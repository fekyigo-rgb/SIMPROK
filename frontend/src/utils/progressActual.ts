export type ProgressHistoryLoadState =
  | { kind: "loading" }
  | { kind: "loaded"; count: number }
  | { kind: "error"; message: string };

export function localCalendarDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function plannedFact(
  item: { planned?: { quantity?: string; unit?: string } } | null,
) {
  return {
    quantity: item?.planned?.quantity ?? null,
    unit: item?.planned?.unit ?? null,
  };
}

export function historyMessage(state: ProgressHistoryLoadState): string | null {
  if (state.kind === "loading") return "Memuat riwayat Actual…";
  if (state.kind === "error") return state.message;
  return state.count === 0 ? "Belum ada Actual yang dicatat." : null;
}

export function effectiveHistoryEntry<T extends { id: string }>(
  entries: T[],
  effectiveEntryId: string | null,
): T | null {
  return effectiveEntryId
    ? (entries.find((entry) => entry.id === effectiveEntryId) ?? null)
    : null;
}

export interface ProgressTimelineEvent {
  action: string;
  occurredAt: string;
  actor: { displayName: string };
  reason: string | null;
}

export function projectTimestampPresentation(
  value: string,
  projectTimeZone: string | null,
) {
  const date = new Date(value);
  const timeZone = projectTimeZone ?? "UTC";
  const basis = projectTimeZone
    ? `Waktu proyek (${projectTimeZone})`
    : "UTC; zona waktu proyek belum ditetapkan";
  if (Number.isNaN(date.getTime())) {
    return {
      occurredAtLabel: "Waktu tidak tersedia",
      timeZoneBasis: basis,
    };
  }
  return {
    occurredAtLabel: new Intl.DateTimeFormat("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(date),
    timeZoneBasis: basis,
  };
}

export function timelinePresentation(
  event: ProgressTimelineEvent,
  projectTimeZone: string | null = null,
) {
  const timestamp = projectTimestampPresentation(
    event.occurredAt,
    projectTimeZone,
  );
  return {
    key: `${event.action}:${event.occurredAt}`,
    ...timestamp,
  };
}

export function correctionDate(workDate: string | null): string {
  return workDate ? workDate.slice(0, 10) : "";
}

export function correctionCaptureMethod(value: string): string {
  return [
    "FIELD_OBSERVATION",
    "FIELD_MEASUREMENT",
    "DOCUMENT_REFERENCE",
  ].includes(value)
    ? value
    : "";
}
