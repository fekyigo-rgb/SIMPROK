import { ExecutionPlanStatus, ProjectStatus } from '@prisma/client';

export const EXECUTION_PLAN_DRAFT_FLOW = {
  NORMAL_PLANNED_FLOW: 'NORMAL_PLANNED_FLOW',
  LEGACY_ACTIVE_ADOPTION: 'LEGACY_ACTIVE_ADOPTION',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
} as const;

export type ExecutionPlanDraftFlow =
  (typeof EXECUTION_PLAN_DRAFT_FLOW)[keyof typeof EXECUTION_PLAN_DRAFT_FLOW];

export function executionPlanDraftFlow(input: {
  projectStatus: ProjectStatus;
  activeBaselineCount: number;
  currentBaselinePlanStatuses: readonly ExecutionPlanStatus[];
  otherBaselinePlanCount: number;
}): ExecutionPlanDraftFlow {
  if (
    input.activeBaselineCount !== 1 ||
    input.otherBaselinePlanCount !== 0 ||
    input.currentBaselinePlanStatuses.length > 1 ||
    (input.currentBaselinePlanStatuses.length === 1 &&
      input.currentBaselinePlanStatuses[0] !== ExecutionPlanStatus.DRAFT)
  ) {
    return EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE;
  }

  if (input.projectStatus === ProjectStatus.PLANNED) {
    return EXECUTION_PLAN_DRAFT_FLOW.NORMAL_PLANNED_FLOW;
  }
  if (input.projectStatus === ProjectStatus.ACTIVE) {
    return EXECUTION_PLAN_DRAFT_FLOW.LEGACY_ACTIVE_ADOPTION;
  }
  return EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE;
}
