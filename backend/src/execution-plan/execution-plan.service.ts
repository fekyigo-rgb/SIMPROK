import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExecutionPlanStatus,
  Prisma,
  ProjectStatus,
} from '@prisma/client';
import type { ProjectAccessContext } from '../auth/project-access-policy.service';
import { PERMISSIONS } from '../common/constants/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressAuthorityService } from '../progress/progress-authority.service';
import type {
  ExecutionPlanDistributionInputDto,
  LockExecutionPlanDto,
  SaveExecutionPlanDraftDto,
} from './dto/execution-plan.dto';
import {
  EXECUTION_PLAN_AUTHORITY,
  EXECUTION_PLAN_BLOCKER,
  EXECUTION_PLAN_READINESS,
  type ExecutionPlanBlockerCode,
} from './execution-plan.contracts';
import {
  projectExecutionPlan,
  type ExecutionPlanProjectionItem,
} from './execution-plan-projection.policy';
import {
  EXECUTION_PLAN_DRAFT_FLOW,
  executionPlanDraftFlow,
} from './execution-plan-adoption.policy';

const PROJECT_BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HARD_DRAFT_BLOCKERS = new Set<ExecutionPlanBlockerCode>([
  EXECUTION_PLAN_BLOCKER.INVALID_DISTRIBUTION_WORK_ITEM,
  EXECUTION_PLAN_BLOCKER.INVALID_DISTRIBUTION_DATE,
  EXECUTION_PLAN_BLOCKER.INVALID_DISTRIBUTION_QUANTITY,
  EXECUTION_PLAN_BLOCKER.DISTRIBUTION_INTERVAL_OVERLAP,
]);

interface TrustedExecutionPlanActor {
  accountId: string;
  projectAccess: ProjectAccessContext;
}

@Injectable()
export class ExecutionPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: ProgressAuthorityService,
  ) {}

  private businessDate(value: string): Date {
    const match = PROJECT_BUSINESS_DATE.exec(value);
    if (!match) {
      throw new BadRequestException('PROJECT_BUSINESS_DATE_REQUIRED');
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
      throw new BadRequestException('PROJECT_BUSINESS_DATE_REQUIRED');
    }
    return date;
  }

  private distributionInput(
    rows: readonly ExecutionPlanDistributionInputDto[],
  ): Array<{
    id: string;
    boqItemId: string;
    periodStartDate: Date;
    periodEndDate: Date;
    plannedIncrementalQuantity: Prisma.Decimal;
  }> {
    return rows.map((row, index) => {
      const quantity = new Prisma.Decimal(row.plannedIncrementalQuantity);
      if (!quantity.greaterThan(0)) {
        throw new BadRequestException(
          'PLANNED_INCREMENTAL_QUANTITY_MUST_BE_POSITIVE',
        );
      }
      return {
        id: `input-${index}`,
        boqItemId: row.boqItemId,
        periodStartDate: this.businessDate(row.periodStartDate),
        periodEndDate: this.businessDate(row.periodEndDate),
        plannedIncrementalQuantity: quantity,
      };
    });
  }

  private async activeBaselineForWrite(
    tx: Prisma.TransactionClient,
    projectId: string,
  ) {
    const baselines = await tx.projectBaseline.findMany({
      where: { projectId, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
      take: 2,
      include: { rabDocument: true },
    });
    if (baselines.length !== 1) {
      throw new ConflictException(
        baselines.length === 0
          ? EXECUTION_PLAN_BLOCKER.NO_ACTIVE_BASELINE
          : EXECUTION_PLAN_BLOCKER.MULTIPLE_ACTIVE_BASELINES,
      );
    }
    return baselines[0];
  }

  private async baselineItems(
    tx: Prisma.TransactionClient,
    boqStructureId: string,
  ): Promise<ExecutionPlanProjectionItem[]> {
    return tx.boqItem.findMany({
      where: { boqStructureId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        parentId: true,
        wbsNodeId: true,
        wbsCode: true,
        name: true,
        itemType: true,
        sortOrder: true,
        quantity: true,
        unit: true,
        lineTotal: true,
      },
    });
  }

  private assertTrustedContext(
    project: { id: string; workspaceId: string },
    actor: TrustedExecutionPlanActor,
  ): void {
    if (
      project.id !== actor.projectAccess.projectId ||
      project.workspaceId !== actor.projectAccess.workspaceId
    ) {
      throw new NotFoundException('Project not found');
    }
  }

  private activateProjectWithinLock(
    tx: Prisma.TransactionClient,
    projectId: string,
  ) {
    return tx.project.updateMany({
      where: { id: projectId, status: ProjectStatus.PLANNED },
      data: { status: ProjectStatus.ACTIVE },
    });
  }

  async getForMonitoring(params: {
    projectId: string;
    accountId: string;
    projectAccess: ProjectAccessContext;
    effectivePermissions: readonly string[];
  }) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: params.projectId,
        workspaceId: params.projectAccess.workspaceId,
      },
      select: { id: true, workspaceId: true, status: true, timeZone: true },
    });
    if (!project) throw new NotFoundException('Project not found');

    const baselines = await this.prisma.projectBaseline.findMany({
      where: { projectId: project.id, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
      take: 2,
      include: { rabDocument: true },
    });
    const canEditPermission = params.effectivePermissions.includes(
      PERMISSIONS.EXECUTION_PLAN_EDIT,
    );
    const canLockPermission = params.effectivePermissions.includes(
      PERMISSIONS.EXECUTION_PLAN_LOCK,
    );
    const authority = canLockPermission
      ? await this.authority.resolve(
          params.accountId,
          params.projectAccess,
          EXECUTION_PLAN_AUTHORITY,
        )
      : null;

    if (baselines.length !== 1) {
      const blocker =
        baselines.length === 0
          ? EXECUTION_PLAN_BLOCKER.NO_ACTIVE_BASELINE
          : EXECUTION_PLAN_BLOCKER.MULTIPLE_ACTIVE_BASELINES;
      return {
        projectId: project.id,
        projectStatus: project.status,
        projectTimeZone: project.timeZone,
        readinessState: EXECUTION_PLAN_READINESS.PLAN_NOT_READY,
        baseline: null,
        plan: null,
        distributions: [],
        schedule: [],
        workPlan: [],
        plannedCurve: { state: 'UNAVAILABLE', reason: blocker, points: [] },
        blockers: [{ code: blocker }],
        capabilities: {
          canEditDraft: false,
          canLock: false,
          editPermission: canEditPermission,
          lockPermission: canLockPermission,
          lockAuthority: authority,
        },
      };
    }

    const baseline = baselines[0];
    const items = await this.prisma.boqItem.findMany({
      where: { boqStructureId: baseline.rabDocument.boqStructureId },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        parentId: true,
        wbsNodeId: true,
        wbsCode: true,
        name: true,
        itemType: true,
        sortOrder: true,
        quantity: true,
        unit: true,
        lineTotal: true,
      },
    });
    const plans = await this.prisma.executionPlanVersion.findMany({
      where: { projectId: project.id, baselineId: baseline.id },
      orderBy: { versionNumber: 'desc' },
      take: 3,
      include: {
        distributions: {
          orderBy: [
            { periodStartDate: 'asc' },
            { periodEndDate: 'asc' },
            { id: 'asc' },
          ],
        },
        lockedByPosition: { select: { id: true, code: true } },
      },
    });
    const otherBaselinePlanCount =
      await this.prisma.executionPlanVersion.count({
        where: { projectId: project.id, baselineId: { not: baseline.id } },
      });
    const lockedPlans = plans.filter(
      (plan) => plan.status === ExecutionPlanStatus.LOCKED,
    );
    const draftPlans = plans.filter(
      (plan) => plan.status === ExecutionPlanStatus.DRAFT,
    );
    if (
      lockedPlans.length > 1 ||
      draftPlans.length > 1 ||
      (lockedPlans.length === 1 && draftPlans.length === 1)
    ) {
      throw new ConflictException(
        EXECUTION_PLAN_BLOCKER.AMBIGUOUS_EXECUTION_PLAN_CONTEXT,
      );
    }
    const plan = lockedPlans[0] ?? draftPlans[0] ?? null;
    const draftFlow = executionPlanDraftFlow({
      projectStatus: project.status,
      activeBaselineCount: baselines.length,
      currentBaselinePlanStatuses: plans.map((candidate) => candidate.status),
      otherBaselinePlanCount,
    });
    if (!plan) {
      const blocker =
        otherBaselinePlanCount > 0
          ? EXECUTION_PLAN_BLOCKER.BASELINE_BINDING_MISMATCH
          : draftFlow === EXECUTION_PLAN_DRAFT_FLOW.LEGACY_ACTIVE_ADOPTION
            ? EXECUTION_PLAN_BLOCKER.LEGACY_ACTIVE_PROJECT_REQUIRES_PLAN_ADOPTION
            : project.status === ProjectStatus.PLANNED
              ? EXECUTION_PLAN_BLOCKER.EXECUTION_PLAN_DRAFT_NOT_FOUND
              : EXECUTION_PLAN_BLOCKER.PROJECT_NOT_PLANNED;
      return {
        projectId: project.id,
        projectStatus: project.status,
        projectTimeZone: project.timeZone,
        readinessState: EXECUTION_PLAN_READINESS.PLAN_NOT_READY,
        baseline: {
          id: baseline.id,
          versionNumber: baseline.versionNumber,
          approvedAt: baseline.approvedAt.toISOString(),
        },
        plan: null,
        distributions: [],
        schedule: [],
        workPlan: items
          .filter((item) => item.itemType === 'WORK_ITEM')
          .map((item) => ({
            boqItemId: item.id,
            parentId: item.parentId,
            wbsNodeId: item.wbsNodeId,
            wbsCode: item.wbsCode,
            name: item.name,
            unit: item.unit,
            baselineQuantity: item.quantity.toString(),
            distributionCount: 0,
          })),
        plannedCurve: { state: 'UNAVAILABLE', reason: blocker, points: [] },
        blockers: [{ code: blocker }],
        capabilities: {
          canEditDraft:
            draftFlow !== EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE &&
            canEditPermission,
          canLock: false,
          editPermission: canEditPermission,
          lockPermission: canLockPermission,
          lockAuthority: authority,
        },
      };
    }

    const projection = projectExecutionPlan({
      projectStatus: project.status,
      planStatus: plan.status,
      draftFlow,
      totalBaseCost: baseline.rabDocument.totalBaseCost,
      items,
      distributions: plan.distributions,
    });
    const blockers = [...projection.blockers];
    if (
      plan.status === ExecutionPlanStatus.LOCKED &&
      project.status !== ProjectStatus.ACTIVE
    ) {
      blockers.push({
        code: EXECUTION_PLAN_BLOCKER.LOCKED_PLAN_PROJECT_NOT_ACTIVE,
      });
    }
    const readinessState =
      blockers.length === 0
        ? projection.readinessState
        : plan.status === ExecutionPlanStatus.LOCKED
          ? EXECUTION_PLAN_READINESS.PLAN_NOT_READY
          : projection.readinessState;
    const itemById = new Map(items.map((item) => [item.id, item]));

    return {
      projectId: project.id,
      projectStatus: project.status,
      projectTimeZone: project.timeZone,
      readinessState,
      baseline: {
        id: baseline.id,
        versionNumber: baseline.versionNumber,
        approvedAt: baseline.approvedAt.toISOString(),
      },
      plan: {
        id: plan.id,
        versionNumber: plan.versionNumber,
        revision: plan.revision,
        status: plan.status,
        predecessorId: plan.predecessorId,
        createdAt: plan.createdAt.toISOString(),
        lastEditedAt: plan.lastEditedAt.toISOString(),
        lockedAt: plan.lockedAt?.toISOString() ?? null,
        lockedFromRevision: plan.lockedFromRevision,
        lockedFromProjectStatus: plan.lockedFromProjectStatus,
        authority:
          plan.status === ExecutionPlanStatus.LOCKED
            ? {
                code: plan.lockedAuthorityCode,
                positionId: plan.lockedByPositionId,
                positionCode: plan.lockedByPosition?.code ?? null,
              }
            : null,
      },
      distributions: plan.distributions.map((row) => {
        const item = itemById.get(row.boqItemId);
        return {
          id: row.id,
          boqItemId: row.boqItemId,
          wbsCode: item?.wbsCode ?? null,
          workItemName: item?.name ?? null,
          unit: item?.unit ?? null,
          periodStartDate: row.periodStartDate.toISOString().slice(0, 10),
          periodEndDate: row.periodEndDate.toISOString().slice(0, 10),
          plannedIncrementalQuantity:
            row.plannedIncrementalQuantity.toString(),
        };
      }),
      schedule: projection.schedule,
      workPlan: projection.workPlan,
      plannedCurve: projection.plannedCurve,
      blockers,
      capabilities: {
        canEditDraft:
          plan.status === ExecutionPlanStatus.DRAFT &&
          draftFlow !== EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE &&
          canEditPermission,
        canLock:
          plan.status === ExecutionPlanStatus.DRAFT &&
          readinessState === EXECUTION_PLAN_READINESS.READY_FOR_LOCK &&
          canLockPermission &&
          authority !== null,
        editPermission: canEditPermission,
        lockPermission: canLockPermission,
        lockAuthority: authority,
      },
    };
  }

  async saveDraft(
    projectId: string,
    dto: SaveExecutionPlanDraftDto,
    actor: TrustedExecutionPlanActor,
  ) {
    const inputRows = this.distributionInput(dto.distributions);
    return this.prisma.$transaction(async (tx) => {
      const lockedProjects = await tx.$queryRaw<
        Array<{ id: string; workspaceId: string; status: ProjectStatus }>
      >(
        Prisma.sql`SELECT "id", "workspaceId", "status" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
      );
      const project = lockedProjects[0];
      if (!project) throw new NotFoundException('Project not found');
      this.assertTrustedContext(project, actor);
      await this.authority.requireActiveActor(
        tx,
        actor.accountId,
        actor.projectAccess,
      );
      const baseline = await this.activeBaselineForWrite(tx, projectId);
      const projectPlans = await tx.executionPlanVersion.findMany({
        where: { projectId },
        orderBy: { versionNumber: 'desc' },
      });
      if (
        projectPlans.some(
          (candidate) => candidate.status === ExecutionPlanStatus.LOCKED,
        )
      ) {
        throw new ConflictException('EXECUTION_PLAN_ALREADY_LOCKED');
      }
      const currentPlans = projectPlans.filter(
        (candidate) => candidate.baselineId === baseline.id,
      );
      const draftFlow = executionPlanDraftFlow({
        projectStatus: project.status,
        activeBaselineCount: 1,
        currentBaselinePlanStatuses: currentPlans.map(
          (candidate) => candidate.status,
        ),
        otherBaselinePlanCount: projectPlans.length - currentPlans.length,
      });
      if (draftFlow === EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE) {
        if (
          project.status !== ProjectStatus.PLANNED &&
          project.status !== ProjectStatus.ACTIVE
        ) {
          throw new ConflictException('PROJECT_NOT_PLANNED');
        }
        throw new ConflictException(
          projectPlans.some(
            (candidate) => candidate.baselineId !== baseline.id,
          )
            ? EXECUTION_PLAN_BLOCKER.BASELINE_BINDING_MISMATCH
            : EXECUTION_PLAN_BLOCKER.AMBIGUOUS_EXECUTION_PLAN_CONTEXT,
        );
      }
      const drafts = currentPlans.filter(
        (candidate) => candidate.status === ExecutionPlanStatus.DRAFT,
      );
      if (drafts.length > 1) {
        throw new ConflictException(
          EXECUTION_PLAN_BLOCKER.AMBIGUOUS_EXECUTION_PLAN_CONTEXT,
        );
      }
      const existing = drafts[0] ?? null;
      if (
        (!existing && dto.expectedRevision !== 0) ||
        (existing && existing.revision !== dto.expectedRevision)
      ) {
        throw new ConflictException('EXECUTION_PLAN_REVISION_CONFLICT');
      }

      const items = await this.baselineItems(
        tx,
        baseline.rabDocument.boqStructureId,
      );
      const validation = projectExecutionPlan({
        projectStatus: project.status,
        planStatus: ExecutionPlanStatus.DRAFT,
        draftFlow,
        totalBaseCost: baseline.rabDocument.totalBaseCost,
        items,
        distributions: inputRows,
      });
      const hardBlockers = validation.blockers.filter((blocker) =>
        HARD_DRAFT_BLOCKERS.has(blocker.code),
      );
      if (hardBlockers.length > 0) {
        throw new BadRequestException({
          code: 'EXECUTION_PLAN_DRAFT_INVALID',
          blockers: hardBlockers,
        });
      }

      let planId: string;
      let revision: number;
      if (!existing) {
        const version = await tx.executionPlanVersion.aggregate({
          where: { projectId },
          _max: { versionNumber: true },
        });
        const created = await tx.executionPlanVersion.create({
          data: {
            projectId,
            baselineId: baseline.id,
            versionNumber: (version._max.versionNumber ?? 0) + 1,
            revision: 1,
            status: ExecutionPlanStatus.DRAFT,
            createdByAccountId: actor.accountId,
            lastEditedByAccountId: actor.accountId,
            lastEditedAt: new Date(),
          },
        });
        planId = created.id;
        revision = created.revision;
      } else {
        const nextRevision = existing.revision + 1;
        const changed = await tx.executionPlanVersion.updateMany({
          where: {
            id: existing.id,
            status: ExecutionPlanStatus.DRAFT,
            revision: dto.expectedRevision,
          },
          data: {
            revision: nextRevision,
            lastEditedByAccountId: actor.accountId,
            lastEditedAt: new Date(),
          },
        });
        if (changed.count !== 1) {
          throw new ConflictException('EXECUTION_PLAN_REVISION_CONFLICT');
        }
        await tx.executionPlanDistribution.deleteMany({
          where: { executionPlanVersionId: existing.id },
        });
        planId = existing.id;
        revision = nextRevision;
      }

      if (inputRows.length > 0) {
        await tx.executionPlanDistribution.createMany({
          data: inputRows.map((row) => ({
            executionPlanVersionId: planId,
            boqItemId: row.boqItemId,
            periodStartDate: row.periodStartDate,
            periodEndDate: row.periodEndDate,
            plannedIncrementalQuantity: row.plannedIncrementalQuantity,
          })),
        });
      }
      return {
        changed: true,
        executionPlanVersionId: planId,
        status: ExecutionPlanStatus.DRAFT,
        revision,
        baselineId: baseline.id,
      };
    });
  }

  async lock(
    projectId: string,
    dto: LockExecutionPlanDto,
    actor: TrustedExecutionPlanActor,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const lockedProjects = await tx.$queryRaw<
        Array<{ id: string; workspaceId: string; status: ProjectStatus }>
      >(
        Prisma.sql`SELECT "id", "workspaceId", "status" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
      );
      const project = lockedProjects[0];
      if (!project) throw new NotFoundException('Project not found');
      this.assertTrustedContext(project, actor);

      const holder = await this.authority.requireWithinTransaction(
        tx,
        actor.accountId,
        actor.projectAccess,
        EXECUTION_PLAN_AUTHORITY,
      );
      const baseline = await this.activeBaselineForWrite(tx, projectId);
      const plans = await tx.executionPlanVersion.findMany({
        where: { projectId, baselineId: baseline.id },
        orderBy: { versionNumber: 'desc' },
        take: 3,
        include: { distributions: true },
      });
      const otherBaselinePlanCount =
        await tx.executionPlanVersion.count({
          where: { projectId, baselineId: { not: baseline.id } },
        });
      const lockedPlans = plans.filter(
        (plan) => plan.status === ExecutionPlanStatus.LOCKED,
      );
      const draftPlans = plans.filter(
        (plan) => plan.status === ExecutionPlanStatus.DRAFT,
      );
      if (otherBaselinePlanCount > 0) {
        throw new ConflictException(
          EXECUTION_PLAN_BLOCKER.BASELINE_BINDING_MISMATCH,
        );
      }

      if (lockedPlans.length === 1 && draftPlans.length === 0) {
        const settled = lockedPlans[0];
        const wholeLock =
          settled.lockedAt !== null &&
          settled.lockedByAccountId !== null &&
          settled.lockedByPositionId !== null &&
          settled.lockedFromRevision === settled.revision &&
          (settled.lockedFromProjectStatus === ProjectStatus.PLANNED ||
            settled.lockedFromProjectStatus === ProjectStatus.ACTIVE) &&
          settled.lockedAuthorityCode === EXECUTION_PLAN_AUTHORITY;
        if (
          project.status === ProjectStatus.ACTIVE &&
          settled.id === dto.executionPlanVersionId &&
          settled.revision === dto.expectedRevision &&
          wholeLock
        ) {
          return {
            changed: false,
            executionPlanVersionId: settled.id,
            status: settled.status,
            revision: settled.revision,
            projectStatus: project.status,
            baselineId: baseline.id,
            lockedAt: settled.lockedAt!.toISOString(),
            authorityCode: settled.lockedAuthorityCode,
            lockedByPositionId: settled.lockedByPositionId,
            lockedFromProjectStatus: settled.lockedFromProjectStatus,
          };
        }
        throw new ConflictException('EXECUTION_PLAN_LOCK_CONFLICT');
      }
      if (
        lockedPlans.length !== 0 ||
        draftPlans.length !== 1 ||
        plans.length !== 1
      ) {
        throw new ConflictException(
          EXECUTION_PLAN_BLOCKER.AMBIGUOUS_EXECUTION_PLAN_CONTEXT,
        );
      }
      const draftFlow = executionPlanDraftFlow({
        projectStatus: project.status,
        activeBaselineCount: 1,
        currentBaselinePlanStatuses: plans.map(
          (candidate) => candidate.status,
        ),
        otherBaselinePlanCount,
      });
      if (draftFlow === EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE) {
        throw new ConflictException('PROJECT_NOT_PLANNED');
      }
      const plan = draftPlans[0];
      if (
        plan.id !== dto.executionPlanVersionId ||
        plan.revision !== dto.expectedRevision
      ) {
        throw new ConflictException('EXECUTION_PLAN_REVISION_CONFLICT');
      }

      const items = await this.baselineItems(
        tx,
        baseline.rabDocument.boqStructureId,
      );
      const projection = projectExecutionPlan({
        projectStatus: project.status,
        planStatus: plan.status,
        draftFlow,
        totalBaseCost: baseline.rabDocument.totalBaseCost,
        items,
        distributions: plan.distributions,
      });
      if (projection.blockers.length > 0) {
        throw new ConflictException({
          code: 'EXECUTION_PLAN_NOT_READY',
          blockers: projection.blockers,
        });
      }

      const lockedAt = new Date();
      const planTransition = await tx.executionPlanVersion.updateMany({
        where: {
          id: plan.id,
          status: ExecutionPlanStatus.DRAFT,
          revision: dto.expectedRevision,
        },
        data: {
          status: ExecutionPlanStatus.LOCKED,
          lockedAt,
          lockedByAccountId: actor.accountId,
          lockedByPositionId: holder.positionId,
          lockedFromRevision: plan.revision,
          lockedFromProjectStatus: project.status,
          lockedAuthorityCode: EXECUTION_PLAN_AUTHORITY,
        },
      });
      if (planTransition.count !== 1) {
        throw new ConflictException('EXECUTION_PLAN_REVISION_CONFLICT');
      }
      if (draftFlow === EXECUTION_PLAN_DRAFT_FLOW.NORMAL_PLANNED_FLOW) {
        const projectTransition = await this.activateProjectWithinLock(
          tx,
          projectId,
        );
        if (projectTransition.count !== 1) {
          throw new ConflictException('PROJECT_ACTIVATION_CONFLICT');
        }
      }
      return {
        changed: true,
        executionPlanVersionId: plan.id,
        status: ExecutionPlanStatus.LOCKED,
        revision: plan.revision,
        projectStatus: ProjectStatus.ACTIVE,
        baselineId: baseline.id,
        lockedAt: lockedAt.toISOString(),
        authorityCode: EXECUTION_PLAN_AUTHORITY,
        lockedByPositionId: holder.positionId,
        lockedFromProjectStatus: project.status,
      };
    });
  }
}
