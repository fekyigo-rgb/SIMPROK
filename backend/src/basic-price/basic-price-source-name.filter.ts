import { Prisma } from '@prisma/client';

export const BASIC_PRICE_SOURCE_NAME_FILTER_VERSION =
  'BP_ONE_TRUTH_01_SOURCE_NAME_AUDIT_PATH_V2';

/**
 * BP-UX-FINAL-01C GAP-A — FIND A PRICE BY THE NAME OF WHO ACTUALLY PUBLISHED IT.
 *
 * THE DEFECT, AND WHY IT WAS INVISIBLE.
 *
 * SIMPROK reaches imported names through TWO existing provenance chains;
 * a Detail-born new observation retains its name in its birth audit.
 * `deriveExplorerSourceName` reads these same sources:
 *
 *   CATALOG   BasicPrice.sourceSubmission -> PriceSubmission.importRow
 *                                         -> BasicPriceImportRow.batch
 *   PRIVATE   BasicPrice.sourceImportRow  -> BasicPriceImportRow.batch
 *
 * The two end at the SAME two columns on the SAME table
 * (`sourceVendorName`, `sourceOrganizationName`), which is exactly why the
 * projection can say "one link shorter, not a second provenance subsystem".
 *
 * The FILTER read only the first one. So the Explorer would happily PRINT
 * "Tim Simprok" in the SUMBER column of a workspace-private row and then return
 * nothing at all when a person typed "Tim Simprok" into the Nama sumber box —
 * the column and the filter disagreed about what a source is. On the Owner's
 * canonical database every single Basic Price is WORKSPACE_PRIVATE, so the
 * filter matched NOTHING, for every row, always. A control that can only ever
 * return zero is a false door.
 *
 * WHY `AND: [{ OR: [...] }]` AND NEVER A TOP-LEVEL `OR`.
 *
 * This is the single most dangerous line in this repair, so it is stated
 * structurally rather than trusted to review. `buildUsableBasicPriceWhere`
 * OWNS the top-level `OR` key — that key IS tenant isolation:
 *
 *     { OR: [ catalogAssetBranch(workspaceId), privateAssetBranch(workspaceId) ] }
 *
 * Assigning `where.OR = [...]` here would not narrow the query, it would
 * DELETE eligibility and hand every tenant every row in the table. Returning a
 * fragment destined for `AND` makes that mistake unrepresentable: an `AND`
 * member can only ever remove rows, never add one.
 *
 * The `OR` inside is the two IMPORT PROVENANCE alternatives plus the
 * pre-existing observation audit identity. The database guarantees a row
 * has at most one of the import pointers
 * (`basic_prices_import_row_link_private_only_check` +
 * `basic_prices_private_not_submission_born_check`), so this can never match a
 * row through a chain it does not really have.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not touch workspace scope, asset
 * scope, publication state or eligibility. It does not fabricate a source name
 * or guess which independent document observations belong to one price stream.
 * Exact predecessor-only legacy inheritance still requires a separate
 * database-side lineage predicate; this direct audit branch does not claim it.
 */
const batchNameMatch = (
  sourceName: string,
): Prisma.BasicPriceImportBatchWhereInput => ({
  // Vendor OR organization, because a person searches with whichever name they
  // know. `deriveExplorerSourceName` PREFERS vendor when both exist; a filter
  // has no business being that fussy — it is helping someone find a row, not
  // deciding what the row is called.
  OR: [
    { sourceVendorName: { contains: sourceName, mode: 'insensitive' } },
    { sourceOrganizationName: { contains: sourceName, mode: 'insensitive' } },
  ],
});

/**
 * One `AND` member matching either lawful provenance path.
 *
 * Returned as a single fragment (not an array) because it is one question:
 * "does this row's source, however it is reached, carry this name".
 */
export const basicPriceSourceNameWhere = (
  sourceName: string,
): Prisma.BasicPriceWhereInput => ({
  OR: [
    {
      sourceSubmission: {
        is: {
          importRow: { is: { batch: { is: batchNameMatch(sourceName) } } },
        },
      },
    },
    {
      // RM-03C — the private row reaches the very same batch directly, because
      // it has no PriceSubmission to travel through.
      sourceImportRow: { is: { batch: { is: batchNameMatch(sourceName) } } },
    },
    {
      // BP-ONE-TRUTH-01: a NEW_OBSERVATION carries its source identity in
      // provenance, not in a fabricated import-row link. Search the existing
      // audit JSON in the DATABASE, before count and pagination. No client
      // filtering, new identity engine, or widening of tenant eligibility.
      provenanceCorrections: {
        some: {
          after: {
            path: ['sourceIdentityName'],
            string_contains: sourceName,
            mode: 'insensitive',
          },
        },
      },
    },
  ],
});
