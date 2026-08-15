import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProgressActualStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { ProjectAccessContext } from '../auth/project-access-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CorrectProgressDto,
  ProgressEvidenceReferenceDto,
  SubmitFieldProgressDto,
} from './dto/create-progress.dto';
import {
  PROGRESS_AUTHORITIES,
  ProgressAuthorityService,
  type ProgressAuthorityContext,
} from './progress-authority.service';

interface TrustedProgressActor {
  accountId: string;
  membershipId: string;
  roleInProject: string;
}

const EFFECTIVE_STATUSES: ProgressActualStatus[] = [
  ProgressActualStatus.LEGACY_UNSPECIFIED,
  ProgressActualStatus.SUBMITTED,
  ProgressActualStatus.VERIFIED,
  ProgressActualStatus.ACCEPTED,
];

interface EffectiveCandidate {
  id: string;
  workDate: Date | null;
  createdAt: Date;
  supersedesEntryId: string | null;
}

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: ProgressAuthorityService,
  ) {}

  private actor(
    accountId: string,
    access: ProjectAccessContext,
  ): TrustedProgressActor {
    return {
      accountId,
      membershipId: access.membershipId,
      roleInProject: access.roleInProject,
    };
  }

  private evidence(
    value?: ProgressEvidenceReferenceDto[],
  ): Prisma.InputJsonValue | undefined {
    return value?.length
      ? (value as unknown as Prisma.InputJsonValue)
      : undefined;
  }

  private assertQuantity(value: string): Prisma.Decimal {
    const quantity = new Prisma.Decimal(value);
    if (quantity.isNegative()) {
      throw new BadRequestException('Installed quantity cannot be negative');
    }
    return quantity;
  }

  private fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private effectiveEntry<T extends EffectiveCandidate>(entries: T[]): T | null {
    const supersededIds = new Set(
      entries.map((entry) => entry.supersedesEntryId).filter(Boolean),
    );
    return (
      [...entries]
        .filter((entry) => !supersededIds.has(entry.id))
        .sort((left, right) => {
          const workDate =
            (right.workDate?.getTime() ?? Number.MIN_SAFE_INTEGER) -
            (left.workDate?.getTime() ?? Number.MIN_SAFE_INTEGER);
          if (workDate !== 0) return workDate;
          const recorded = right.createdAt.getTime() - left.createdAt.getTime();
          return recorded !== 0 ? recorded : right.id.localeCompare(left.id);
        })[0] ?? null
    );
  }

  private evidenceProjection(entry: {
    evidenceReferences: Prisma.JsonValue | null;
    photoUrl: string | null;
  }) {
    const current = Array.isArray(entry.evidenceReferences)
      ? entry.evidenceReferences
      : [];
    return entry.photoUrl
      ? [
          ...current,
          {
            url: entry.photoUrl,
            label: 'Bukti lama',
            kind: 'LEGACY_REFERENCE',
            verificationState: 'UNAVAILABLE',
          },
        ]
      : current;
  }

  private async activeBaselineForWrite(
    tx: Prisma.TransactionClient,
    projectId: string,
  ) {
    const rows = await tx.$queryRaw<
      Array<{ id: string; rabDocumentId: string }>
    >(
      Prisma.sql`SELECT "id", "rabDocumentId"
                   FROM "project_baselines"
                  WHERE "projectId" = ${projectId}::uuid AND "status" = 'ACTIVE'
                  ORDER BY "versionNumber" DESC
                  FOR SHARE`,
    );
    if (rows.length !== 1) {
      throw new ConflictException(
        rows.length === 0 ? 'NO_ACTIVE_BASELINE' : 'MULTIPLE_ACTIVE_BASELINES',
      );
    }
    const rab = await tx.rabDocument.findUnique({
      where: { id: rows[0].rabDocumentId },
      select: { boqStructureId: true },
    });
    if (!rab) throw new ConflictException('ACTIVE_BASELINE_RAB_NOT_FOUND');
    return { id: rows[0].id, boqStructureId: rab.boqStructureId };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    params: {
      projectId: string;
      entryId: string;
      actor: TrustedProgressActor;
      action: string;
      reason?: string;
      evidence?: ProgressEvidenceReferenceDto[];
      authority?: ProgressAuthorityContext;
      metadata?: Prisma.InputJsonValue;
      commandId?: string;
      commandFingerprint?: string;
    },
  ) {
    await tx.progressAuditEvent.create({
      data: {
        projectId: params.projectId,
        progressEntryId: params.entryId,
        actorAccountId: params.actor.accountId,
        actorMembershipId: params.actor.membershipId,
        actorPositionId: params.authority?.positionId,
        authorityCode: params.authority?.authorityCode,
        positionCodeSnapshot: params.authority?.positionCode,
        roleInProjectSnapshot: params.actor.roleInProject,
        commandId: params.commandId,
        commandFingerprint: params.commandFingerprint,
        action: params.action,
        reason: params.reason,
        evidenceReferences: this.evidence(params.evidence),
        metadata: params.metadata,
      },
    });
  }

  async getMonitoring(projectId: string) {
    const unavailable = [
      'plannedStart',
      'plannedFinish',
      'plannedDuration',
      'plannedWeight',
    ] as const;
    const baseline = await this.prisma.projectBaseline.findFirst({
      where: { projectId, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
      include: { rabDocument: true },
    });
    if (!baseline?.rabDocument?.boqStructureId) {
      return {
        projectId,
        baseline: baseline
          ? {
              id: baseline.id,
              versionNumber: baseline.versionNumber,
              approvedAt: baseline.approvedAt,
            }
          : null,
        items: [],
        unavailable,
      };
    }
    const items = await this.prisma.boqItem.findMany({
      where: { boqStructureId: baseline.rabDocument.boqStructureId },
      orderBy: { sortOrder: 'asc' },
    });
    const workItemIds = items
      .filter((item) => item.itemType === 'WORK_ITEM')
      .map((item) => item.id);
    const entries = workItemIds.length
      ? await this.prisma.progressEntry.findMany({
          where: {
            boqItemId: { in: workItemIds },
            status: { in: EFFECTIVE_STATUSES },
            correction: null,
            progressReport: {
              is: { projectId, baselineId: baseline.id, status: 'SUBMITTED' },
            },
          },
          orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            boqItemId: true,
            installedQuantity: true,
            workDate: true,
            notes: true,
            photoUrl: true,
            evidenceReferences: true,
            captureMethod: true,
            status: true,
            recordedByAccountId: true,
            supersedesEntryId: true,
            createdAt: true,
          },
        })
      : [];
    const effectiveByItem = new Map<string, (typeof entries)[number]>();
    for (const workItemId of workItemIds) {
      const effective = this.effectiveEntry(
        entries.filter((entry) => entry.boqItemId === workItemId),
      );
      if (effective) effectiveByItem.set(workItemId, effective);
    }
    return {
      projectId,
      baseline: {
        id: baseline.id,
        versionNumber: baseline.versionNumber,
        approvedAt: baseline.approvedAt,
      },
      items: items.map((item) => {
        const effective = effectiveByItem.get(item.id);
        return {
          id: item.id,
          parentId: item.parentId,
          wbsNodeId: item.wbsNodeId,
          wbsCode: item.wbsCode,
          name: item.name,
          itemType: item.itemType,
          sortOrder: item.sortOrder,
          planned: { quantity: item.quantity.toString(), unit: item.unit },
          actual:
            item.itemType !== 'WORK_ITEM'
              ? null
              : effective
                ? {
                    state: 'RECORDED' as const,
                    lifecycleState: effective.status,
                    effectiveRecord: {
                      id: effective.id,
                      installedQuantity: effective.installedQuantity.toString(),
                      workDate: effective.workDate,
                      notes: effective.notes,
                      captureMethod: effective.captureMethod,
                      evidenceReferences: this.evidenceProjection(effective),
                      recordedByAccountId: effective.recordedByAccountId,
                      supersedesEntryId: effective.supersedesEntryId,
                      recordedAt: effective.createdAt,
                    },
                    // MON-02A compatibility while clients migrate to effectiveRecord.
                    latestRecord: {
                      id: effective.id,
                      installedQuantity: effective.installedQuantity.toString(),
                      workDate: effective.workDate,
                      notes: effective.notes,
                      photoUrl: effective.photoUrl,
                      recordedAt: effective.createdAt,
                    },
                  }
                : {
                    state: 'NOT_YET_RECORDED' as const,
                    effectiveRecord: null,
                    latestRecord: null,
                  },
        };
      }),
      unavailable,
    };
  }

  async submitFieldProgress(
    projectId: string,
    dto: SubmitFieldProgressDto,
    accountId: string,
    access: ProjectAccessContext,
  ) {
    if (dto.entries.length === 0)
      throw new BadRequestException('At least one progress entry is required');
    const actor = this.actor(accountId, access);
    const commandFingerprint = this.fingerprint({
      kind: 'SUBMIT_ACTUAL',
      projectId,
      actorAccountId: accountId,
      entries: dto.entries,
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.progressReport.findUnique({
          where: { commandId: dto.commandId },
          include: { entries: true },
        });
        if (replay) {
          if (
            replay.projectId !== projectId ||
            replay.commandFingerprint !== commandFingerprint ||
            replay.entries.some(
              (entry) => entry.recordedByAccountId !== accountId,
            )
          ) {
            throw new ConflictException('COMMAND_ID_PAYLOAD_CONFLICT');
          }
          return {
            progressReportId: replay.id,
            entryIds: replay.entries.map((entry) => entry.id),
            replayed: true,
          };
        }
        await this.authority.requireActiveActor(tx, accountId, access);
        const baseline = await this.activeBaselineForWrite(tx, projectId);
        const itemIds = [
          ...new Set(dto.entries.map((entry) => entry.boqItemId)),
        ];
        const items = await tx.boqItem.findMany({
          where: {
            id: { in: itemIds },
            boqStructureId: baseline.boqStructureId,
            itemType: 'WORK_ITEM',
          },
          select: { id: true },
        });
        if (items.length !== itemIds.length)
          throw new BadRequestException('INVALID_PROJECT_WORK_ITEM');
        const dates = dto.entries.map((entry) => new Date(entry.workDate));
        const report = await tx.progressReport.create({
          data: {
            projectId,
            baselineId: baseline.id,
            commandId: dto.commandId,
            commandFingerprint,
            periodStartDate: new Date(Math.min(...dates.map(Number))),
            periodEndDate: new Date(Math.max(...dates.map(Number))),
            status: 'SUBMITTED',
          },
        });
        const entryIds: string[] = [];
        for (const input of dto.entries) {
          const entry = await tx.progressEntry.create({
            data: {
              progressReportId: report.id,
              boqItemId: input.boqItemId,
              installedQuantity: this.assertQuantity(input.installedQuantity),
              actualCost: null,
              earnedValue: null,
              workDate: new Date(input.workDate),
              notes: input.notes,
              captureMethod: input.captureMethod,
              evidenceReferences: this.evidence(input.evidenceReferences),
              recordedByAccountId: actor.accountId,
              recordedByMembershipId: actor.membershipId,
              status: ProgressActualStatus.SUBMITTED,
            },
          });
          await this.audit(tx, {
            projectId,
            entryId: entry.id,
            actor,
            action: 'ACTUAL_SUBMITTED',
            evidence: input.evidenceReferences,
            metadata: {
              roleInProject: actor.roleInProject,
              commandId: dto.commandId,
            },
          });
          entryIds.push(entry.id);
        }
        const confirmedBaseline = await this.activeBaselineForWrite(
          tx,
          projectId,
        );
        if (confirmedBaseline.id !== baseline.id) {
          throw new ConflictException('ACTIVE_BASELINE_CHANGED');
        }
        return { progressReportId: report.id, entryIds, replayed: false };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await this.prisma.progressReport.findUnique({
          where: { commandId: dto.commandId },
          include: { entries: true },
        });
        if (
          replay?.projectId === projectId &&
          replay.commandFingerprint === commandFingerprint &&
          replay.entries.every(
            (entry) => entry.recordedByAccountId === accountId,
          )
        ) {
          return {
            progressReportId: replay.id,
            entryIds: replay.entries.map((entry) => entry.id),
            replayed: true,
          };
        }
        throw new ConflictException('COMMAND_ID_PAYLOAD_CONFLICT');
      }
      throw error;
    }
  }

  async correctEntry(
    projectId: string,
    entryId: string,
    dto: CorrectProgressDto,
    accountId: string,
    access: ProjectAccessContext,
  ) {
    const actor = this.actor(accountId, access);
    const commandFingerprint = this.fingerprint({
      kind: 'CORRECT_ACTUAL',
      projectId,
      entryId,
      actorAccountId: accountId,
      installedQuantity: dto.installedQuantity,
      workDate: dto.workDate,
      captureMethod: dto.captureMethod,
      reason: dto.reason,
      notes: dto.notes,
      evidenceReferences: dto.evidenceReferences,
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const existingReport = await tx.progressReport.findUnique({
          where: { commandId: dto.commandId },
          include: { entries: true },
        });
        if (existingReport) {
          const correction = existingReport.entries[0];
          if (
            existingReport.projectId !== projectId ||
            existingReport.commandFingerprint !== commandFingerprint ||
            correction?.supersedesEntryId !== entryId ||
            correction.recordedByAccountId !== accountId
          )
            throw new ConflictException('COMMAND_ID_CORRECTION_CONFLICT');
          return { entryId: correction.id, replayed: true };
        }
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            progressReportId: string;
            boqItemId: string;
            status: ProgressActualStatus;
            revision: number;
          }>
        >(
          Prisma.sql`SELECT "id", "progressReportId", "boqItemId", "status", "revision"
                     FROM "progress_entries" WHERE "id" = ${entryId}::uuid FOR UPDATE`,
        );
        const original = locked[0];
        if (!original) throw new NotFoundException('Actual not found');
        const report = await tx.progressReport.findUnique({
          where: { id: original.progressReportId },
        });
        if (!report || report.projectId !== projectId)
          throw new NotFoundException('Actual not found');
        const authority = await this.authority.requireWithinTransaction(
          tx,
          accountId,
          access,
          PROGRESS_AUTHORITIES.CORRECT,
        );
        const child = await tx.progressEntry.findUnique({
          where: { supersedesEntryId: entryId },
        });
        if (child) throw new ConflictException('ACTUAL_ALREADY_SUPERSEDED');
        if (!EFFECTIVE_STATUSES.includes(original.status))
          throw new ConflictException('ACTUAL_NOT_EFFECTIVE');
        const baseline = await this.activeBaselineForWrite(tx, projectId);
        if (baseline.id !== report.baselineId)
          throw new ConflictException('ACTIVE_BASELINE_CHANGED');
        const correctionReport = await tx.progressReport.create({
          data: {
            projectId,
            baselineId: report.baselineId,
            commandId: dto.commandId,
            commandFingerprint,
            periodStartDate: new Date(dto.workDate),
            periodEndDate: new Date(dto.workDate),
            status: 'SUBMITTED',
          },
        });
        if (original.status === ProgressActualStatus.SUBMITTED) {
          await tx.progressEntry.update({
            where: { id: entryId },
            data: { status: ProgressActualStatus.RETURNED_FOR_CORRECTION },
          });
        }
        const correction = await tx.progressEntry.create({
          data: {
            progressReportId: correctionReport.id,
            boqItemId: original.boqItemId,
            installedQuantity: this.assertQuantity(dto.installedQuantity),
            actualCost: null,
            earnedValue: null,
            workDate: new Date(dto.workDate),
            notes: dto.notes,
            captureMethod: dto.captureMethod,
            evidenceReferences: this.evidence(dto.evidenceReferences),
            recordedByAccountId: actor.accountId,
            recordedByMembershipId: actor.membershipId,
            supersedesEntryId: entryId,
            correctionReason: dto.reason,
            revision: original.revision + 1,
            status: ProgressActualStatus.SUBMITTED,
          },
        });
        await this.audit(tx, {
          projectId,
          entryId,
          actor,
          authority,
          action:
            original.status === ProgressActualStatus.SUBMITTED
              ? 'ACTUAL_RETURNED_FOR_CORRECTION'
              : 'ACTUAL_SUPERSEDED_BY_CORRECTION',
          reason: dto.reason,
          metadata: { historicalStatusPreserved: original.status },
        });
        await this.audit(tx, {
          projectId,
          entryId: correction.id,
          actor,
          authority,
          action: 'ACTUAL_CORRECTION_SUBMITTED',
          reason: dto.reason,
          evidence: dto.evidenceReferences,
          metadata: { supersedesEntryId: entryId, commandId: dto.commandId },
        });
        const confirmedBaseline = await this.activeBaselineForWrite(
          tx,
          projectId,
        );
        if (confirmedBaseline.id !== baseline.id) {
          throw new ConflictException('ACTIVE_BASELINE_CHANGED');
        }
        return { entryId: correction.id, replayed: false };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await this.prisma.progressReport.findUnique({
          where: { commandId: dto.commandId },
          include: { entries: true },
        });
        const correction = replay?.entries[0];
        if (
          replay?.projectId === projectId &&
          replay.commandFingerprint === commandFingerprint &&
          correction?.supersedesEntryId === entryId &&
          correction.recordedByAccountId === accountId
        ) {
          return { entryId: correction.id, replayed: true };
        }
        throw new ConflictException('COMMAND_ID_CORRECTION_CONFLICT');
      }
      throw error;
    }
  }

  async transitionEntry(
    projectId: string,
    entryId: string,
    action: 'VERIFY' | 'ACCEPT',
    commandId: string,
    reason: string | undefined,
    accountId: string,
    access: ProjectAccessContext,
  ) {
    const authorityCode =
      action === 'VERIFY'
        ? PROGRESS_AUTHORITIES.VERIFY
        : PROGRESS_AUTHORITIES.ACCEPT;
    const actor = this.actor(accountId, access);
    const commandFingerprint = this.fingerprint({
      kind: action,
      projectId,
      entryId,
      actorAccountId: accountId,
      reason,
    });
    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            progressReportId: string;
            status: ProgressActualStatus;
          }>
        >(
          Prisma.sql`SELECT "id", "progressReportId", "status" FROM "progress_entries" WHERE "id" = ${entryId}::uuid FOR UPDATE`,
        );
        const entry = locked[0];
        if (!entry) throw new NotFoundException('Actual not found');
        const replay = await tx.progressAuditEvent.findUnique({
          where: { commandId },
        });
        if (replay) {
          if (
            replay.projectId !== projectId ||
            replay.progressEntryId !== entryId ||
            replay.actorAccountId !== accountId ||
            replay.commandFingerprint !== commandFingerprint
          ) {
            throw new ConflictException('COMMAND_ID_TRANSITION_CONFLICT');
          }
          return {
            entryId,
            status:
              action === 'VERIFY'
                ? ProgressActualStatus.VERIFIED
                : ProgressActualStatus.ACCEPTED,
            replayed: true,
          };
        }
        const report = await tx.progressReport.findUnique({
          where: { id: entry.progressReportId },
        });
        if (!report || report.projectId !== projectId)
          throw new NotFoundException('Actual not found');
        const authority = await this.authority.requireWithinTransaction(
          tx,
          accountId,
          access,
          authorityCode,
        );
        if (
          await tx.progressEntry.findUnique({
            where: { supersedesEntryId: entryId },
          })
        )
          throw new ConflictException('ACTUAL_NOT_EFFECTIVE');
        const expected =
          action === 'VERIFY'
            ? ProgressActualStatus.SUBMITTED
            : ProgressActualStatus.VERIFIED;
        const target =
          action === 'VERIFY'
            ? ProgressActualStatus.VERIFIED
            : ProgressActualStatus.ACCEPTED;
        if (entry.status !== expected)
          throw new ConflictException(`ACTUAL_MUST_BE_${expected}`);
        await tx.progressEntry.update({
          where: { id: entryId },
          data: { status: target },
        });
        await this.audit(tx, {
          projectId,
          entryId,
          actor,
          authority,
          action: `ACTUAL_${target}`,
          reason,
          commandId,
          commandFingerprint,
          metadata: { from: expected, to: target },
        });
        return { entryId, status: target, replayed: false };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await this.prisma.progressAuditEvent.findUnique({
          where: { commandId },
        });
        if (
          replay?.projectId === projectId &&
          replay.progressEntryId === entryId &&
          replay.actorAccountId === accountId &&
          replay.commandFingerprint === commandFingerprint
        ) {
          return {
            entryId,
            status:
              action === 'VERIFY'
                ? ProgressActualStatus.VERIFIED
                : ProgressActualStatus.ACCEPTED,
            replayed: true,
          };
        }
        throw new ConflictException('COMMAND_ID_TRANSITION_CONFLICT');
      }
      throw error;
    }
  }

  async getWorkItemHistory(
    projectId: string,
    boqItemId: string,
    accountId: string,
    access: ProjectAccessContext,
  ) {
    const baseline = await this.prisma.projectBaseline.findFirst({
      where: { projectId, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
      include: { rabDocument: true },
    });
    const workItem = baseline?.rabDocument
      ? await this.prisma.boqItem.findFirst({
          where: {
            id: boqItemId,
            boqStructureId: baseline.rabDocument.boqStructureId,
            itemType: 'WORK_ITEM',
          },
        })
      : null;
    if (!baseline?.rabDocument || !workItem)
      throw new NotFoundException('Work item not found');
    const entries = await this.prisma.progressEntry.findMany({
      where: { boqItemId, progressReport: { projectId } },
      orderBy: [{ revision: 'asc' }, { createdAt: 'asc' }],
      include: {
        progressReport: { select: { baselineId: true } },
        auditEvents: {
          orderBy: { occurredAt: 'asc' },
          include: { actor: { select: { displayName: true } } },
        },
      },
    });
    const effective = this.effectiveEntry(
      entries.filter((entry) => EFFECTIVE_STATUSES.includes(entry.status)),
    );
    const [verify, correct, accept] = await Promise.all([
      this.authority.resolve(accountId, access, PROGRESS_AUTHORITIES.VERIFY),
      this.authority.resolve(accountId, access, PROGRESS_AUTHORITIES.CORRECT),
      this.authority.resolve(accountId, access, PROGRESS_AUTHORITIES.ACCEPT),
    ]);
    return {
      projectId,
      boqItemId,
      baseline: { id: baseline.id, versionNumber: baseline.versionNumber },
      workItem: {
        id: workItem.id,
        wbsCode: workItem.wbsCode,
        name: workItem.name,
        planned: {
          quantity: workItem.quantity.toString(),
          unit: workItem.unit,
        },
      },
      effectiveEntryId: effective?.id ?? null,
      availableActions: {
        verify: !!verify,
        correct: !!correct,
        accept: !!accept,
      },
      entries: entries.map((entry) => ({
        id: entry.id,
        installedQuantity: entry.installedQuantity.toString(),
        actualCost: entry.actualCost?.toString() ?? null,
        earnedValue: entry.earnedValue?.toString() ?? null,
        workDate: entry.workDate,
        recordedAt: entry.createdAt,
        recordedByAccountId: entry.recordedByAccountId,
        captureMethod: entry.captureMethod,
        evidenceReferences: this.evidenceProjection(entry),
        status: entry.status,
        supersedesEntryId: entry.supersedesEntryId,
        correctionReason: entry.correctionReason,
        revision: entry.revision,
        isEffective: entry.id === effective?.id,
        provenance: {
          projectId,
          workItemId: boqItemId,
          baselineId: entry.progressReport.baselineId,
          recordedBy: entry.recordedByAccountId
            ? {
                accountId: entry.recordedByAccountId,
                displayName: entry.auditEvents[0]?.actor.displayName ?? null,
              }
            : null,
        },
        timeline: entry.auditEvents.map((event) => ({
          action: event.action,
          actor: {
            accountId: event.actorAccountId,
            displayName: event.actor.displayName,
          },
          occurredAt: event.occurredAt,
          reason: event.reason,
          authorityCode: event.authorityCode,
          positionCode: event.positionCodeSnapshot,
          roleInProject: event.roleInProjectSnapshot,
          evidenceReferences: event.evidenceReferences ?? [],
        })),
      })),
    };
  }
}
