export const PROJECT_EXECUTION_START_AUTHORITY =
  'PROJECT_EXECUTION_START' as const;

export const PROJECT_EXECUTION_START_ACTION =
  'PROJECT_EXECUTION_START' as const;

export const PROJECT_EXECUTION_START_POLICY_VERSION =
  'SR01_PROJECT_EXECUTION_START_V1' as const;

export interface ProjectExecutionStartResult {
  changed: boolean;
  projectId: string;
  projectStatus: 'ACTIVE';
  baselineId: string;
  executionPlanVersionId: string;
  effectiveStartDate: string;
  recordedAt: string;
  authorityCode: typeof PROJECT_EXECUTION_START_AUTHORITY;
  positionId: string;
}
