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

export type RabLifecycleReasonCode =
  | 'ACTIVE_BASELINE_EXISTS'
  | 'APPROVED_RAB_EXISTS'
  | 'MULTIPLE_WORKING_DRAFTS'
  | 'PROJECT_NOT_DRAFT';

export interface RabLifecycleProjection {
  canEnterEditableDraftWorkspace: boolean;
  canEditDraft: boolean;
  reasonCode: RabLifecycleReasonCode | null;
  projectStatus: ProjectStatus;
  activeBaselineCount: number;
  approvedRabCount: number;
  workingDraftCount: number;
}

type LifecycleQueryClient = Pick<PrismaService, 'projectBaseline' | 'rabDocument' | 'boqStructure'>;

interface LifecycleCounts {
  activeBaselineCount: number;
  approvedRabCount: number;
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
 *   3. workingDraftCount > 1     -> MULTIPLE_WORKING_DRAFTS
 *   4. status not RAB-editable   -> PROJECT_NOT_DRAFT
 *   5. otherwise                 -> allowed
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
    const { activeBaselineCount, approvedRabCount, workingDraftCount } = counts;

    let reasonCode: RabLifecycleReasonCode | null = null;
    if (activeBaselineCount > 0) reasonCode = 'ACTIVE_BASELINE_EXISTS';
    else if (approvedRabCount > 0) reasonCode = 'APPROVED_RAB_EXISTS';
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
      workingDraftCount,
    };
  }

  private async countLifecycle(client: LifecycleQueryClient, projectId: string): Promise<LifecycleCounts> {
    const [activeBaselineCount, approvedRabCount, workingDraftCount] = await Promise.all([
      client.projectBaseline.count({ where: { projectId, status: 'ACTIVE' } }),
      client.rabDocument.count({ where: { projectId, status: 'APPROVED' } }),
      client.boqStructure.count({ where: { projectId, status: 'DRAFT', name: WORKING_DRAFT_STRUCTURE_NAME } }),
    ]);
    return { activeBaselineCount, approvedRabCount, workingDraftCount };
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

  /** Batch projection for list views. Exactly three queries regardless of project count — no N+1. */
  async evaluateBatch(projectIds: string[], projectStatusById: Map<string, ProjectStatus>): Promise<Map<string, RabLifecycleProjection>> {
    const result = new Map<string, RabLifecycleProjection>();
    if (projectIds.length === 0) return result;

    const [baselineGroups, approvedGroups, draftGroups] = await Promise.all([
      this.prisma.projectBaseline.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, status: 'ACTIVE' }, _count: { _all: true } }),
      this.prisma.rabDocument.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, status: 'APPROVED' }, _count: { _all: true } }),
      this.prisma.boqStructure.groupBy({ by: ['projectId'], where: { projectId: { in: projectIds }, status: 'DRAFT', name: WORKING_DRAFT_STRUCTURE_NAME }, _count: { _all: true } }),
    ]);

    const baselineByProject = new Map(baselineGroups.map((row) => [row.projectId as string, row._count._all]));
    const approvedByProject = new Map(approvedGroups.map((row) => [row.projectId as string, row._count._all]));
    const draftByProject = new Map(draftGroups.map((row) => [row.projectId as string, row._count._all]));

    for (const projectId of projectIds) {
      const projectStatus = projectStatusById.get(projectId);
      if (!projectStatus) {
        throw new InternalServerErrorException('PROJECT_STATUS_MISSING_FOR_RAB_LIFECYCLE');
      }

      const counts: LifecycleCounts = {
        activeBaselineCount: baselineByProject.get(projectId) ?? 0,
        approvedRabCount: approvedByProject.get(projectId) ?? 0,
        workingDraftCount: draftByProject.get(projectId) ?? 0,
      };
      result.set(projectId, this.project(counts, projectStatus));
    }

    return result;
  }
}
