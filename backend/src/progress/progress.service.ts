import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  ProgressActualStatus,
  ProgressAuditOutcome,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { ProjectAccessContext } from '../auth/project-access-policy.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CorrectProgressDto,
  ProgressEvidenceReferenceDto,
  SubmitFieldProgressDto,
} from './dto/create-progress.dto';
import { PERMISSIONS } from '../common/constants/permissions';
import { WorkspacePermissionResolverService } from '../auth/workspace-permission-resolver.service';
import {
  PROGRESS_AUTHORITIES,
  ProgressAuthorityService,
  type ProgressAuthorityContext,
} from './progress-authority.service';

interface TrustedProgressActor {
  accountId: string;
  membershipId: string;
  workspaceId: string;
  roleInProject: string;
}

interface ProgressRequestTrace {
  requestId: string;
  correlationId: string;
}

const EFFECTIVE_STATUSES: ProgressActualStatus[] = [
  ProgressActualStatus.LEGACY_UNSPECIFIED,
  ProgressActualStatus.RECORDED,
  ProgressActualStatus.SUBMITTED,
  ProgressActualStatus.VERIFIED,
  ProgressActualStatus.ACCEPTED,
];

const PROGRESS_AUDIT_SCHEMA_VERSION = 1;
const PROGRESS_AUDIT_EVENT_TYPE = 'ACTUAL_PROGRESS';
const PROGRESS_AUDIT_SOURCE_MODULE = 'FIELD_PROGRESS';
const PROGRESS_AUDIT_ACTOR_TYPE = 'USER';
const PROJECT_BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

interface EffectiveCandidate {
  id: string;
  workDate: Date | null;
  createdAt: Date;
  supersedesEntryId: string | null;
  status: ProgressActualStatus;
  revision: number;
}

@Injectable()
export class ProgressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: ProgressAuthorityService,
    private readonly permissionResolver: WorkspacePermissionResolverService,
  ) {}

  private actor(
    accountId: string,
    access: ProjectAccessContext,
  ): TrustedProgressActor {
    return {
      accountId,
      membershipId: access.membershipId,
      workspaceId: access.workspaceId,
      roleInProject: access.roleInProject,
    };
  }

  private trace(trace?: Partial<ProgressRequestTrace>): ProgressRequestTrace {
    return {
      requestId: trace?.requestId ?? randomUUID(),
      correlationId: trace?.correlationId ?? randomUUID(),
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

  private projectBusinessDate(value: string): Date {
    const match = PROJECT_BUSINESS_DATE.exec(value);
    if (!match) {
      throw new BadRequestException('WORK_DATE_PROJECT_BUSINESS_DATE_REQUIRED');
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      throw new BadRequestException('WORK_DATE_PROJECT_BUSINESS_DATE_REQUIRED');
    }
    return date;
  }

  private fingerprint(value: unknown): string {
    const canonicalize = (input: unknown): unknown => {
      if (Array.isArray(input)) return input.map(canonicalize);
      if (input && typeof input === 'object') {
        return Object.fromEntries(
          Object.entries(input as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonicalize(item)]),
        );
      }
      return input;
    };
    return createHash('sha256')
      .update(JSON.stringify(canonicalize(value)))
      .digest('hex');
  }

  private effectiveEntry<T extends EffectiveCandidate>(entries: T[]): T | null {
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const chains = new Map<string, T[]>();
    const legitimacy = (status: ProgressActualStatus) => {
      if (status === ProgressActualStatus.ACCEPTED) return 3;
      if (status === ProgressActualStatus.VERIFIED) return 2;
      return EFFECTIVE_STATUSES.includes(status) ? 1 : -1;
    };
    for (const entry of entries) {
      let root = entry;
      const visited = new Set<string>();
      while (root.supersedesEntryId && byId.has(root.supersedesEntryId)) {
        if (visited.has(root.id)) break;
        visited.add(root.id);
        root = byId.get(root.supersedesEntryId)!;
      }
      const chain = chains.get(root.id) ?? [];
      chain.push(entry);
      chains.set(root.id, chain);
    }

    const candidates = [...chains.values()]
      .map(
        (chain) =>
          [...chain]
            .filter((entry) => legitimacy(entry.status) >= 0)
            .sort((left, right) => {
              const rank = legitimacy(right.status) - legitimacy(left.status);
              if (rank !== 0) return rank;
              const revision = right.revision - left.revision;
              if (revision !== 0) return revision;
              const recorded =
                right.createdAt.getTime() - left.createdAt.getTime();
              return recorded !== 0
                ? recorded
                : right.id.localeCompare(left.id);
            })[0] ?? null,
      )
      .filter((entry): entry is T => entry !== null);

    return (
      candidates.sort((left, right) => {
        const workDate =
          (right.workDate?.getTime() ?? Number.MIN_SAFE_INTEGER) -
          (left.workDate?.getTime() ?? Number.MIN_SAFE_INTEGER);
        if (workDate !== 0) return workDate;
        const recorded = right.createdAt.getTime() - left.createdAt.getTime();
        return recorded !== 0 ? recorded : right.id.localeCompare(left.id);
      })[0] ?? null
    );
  }

  private governanceCandidate<T extends EffectiveCandidate>(
    entries: T[],
  ): T | null {
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
          const revision = right.revision - left.revision;
          if (revision !== 0) return revision;
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
            label: 'Referensi bukti lama — status verifikasi tidak tersedia',
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
      trace: ProgressRequestTrace;
      reason?: string;
      reasonCode?: string;
      reasonText?: string;
      evidence?: ProgressEvidenceReferenceDto[];
      authority?: ProgressAuthorityContext;
      metadata?: Prisma.InputJsonValue;
      businessCommandId?: string;
      commandId?: string;
      commandFingerprint?: string;
      entityVersionBefore?: number;
      entityVersionAfter?: number;
    },
  ) {
    const now = new Date();
    await tx.progressAuditEvent.create({
      data: {
        schemaVersion: PROGRESS_AUDIT_SCHEMA_VERSION,
        eventType: PROGRESS_AUDIT_EVENT_TYPE,
        outcome: ProgressAuditOutcome.SUCCESS,
        workspaceId: params.actor.workspaceId,
        projectId: params.projectId,
        progressEntryId: params.entryId,
        actorAccountId: params.actor.accountId,
        actorMembershipId: params.actor.membershipId,
        actorPositionId: params.authority?.positionId,
        actorType: PROGRESS_AUDIT_ACTOR_TYPE,
        authorityCode: params.authority?.authorityCode,
        positionCodeSnapshot: params.authority?.positionCode,
        roleInProjectSnapshot: params.actor.roleInProject,
        sourceModule: PROGRESS_AUDIT_SOURCE_MODULE,
        targetEntityType: 'PROGRESS_ENTRY',
        targetEntityId: params.entryId,
        correlationId: params.trace.correlationId,
        requestId: params.trace.requestId,
        businessCommandId: params.businessCommandId,
        commandId: params.commandId,
        commandFingerprint: params.commandFingerprint,
        action: params.action,
        reason: params.reasonText ?? params.reason,
        reasonCode: params.reasonCode,
        reasonText: params.reasonText ?? params.reason,
        errorCode: null,
        entityVersionBefore: params.entityVersionBefore,
        entityVersionAfter: params.entityVersionAfter,
        evidenceReferences: this.evidence(params.evidence),
        metadata: params.metadata,
        occurredAt: now,
        recordedAt: now,
      },
    });
  }

  private denialErrorCode(error: unknown): string | null {
    if (error instanceof ForbiddenException) {
      const known = [
        'PROJECT_ASSIGNMENT_REVOKED',
        'ACTIVE_PROJECT_ACTOR_REQUIRED',
        'DECISION_AUTHORITY_REVOKED',
        'DECISION_AUTHORITY_REQUIRED',
        'SEPARATION_OF_DUTIES_DENIED',
      ];
      return known.includes(`${error.message}`)
        ? `${error.message}`
        : 'AUTHORITY_OR_ASSIGNMENT_DENIED';
    }
    if (error instanceof NotFoundException) {
      return 'TARGET_NOT_AVAILABLE';
    }
    if (error instanceof ConflictException) {
      return `${error.message}`.startsWith('COMMAND_ID_')
        ? 'COMMAND_CONFLICT'
        : 'INVALID_LIFECYCLE_TRANSITION';
    }
    if (
      error instanceof BadRequestException &&
      `${error.message}` === 'INVALID_PROJECT_WORK_ITEM'
    ) {
      return 'TARGET_SCOPE_DENIED';
    }
    return null;
  }

  private async auditDenied(params: {
    projectId: string;
    actor: TrustedProgressActor;
    action: string;
    trace: ProgressRequestTrace;
    errorCode: string;
    errorText?: string;
    targetEntityType: string;
    targetEntityId?: string;
    metadata?: Prisma.InputJsonValue;
    businessCommandId?: string;
    commandId?: string;
    commandFingerprint?: string;
  }) {
    const now = new Date();
    try {
      await this.prisma.progressAuditEvent.create({
        data: {
          schemaVersion: PROGRESS_AUDIT_SCHEMA_VERSION,
          eventType: PROGRESS_AUDIT_EVENT_TYPE,
          outcome: ProgressAuditOutcome.DENIED,
          workspaceId: params.actor.workspaceId,
          projectId: params.projectId,
          progressEntryId: null,
          actorAccountId: params.actor.accountId,
          actorMembershipId: params.actor.membershipId,
          actorType: PROGRESS_AUDIT_ACTOR_TYPE,
          roleInProjectSnapshot: params.actor.roleInProject,
          sourceModule: PROGRESS_AUDIT_SOURCE_MODULE,
          targetEntityType: params.targetEntityType,
          targetEntityId: params.targetEntityId,
          correlationId: params.trace.correlationId,
          requestId: params.trace.requestId,
          businessCommandId: params.businessCommandId,
          commandId: params.commandId
            ? `DENIED:${params.action}:${params.commandId}`
            : undefined,
          commandFingerprint: params.commandFingerprint,
          action: params.action,
          reason: params.errorText,
          reasonCode: null,
          reasonText: null,
          errorCode: params.errorCode,
          metadata: params.metadata,
          occurredAt: now,
          recordedAt: now,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw new ServiceUnavailableException('DENIAL_AUDIT_UNAVAILABLE');
    }
  }

  private async auditDeniedAndRethrow(params: {
    error: unknown;
    projectId: string;
    actor: TrustedProgressActor;
    action: string;
    trace: ProgressRequestTrace;
    targetEntityType: string;
    targetEntityId?: string;
    metadata?: Prisma.InputJsonValue;
    businessCommandId?: string;
    commandId?: string;
    commandFingerprint?: string;
  }): Promise<never> {
    const errorCode = this.denialErrorCode(params.error);
    if (errorCode) {
      const safeTargetEntityId =
        errorCode === 'TARGET_NOT_AVAILABLE'
          ? undefined
          : params.targetEntityId;
      await this.auditDenied({
        projectId: params.projectId,
        actor: params.actor,
        action: params.action,
        trace: params.trace,
        errorCode,
        errorText:
          params.error instanceof Error ? params.error.message : undefined,
        targetEntityType: params.targetEntityType,
        targetEntityId: safeTargetEntityId,
        metadata: params.metadata,
        businessCommandId: params.businessCommandId,
        commandId: params.commandId,
        commandFingerprint: params.commandFingerprint,
      });
    }
    throw params.error;
  }

  async getMonitoring(projectId: string) {
    const unavailable = [
      'plannedStart',
      'plannedFinish',
      'plannedDuration',
      'plannedWeight',
    ] as const;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { timeZone: true },
    });
    const activeBaselines = await this.prisma.projectBaseline.findMany({
      where: { projectId, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
      take: 2,
      include: {
        rabDocument: true,
      },
    });
    if (activeBaselines.length > 1) {
      throw new ConflictException('MULTIPLE_ACTIVE_BASELINES');
    }
    const baseline = activeBaselines[0] ?? null;
    if (!baseline?.rabDocument?.boqStructureId) {
      return {
        projectId,
        projectTimeZone: project?.timeZone ?? null,
        baseline: baseline
          ? {
              id: baseline.id,
              versionNumber: baseline.versionNumber,
              approvedAt: baseline.approvedAt,
            }
          : null,
        items: [],
        freshness: {
          dataThrough: { state: 'UNAVAILABLE' as const, workDate: null },
          lastRecordedAt: {
            state: 'UNAVAILABLE' as const,
            recordedAt: null,
          },
        },
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
            revision: true,
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
    const effectiveRecords = [...effectiveByItem.values()];
    const latestWorkDate = effectiveRecords.reduce<Date | null>(
      (latest, entry) =>
        entry.workDate && (!latest || entry.workDate > latest)
          ? entry.workDate
          : latest,
      null,
    );
    const latestRecordedAt = effectiveRecords.reduce<Date | null>(
      (latest, entry) =>
        !latest || entry.createdAt > latest ? entry.createdAt : latest,
      null,
    );
    const freshness =
      effectiveRecords.length === 0
        ? {
            dataThrough: {
              state: 'NOT_YET_RECORDED' as const,
              workDate: null,
            },
            lastRecordedAt: {
              state: 'NOT_YET_RECORDED' as const,
              recordedAt: null,
            },
          }
        : {
            dataThrough: latestWorkDate
              ? { state: 'RECORDED' as const, workDate: latestWorkDate }
              : { state: 'UNAVAILABLE' as const, workDate: null },
            lastRecordedAt: latestRecordedAt
              ? { state: 'RECORDED' as const, recordedAt: latestRecordedAt }
              : { state: 'UNAVAILABLE' as const, recordedAt: null },
          };
    return {
      projectId,
      projectTimeZone: project?.timeZone ?? null,
      baseline: {
        id: baseline.id,
        versionNumber: baseline.versionNumber,
        approvedAt: baseline.approvedAt,
      },
      freshness,
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
    const trace = this.trace();
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
        const deniedReplay = await tx.progressAuditEvent.findUnique({
          where: { commandId: dto.commandId },
        });
        if (deniedReplay) {
          throw new ConflictException('COMMAND_ID_AUDIT_CONFLICT');
        }
        const transactionalActor = await this.authority.requireActiveActor(
          tx,
          accountId,
          access,
        );
        const currentActor = {
          ...actor,
          roleInProject: transactionalActor.roleInProject,
        };
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
        const dates = dto.entries.map((entry) =>
          this.projectBusinessDate(entry.workDate),
        );
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
              workDate: this.projectBusinessDate(input.workDate),
              notes: input.notes,
              captureMethod: input.captureMethod,
              evidenceReferences: this.evidence(input.evidenceReferences),
              recordedByAccountId: currentActor.accountId,
              recordedByMembershipId: currentActor.membershipId,
              status: ProgressActualStatus.SUBMITTED,
            },
          });
          await this.audit(tx, {
            projectId,
            entryId: entry.id,
            actor: currentActor,
            action: 'ACTUAL_SUBMITTED',
            trace,
            evidence: input.evidenceReferences,
            businessCommandId: dto.commandId,
            commandFingerprint,
            entityVersionAfter: entry.revision,
            metadata: {
              baselineId: baseline.id,
              roleInProject: currentActor.roleInProject,
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
        return this.auditDeniedAndRethrow({
          error: new ConflictException('COMMAND_ID_PAYLOAD_CONFLICT'),
          projectId,
          actor,
          action: 'ACTUAL_SUBMIT',
          trace,
          targetEntityType: 'PROJECT',
          targetEntityId: projectId,
          metadata: { entryCount: dto.entries.length },
          businessCommandId: dto.commandId,
          commandId: dto.commandId,
          commandFingerprint,
        });
      }
      return this.auditDeniedAndRethrow({
        error,
        projectId,
        actor,
        action: 'ACTUAL_SUBMIT',
        trace,
        targetEntityType: 'PROJECT',
        targetEntityId: projectId,
        metadata: { entryCount: dto.entries.length },
        businessCommandId: dto.commandId,
        commandId: dto.commandId,
        commandFingerprint,
      });
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
    const trace = this.trace();
    const commandFingerprint = this.fingerprint({
      kind: 'CORRECT_ACTUAL',
      projectId,
      entryId,
      actorAccountId: accountId,
      installedQuantity: dto.installedQuantity,
      workDate: dto.workDate,
      captureMethod: dto.captureMethod,
      reasonCode: dto.reasonCode,
      reasonText: dto.reasonText,
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
        const deniedReplay = await tx.progressAuditEvent.findUnique({
          where: { commandId: dto.commandId },
        });
        if (deniedReplay) {
          throw new ConflictException('COMMAND_ID_AUDIT_CONFLICT');
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
        const replayAfterLock = await tx.progressReport.findUnique({
          where: { commandId: dto.commandId },
          include: { entries: true },
        });
        if (replayAfterLock) {
          const correction = replayAfterLock.entries[0];
          if (
            replayAfterLock.projectId !== projectId ||
            replayAfterLock.commandFingerprint !== commandFingerprint ||
            correction?.supersedesEntryId !== entryId ||
            correction.recordedByAccountId !== accountId
          )
            throw new ConflictException('COMMAND_ID_CORRECTION_CONFLICT');
          return { entryId: correction.id, replayed: true };
        }
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
        const transactionalActor = await this.authority.requireActiveActor(
          tx,
          accountId,
          access,
        );
        const currentActor = {
          ...actor,
          roleInProject: transactionalActor.roleInProject,
        };
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
            periodStartDate: this.projectBusinessDate(dto.workDate),
            periodEndDate: this.projectBusinessDate(dto.workDate),
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
            workDate: this.projectBusinessDate(dto.workDate),
            notes: dto.notes,
            captureMethod: dto.captureMethod,
            evidenceReferences: this.evidence(dto.evidenceReferences),
            recordedByAccountId: currentActor.accountId,
            recordedByMembershipId: currentActor.membershipId,
            supersedesEntryId: entryId,
            correctionReasonCode: dto.reasonCode,
            correctionReason: dto.reasonText,
            revision: original.revision + 1,
            status: ProgressActualStatus.SUBMITTED,
          },
        });
        await this.audit(tx, {
          projectId,
          entryId,
          actor: currentActor,
          authority,
          action:
            original.status === ProgressActualStatus.SUBMITTED
              ? 'ACTUAL_RETURNED_FOR_CORRECTION'
              : 'ACTUAL_SUPERSEDED_BY_CORRECTION',
          trace,
          reasonCode: dto.reasonCode,
          reasonText: dto.reasonText,
          businessCommandId: dto.commandId,
          commandFingerprint,
          entityVersionBefore: original.revision,
          entityVersionAfter: correction.revision,
          metadata: {
            historicalStatusPreserved: original.status,
            baselineId: report.baselineId,
          },
        });
        await this.audit(tx, {
          projectId,
          entryId: correction.id,
          actor: currentActor,
          authority,
          action: 'ACTUAL_CORRECTION_SUBMITTED',
          trace,
          reasonCode: dto.reasonCode,
          reasonText: dto.reasonText,
          evidence: dto.evidenceReferences,
          businessCommandId: dto.commandId,
          commandFingerprint,
          entityVersionBefore: original.revision,
          entityVersionAfter: correction.revision,
          metadata: {
            supersedesEntryId: entryId,
            commandId: dto.commandId,
            baselineId: report.baselineId,
          },
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
        return this.auditDeniedAndRethrow({
          error: new ConflictException('COMMAND_ID_CORRECTION_CONFLICT'),
          projectId,
          actor,
          action: 'ACTUAL_CORRECT',
          trace,
          targetEntityType: 'PROGRESS_ENTRY',
          targetEntityId: entryId,
          businessCommandId: dto.commandId,
          commandId: dto.commandId,
          commandFingerprint,
        });
      }
      return this.auditDeniedAndRethrow({
        error,
        projectId,
        actor,
        action: 'ACTUAL_CORRECT',
        trace,
        targetEntityType: 'PROGRESS_ENTRY',
        targetEntityId: entryId,
        businessCommandId: dto.commandId,
        commandId: dto.commandId,
        commandFingerprint,
      });
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
    const trace = this.trace();
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
            recordedByAccountId: string | null;
            revision: number;
          }>
        >(
          Prisma.sql`SELECT "id", "progressReportId", "status", "recordedByAccountId", "revision"
                       FROM "progress_entries" WHERE "id" = ${entryId}::uuid FOR UPDATE`,
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
        const transactionalActor = await this.authority.requireActiveActor(
          tx,
          accountId,
          access,
        );
        const currentActor = {
          ...actor,
          roleInProject: transactionalActor.roleInProject,
        };
        const verifier =
          action === 'ACCEPT'
            ? await tx.progressAuditEvent.findFirst({
                where: {
                  progressEntryId: entryId,
                  outcome: ProgressAuditOutcome.SUCCESS,
                  action: 'ACTUAL_VERIFIED',
                },
                orderBy: { occurredAt: 'desc' },
                select: { actorAccountId: true },
              })
            : null;
        await this.authority.requireSeparationPolicy(
          tx,
          access,
          authority,
          action,
          accountId,
          [entry.recordedByAccountId, verifier?.actorAccountId],
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
          actor: currentActor,
          authority,
          action: `ACTUAL_${target}`,
          trace,
          reasonText: reason,
          businessCommandId: commandId,
          commandId,
          commandFingerprint,
          entityVersionBefore: entry.revision,
          entityVersionAfter: entry.revision,
          metadata: {
            from: expected,
            to: target,
            baselineId: report.baselineId,
          },
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
        return this.auditDeniedAndRethrow({
          error: new ConflictException('COMMAND_ID_TRANSITION_CONFLICT'),
          projectId,
          actor,
          action: `ACTUAL_${action}`,
          trace,
          targetEntityType: 'PROGRESS_ENTRY',
          targetEntityId: entryId,
          businessCommandId: commandId,
          commandId,
          commandFingerprint,
        });
      }
      return this.auditDeniedAndRethrow({
        error,
        projectId,
        actor,
        action: `ACTUAL_${action}`,
        trace,
        targetEntityType: 'PROGRESS_ENTRY',
        targetEntityId: entryId,
        businessCommandId: commandId,
        commandId,
        commandFingerprint,
      });
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
      include: {
        rabDocument: true,
        project: { select: { timeZone: true } },
      },
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
      entries.filter(
        (entry) => entry.progressReport.baselineId === baseline.id,
      ),
    );
    const governanceCandidate = this.governanceCandidate(
      entries.filter(
        (entry) => entry.progressReport.baselineId === baseline.id,
      ),
    );
    const [effectivePermissions, verify, correct, accept] = await Promise.all([
      this.permissionResolver.resolve(accountId, access.workspaceId),
      this.authority.resolve(accountId, access, PROGRESS_AUTHORITIES.VERIFY),
      this.authority.resolve(accountId, access, PROGRESS_AUTHORITIES.CORRECT),
      this.authority.resolve(accountId, access, PROGRESS_AUTHORITIES.ACCEPT),
    ]);
    const hasPermission = (permission: string) =>
      !!effectivePermissions?.permissions.includes(permission);
    const verifierAccountId = governanceCandidate?.auditEvents
      .filter(
        (event) =>
          event.outcome === ProgressAuditOutcome.SUCCESS &&
          event.action === 'ACTUAL_VERIFIED',
      )
      .at(-1)?.actorAccountId;
    const verifySeparationAllowed =
      !!governanceCandidate &&
      (governanceCandidate.recordedByAccountId !== accountId ||
        (!!verify &&
          (await this.authority.canCombineResponsibility(
            access,
            verify,
            'VERIFY',
          ))));
    const acceptCrossesOwnStage =
      !!governanceCandidate &&
      [governanceCandidate.recordedByAccountId, verifierAccountId].some(
        (priorActorAccountId) => priorActorAccountId === accountId,
      );
    const acceptSeparationAllowed =
      !!governanceCandidate &&
      (!acceptCrossesOwnStage ||
        (!!accept &&
          (await this.authority.canCombineResponsibility(
            access,
            accept,
            'ACCEPT',
          ))));
    return {
      projectId,
      projectTimeZone: baseline.project.timeZone,
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
      governanceEntryId: governanceCandidate?.id ?? null,
      availableActions: {
        verify:
          governanceCandidate?.status === ProgressActualStatus.SUBMITTED &&
          !!verify &&
          hasPermission(PERMISSIONS.FIELD_PROGRESS_VERIFY) &&
          verifySeparationAllowed,
        correct:
          !!effective &&
          governanceCandidate?.id === effective.id &&
          !!correct &&
          hasPermission(PERMISSIONS.FIELD_PROGRESS_CORRECT),
        accept:
          governanceCandidate?.status === ProgressActualStatus.VERIFIED &&
          !!accept &&
          hasPermission(PERMISSIONS.FIELD_PROGRESS_ACCEPT) &&
          acceptSeparationAllowed,
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
        correctionReasonCode: entry.correctionReasonCode,
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
          reasonCode: event.reasonCode,
          reasonText: event.reasonText,
          authorityCode: event.authorityCode,
          positionCode: event.positionCodeSnapshot,
          roleInProject: event.roleInProjectSnapshot,
          evidenceReferences: event.evidenceReferences ?? [],
        })),
      })),
    };
  }
}
