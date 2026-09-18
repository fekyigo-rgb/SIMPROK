import { assignStructuralNumbers } from './rabRowNumbering.ts';
import { projectTimestampPresentation } from './progressActual.ts';

export type MonitoringFactState =
  | 'RECORDED'
  | 'NOT_YET_RECORDED'
  | 'UNAVAILABLE';

export type MonitoringWeightReason =
  | 'BASELINE_VALUE_UNAVAILABLE'
  | 'ZERO_BASELINE_DENOMINATOR'
  | 'INVALID_BASELINE_DENOMINATOR'
  | 'ITEM_VALUE_UNAVAILABLE'
  | 'INCOMPLETE_BASELINE_VALUE_COVERAGE';

export type MonitoringWeightFact =
  | { state: 'AVAILABLE'; percentage: string; reason: null }
  | {
      state: 'UNAVAILABLE';
      percentage: null;
      reason: MonitoringWeightReason;
    }
  | { state: 'NOT_APPLICABLE'; percentage: null; reason: null };

export interface MonitoringRowWeight {
  own: MonitoringWeightFact;
  subtree: MonitoringWeightFact;
  cumulative: MonitoringWeightFact;
}

export interface MonitoringProjectWeight {
  basis: 'ACTIVE_BASELINE_RAB_TOTAL_BASE_COST';
  completeness: 'COMPLETE' | 'INCOMPLETE' | 'UNAVAILABLE';
  reason: MonitoringWeightReason | null;
  denominator: {
    state: 'AVAILABLE' | 'UNAVAILABLE';
    value: string | null;
  };
  eligibleWorkItemCount: number;
  weightedWorkItemCount: number;
  unavailableWorkItemCount: number;
}

export interface MonitoringEffectiveRecord {
  id: string;
  installedQuantity: string;
  workDate: string | null;
  notes: string | null;
  captureMethod: string;
  evidenceReferences: unknown[];
  recordedByAccountId: string | null;
  supersedesEntryId: string | null;
  recordedAt: string;
}

export type MonitoringActual =
  | {
      state: 'RECORDED';
      lifecycleState: string;
      effectiveRecord: MonitoringEffectiveRecord;
      latestRecord?: unknown;
    }
  | {
      state: 'NOT_YET_RECORDED' | 'UNAVAILABLE';
      effectiveRecord: null;
      latestRecord?: unknown;
    };

export interface MonitoringItem {
  id: string;
  parentId: string | null;
  wbsNodeId: string | null;
  wbsCode: string;
  name: string;
  itemType: string;
  sortOrder: number;
  planned: { quantity: string; unit: string };
  weight: MonitoringRowWeight;

  /**
   * Backend-authoritative official calculation truth.
   *
   * This is deliberately separate from `actual`.
   * `actual` is record context; these fields are calculation facts.
   */
  currentOfficialQuantity:
    | {
        state:
          | 'NOT_YET_RECORDED'
          | 'NO_ELIGIBLE_CURRENT_FACT'
          | 'INVALID_LINEAGE'
          | 'INVALID_NUMERIC_FACT'
          | 'SEMANTICS_UNPROVEN';
      }
    | {
        state: 'INCOMPLETE';
        knownEligibleQuantitySubtotal: string;
      }
    | {
        state: 'COMPLETE';
        currentOfficialQuantity: string;
      };

  currentOfficialItemProgress:
    | {
        state:
          | 'NOT_YET_RECORDED'
          | 'NO_ELIGIBLE_CURRENT_FACT'
          | 'INVALID_LINEAGE'
          | 'INVALID_NUMERIC_FACT'
          | 'SEMANTICS_UNPROVEN';
      }
    | {
        state: 'INCOMPLETE';
        knownProgressSubtotalPercent?: string;
      }
    | {
        state: 'UNAVAILABLE';
        reason: string;
      }
    | {
        state: 'COMPLETE';
        rawPhysicalProgressPercent: string;
        boundedContributionProgressPercent: string;
      };

  actual: MonitoringActual | null;
}

export interface MonitoringFreshness {
  dataThrough: {
    state: MonitoringFactState;
    workDate: string | null;
  };
  lastRecordedAt: {
    state: MonitoringFactState;
    recordedAt: string | null;
  };
}

export type MonitoringOfficialProjectProgress =
  | {
      state: 'COMPLETE';
      currentOfficialRabWeightedPhysicalProgressPercent: string;
    }
  | {
      state: 'INCOMPLETE';
      knownWeightedContributionSubtotalPercent: string;
    }
  | {
      state: 'UNAVAILABLE';
      reason: string;
    };

export type MonitoringComparisonPlannedProgress =
  | {
      state: 'COMPLETE';
      plannedRabWeightedPhysicalProgressPercent: string;
    }
  | {
      state: 'INCOMPLETE';
      reason: string;
      knownWeightedPlannedProgressSubtotalPercent: string;
    }
  | {
      state: 'UNAVAILABLE';
      reason: string;
    };

export type MonitoringComparisonDeviation =
  | { state: 'COMPLETE'; value: string }
  | {
      state: 'UNAVAILABLE';
      reason: {
        planned: 'PLANNED_INCOMPLETE' | 'PLANNED_UNAVAILABLE' | null;
        actual: 'ACTUAL_INCOMPLETE' | 'ACTUAL_UNAVAILABLE' | null;
      };
    };

export interface MonitoringProgressComparisonPoint {
  cutoffDate: string;
  planned: MonitoringComparisonPlannedProgress;
  actual: MonitoringOfficialProjectProgress;
  deviationPercentagePoints: MonitoringComparisonDeviation;
}

export interface MonitoringProgressComparison {
  mode: 'PLANNED_VS_CURRENT_OFFICIAL_TRUTH_RESTATED_TO_WORKDATE';
  cutoffDate: string;
  baseline: {
    id: string;
    versionNumber: number;
    approvedAt: string;
  } | null;
  plannedSource: {
    executionPlanVersionId: string;
    versionNumber: number;
    status: 'LOCKED';
  } | null;
  boundaryBasis:
    'PLANNED_PERIOD_ENDS_AND_GOVERNED_ACTUAL_WORKDATES_AND_REQUESTED_CUTOFF';
  points: MonitoringProgressComparisonPoint[];
}

export type MonitoringTemporalBasis = 'CALENDAR' | 'WORK_PERIOD';
export type MonitoringTemporalGranularity = 'WEEK' | 'MONTH';

type MonitoringTemporalPeriodBase = {
  periodKey: string;
  periodIndex: number;
  startDate: string;
  endDate: string;
};

export type MonitoringTemporalPeriod =
  | (MonitoringTemporalPeriodBase & {
      basis: 'CALENDAR'; granularity: 'WEEK';
      metadata: {
        boundaryInclusivity: 'START_AND_END_INCLUSIVE';
        boundaryRule: 'ISO_8601_MONDAY_TO_SUNDAY';
        isoWeekYear: number; isoWeekNumber: number;
      };
    })
  | (MonitoringTemporalPeriodBase & {
      basis: 'CALENDAR'; granularity: 'MONTH';
      metadata: {
        boundaryInclusivity: 'START_AND_END_INCLUSIVE';
        boundaryRule: 'GREGORIAN_CALENDAR_MONTH';
        calendarYear: number; calendarMonth: number;
      };
    })
  | (MonitoringTemporalPeriodBase & {
      basis: 'WORK_PERIOD'; granularity: 'WEEK';
      metadata: {
        boundaryInclusivity: 'START_AND_END_INCLUSIVE';
        boundaryRule: 'SEVEN_DAY_WINDOW_FROM_GOVERNED_WORK_PERIOD_ANCHOR';
        governedWorkPeriodAnchorDate: string;
      };
    })
  | (MonitoringTemporalPeriodBase & {
      basis: 'WORK_PERIOD'; granularity: 'MONTH';
      metadata: {
        boundaryInclusivity: 'START_AND_END_INCLUSIVE';
        boundaryRule: 'ORIGINAL_ANCHOR_ANNIVERSARY_MONTH_WITH_TARGET_CLAMP';
        governedWorkPeriodAnchorDate: string;
      };
    });

export type MonitoringPlannedItemQuantity =
  | { state: 'COMPLETE'; plannedQuantity: string }
  | { state: 'INCOMPLETE'; reason: string; knownPlannedQuantitySubtotal: string }
  | { state: 'UNAVAILABLE'; reason: string };

export interface MonitoringPeriodEvidenceFact {
  sourceActualEntryId: string;
  workDate: string;
  recordedAt: string;
  captureMethod: string;
  notes: string | null;
  evidenceReferences: unknown[];
}

export type MonitoringPeriodEvidence =
  | { state: 'COMPLETE' | 'INCOMPLETE'; facts: MonitoringPeriodEvidenceFact[] }
  | {
      state:
        | 'NOT_YET_RECORDED'
        | 'NO_ELIGIBLE_CURRENT_FACT'
        | 'INVALID_NUMERIC_FACT'
        | 'SEMANTICS_UNPROVEN';
      facts: MonitoringPeriodEvidenceFact[];
    }
  | {
      state: 'INVALID_LINEAGE';
      reason?: string;
      facts: MonitoringPeriodEvidenceFact[];
    };

export interface MonitoringTemporalLensItem {
  boqItemId: string;
  planned: {
    periodQuantity: MonitoringPlannedItemQuantity;
    cumulativeQuantityThroughEndDate: MonitoringPlannedItemQuantity;
  };
  actual: {
    periodOfficialQuantity: MonitoringItem['currentOfficialQuantity'];
    cumulativeOfficialQuantityThroughEndDate: MonitoringItem['currentOfficialQuantity'];
    periodEvidence: MonitoringPeriodEvidence;
  };
}

export interface MonitoringTemporalLensWeeklyRecap {
  rule: 'CANONICAL_WEEK_SLICE_RECAP';
  sliceCount: number;
  slices: Array<{
    weekPeriodKey: string;
    weekPeriodIndex: number;
    weekStartDate: string;
    weekEndDate: string;
    sliceStartDate: string;
    sliceEndDate: string;
  }>;
}

export type MonitoringTemporalLens =
  | {
      mode: 'CANONICAL_MONITORING_TEMPORAL_LENS_V1'; state: 'UNAVAILABLE';
      basis: MonitoringTemporalBasis; granularity: MonitoringTemporalGranularity;
      referenceDate: string; reason: string;
    }
  | {
      mode: 'CANONICAL_MONITORING_TEMPORAL_LENS_V1'; state: 'RESOLVED';
      basis: MonitoringTemporalBasis; granularity: MonitoringTemporalGranularity;
      referenceDate: string; period: MonitoringTemporalPeriod;
      weeklyRecap?: MonitoringTemporalLensWeeklyRecap;
      baseline: { id: string; versionNumber: number; approvedAt: string } | null;
      plannedSource: {
        executionPlanVersionId: string; versionNumber: number; status: 'LOCKED';
      } | null;
      plannedContext:
        | { state: 'COMPLETE' }
        | { state: 'INCOMPLETE' | 'UNAVAILABLE'; reason: string };
      actualTruthMode: 'CURRENT_OFFICIAL_TRUTH_RESTATED_TO_EXPLICIT_WORKDATE_WINDOW';
      items: MonitoringTemporalLensItem[];
    };

export type MonitoringProgressComparisonPresentation =
  | { state: 'PENDING'; cutoffDate: null; comparison: null }
  | { state: 'LOADING'; cutoffDate: string; comparison: null }
  | {
      state: 'AVAILABLE';
      cutoffDate: string;
      comparison: MonitoringProgressComparison;
    }
  | {
      state: 'MISSING_CUTOFF' | 'UNAVAILABLE';
      cutoffDate: string | null;
      comparison: null;
    };

export interface MonitoringResponse {
  projectId: string;
  projectTimeZone: string | null;
  baseline: {
    id: string;
    versionNumber: number;
    approvedAt: string;
  } | null;
  freshness: MonitoringFreshness;
  weight: MonitoringProjectWeight;

  /**
   * Backend-authoritative project-level RAB-weighted physical progress.
   * Frontend renders the supplied state/value and performs no calculation.
   */
  currentOfficialRabWeightedPhysicalProgress: MonitoringOfficialProjectProgress;

  /** Present on an explicit cutoff request or an atomic Temporal Lens request. */
  progressComparison?: MonitoringProgressComparison;

  /** Present only on an explicit canonical Temporal Lens request. */
  temporalLens?: MonitoringTemporalLens;

  items: MonitoringItem[];
  unavailable: string[];
}

export interface MonitoringPeriodicSchedulePlanIdentity {
  id: string;
  versionNumber: number;
  status: 'DRAFT' | 'LOCKED';
}

export type MonitoringPeriodicComparisonCoherence =
  | {
      state: 'COHERENT';
      response: MonitoringResponse;
      comparison: MonitoringProgressComparison;
    }
  | {
      state: 'INCOHERENT';
      reason:
        | 'TEMPORAL_LENS_NOT_RESOLVED'
        | 'TEMPORAL_BASELINE_MISMATCH'
        | 'COMPARISON_NOT_AVAILABLE'
        | 'COMPARISON_MODE_INVALID'
        | 'COMPARISON_CUTOFF_MISMATCH'
        | 'COMPARISON_BASELINE_MISMATCH'
        | 'PLANNED_SOURCE_MISMATCH'
        | 'SCHEDULE_PLAN_MISMATCH';
    };

export type MonitoringPeriodicComparisonPresentation =
  | { state: 'DISABLED' }
  | { state: 'NO_COMPARATOR_CONTEXT' | 'CHECKING'; requestKey: string }
  | {
      state: 'RESOLVED';
      requestKey: string;
      response: MonitoringResponse;
      comparison: MonitoringProgressComparison;
    }
  | { state: 'INCOHERENT' | 'ERROR'; requestKey: string };

function exactMonitoringBaselineIdentity(
  left: MonitoringResponse['baseline'],
  right: MonitoringResponse['baseline'],
): boolean {
  return (
    (left === null && right === null) ||
    (left !== null &&
      right !== null &&
      left.id === right.id &&
      left.versionNumber === right.versionNumber &&
      left.approvedAt === right.approvedAt)
  );
}

function exactMonitoringPlannedSourceIdentity(
  left: MonitoringProgressComparison['plannedSource'],
  right: MonitoringProgressComparison['plannedSource'],
): boolean {
  return (
    (left === null && right === null) ||
    (left !== null &&
      right !== null &&
      left.status === 'LOCKED' &&
      right.status === 'LOCKED' &&
      left.executionPlanVersionId === right.executionPlanVersionId &&
      left.versionNumber === right.versionNumber)
  );
}

/**
 * Presentation-integrity gate only. It proves that the comparator embedded in
 * one resolved Periodic Monitoring response is internally coherent and performs
 * no progress, deviation, quantity, curve, or temporal calculation.
 */
export function periodicComparisonCoherence(input: {
  periodicResponse: MonitoringResponse;
  periodicSchedulePlan?: MonitoringPeriodicSchedulePlanIdentity | null;
}): MonitoringPeriodicComparisonCoherence {
  const lens = input.periodicResponse.temporalLens;
  if (lens?.state !== 'RESOLVED') {
    return { state: 'INCOHERENT', reason: 'TEMPORAL_LENS_NOT_RESOLVED' };
  }

  if (
    !exactMonitoringBaselineIdentity(
      input.periodicResponse.baseline,
      lens.baseline,
    )
  ) {
    return { state: 'INCOHERENT', reason: 'TEMPORAL_BASELINE_MISMATCH' };
  }

  const comparison = input.periodicResponse.progressComparison;
  if (comparison === undefined) {
    return { state: 'INCOHERENT', reason: 'COMPARISON_NOT_AVAILABLE' };
  }
  if (
    comparison.mode !==
    'PLANNED_VS_CURRENT_OFFICIAL_TRUTH_RESTATED_TO_WORKDATE'
  ) {
    return { state: 'INCOHERENT', reason: 'COMPARISON_MODE_INVALID' };
  }
  if (comparison.cutoffDate !== lens.period.endDate) {
    return { state: 'INCOHERENT', reason: 'COMPARISON_CUTOFF_MISMATCH' };
  }
  if (
    !exactMonitoringBaselineIdentity(
      comparison.baseline,
      input.periodicResponse.baseline,
    ) ||
    !exactMonitoringBaselineIdentity(comparison.baseline, lens.baseline)
  ) {
    return { state: 'INCOHERENT', reason: 'COMPARISON_BASELINE_MISMATCH' };
  }
  if (
    !exactMonitoringPlannedSourceIdentity(
      comparison.plannedSource,
      lens.plannedSource,
    )
  ) {
    return { state: 'INCOHERENT', reason: 'PLANNED_SOURCE_MISMATCH' };
  }

  const schedulePlan = input.periodicSchedulePlan;
  if (
    schedulePlan &&
    (schedulePlan.status !== 'LOCKED' ||
      comparison.plannedSource === null ||
      schedulePlan.id !== comparison.plannedSource.executionPlanVersionId ||
      schedulePlan.versionNumber !== comparison.plannedSource.versionNumber)
  ) {
    return { state: 'INCOHERENT', reason: 'SCHEDULE_PLAN_MISMATCH' };
  }

  return { state: 'COHERENT', response: input.periodicResponse, comparison };
}

export type MonitoringTemporalSnapshotCoherence =
  | {
      state: 'COHERENT';
      lens: Extract<MonitoringTemporalLens, { state: 'RESOLVED' }>;
    }
  | {
      state: 'INCOHERENT';
      reason:
        | 'PROJECT_ID_MISMATCH'
        | 'TEMPORAL_LENS_NOT_RESOLVED'
        | 'BASELINE_MISMATCH'
        | 'DUPLICATE_WORK_ITEM_ID'
        | 'DUPLICATE_TEMPORAL_ITEM_ID'
        | 'TEMPORAL_ITEM_NOT_IN_SNAPSHOT';
    };

export function monitoringTemporalSnapshotCoherence(input: {
  requestedProjectId: string;
  response: MonitoringResponse;
}): MonitoringTemporalSnapshotCoherence {
  if (input.response.projectId !== input.requestedProjectId) {
    return { state: 'INCOHERENT', reason: 'PROJECT_ID_MISMATCH' };
  }

  const lens = input.response.temporalLens;
  if (lens?.state !== 'RESOLVED') {
    return { state: 'INCOHERENT', reason: 'TEMPORAL_LENS_NOT_RESOLVED' };
  }

  const responseBaseline = input.response.baseline;
  const lensBaseline = lens.baseline;
  if (!exactMonitoringBaselineIdentity(responseBaseline, lensBaseline)) {
    return { state: 'INCOHERENT', reason: 'BASELINE_MISMATCH' };
  }

  const workItemIds = new Set<string>();
  for (const item of input.response.items) {
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
    if (!workItemIds.has(item.boqItemId)) {
      return { state: 'INCOHERENT', reason: 'TEMPORAL_ITEM_NOT_IN_SNAPSHOT' };
    }
    temporalItemIds.add(item.boqItemId);
  }

  return { state: 'COHERENT', lens };
}

export function monitoringActiveSnapshot(input: {
  mode: 'TERKINI' | 'PERIODIK';
  currentResponse: MonitoringResponse | null;
  periodicResponse: MonitoringResponse | null;
}): MonitoringResponse | null {
  return input.mode === 'TERKINI'
    ? input.currentResponse
    : input.periodicResponse;
}

export function monitoringPeriodicSnapshotForRequest(input: {
  activeRequestKey: string;
  responseRequestKey: string;
  response: MonitoringResponse;
}): MonitoringResponse | null {
  return input.activeRequestKey === input.responseRequestKey
    ? input.response
    : null;
}

export interface MonitoringProject {
  id: string;
  name: string;
  code: string;
  status: string;
}

export type MonitoringRow = MonitoringItem & {
  number: string;
  depth: number;
};

export function buildMonitoringRows(
  items: readonly MonitoringItem[],
): MonitoringRow[] {
  return assignStructuralNumbers(
    items.map((item) => ({
      ...item,
      isNote: item.itemType === 'NOTE',
    })),
  );
}

export function selectedWorkItem(
  rows: readonly MonitoringRow[],
  selectedId: string | null,
): MonitoringRow | null {
  if (!selectedId) return null;
  return (
    rows.find(
      (row) => row.id === selectedId && row.itemType === 'WORK_ITEM',
    ) ?? null
  );
}

export function effectiveActual(
  item: MonitoringItem | null,
): MonitoringEffectiveRecord | null {
  if (item?.actual?.state !== 'RECORDED') return null;
  return item.actual.effectiveRecord;
}

export interface MonitoringEvidencePresentation {
  url: string;
  label: string;
  mediaType?: string;
  integrityHash?: string;
  presentation: 'IMAGE' | 'VIDEO' | 'LINK';
}

export function monitoringEvidencePresentation(
  value: unknown,
): MonitoringEvidencePresentation[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      return [];
    }

    const record = candidate as Record<string, unknown>;
    if (
      typeof record.url !== 'string' ||
      record.url.trim() === '' ||
      typeof record.label !== 'string' ||
      record.label.trim() === ''
    ) {
      return [];
    }

    try {
      const protocol = new URL(record.url).protocol;
      if (protocol !== 'http:' && protocol !== 'https:') return [];
    } catch {
      return [];
    }

    const mediaType =
      typeof record.mediaType === 'string' ? record.mediaType : undefined;
    const integrityHash =
      typeof record.integrityHash === 'string'
        ? record.integrityHash
        : undefined;
    const normalizedMediaType = mediaType?.toLowerCase() ?? '';

    return [
      {
        url: record.url,
        label: record.label,
        ...(mediaType === undefined ? {} : { mediaType }),
        ...(integrityHash === undefined ? {} : { integrityHash }),
        presentation: normalizedMediaType.startsWith('image/')
          ? ('IMAGE' as const)
          : normalizedMediaType.startsWith('video/')
            ? ('VIDEO' as const)
            : ('LINK' as const),
      },
    ];
  });
}

type MonitoringOfficialFactState =
  | MonitoringItem['currentOfficialQuantity']['state']
  | MonitoringItem['currentOfficialItemProgress']['state'];

export interface ScheduleRealizationPresentation {
  currentOfficialQuantity: string;
  currentOfficialItemProgress: string;
  effectiveWorkDate: string;
  quantityState: string;
  progressState: string;
}

export function monitoringWorkItemsById(
  items: readonly MonitoringItem[],
): ReadonlyMap<string, MonitoringItem> {
  return new Map(
    items
      .filter((item) => item.itemType === 'WORK_ITEM')
      .map((item) => [item.id, item] as const),
  );
}

export function officialQuantityLabel(
  fact: MonitoringItem['currentOfficialQuantity'],
  unit: string,
): string {
  switch (fact.state) {
    case 'COMPLETE':
      return `${fact.currentOfficialQuantity} ${unit}`.trim();
    case 'INCOMPLETE':
      return `Belum lengkap — subtotal ${fact.knownEligibleQuantitySubtotal} ${unit}`.trim();
    case 'NOT_YET_RECORDED':
      return 'BELUM DICATAT';
    case 'NO_ELIGIBLE_CURRENT_FACT':
      return 'TIDAK ADA FAKTA BERLAKU';
    case 'INVALID_LINEAGE':
      return 'LINEAGE TIDAK VALID';
    case 'INVALID_NUMERIC_FACT':
      return 'FAKTA NUMERIK TIDAK VALID';
    case 'SEMANTICS_UNPROVEN':
      return 'SEMANTIK BELUM TERBUKTI';
  }
}

export function officialItemProgressLabel(
  fact: MonitoringItem['currentOfficialItemProgress'],
): string {
  switch (fact.state) {
    case 'COMPLETE':
      return `${fact.boundedContributionProgressPercent}%`;
    case 'INCOMPLETE':
      return fact.knownProgressSubtotalPercent === undefined
        ? 'BELUM LENGKAP'
        : `BELUM LENGKAP — subtotal ${fact.knownProgressSubtotalPercent}%`;
    case 'UNAVAILABLE':
      return `TIDAK TERSEDIA — ${fact.reason}`;
    case 'NOT_YET_RECORDED':
      return 'BELUM DICATAT';
    case 'NO_ELIGIBLE_CURRENT_FACT':
      return 'TIDAK ADA FAKTA BERLAKU';
    case 'INVALID_LINEAGE':
      return 'LINEAGE TIDAK VALID';
    case 'INVALID_NUMERIC_FACT':
      return 'FAKTA NUMERIK TIDAK VALID';
    case 'SEMANTICS_UNPROVEN':
      return 'SEMANTIK BELUM TERBUKTI';
  }
}

export function officialFactStateLabel(state: MonitoringOfficialFactState): string {
  switch (state) {
    case 'COMPLETE':
      return 'Lengkap';
    case 'INCOMPLETE':
      return 'Belum lengkap';
    case 'UNAVAILABLE':
      return 'Tidak tersedia';
    case 'NOT_YET_RECORDED':
      return 'Belum dicatat';
    case 'NO_ELIGIBLE_CURRENT_FACT':
      return 'Tidak ada fakta berlaku';
    case 'INVALID_LINEAGE':
      return 'Lineage tidak valid';
    case 'INVALID_NUMERIC_FACT':
      return 'Fakta numerik tidak valid';
    case 'SEMANTICS_UNPROVEN':
      return 'Semantik belum terbukti';
  }
}

export function scheduleRealizationPresentation(
  item: MonitoringItem | undefined,
  unit: string,
): ScheduleRealizationPresentation {
  if (!item) {
    return {
      currentOfficialQuantity: 'TIDAK TERSEDIA',
      currentOfficialItemProgress: 'TIDAK TERSEDIA',
      effectiveWorkDate: 'TIDAK TERSEDIA',
      quantityState: 'Tidak tersedia',
      progressState: 'Tidak tersedia',
    };
  }

  const actual = effectiveActual(item);
  const formattedWorkDate = formatProjectBusinessDate(actual?.workDate ?? null);
  const effectiveWorkDate =
    formattedWorkDate ||
    (item.actual?.state === 'NOT_YET_RECORDED'
      ? 'BELUM DICATAT'
      : 'TIDAK TERSEDIA');

  return {
    currentOfficialQuantity: officialQuantityLabel(
      item.currentOfficialQuantity,
      unit,
    ),
    currentOfficialItemProgress: officialItemProgressLabel(
      item.currentOfficialItemProgress,
    ),
    effectiveWorkDate,
    quantityState: officialFactStateLabel(item.currentOfficialQuantity.state),
    progressState: officialFactStateLabel(
      item.currentOfficialItemProgress.state,
    ),
  };
}

/**
 * Display rounding only. Authoritative percentage math is completed by the
 * backend with Prisma.Decimal; this function never chooses a denominator or
 * turns the wire value back into a JavaScript floating-point Number.
 */
export function formatWeightPercentage(
  fact: MonitoringWeightFact,
): string {
  if (fact.state === 'UNAVAILABLE') return 'TIDAK TERSEDIA';
  if (fact.state === 'NOT_APPLICABLE') return '—';

  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(fact.percentage);
  if (!match) return 'TIDAK TERSEDIA';
  const negative = match[1] === '-';
  const integer = match[2];
  const fraction = (match[3] ?? '').padEnd(3, '0');
  let scaled = BigInt(integer) * 100n + BigInt(fraction.slice(0, 2));
  if (fraction[2] >= '5') scaled += 1n;

  const whole = scaled / 100n;
  const decimals = (scaled % 100n).toString().padStart(2, '0');
  const sign = negative && scaled !== 0n ? '-' : '';
  return `${sign}${whole.toString()},${decimals}%`;
}

export function rowWeightPresentation(item: MonitoringItem): {
  kind: 'ITEM' | 'SECTION' | 'NONE';
  value: string;
} {
  if (item.itemType === 'WORK_ITEM') {
    return { kind: 'ITEM', value: formatWeightPercentage(item.weight.own) };
  }
  if (item.itemType === 'FOLDER') {
    return {
      kind: 'SECTION',
      value: formatWeightPercentage(item.weight.subtree),
    };
  }
  return { kind: 'NONE', value: '—' };
}

export function weightCompletenessLabel(
  weight: MonitoringProjectWeight,
): string {
  if (weight.completeness === 'COMPLETE') return 'Lengkap';
  if (weight.completeness === 'INCOMPLETE') return 'Belum lengkap';
  return 'TIDAK TERSEDIA';
}

export function weightCompletenessExplanation(
  weight: MonitoringProjectWeight,
): string {
  if (weight.completeness === 'COMPLETE') {
    return 'Seluruh item pekerjaan mempunyai nilai Baseline yang dapat dihitung.';
  }
  if (weight.reason === 'ZERO_BASELINE_DENOMINATOR') {
    return 'Total nilai dasar Baseline adalah nol, sehingga bobot tidak dapat dihitung.';
  }
  if (
    weight.reason === 'BASELINE_VALUE_UNAVAILABLE' ||
    weight.reason === 'INVALID_BASELINE_DENOMINATOR'
  ) {
    return 'Total nilai dasar Baseline belum tersedia untuk perhitungan bobot.';
  }
  return 'Sebagian nilai item Baseline belum tersedia atau belum cocok dengan total Baseline.';
}

export function formatProjectBusinessDate(value: string | null): string {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return '';
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeZone: 'UTC',
  }).format(date);
}

export function dataThroughLabel(
  freshness: MonitoringFreshness['dataThrough'],
): string {
  if (freshness.state === 'NOT_YET_RECORDED') return 'BELUM DICATAT';
  if (freshness.state === 'UNAVAILABLE') return 'TIDAK TERSEDIA';
  return formatProjectBusinessDate(freshness.workDate) || 'TIDAK TERSEDIA';
}

/**
 * The Monitoring API serializes its Project Business Date as either the
 * date-only wire or the same date at exact UTC midnight. Taking the captured
 * date component is intentionally not a timezone conversion.
 */
export function monitoringComparisonCutoff(
  freshness: MonitoringFreshness['dataThrough'],
): string | null {
  if (freshness.state !== 'RECORDED' || freshness.workDate === null) {
    return null;
  }

  const match = /^(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))(?:T00:00:00\.000Z)?$/.exec(
    freshness.workDate,
  );
  return match?.[1] ?? null;
}

export function monitoringComparisonRequestPath(
  projectId: string,
  cutoffDate: string,
): string {
  return (
    '/projects/' +
    projectId +
    '/progress/monitoring?cutoffDate=' +
    cutoffDate +
    '&includeProgressComparison=true'
  );
}

export function monitoringTemporalLensRequestPath(input: {
  projectId: string;
  basis: MonitoringTemporalBasis;
  granularity: MonitoringTemporalGranularity;
  referenceDate: string;
}): string {
  const params = new URLSearchParams({
    includeTemporalLens: 'true',
    temporalBasis: input.basis,
    temporalGranularity: input.granularity,
    temporalReferenceDate: input.referenceDate,
    includeProgressComparison: 'true',
  });
  return `/projects/${input.projectId}/progress/monitoring?${params.toString()}`;
}

export function monitoringTemporalBasisLabel(basis: MonitoringTemporalBasis): string {
  return basis === 'WORK_PERIOD' ? 'Waktu Kerja' : 'Kalender';
}

export function monitoringTemporalGranularityLabel(
  granularity: MonitoringTemporalGranularity,
): string {
  return granularity === 'WEEK' ? 'Mingguan' : 'Bulanan';
}

const INDONESIAN_MONTH_LABELS: Readonly<Record<number, string>> = {
  1: 'Januari', 2: 'Februari', 3: 'Maret', 4: 'April', 5: 'Mei', 6: 'Juni',
  7: 'Juli', 8: 'Agustus', 9: 'September', 10: 'Oktober',
  11: 'November', 12: 'Desember',
};

export function monitoringTemporalPeriodLabel(period: MonitoringTemporalPeriod): string {
  if (period.basis === 'WORK_PERIOD') {
    return period.granularity === 'WEEK'
      ? `Minggu Kerja ke-${period.periodIndex}`
      : `Bulan Kerja ke-${period.periodIndex}`;
  }
  if (period.granularity === 'WEEK') return `Minggu Kalender \u00b7 ${period.periodKey}`;
  const month = INDONESIAN_MONTH_LABELS[period.metadata.calendarMonth];
  return month === undefined
    ? `Bulan Kalender \u00b7 ${period.periodKey}`
    : `${month} ${period.metadata.calendarYear}`;
}

export function monitoringTemporalLensUnavailableMessage(reason: string): string {
  const messages: Readonly<Record<string, string>> = {
    GOVERNED_WORK_PERIOD_ANCHOR_REQUIRED:
      'Basis Waktu Kerja belum tersedia karena Hari Pertama Resmi proyek belum dibuktikan.',
    WORK_PERIOD_ANCHOR_PROVENANCE_INVALID:
      'Basis Waktu Kerja tidak dapat digunakan karena bukti Hari Pertama Resmi tidak valid.',
    REFERENCE_DATE_BEFORE_GOVERNED_WORK_PERIOD_ANCHOR:
      'Tanggal acuan berada sebelum Hari Pertama Resmi proyek.',
  };
  return messages[reason] ?? 'Konteks periode belum tersedia dari fakta proyek yang sah.';
}

export function plannedPeriodQuantityLabel(
  fact: MonitoringPlannedItemQuantity | undefined,
  unit: string,
): string {
  if (fact === undefined || fact.state === 'UNAVAILABLE') return 'TIDAK TERSEDIA';
  if (fact.state === 'INCOMPLETE') {
    return `Belum lengkap \u2014 subtotal ${fact.knownPlannedQuantitySubtotal} ${unit}`.trim();
  }
  return `${fact.plannedQuantity} ${unit}`.trim();
}

export function temporalActualQuantityLabel(
  fact: MonitoringItem['currentOfficialQuantity'] | undefined,
  unit: string,
): string {
  return fact === undefined ? 'TIDAK TERSEDIA' : officialQuantityLabel(fact, unit);
}

export function temporalLensItemsByBoqItemId(
  items: readonly MonitoringTemporalLensItem[],
): ReadonlyMap<string, MonitoringTemporalLensItem> {
  return new Map(items.map((item) => [item.boqItemId, item] as const));
}

export function plannedComparisonLabel(
  fact: MonitoringComparisonPlannedProgress,
): string {
  switch (fact.state) {
    case 'COMPLETE':
      return fact.plannedRabWeightedPhysicalProgressPercent + '%';
    case 'INCOMPLETE':
      return (
        'Belum lengkap · subtotal ' +
        fact.knownWeightedPlannedProgressSubtotalPercent +
        '%'
      );
    case 'UNAVAILABLE':
      return 'Tidak tersedia';
  }
}

export function actualComparisonLabel(
  fact: MonitoringOfficialProjectProgress,
): string {
  switch (fact.state) {
    case 'COMPLETE':
      return fact.currentOfficialRabWeightedPhysicalProgressPercent + '%';
    case 'INCOMPLETE':
      return (
        'Belum lengkap · subtotal ' +
        fact.knownWeightedContributionSubtotalPercent +
        '%'
      );
    case 'UNAVAILABLE':
      return 'Tidak tersedia';
  }
}

function decimalWireSign(value: string): -1 | 0 | 1 | null {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const digits = match[2] + (match[3] ?? '');
  const isZero = digits.split('').every((digit) => digit === '0');
  if (isZero) return 0;
  return match[1] === '-' ? -1 : 1;
}

function deviationUnavailableMeaning(
  reason: Extract<
    MonitoringComparisonDeviation,
    { state: 'UNAVAILABLE' }
  >['reason'],
): string {
  if (reason.planned !== null && reason.actual !== null) {
    return 'Rencana dan realisasi belum mempunyai fakta lengkap.';
  }
  if (reason.planned !== null) return 'Fakta rencana belum lengkap.';
  if (reason.actual !== null) return 'Fakta realisasi belum lengkap.';
  return 'Deviasi belum tersedia.';
}

export function deviationComparisonPresentation(
  fact: MonitoringComparisonDeviation,
): { value: string; meaning: string } {
  if (fact.state === 'UNAVAILABLE') {
    return {
      value: 'Tidak tersedia',
      meaning: deviationUnavailableMeaning(fact.reason),
    };
  }

  const sign = decimalWireSign(fact.value);
  return {
    value: fact.value + ' pp',
    meaning:
      sign === 1
        ? 'Lebih maju dari rencana'
        : sign === -1
          ? 'Tertinggal dari rencana'
          : sign === 0
            ? 'Sesuai rencana'
            : 'Makna tanda tidak tersedia',
  };
}

export interface MonitoringComparisonChartPoint {
  cutoffDate: string;
  x: number | null;
  plannedY: number | null;
  actualY: number | null;
}

export interface MonitoringComparisonChartSegment {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface MonitoringComparisonChartProjection {
  width: number;
  height: number;
  padding: number;
  points: MonitoringComparisonChartPoint[];
  plannedSegments: MonitoringComparisonChartSegment[];
  actualSegments: MonitoringComparisonChartSegment[];
}

/**
 * Presentation-only SVG projection. Number/Date conversion below determines
 * coordinates only; canonical strings remain untouched for labels and tables.
 * Input order and boundaries are consumed exactly as supplied by the backend.
 */
export function monitoringComparisonChartProjection(
  points: readonly MonitoringProgressComparisonPoint[],
): MonitoringComparisonChartProjection {
  const width = 720;
  const height = 280;
  const padding = 34;
  const boundaryTime = (value: string): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = Date.parse(value + 'T00:00:00.000Z');
    return Number.isFinite(parsed) ? parsed : null;
  };
  const percentageY = (value: string): number | null => {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    const visualPercent = Math.min(100, Math.max(0, parsed));
    return (
      height -
      padding -
      (visualPercent / 100) * (height - padding * 2)
    );
  };

  const firstTime =
    points.length > 0 ? boundaryTime(points[0].cutoffDate) : null;
  const lastTime =
    points.length > 0
      ? boundaryTime(points[points.length - 1].cutoffDate)
      : null;
  const validRange =
    firstTime !== null && lastTime !== null && lastTime >= firstTime;

  const projected = points.map((point): MonitoringComparisonChartPoint => {
    const pointTime = boundaryTime(point.cutoffDate);
    const x =
      !validRange ||
      pointTime === null ||
      pointTime < firstTime ||
      pointTime > lastTime
        ? null
        : lastTime === firstTime
          ? width / 2
          : padding +
            ((pointTime - firstTime) / (lastTime - firstTime)) *
              (width - padding * 2);

    return {
      cutoffDate: point.cutoffDate,
      x,
      plannedY:
        point.planned.state === 'COMPLETE'
          ? percentageY(
              point.planned.plannedRabWeightedPhysicalProgressPercent,
            )
          : null,
      actualY:
        point.actual.state === 'COMPLETE'
          ? percentageY(
              point.actual.currentOfficialRabWeightedPhysicalProgressPercent,
            )
          : null,
    };
  });

  const segmentsFor = (
    key: 'plannedY' | 'actualY',
  ): MonitoringComparisonChartSegment[] => {
    const segments: MonitoringComparisonChartSegment[] = [];
    for (let index = 1; index < projected.length; index += 1) {
      const previous = projected[index - 1];
      const current = projected[index];
      const previousY = previous[key];
      const currentY = current[key];
      if (
        previous.x !== null &&
        current.x !== null &&
        previousY !== null &&
        currentY !== null
      ) {
        const boundaryAtPreviousValue = { x: current.x, y: previousY };
        segments.push({
          from: { x: previous.x, y: previousY },
          to: boundaryAtPreviousValue,
        });
        if (currentY !== previousY) {
          segments.push({
            from: boundaryAtPreviousValue,
            to: { x: current.x, y: currentY },
          });
        }
      }
    }
    return segments;
  };

  return {
    width,
    height,
    padding,
    points: projected,
    plannedSegments: segmentsFor('plannedY'),
    actualSegments: segmentsFor('actualY'),
  };
}

export function lastRecordedLabel(
  freshness: MonitoringFreshness['lastRecordedAt'],
  projectTimeZone: string | null,
): { value: string; basis: string } {
  if (freshness.state === 'NOT_YET_RECORDED') {
    return { value: 'BELUM DICATAT', basis: '' };
  }
  if (freshness.state === 'UNAVAILABLE' || !freshness.recordedAt) {
    return { value: 'TIDAK TERSEDIA', basis: '' };
  }
  const presentation = projectTimestampPresentation(
    freshness.recordedAt,
    projectTimeZone,
  );
  return {
    value: presentation.occurredAtLabel,
    basis: presentation.timeZoneBasis,
  };
}

export function recordedAtLabel(
  value: string | null,
  projectTimeZone: string | null,
): { value: string; basis: string } {
  if (!value) return { value: 'TIDAK TERSEDIA', basis: '' };
  const presentation = projectTimestampPresentation(value, projectTimeZone);
  return {
    value: presentation.occurredAtLabel,
    basis: presentation.timeZoneBasis,
  };
}

export function actualStateLabel(actual: MonitoringActual | null): string {
  if (!actual || actual.state === 'UNAVAILABLE') return 'TIDAK TERSEDIA';
  if (actual.state === 'NOT_YET_RECORDED') return 'BELUM DICATAT';
  return actual.state === 'RECORDED'
    ? lifecycleLabel(actual.lifecycleState)
    : 'TIDAK TERSEDIA';
}

export function lifecycleLabel(value: string): string {
  const labels: Record<string, string> = {
    LEGACY_UNSPECIFIED: 'Status lama',
    RECORDED: 'Tercatat',
    SUBMITTED: 'Diajukan',
    VERIFIED: 'Terverifikasi',
    ACCEPTED: 'Diterima',
  };
  return labels[value] ?? 'Status belum dikenali';
}

export function captureMethodLabel(value: string): string {
  const labels: Record<string, string> = {
    FIELD_OBSERVATION: 'Observasi lapangan',
    FIELD_MEASUREMENT: 'Pengukuran lapangan',
    DOCUMENT_REFERENCE: 'Referensi dokumen',
    LEGACY_UNSPECIFIED: 'Metode tidak tersedia',
  };
  return labels[value] ?? 'Metode belum dikenali';
}

export function progressDetailPath(
  projectId: string,
  boqItemId: string,
): string {
  return `/field/project/${projectId}/progress/${boqItemId}`;
}
