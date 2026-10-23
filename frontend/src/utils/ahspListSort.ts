/**
 * Small presentation-only helper for the existing AHSP table.
 * Reuses the platform Intl.Collator; does not write, normalize or mutate AHSP records.
 * Unknown/blank values stay at the bottom in either direction.
 */
export type AhspListSortDirection = 'asc' | 'desc';

const ahspListCollator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });

export function sortAhspListRows<T>(
  rows: readonly T[],
  valueForRow: (row: T) => string | null | undefined,
  direction: AhspListSortDirection,
): T[] {
  return rows
    .map((row, originalIndex) => ({ row, originalIndex, value: (valueForRow(row) ?? '').trim() }))
    .sort((a, b) => {
      if (!a.value || !b.value) {
        if (!a.value && !b.value) return a.originalIndex - b.originalIndex;
        return a.value ? -1 : 1;
      }
      const compared = ahspListCollator.compare(a.value, b.value);
      return (direction === 'asc' ? compared : -compared) || (a.originalIndex - b.originalIndex);
    })
    .map(({ row }) => row);
}
