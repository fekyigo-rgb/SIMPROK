import { assignStructuralNumbers } from './rabRowNumbering.ts';
import { projectTimestampPresentation } from './progressActual.ts';

export type MonitoringFactState =
  | 'RECORDED'
  | 'NOT_YET_RECORDED'
  | 'UNAVAILABLE';

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
