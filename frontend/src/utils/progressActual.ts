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
