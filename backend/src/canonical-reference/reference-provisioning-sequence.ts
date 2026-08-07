/**
 * RM-03D0 — the two-step canonical reference sequence, and its partial-state law.
 *
 * Region and ResourceCatalog are provisioned by two independent transactions.
 * Forcing them into one would have meant reaching inside the reviewed RM-02C1b
 * planner to share its transaction — exactly the kind of change RM-03D0 is not
 * allowed to make, and a much larger blast radius than the problem deserves.
 *
 * So a partial outcome is possible and is treated as a FACT, not an accident:
 * if the Region commits (or is recognised as already present) and the catalog
 * step then fails, the Region row is real canonical data. This module refuses
 * to pretend otherwise. It performs NO cleanup, NO delete, NO compensating
 * write and NO fake rollback — it raises STOP_PARTIAL_REFERENCE_STATE carrying
 * the exact Region id, whether that Region was created or reused, and the
 * original catalog failure, so a human can decide what is actually true.
 *
 * A silent rollback here would be worse than the partial state: it would
 * destroy a legitimately committed reference row to make a report look tidy.
 */

export interface RegionOutcome {
  regionId: string;
  regionCreatedDelta: number;
  regionReusedDelta: number;
  planSha256: string;
}

export class PartialReferenceStateError extends Error {
  public readonly reasonCode = 'STOP_PARTIAL_REFERENCE_STATE';

  constructor(
    public readonly region: RegionOutcome,
    public readonly catalogFailure: unknown,
  ) {
    super(
      [
        'STOP_PARTIAL_REFERENCE_STATE:',
        'the Region step completed and the ResourceCatalog step then failed.',
        `Region ${region.regionId} is committed canonical data`,
        `(created=${region.regionCreatedDelta}, reused=${region.regionReusedDelta},`,
        `regionPlanSha256=${region.planSha256}).`,
        'It was NOT rolled back, deleted or compensated.',
        'Original ResourceCatalog failure:',
        catalogFailure instanceof Error
          ? catalogFailure.message
          : String(catalogFailure),
      ].join(' '),
    );
    this.name = 'PartialReferenceStateError';
    // Preserve the original failure for a caller that wants to inspect it
    // rather than parse a message.
    if (catalogFailure instanceof Error) {
      this.cause = catalogFailure;
    }
  }
}

export interface ReferenceProvisioningResult<TCatalog> {
  region: RegionOutcome;
  catalog: TCatalog;
}

/**
 * Runs Region, then ResourceCatalog, in that order.
 *
 * A Region failure propagates untouched — nothing was written yet, so there is
 * no partial state to report and the original error is the whole truth. Only a
 * failure AFTER the Region step becomes a partial-state stop.
 */
export async function provisionCanonicalReferences<TCatalog>(steps: {
  applyRegion: () => Promise<RegionOutcome>;
  applyResourceCatalog: () => Promise<TCatalog>;
}): Promise<ReferenceProvisioningResult<TCatalog>> {
  // Not wrapped: if the Region step fails, nothing has been committed and the
  // caller must see the real reason, not a partial-state wrapper.
  const region = await steps.applyRegion();

  let catalog: TCatalog;
  try {
    catalog = await steps.applyResourceCatalog();
  } catch (catalogFailure) {
    throw new PartialReferenceStateError(region, catalogFailure);
  }

  return { region, catalog };
}
