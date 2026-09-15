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
