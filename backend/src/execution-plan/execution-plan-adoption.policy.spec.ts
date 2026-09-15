import { ExecutionPlanStatus, ProjectStatus } from '@prisma/client';
import {
  EXECUTION_PLAN_DRAFT_FLOW,
  executionPlanDraftFlow,
} from './execution-plan-adoption.policy';

const decide = (
  projectStatus: ProjectStatus,
  currentBaselinePlanStatuses: ExecutionPlanStatus[] = [],
  otherBaselinePlanCount = 0,
  activeBaselineCount = 1,
) =>
  executionPlanDraftFlow({
    projectStatus,
    activeBaselineCount,
    currentBaselinePlanStatuses,
    otherBaselinePlanCount,
  });

describe('executionPlanDraftFlow', () => {
  it('preserves the normal PLANNED flow', () => {
    expect(decide(ProjectStatus.PLANNED)).toBe(
      EXECUTION_PLAN_DRAFT_FLOW.NORMAL_PLANNED_FLOW,
    );
    expect(
      decide(ProjectStatus.PLANNED, [ExecutionPlanStatus.DRAFT]),
    ).toBe(EXECUTION_PLAN_DRAFT_FLOW.NORMAL_PLANNED_FLOW);
  });

  it('allows initial adoption and revision of the same draft for ACTIVE legacy projects', () => {
    expect(decide(ProjectStatus.ACTIVE)).toBe(
      EXECUTION_PLAN_DRAFT_FLOW.LEGACY_ACTIVE_ADOPTION,
    );
    expect(
      decide(ProjectStatus.ACTIVE, [ExecutionPlanStatus.DRAFT]),
    ).toBe(EXECUTION_PLAN_DRAFT_FLOW.LEGACY_ACTIVE_ADOPTION);
  });

  it('denies adoption when a locked, competing, cross-baseline, or ambiguous plan exists', () => {
    expect(
      decide(ProjectStatus.ACTIVE, [ExecutionPlanStatus.LOCKED]),
    ).toBe(EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE);
    expect(
      decide(ProjectStatus.ACTIVE, [ExecutionPlanStatus.DRAFT], 1),
    ).toBe(EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE);
    expect(decide(ProjectStatus.ACTIVE, [], 1)).toBe(
      EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE,
    );
    expect(
      decide(ProjectStatus.ACTIVE, [
        ExecutionPlanStatus.DRAFT,
        ExecutionPlanStatus.DRAFT,
      ]),
    ).toBe(EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE);
  });

  it('fails closed for multiple active baselines and non-execution project states', () => {
    expect(decide(ProjectStatus.ACTIVE, [], 0, 2)).toBe(
      EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE,
    );
    for (const status of [
      ProjectStatus.ON_HOLD,
      ProjectStatus.COMPLETED,
      ProjectStatus.CANCELLED,
    ]) {
      expect(decide(status)).toBe(EXECUTION_PLAN_DRAFT_FLOW.NOT_ELIGIBLE);
    }
  });
});
