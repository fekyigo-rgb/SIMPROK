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
  items: MonitoringItem[];
  unavailable: string[];
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
