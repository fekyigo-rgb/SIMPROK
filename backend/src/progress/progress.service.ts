import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProgressActualStatus } from '@prisma/client';
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
  ProgressActualStatus.SUBMITTED,
  ProgressActualStatus.VERIFIED,
  ProgressActualStatus.ACCEPTED,
];

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: ProgressAuthorityService,
  ) {}

  private actor(accountId: string, access: ProjectAccessContext): TrustedProgressActor {
    return {
      accountId,
      membershipId: access.membershipId,
      roleInProject: access.roleInProject,
    };
  }

  private evidence(value?: ProgressEvidenceReferenceDto[]): Prisma.InputJsonValue | undefined {
    return value?.length ? (value as unknown as Prisma.InputJsonValue) : undefined;
  }

  private assertQuantity(value: string): Prisma.Decimal {
    const quantity = new Prisma.Decimal(value);
    if (quantity.isNegative()) {
      throw new BadRequestException('Installed quantity cannot be negative');
    }
    return quantity;
  }

  private async activeBaselineForWrite(tx: Prisma.TransactionClient, projectId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string; rabDocumentId: string }>>(
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
        action: params.action,
        reason: params.reason,
        evidenceReferences: this.evidence(params.evidence),
        metadata: params.metadata,
      },
    });
  }

  async getMonitoring(projectId: string) {
    const unavailable = ['plannedStart', 'plannedFinish', 'plannedDuration', 'plannedWeight'] as const;
    const baseline = await this.prisma.projectBaseline.findFirst({
      where: { projectId, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
      include: { rabDocument: true },
    });
    if (!baseline?.rabDocument?.boqStructureId) {
      return {
        projectId,
        baseline: baseline
          ? { id: baseline.id, versionNumber: baseline.versionNumber, approvedAt: baseline.approvedAt }
          : null,
        items: [],
        unavailable,
      };
    }
    const items = await this.prisma.boqItem.findMany({
      where: { boqStructureId: baseline.rabDocument.boqStructureId },
      orderBy: { sortOrder: 'asc' },
    });
    const workItemIds = items.filter((item) => item.itemType === 'WORK_ITEM').map((item) => item.id);
    const entries = workItemIds.length
      ? await this.prisma.progressEntry.findMany({
          where: {
            boqItemId: { in: workItemIds },
            status: { in: EFFECTIVE_STATUSES },
            correction: null,
            progressReport: { is: { projectId, baselineId: baseline.id, status: 'SUBMITTED' } },
          },
          orderBy: [{ workDate: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            boqItemId: true,
            installedQuantity: true,
            workDate: true,
            notes: true,
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
    for (const entry of entries) if (!effectiveByItem.has(entry.boqItemId)) effectiveByItem.set(entry.boqItemId, entry);
    return {
      projectId,
      baseline: { id: baseline.id, versionNumber: baseline.versionNumber, approvedAt: baseline.approvedAt },
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
          actual: item.itemType !== 'WORK_ITEM' ? null : effective ? {
            state: 'RECORDED' as const,
            lifecycleState: effective.status,
            effectiveRecord: {
              id: effective.id,
              installedQuantity: effective.installedQuantity.toString(),
              workDate: effective.workDate,
              notes: effective.notes,
              captureMethod: effective.captureMethod,
              evidenceReferences: effective.evidenceReferences ?? [],
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
              photoUrl: null,
              recordedAt: effective.createdAt,
            },
          } : { state: 'NOT_YET_RECORDED' as const, effectiveRecord: null, latestRecord: null },
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
    if (dto.entries.length === 0) throw new BadRequestException('At least one progress entry is required');
    const actor = this.actor(accountId, access);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const replay = await tx.progressReport.findUnique({ where: { commandId: dto.commandId }, include: { entries: true } });
        if (replay) {
          if (replay.projectId !== projectId) throw new ConflictException('COMMAND_ID_PROJECT_CONFLICT');
          return { progressReportId: replay.id, entryIds: replay.entries.map((entry) => entry.id), replayed: true };
        }
        const baseline = await this.activeBaselineForWrite(tx, projectId);
        const itemIds = [...new Set(dto.entries.map((entry) => entry.boqItemId))];
        const items = await tx.boqItem.findMany({
          where: { id: { in: itemIds }, boqStructureId: baseline.boqStructureId, itemType: 'WORK_ITEM' },
          select: { id: true },
        });
        if (items.length !== itemIds.length) throw new BadRequestException('INVALID_PROJECT_WORK_ITEM');
        const dates = dto.entries.map((entry) => new Date(entry.workDate));
        const report = await tx.progressReport.create({
          data: {
            projectId,
            baselineId: baseline.id,
            commandId: dto.commandId,
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
            metadata: { roleInProject: actor.roleInProject, commandId: dto.commandId },
          });
          entryIds.push(entry.id);
        }
        const confirmedBaseline = await this.activeBaselineForWrite(tx, projectId);
        if (confirmedBaseline.id !== baseline.id) {
          throw new ConflictException('ACTIVE_BASELINE_CHANGED');
        }
        return { progressReportId: report.id, entryIds, replayed: false };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.prisma.progressReport.findUnique({ where: { commandId: dto.commandId }, include: { entries: true } });
        if (replay?.projectId === projectId) return { progressReportId: replay.id, entryIds: replay.entries.map((entry) => entry.id), replayed: true };
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
    const authority = await this.authority.require(accountId, access, PROGRESS_AUTHORITIES.CORRECT);
    const actor = this.actor(accountId, access);
    return this.prisma.$transaction(async (tx) => {
      const existingReport = await tx.progressReport.findUnique({ where: { commandId: dto.commandId }, include: { entries: true } });
      if (existingReport) {
        const correction = existingReport.entries[0];
        if (existingReport.projectId !== projectId || correction?.supersedesEntryId !== entryId) throw new ConflictException('COMMAND_ID_CORRECTION_CONFLICT');
        return { entryId: correction.id, replayed: true };
      }
      const locked = await tx.$queryRaw<Array<{ id: string; progressReportId: string; boqItemId: string; status: ProgressActualStatus; revision: number }>>(
        Prisma.sql`SELECT "id", "progressReportId", "boqItemId", "status", "revision"
                     FROM "progress_entries" WHERE "id" = ${entryId}::uuid FOR UPDATE`,
      );
      const original = locked[0];
      if (!original) throw new NotFoundException('Actual not found');
      const report = await tx.progressReport.findUnique({ where: { id: original.progressReportId } });
      if (!report || report.projectId !== projectId) throw new NotFoundException('Actual not found');
      const child = await tx.progressEntry.findUnique({ where: { supersedesEntryId: entryId } });
      if (child) throw new ConflictException('ACTUAL_ALREADY_SUPERSEDED');
      if (!EFFECTIVE_STATUSES.includes(original.status)) throw new ConflictException('ACTUAL_NOT_EFFECTIVE');
      const baseline = await this.activeBaselineForWrite(tx, projectId);
      if (baseline.id !== report.baselineId) throw new ConflictException('ACTIVE_BASELINE_CHANGED');
      const correctionReport = await tx.progressReport.create({
        data: {
          projectId,
          baselineId: report.baselineId,
          commandId: dto.commandId,
          periodStartDate: new Date(dto.workDate),
          periodEndDate: new Date(dto.workDate),
          status: 'SUBMITTED',
        },
      });
      await tx.progressEntry.update({ where: { id: entryId }, data: { status: ProgressActualStatus.RETURNED_FOR_CORRECTION } });
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
      await this.audit(tx, { projectId, entryId, actor, authority, action: 'ACTUAL_RETURNED_FOR_CORRECTION', reason: dto.reason });
      await this.audit(tx, { projectId, entryId: correction.id, actor, authority, action: 'ACTUAL_CORRECTION_SUBMITTED', reason: dto.reason, evidence: dto.evidenceReferences, metadata: { supersedesEntryId: entryId, commandId: dto.commandId } });
      const confirmedBaseline = await this.activeBaselineForWrite(tx, projectId);
      if (confirmedBaseline.id !== baseline.id) {
        throw new ConflictException('ACTIVE_BASELINE_CHANGED');
      }
      return { entryId: correction.id, replayed: false };
    });
  }

  async transitionEntry(
    projectId: string,
    entryId: string,
    action: 'VERIFY' | 'ACCEPT',
    reason: string | undefined,
    accountId: string,
    access: ProjectAccessContext,
  ) {
    const authorityCode = action === 'VERIFY' ? PROGRESS_AUTHORITIES.VERIFY : PROGRESS_AUTHORITIES.ACCEPT;
    const authority = await this.authority.require(accountId, access, authorityCode);
    const actor = this.actor(accountId, access);
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string; progressReportId: string; status: ProgressActualStatus }>>(
        Prisma.sql`SELECT "id", "progressReportId", "status" FROM "progress_entries" WHERE "id" = ${entryId}::uuid FOR UPDATE`,
      );
      const entry = locked[0];
      if (!entry) throw new NotFoundException('Actual not found');
      const report = await tx.progressReport.findUnique({ where: { id: entry.progressReportId } });
      if (!report || report.projectId !== projectId) throw new NotFoundException('Actual not found');
      if (await tx.progressEntry.findUnique({ where: { supersedesEntryId: entryId } })) throw new ConflictException('ACTUAL_NOT_EFFECTIVE');
      const expected = action === 'VERIFY' ? ProgressActualStatus.SUBMITTED : ProgressActualStatus.VERIFIED;
      const target = action === 'VERIFY' ? ProgressActualStatus.VERIFIED : ProgressActualStatus.ACCEPTED;
      if (entry.status !== expected) throw new ConflictException(`ACTUAL_MUST_BE_${expected}`);
      await tx.progressEntry.update({ where: { id: entryId }, data: { status: target } });
      await this.audit(tx, { projectId, entryId, actor, authority, action: `ACTUAL_${target}`, reason, metadata: { from: expected, to: target, roleInProject: actor.roleInProject } });
      return { entryId, status: target };
    });
  }

  async getWorkItemHistory(projectId: string, boqItemId: string, accountId: string, access: ProjectAccessContext) {
    const baseline = await this.prisma.projectBaseline.findFirst({ where: { projectId, status: 'ACTIVE' }, orderBy: { versionNumber: 'desc' }, include: { rabDocument: true } });
    if (!baseline?.rabDocument || !(await this.prisma.boqItem.findFirst({ where: { id: boqItemId, boqStructureId: baseline.rabDocument.boqStructureId, itemType: 'WORK_ITEM' } }))) throw new NotFoundException('Work item not found');
    const entries = await this.prisma.progressEntry.findMany({
      where: { boqItemId, progressReport: { projectId } },
      orderBy: [{ revision: 'asc' }, { createdAt: 'asc' }],
      include: { auditEvents: { orderBy: { occurredAt: 'asc' } } },
    });
    const [verify, correct, accept] = await Promise.all([
      this.authority.resolve(accountId, access, PROGRESS_AUTHORITIES.VERIFY),
      this.authority.resolve(accountId, access, PROGRESS_AUTHORITIES.CORRECT),
      this.authority.resolve(accountId, access, PROGRESS_AUTHORITIES.ACCEPT),
    ]);
    return {
      projectId,
      boqItemId,
      availableActions: { verify: !!verify, correct: !!correct, accept: !!accept },
      entries: entries.map((entry) => ({
        id: entry.id,
        installedQuantity: entry.installedQuantity.toString(),
        actualCost: entry.actualCost?.toString() ?? null,
        earnedValue: entry.earnedValue?.toString() ?? null,
        workDate: entry.workDate,
        recordedAt: entry.createdAt,
        recordedByAccountId: entry.recordedByAccountId,
        captureMethod: entry.captureMethod,
        evidenceReferences: entry.evidenceReferences ?? [],
        status: entry.status,
        supersedesEntryId: entry.supersedesEntryId,
        correctionReason: entry.correctionReason,
        revision: entry.revision,
        audit: entry.auditEvents,
      })),
    };
  }
}
