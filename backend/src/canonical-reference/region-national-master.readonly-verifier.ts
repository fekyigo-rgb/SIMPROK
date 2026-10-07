import {
  buildRegionPlan,
  RegionProvisionError,
  type RegionDesignation,
  type RegionQueryClient,
  type RegionRow,
} from './region-provisioner';

export interface NationalRegionReadOnlyPlanReport {
  plannedCreate: number;
  plannedReuse: number;
  plannedConflict: number;
  conflictReasonCounts: Record<string, number>;
}

/**
 * An indexed, read-only implementation of the planner's existing query
 * surface. It keeps a national verification bounded after the caller has read
 * one database snapshot; all identity, hierarchy, and conflict decisions stay
 * inside buildRegionPlan().
 */
export function indexedRegionQueryClient(
  rows: readonly RegionRow[],
): RegionQueryClient {
  const byCode = new Map<string, RegionRow>();
  const byName = new Map<string, RegionRow[]>();
  for (const row of rows) {
    byCode.set(row.code, row);
    const sameName = byName.get(row.name) ?? [];
    sameName.push(row);
    byName.set(row.name, sameName);
  }

  return {
    region: {
      findMany: async ({ where }) => {
        const matches = new Map<string, RegionRow>();
        for (const candidate of where.OR) {
          if ('code' in candidate) {
            const row = byCode.get(candidate.code);
            if (row) matches.set(row.id, row);
          } else {
            for (const row of byName.get(candidate.name) ?? []) {
              matches.set(row.id, row);
            }
          }
        }
        return [...matches.values()];
      },
    },
  };
}

/** Verification plumbing only: it calls the canonical planner and aggregates. */
export async function planNationalRegionReuseReadOnly(params: {
  designations: readonly RegionDesignation[];
  rows: readonly RegionRow[];
  onProgress?: (processed: number, total: number) => void;
}): Promise<NationalRegionReadOnlyPlanReport> {
  const client = indexedRegionQueryClient(params.rows);
  const report: NationalRegionReadOnlyPlanReport = {
    plannedCreate: 0,
    plannedReuse: 0,
    plannedConflict: 0,
    conflictReasonCounts: {},
  };

  for (const [index, designation] of params.designations.entries()) {
    try {
      const plan = await buildRegionPlan(client, designation);
      if (plan.disposition === 'CREATE_REGION') report.plannedCreate += 1;
      else report.plannedReuse += 1;
    } catch (error) {
      if (!(error instanceof RegionProvisionError)) throw error;
      report.plannedConflict += 1;
      report.conflictReasonCounts[error.reasonCode] =
        (report.conflictReasonCounts[error.reasonCode] ?? 0) + 1;
    }
    params.onProgress?.(index + 1, params.designations.length);
  }

  return report;
}
