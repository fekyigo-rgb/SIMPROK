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

interface IndexedRegionPlanningState {
  client: RegionQueryClient;
  addProspectiveRow(row: RegionRow): void;
}

/**
 * An indexed, read-only implementation of the planner's existing query
 * surface. It keeps a national verification bounded after the caller has read
 * one database snapshot; all identity, hierarchy, and conflict decisions stay
 * inside buildRegionPlan().
 */
function indexedRegionPlanningState(
  rows: readonly RegionRow[],
): IndexedRegionPlanningState {
  const byCode = new Map<string, RegionRow>();
  const byName = new Map<string, RegionRow[]>();

  const addProspectiveRow = (row: RegionRow): void => {
    byCode.set(row.code, row);
    const sameName = byName.get(row.name) ?? [];
    sameName.push(row);
    byName.set(row.name, sameName);
  };

  for (const row of rows) {
    addProspectiveRow(row);
  }

  return {
    addProspectiveRow,
    client: {
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
    },
  };
}

export function indexedRegionQueryClient(
  rows: readonly RegionRow[],
): RegionQueryClient {
  return indexedRegionPlanningState(rows).client;
}

/** Verification plumbing only: it calls the canonical planner and aggregates. */
export async function planNationalRegionReuseReadOnly(params: {
  designations: readonly RegionDesignation[];
  rows: readonly RegionRow[];
  onProgress?: (processed: number, total: number) => void;
}): Promise<NationalRegionReadOnlyPlanReport> {
  const planningState = indexedRegionPlanningState(params.rows);
  const report: NationalRegionReadOnlyPlanReport = {
    plannedCreate: 0,
    plannedReuse: 0,
    plannedConflict: 0,
    conflictReasonCounts: {},
  };

  for (const [index, designation] of params.designations.entries()) {
    try {
      const plan = await buildRegionPlan(planningState.client, designation);
      if (plan.disposition === 'CREATE_REGION') {
        report.plannedCreate += 1;
        planningState.addProspectiveRow({
          id: `prospective:${plan.regionCode}`,
          code: plan.regionCode,
          name: plan.regionName,
          isActive: true,
          parentId: plan.parentRegionId ?? null,
          administrativeLevel: plan.administrativeLevel ?? null,
        });
      } else {
        report.plannedReuse += 1;
      }
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
