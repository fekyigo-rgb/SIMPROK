import type {
  MonitoringResponse,
  MonitoringTemporalLens,
} from './monitoringCurrent';

export type ExecutionPlanReadinessState =
  | 'PLAN_NOT_READY'
  | 'REVISION_IN_PROGRESS'
  | 'READY_FOR_LOCK'
  | 'LOCKED_FOR_EXECUTION';

export interface ExecutionPlanBlocker {
  code: string;
  boqItemId?: string;
  expectedQuantity?: string;
  plannedQuantity?: string;
}

export interface ExecutionPlanResponse {
  projectId: string;
  projectStatus: string;
  projectTimeZone: string | null;
  readinessState: ExecutionPlanReadinessState;
  baseline: {
    id: string;
    versionNumber: number;
    approvedAt: string;
  } | null;
  plan: {
    id: string;
    versionNumber: number;
    revision: number;
    status: 'DRAFT' | 'LOCKED';
    predecessorId: string | null;
    createdAt: string;
    lastEditedAt: string;
    lockedAt: string | null;
    lockedFromRevision: number | null;
    lockedFromProjectStatus: 'PLANNED' | 'ACTIVE' | null;
    authority: {
      code: string | null;
      positionId: string | null;
      positionCode: string | null;
    } | null;
  } | null;
  distributions: Array<{
    id: string;
    boqItemId: string;
    wbsCode: string | null;
    workItemName: string | null;
    unit: string | null;
    periodStartDate: string;
    periodEndDate: string;
    plannedIncrementalQuantity: string;
  }>;
  schedule: Array<{
    boqItemId: string;
    wbsCode: string;
    name: string;
    unit: string;
    baselineQuantity: string;
    plannedQuantity: string;
    plannedItemProgressPercent: string | null;
    plannedStartDate: string;
    plannedFinishDate: string;
  }>;
  workPlan: Array<{
    boqItemId: string;
    parentId: string | null;
    wbsNodeId: string | null;
    wbsCode: string;
    name: string;
    unit: string;
    baselineQuantity: string;
    distributionCount: number;
  }>;
  plannedCurve: {
    state: 'COMPLETE' | 'INCOMPLETE' | 'UNAVAILABLE';
    reason: string | null;
    points: Array<{
      periodEndDate: string;
      knownWeightedPlannedProgressPercent: string;
    }>;
  };
  blockers: ExecutionPlanBlocker[];
  capabilities: {
    canEditDraft: boolean;
    canLock: boolean;
    editPermission: boolean;
    lockPermission: boolean;
    lockAuthority: {
      positionId: string;
      positionCode: string;
      authorityCode: string;
    } | null;
  };
}

type ResolvedMonitoringTemporalLens = Extract<
  MonitoringTemporalLens,
  { state: 'RESOLVED' }
>;

export type PeriodicScheduleCoherence =
  | {
      state: 'COHERENT';
      lens: ResolvedMonitoringTemporalLens;
      executionPlan: ExecutionPlanResponse;
    }
  | { state: 'NO_PLANNED_SOURCE' }
  | {
      state: 'INCOHERENT';
      reason:
        | 'TEMPORAL_LENS_NOT_RESOLVED'
        | 'PLANNED_SOURCE_STATUS_INVALID'
        | 'BASELINE_REQUIRED'
        | 'TEMPORAL_BASELINE_MISMATCH'
        | 'PROJECT_ID_MISMATCH'
        | 'EXECUTION_PLAN_BASELINE_MISMATCH'
        | 'EXECUTION_PLAN_NOT_AVAILABLE'
        | 'EXECUTION_PLAN_NOT_LOCKED'
        | 'EXECUTION_PLAN_ID_MISMATCH'
        | 'EXECUTION_PLAN_VERSION_MISMATCH'
        | 'DUPLICATE_WORK_ITEM_ID'
        | 'DUPLICATE_TEMPORAL_ITEM_ID'
        | 'DUPLICATE_SCHEDULE_ITEM_ID'
        | 'SCHEDULE_ITEM_NOT_IN_PERIODIC_RAB'
        | 'SCHEDULE_ITEM_NOT_IN_TEMPORAL_LENS';
    };

function exactBaselineIdentity(
  left: MonitoringResponse['baseline'],
  right: ExecutionPlanResponse['baseline'],
): boolean {
  return (
    left !== null &&
    right !== null &&
    left.id === right.id &&
    left.versionNumber === right.versionNumber &&
    left.approvedAt === right.approvedAt
  );
}

/**
 * Presentation-integrity gate only. It proves that one locked Schedule read
 * belongs to the same canonical Periodic Monitoring snapshot; it performs no
 * quantity, progress, boundary, or date calculation.
 */
export function periodicScheduleCoherence(input: {
  periodicResponse: MonitoringResponse;
  executionPlan: ExecutionPlanResponse;
}): PeriodicScheduleCoherence {
  const lens = input.periodicResponse.temporalLens;
  if (lens?.state !== 'RESOLVED') {
    return { state: 'INCOHERENT', reason: 'TEMPORAL_LENS_NOT_RESOLVED' };
  }
  if (lens.plannedSource === null) return { state: 'NO_PLANNED_SOURCE' };
  if (
    (lens.plannedSource as { status?: unknown }).status !== 'LOCKED'
  ) {
    return { state: 'INCOHERENT', reason: 'PLANNED_SOURCE_STATUS_INVALID' };
  }

  if (input.periodicResponse.baseline === null || lens.baseline === null) {
    return { state: 'INCOHERENT', reason: 'BASELINE_REQUIRED' };
  }
  if (
    !exactBaselineIdentity(input.periodicResponse.baseline, lens.baseline)
  ) {
    return { state: 'INCOHERENT', reason: 'TEMPORAL_BASELINE_MISMATCH' };
  }
  if (input.executionPlan.projectId !== input.periodicResponse.projectId) {
    return { state: 'INCOHERENT', reason: 'PROJECT_ID_MISMATCH' };
  }
  if (
    !exactBaselineIdentity(
      input.periodicResponse.baseline,
      input.executionPlan.baseline,
    )
  ) {
    return {
      state: 'INCOHERENT',
      reason: 'EXECUTION_PLAN_BASELINE_MISMATCH',
    };
  }

  const plan = input.executionPlan.plan;
  if (plan === null) {
    return { state: 'INCOHERENT', reason: 'EXECUTION_PLAN_NOT_AVAILABLE' };
  }
  if (plan.status !== 'LOCKED') {
    return { state: 'INCOHERENT', reason: 'EXECUTION_PLAN_NOT_LOCKED' };
  }
  if (plan.id !== lens.plannedSource.executionPlanVersionId) {
    return { state: 'INCOHERENT', reason: 'EXECUTION_PLAN_ID_MISMATCH' };
  }
  if (plan.versionNumber !== lens.plannedSource.versionNumber) {
    return { state: 'INCOHERENT', reason: 'EXECUTION_PLAN_VERSION_MISMATCH' };
  }

  const workItemIds = new Set<string>();
  for (const item of input.periodicResponse.items) {
    if (item.itemType !== 'WORK_ITEM') continue;
    if (workItemIds.has(item.id)) {
      return { state: 'INCOHERENT', reason: 'DUPLICATE_WORK_ITEM_ID' };
    }
    workItemIds.add(item.id);
  }

  const temporalItemIds = new Set<string>();
  for (const item of lens.items) {
    if (temporalItemIds.has(item.boqItemId)) {
      return { state: 'INCOHERENT', reason: 'DUPLICATE_TEMPORAL_ITEM_ID' };
    }
    temporalItemIds.add(item.boqItemId);
  }

  const scheduleItemIds = new Set<string>();
  for (const item of input.executionPlan.schedule) {
    if (scheduleItemIds.has(item.boqItemId)) {
      return { state: 'INCOHERENT', reason: 'DUPLICATE_SCHEDULE_ITEM_ID' };
    }
    if (!workItemIds.has(item.boqItemId)) {
      return {
        state: 'INCOHERENT',
        reason: 'SCHEDULE_ITEM_NOT_IN_PERIODIC_RAB',
      };
    }
    if (!temporalItemIds.has(item.boqItemId)) {
      return {
        state: 'INCOHERENT',
        reason: 'SCHEDULE_ITEM_NOT_IN_TEMPORAL_LENS',
      };
    }
    scheduleItemIds.add(item.boqItemId);
  }

  return { state: 'COHERENT', lens, executionPlan: input.executionPlan };
}

export type PeriodicSchedulePlanDecision =
  | { state: 'NO_PLANNED_SOURCE' }
  | { state: 'REUSE'; executionPlan: ExecutionPlanResponse }
  | { state: 'REFRESH_REQUIRED' };

export function periodicSchedulePlanDecision(input: {
  periodicResponse: MonitoringResponse;
  candidates: readonly (ExecutionPlanResponse | null)[];
}): PeriodicSchedulePlanDecision {
  const lens = input.periodicResponse.temporalLens;
  if (lens?.state === 'RESOLVED' && lens.plannedSource === null) {
    return { state: 'NO_PLANNED_SOURCE' };
  }
  for (const candidate of input.candidates) {
    if (candidate === null) continue;
    const coherence = periodicScheduleCoherence({
      periodicResponse: input.periodicResponse,
      executionPlan: candidate,
    });
    if (coherence.state === 'COHERENT') {
      return { state: 'REUSE', executionPlan: candidate };
    }
  }
  return { state: 'REFRESH_REQUIRED' };
}

export function executionPlanStatusLabel(
  state: ExecutionPlanReadinessState,
): string {
  const labels: Record<ExecutionPlanReadinessState, string> = {
    PLAN_NOT_READY: 'Rencana Pelaksanaan Belum Siap',
    REVISION_IN_PROGRESS: 'Rencana Pelaksanaan Belum Dikunci',
    READY_FOR_LOCK: 'Rencana Pelaksanaan Siap Dikunci',
    LOCKED_FOR_EXECUTION: 'Rencana Pelaksanaan Terkunci',
  };
  return labels[state];
}

const EXECUTION_PLAN_BLOCKER_LABELS: Readonly<Record<string, string>> = {
  NO_ACTIVE_BASELINE: 'Baseline aktif belum tersedia.',
  MULTIPLE_ACTIVE_BASELINES:
    'Terdapat lebih dari satu Baseline aktif. Penguncian dihentikan.',
  EXECUTION_PLAN_DRAFT_NOT_FOUND: 'Rencana Pelaksanaan belum dilengkapi.',
  ACTIVE_PROJECT_WITHOUT_LOCKED_PLAN:
    'Proyek aktif ini belum mempunyai Rencana Pelaksanaan terkunci.',
  LEGACY_ACTIVE_PROJECT_REQUIRES_PLAN_ADOPTION:
    'Proyek ini sudah aktif sebelum Rencana Pelaksanaan resmi tersedia di SIMPROK. Lengkapi dan kunci Rencana Pelaksanaan untuk melanjutkan pencatatan realisasi baru.',
  PROJECT_NOT_PLANNED: 'Proyek tidak lagi berada pada tahap perencanaan.',
  NO_REQUIRED_WORK_ITEMS: 'Baseline belum mempunyai item pekerjaan berkuantitas positif.',
  MISSING_WORK_ITEM_DISTRIBUTION: 'Distribusi waktu item pekerjaan belum tersedia.',
  PLANNED_QUANTITY_INCOMPLETE: 'Jumlah rencana item belum mencapai volume Baseline.',
  PLANNED_QUANTITY_EXCEEDS_BASELINE: 'Jumlah rencana item melebihi volume Baseline.',
  INVALID_DISTRIBUTION_WORK_ITEM: 'Distribusi mengacu pada item di luar Baseline aktif.',
  INVALID_DISTRIBUTION_DATE: 'Rentang tanggal rencana tidak valid.',
  INVALID_DISTRIBUTION_QUANTITY: 'Kuantitas rencana harus lebih besar dari nol.',
  DISTRIBUTION_INTERVAL_OVERLAP: 'Periode rencana untuk item yang sama saling tumpang tindih.',
  H2A1_WEIGHT_UNAVAILABLE:
    'Kurva S Rencana belum tersedia karena bobot RAB resmi belum lengkap.',
  LOCKED_PLAN_PROJECT_NOT_ACTIVE:
    'Integritas eksekusi tidak konsisten: plan terkunci tetapi proyek belum aktif.',
};

export function executionPlanCurveUnavailableLabel(
  reason: string | null,
): string {
  if (reason && EXECUTION_PLAN_BLOCKER_LABELS[reason]) {
    return executionPlanBlockerLabel({ code: reason });
  }
  return 'Kurva S Rencana belum tersedia karena data rencana belum lengkap.';
}

export function executionPlanPeriodCountLabel(
  distributionCount: number,
): string {
  return distributionCount === 0
    ? 'Belum dilengkapi'
    : String(distributionCount) + ' periode';
}

export function executionPlanBlockerLabel(
  blocker: ExecutionPlanBlocker,
): string {
  const base =
    EXECUTION_PLAN_BLOCKER_LABELS[blocker.code] ??
    'Rencana belum memenuhi syarat penguncian.';
  if (!blocker.boqItemId) return base;
  const quantities =
    blocker.expectedQuantity && blocker.plannedQuantity
      ? ` Rencana ${blocker.plannedQuantity}; Baseline ${blocker.expectedQuantity}.`
      : '';
  return `${base}${quantities}`;
}
