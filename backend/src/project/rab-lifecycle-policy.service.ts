import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const WORKING_DRAFT_STRUCTURE_NAME = 'Working Draft';

/**
 * Project.status values under which a Working Draft may be entered/edited.
 * This is an eligibility DOOR, not a source of baseline/approved-RAB/draft
 * facts — see RabLifecyclePolicyService below. ProjectStatus has no DRAFT
 * member; PLANNED is the canonical "Draft / Perencanaan" planning status.
 */
export const RAB_EDITABLE_PROJECT_STATUSES: readonly ProjectStatus[] = [ProjectStatus.PLANNED];

/**
 * ONE RAB, ONE HOUSE, THREE STATES. `RabDocument.status` is the single
 * lifecycle field; there is no second RAB entity, no snapshot copy, and no
 * baseline involved in freezing.
 *
 *   DRAFT     saved and real, still alive and editable
 *   LOCKED    the SAME RabDocument, frozen — readable, never mutable
 *   APPROVED  a separate human-authority decision, not reachable from here
 *
 * Declared as string constants rather than a Prisma enum because the column
 * is already `String @default("DRAFT")` and can hold these values today. A
 * migration to store "LOCKED" would buy nothing; what it would cost is a
 * schema change on the one table every RAB read already depends on.
 */
export const RAB_STATUS = {
  DRAFT: 'DRAFT',
  LOCKED: 'LOCKED',
  APPROVED: 'APPROVED',
} as const;

export type RabStatus = (typeof RAB_STATUS)[keyof typeof RAB_STATUS];

/** The named refusal every RAB mutator raises once the RAB is frozen. */
export const RAB_LOCKED_REASON = 'RAB_LOCKED' as const;

export type RabLifecycleReasonCode =
  | 'ACTIVE_BASELINE_EXISTS'
  | 'APPROVED_RAB_EXISTS'
  | typeof RAB_LOCKED_REASON
  | 'MULTIPLE_WORKING_DRAFTS'
  | 'PROJECT_NOT_DRAFT';

export interface RabLifecycleProjection {
  canEnterEditableDraftWorkspace: boolean;
  canEditDraft: boolean;
  reasonCode: RabLifecycleReasonCode | null;
  projectStatus: ProjectStatus;
  activeBaselineCount: number;
  approvedRabCount: number;
  lockedRabCount: number;
  workingDraftCount: number;
}

type LifecycleQueryClient = Pick<PrismaService, 'projectBaseline' | 'rabDocument' | 'boqStructure'>;

interface LifecycleCounts {
  activeBaselineCount: number;
  approvedRabCount: number;
  lockedRabCount: number;
  workingDraftCount: number;
}

/**
 * Canonical, single authority for RAB draft-lifecycle state. Every route that
 * reads or mutates a project's Working Draft (GET/PUT boq/draft, BOQ import
 * preview/approve) and the /projects/mine list projection reads this same
 * projection.
 *
 * Reason priority (first match wins):
 *   1. activeBaselineCount > 0   -> ACTIVE_BASELINE_EXISTS
 *   2. approvedRabCount > 0      -> APPROVED_RAB_EXISTS
 *   3. lockedRabCount > 0        -> RAB_LOCKED
 *   4. workingDraftCount > 1     -> MULTIPLE_WORKING_DRAFTS
 *   5. status not RAB-editable   -> PROJECT_NOT_DRAFT
 *   6. otherwise                 -> allowed
 *
 * RAB_LOCKED sits BELOW approval and baseline on purpose: those are stronger,
 * later facts, and a project that has both should report the stronger one.
 *
 * This is also the whole of the freeze enforcement. Every RAB mutator —
 * PUT /boq/draft, BOQ import approve, select-ahsp, cost-calculation persist —
 * already consults this projection inside its own FOR UPDATE transaction on
 * the Project row, so teaching THIS function about LOCKED closes all of them
 * at once. No guard is bolted onto each route one by one, and no mutator can
 * be added later that quietly skips the freeze without also skipping the
 * lifecycle law it already had to obey.
 *
 * Project.status is read only as an eligibility gate at priority 4. It never
 * fabricates an active baseline, an approved RAB, or Working Draft
 * cardinality, and it never overrides facts 1-3 — a PLANNED project with an
 * active baseline is still ACTIVE_BASELINE_EXISTS, not allowed.
 */
@Injectable()
export class RabLifecyclePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  private project(counts: LifecycleCounts, projectStatus: ProjectStatus): RabLifecycleProjection {
    const { activeBaselineCount, approvedRabCount, lockedRabCount, workingDraftCount } = counts;

    let reasonCode: RabLifecycleReasonCode | null = null;
    if (activeBaselineCount > 0) reasonCode = 'ACTIVE_BASELINE_EXISTS';
    else if (approvedRabCount > 0) reasonCode = 'APPROVED_RAB_EXISTS';
    else if (lockedRabCount > 0) reasonCode = RAB_LOCKED_REASON;
    else if (workingDraftCount > 1) reasonCode = 'MULTIPLE_WORKING_DRAFTS';
    else if (!RAB_EDITABLE_PROJECT_STATUSES.includes(projectStatus)) reasonCode = 'PROJECT_NOT_DRAFT';

    const allowed = reasonCode === null;

    return {
      canEnterEditableDraftWorkspace: allowed,
      canEditDraft: allowed,
      reasonCode,
      projectStatus,
      activeBaselineCount,
      approvedRabCount,
      lockedRabCount,
      workingDraftCount,
    };
  }

  private async countLifecycle(client: LifecycleQueryClient, projectId: string): Promise<LifecycleCounts> {
    const [activeBaselineCount, approvedRabCount, lockedRabCount, workingDraftCount] = await Promise.all([
      client.projectBaseline.count({ where: { projectId, status: 'ACTIVE' } }),
      client.rabDocument.count({ where: { projectId, status: RAB_STATUS.APPROVED } }),
      client.rabDocument.count({ where: { projectId, status: RAB_STATUS.LOCKED } }),
      client.boqStructure.count({ where: { projectId, status: 'DRAFT', name: WORKING_DRAFT_STRUCTURE_NAME } }),
    ]);
    return { activeBaselineCount, approvedRabCount, lockedRabCount, workingDraftCount };
  }

  /** Read-path evaluation (GET draft, import preview). `projectStatus` should come from an already-trusted context (e.g. ProjectAccessGuard). */
  async evaluate(projectId: string, projectStatus: ProjectStatus): Promise<RabLifecycleProjection> {
    const counts = await this.countLifecycle(this.prisma, projectId);
    return this.project(counts, projectStatus);
  }

  /** Write-path evaluation. Caller must supply a client bound to a transaction that already holds a FOR UPDATE lock on the Project row, and the status read within that same lock. */
  async evaluateInTransaction(tx: LifecycleQueryClient, projectId: string, projectStatus: ProjectStatus): Promise<RabLifecycleProjection> {
    const counts = await this.countLifecycle(tx, projectId);
    return this.project(counts, projectStatus);
  }

  /** Batch projection for list views. A fixed number of queries regardless of project count — no N+1. */
  async evaluateBatch(projectIds: string[], projectStatusById: Map<string, ProjectStatus>): Promise<Map<string, RabLifecycleProjection>> {
    const result = new Map<string, RabLifecycleProjection>();
    if (projectIds.length === 0) return result;

    const [baselineGroups, approvedGroups, lockedGroups, draftGroups] = await Promise.all([
      this.prisma.projectBaseline.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, status: 'ACTIVE' }, _count: { _all: true } }),
      this.prisma.rabDocument.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, status: RAB_STATUS.APPROVED }, _count: { _all: true } }),
      this.prisma.rabDocument.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, status: RAB_STATUS.LOCKED }, _count: { _all: true } }),
      this.prisma.boqStructure.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, status: 'DRAFT', name: WORKING_DRAFT_STRUCTURE_NAME }, _count: { _all: true } }),
    ]);

    const baselineByProject = new Map(baselineGroups.map((row) => [row.projectId as string, row._count._all]));
    const approvedByProject = new Map(approvedGroups.map((row) => [row.projectId as string, row._count._all]));
    const lockedByProject = new Map(lockedGroups.map((row) => [row.projectId as string, row._count._all]));
    const draftByProject = new Map(draftGroups.map((row) => [row.projectId as string, row._count._all]));

    for (const projectId of projectIds) {
      const projectStatus = projectStatusById.get(projectId);
      if (!projectStatus) {
        throw new InternalServerErrorException('PROJECT_STATUS_MISSING_FOR_RAB_LIFECYCLE');
      }

      const counts: LifecycleCounts = {
        activeBaselineCount: baselineByProject.get(projectId) ?? 0,
        approvedRabCount: approvedByProject.get(projectId) ?? 0,
        lockedRabCount: lockedByProject.get(projectId) ?? 0,
        workingDraftCount: draftByProject.get(projectId) ?? 0,
      };
      result.set(projectId, this.project(counts, projectStatus));
    }

    return result;
  }
}
