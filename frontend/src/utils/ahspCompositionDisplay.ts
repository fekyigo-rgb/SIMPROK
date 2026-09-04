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
 *
 * MINIMAL EXCEPTION UX: this panel is also where an exception is actually
 * VISIBLE. A line that still contains an unproven component can never be
 * persisted — the RAB persistence gate refuses it — so the persisted price
 * trace will never show one. The occurrence behind this panel is therefore the
 * only surface where "which of these components needs me?" can honestly be
 * answered, and it already arrives in a single request.
 */

import {
  summariseResourceTrust,
  toResourceTrust,
  type ResourceTrustSummary,
  type ResourceTrustView,
} from './rabResourceTrust.ts';

/** The occurrence resolution shape this module reads, and nothing more. */
export interface AhspResolutionWire {
  rawAhspResourceRef?: string | null;
  rawAhspResourceType?: string | null;
  ahspUnit?: string | null;
  ahspCoefficient?: string | number | null;
  status?: string | null;
  /**
   * The server's own reason codes for this resolution. They already travel on
   * this endpoint's payload (the occurrence is returned with its full
   * `resourceResolutions` rows) and were simply not declared here before, so
   * the panel could only ever say "resolved or not". Declaring them lets the
   * reader be told WHICH of the four honest states applies, and why, without a
   * single extra request.
   */
  reasonCodes?: readonly string[] | null;
}

export interface AhspComponentRow {
  name: string;
  unit: string;
  coefficient: string;
  /**
   * True when SIMPROK could not yet prove which catalogue resource this is.
   * Kept as-is for existing callers; `trust` below is the richer, honest form.
   */
  unresolved: boolean;
  /**
   * WHY THIS REPLACED A BOOLEAN IN PRACTICE.
   *
   * `unresolved` can only say "fine" or "not fine", so it merged two completely
   * different situations: a component SIMPROK genuinely cannot prove, and one
   * where SIMPROK has narrowed the question and a human can settle it in
   * seconds. Those need opposite responses from the reader, so they are no
   * longer the same colour of problem here.
   */
  trust: ResourceTrustView;
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

/**
 * THE stored AHSP recipe on a definition (GET /ahsp/:id versions.resources).
 *
 * This is not the RAB occurrence panel. Occurrence rows carry project-bound
 * identity trust. Definition rows are the analysis as stored: a resource
 * identity string, a type, a unit, a coefficient. Nothing here is resolved
 * against the catalogue, so this helper never invents a trust state.
 */
export type AhspDefinitionResourceWire = {
  resourceId?: string | null;
  resourceType?: string | null;
  baseUnit?: string | null;
  coefficient?: string | number | null;
};

export type AhspDefinitionComponentRow = {
  name: string;
  unit: string;
  coefficient: string;
};

export type AhspDefinitionComponentGroup = {
  key: AhspComponentGroup['key'] | 'UNGROUPED';
  label: string;
  rows: AhspDefinitionComponentRow[];
};

const toDefinitionRow = (
  row: AhspDefinitionResourceWire,
): AhspDefinitionComponentRow => ({
  name: (row.resourceId ?? '').trim() || 'Tanpa nama',
  unit: (row.baseUnit ?? '').trim() || '—',
  coefficient: formatCoefficient(row.coefficient),
});

export const groupAhspDefinitionResources = (
  resources: readonly AhspDefinitionResourceWire[] | null | undefined,
): AhspDefinitionComponentGroup[] => {
  const rows = resources ?? [];
  const grouped: AhspDefinitionComponentGroup[] = GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    rows: rows
      .filter((row) =>
        group.sourceTypes.includes(String(row.resourceType ?? '').toUpperCase()),
      )
      .map(toDefinitionRow),
  }));
  const known = new Set(GROUPS.flatMap((group) => [...group.sourceTypes]));
  const ungrouped = rows.filter(
    (row) => !known.has(String(row.resourceType ?? '').toUpperCase()),
  );
  if (ungrouped.length === 0) return grouped;
  return [
    ...grouped,
    {
      key: 'UNGROUPED',
      label: 'Tipe tidak dikenali',
      rows: ungrouped.map(toDefinitionRow),
    },
  ];
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
        // Server verdict in, reader's language out. Nothing is inferred from
        // the component's name, unit or position in the recipe.
        trust: toResourceTrust({
          status: row.status ?? '',
          reasonCodes: row.reasonCodes ?? [],
        }),
      })),
  }));
};

/** True when the analysis states no components at all — used to stay honest. */
export const hasAnyComponent = (groups: readonly AhspComponentGroup[]): boolean =>
  groups.some((group) => group.rows.length > 0);

export const hasAnyDefinitionComponent = (
  groups: readonly AhspDefinitionComponentGroup[],
): boolean => groups.some((group) => group.rows.length > 0);

/**
 * EXCEPTION-FIRST across the whole analysis.
 *
 * Counts every component in every group once, so the panel can open with "how
 * much of this is already done, and what is left for me" instead of handing the
 * reader three tables to audit.
 */
export const summariseAhspComposition = (
  groups: readonly AhspComponentGroup[],
): ResourceTrustSummary =>
  summariseResourceTrust(groups.flatMap((group) => group.rows.map((row) => row.trust)));

/**
 * The components that genuinely need a human, in recipe order, flattened across
 * groups. Empty on a healthy analysis — which is the normal case, and the
 * reason the panel can stay quiet.
 */
export const attentionComponents = (
  groups: readonly AhspComponentGroup[],
): AhspComponentRow[] =>
  groups.flatMap((group) => group.rows.filter((row) => row.trust.needsAttention));
