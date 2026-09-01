import { Prisma } from '@prisma/client';

export const BASIC_PRICE_SOURCE_NAME_FILTER_VERSION =
  'BPUXFINAL01C_BASIC_PRICE_SOURCE_NAME_TWO_PATH_V1';

/**
 * BP-UX-FINAL-01C GAP-A — FIND A PRICE BY THE NAME OF WHO ACTUALLY PUBLISHED IT.
 *
 * THE DEFECT, AND WHY IT WAS INVISIBLE.
 *
 * SIMPROK reaches a source name through TWO lawful provenance chains, and
 * `deriveExplorerSourceName` (common/basic-price-workflow.projection.ts:477)
 * has always read both:
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
 * The `OR` inside is therefore strictly the two PROVENANCE ALTERNATIVES for one
 * row — and the database guarantees a row has at most one of them
 * (`basic_prices_import_row_link_private_only_check` +
 * `basic_prices_private_not_submission_born_check`), so this can never match a
 * row through a chain it does not really have.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not touch workspace scope, asset
 * scope, publication state or eligibility. It does not invent a name for a row
 * that has no provenance chain — such a row simply does not match, which is the
 * honest answer, and the Explorer keeps saying "Sumber tidak tersedia" for it.
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
  ],
});
