/**
 * RAB-TABLE-UX-01R — the AHSP recipe, grouped for a human.
 *
 * The Kode AHSP door answers "AHSP ini tersusun dari apa?". That is a
 * different question from Rincian Harga, which answers "why is this row's
 * price Rp X". So this module deliberately carries NO money: a resource, its
 * unit and its coefficient — the analysis itself, exactly as the AHSP states
 * it. The price trace keeps its own richer, project-specific evidence.
 *
 * The rows come from the occurrence SIMPROK already froze when the AHSP was
 * selected, read through the existing
 * GET /projects/:projectId/ahsp-occurrences/:occurrenceId endpoint. Nothing new
 * is computed here and no second resolver exists: `ahspCoefficient` and
 * `ahspUnit` are the analysis's own values, copied at selection time.
 */

/** The occurrence resolution shape this module reads, and nothing more. */
export interface AhspResolutionWire {
  rawAhspResourceRef?: string | null;
  rawAhspResourceType?: string | null;
  ahspUnit?: string | null;
  ahspCoefficient?: string | number | null;
  status?: string | null;
}

export interface AhspComponentRow {
  name: string;
  unit: string;
  coefficient: string;
  /** True when SIMPROK could not yet prove which catalogue resource this is. */
  unresolved: boolean;
}

export interface AhspComponentGroup {
  key: 'TENAGA' | 'BAHAN' | 'PERALATAN';
  label: string;
  rows: AhspComponentRow[];
}

/**
 * The three groups an AHSP is written in, in the order Indonesian construction
 * analyses print them. A group with no rows is still returned, so the reader
 * can see that the analysis genuinely states none rather than wondering
 * whether the panel failed to load it.
 */
const GROUPS: ReadonlyArray<{
  key: AhspComponentGroup['key'];
  label: string;
  sourceTypes: readonly string[];
}> = [
  { key: 'TENAGA', label: 'Tenaga', sourceTypes: ['LABOR'] },
  { key: 'BAHAN', label: 'Bahan', sourceTypes: ['MATERIAL'] },
  { key: 'PERALATAN', label: 'Peralatan', sourceTypes: ['EQUIPMENT'] },
];

/**
 * Coefficients are shown exactly as the analysis states them, with trailing
 * zeros trimmed so `0.750000` reads as `0.75`. The VALUE is never rounded or
 * recomputed — only its presentation loses padding that means nothing.
 */
export const formatCoefficient = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return '—';
  const text = String(value).trim();
  if (text === '') return '—';
  if (!/^-?\d+(\.\d+)?$/u.test(text)) return text;
  if (!text.includes('.')) return text;
  const trimmed = text.replace(/0+$/u, '').replace(/\.$/u, '');
  return trimmed === '' || trimmed === '-' ? '0' : trimmed;
};

export const groupAhspComposition = (
  resolutions: readonly AhspResolutionWire[] | null | undefined,
): AhspComponentGroup[] => {
  const rows = resolutions ?? [];
  return GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    rows: rows
      .filter((row) =>
        group.sourceTypes.includes(String(row.rawAhspResourceType ?? '').toUpperCase()),
      )
      .map((row) => ({
        name: (row.rawAhspResourceRef ?? '').trim() || 'Tanpa nama',
        unit: (row.ahspUnit ?? '').trim() || '—',
        coefficient: formatCoefficient(row.ahspCoefficient),
        // Honest, not hidden: a component the resolver could not prove is
        // still part of the recipe and is still listed, marked as needing a
        // human. Removing it would make the analysis look complete when it
        // is not.
        unresolved: Boolean(row.status) && row.status !== 'RESOLVED',
      })),
  }));
};

/** True when the analysis states no components at all — used to stay honest. */
export const hasAnyComponent = (groups: readonly AhspComponentGroup[]): boolean =>
  groups.some((group) => group.rows.length > 0);
