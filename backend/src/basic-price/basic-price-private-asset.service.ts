import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BasicPriceAssetScope,
  BasicPriceKdnEstablishment,
  PriceSourceOrigin,
  PriceSourceType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { interpretKdnLiteral } from '../universal-intake/structure/kdn-literal';
import { toDecimalString2, toMoneyDecimal2 } from '../common/money';
import { assertBatchOwnedByCaller } from './basic-price-import-ownership.util';
import {
  deriveExplorerSourceName,
  mapPrivateBasicPriceItem,
  type PrivateBasicPriceItem,
} from '../common/basic-price-workflow.projection';
import type { TrustedBasicPriceActor } from './trusted-basic-price-actor.service';
import { parseDateOnlyUtc } from '../common/date-only.util';
import { expectedKdnMatchesStored } from './basic-price-detail-change.policy';
import { privateUseBlockReason } from './basic-price-batch-actions.policy';
import {
  sourceClassificationIssue,
  temporalProvenanceIssue,
  type BatchProvenanceFacts,
  type MetadataCoherenceIssue,
} from './basic-price-metadata-coherence.law';

/**
 * THE METADATA LAW LIVES IN ONE FILE, AND THIS IS NOT IT.
 *
 * Everything that decides whether a batch's source classification and temporal
 * provenance are truthful enough to write a price from now lives in
 * `basic-price-metadata-coherence.law.ts`, as pure functions that RETURN a
 * named reason. This service turns that reason into the ConflictException it
 * has always thrown, with the same codes and the same detail payloads; the
 * review room reads the same reason to decide whether to open its door.
 *
 * That is the whole point of the move. The room used to check that four facts
 * were PRESENT while the writer additionally checked that they were COHERENT,
 * so a batch could be told "you may review", have thirteen rows resolved by
 * hand, and only then be refused for metadata it had held all along. Two
 * answers to one question, and the softer one guarded the door.
 *
 * NOTHING WAS RELAXED. The re-exports below keep every existing importer —
 * including the provenance-correction service and its spec — pointing at the
 * same names.
 */
export {
  YEAR_IN_LABEL,
  derivedEffectiveDateFor,
  isSameUtcDay,
  type BatchProvenanceFacts,
} from './basic-price-metadata-coherence.law';

/** Raise the writer's exception for a reason the shared law returned. */
function raise(issue: MetadataCoherenceIssue): never {
  // The two rich codes carry evidence a person needs in order to FIX the batch
  // — what was claimed, and what that claim actually produces. The rest are
  // self-explanatory and stay bare, exactly as before.
  if (
    issue.code === 'DERIVATION_RULE_NOT_PROVABLE' ||
    issue.code === 'DERIVATION_DOES_NOT_EXPLAIN_EFFECTIVE_DATE'
  ) {
    const { code, ...detail } = issue;
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: code,
      ...detail,
    });
  }
  throw new ConflictException(issue.code);
}

/**
 * RM-03D1 — a private price may never carry an UNSTATED source classification.
 * Delegates to the shared law; the refusal codes are unchanged.
 */
export function assertSourceClassificationCoherent(
  sourceOrigin: string | null,
  sourceType: string | null,
): void {
  const issue = sourceClassificationIssue(sourceOrigin, sourceType);
  if (issue) raise(issue);
}

/**
 * RM-03D1 — a DERIVED date must be re-derivable, and a stated date must not
 * pretend to have been derived. Delegates to the shared law; the refusal codes
 * and their detail payloads are unchanged.
 */
export function assertTemporalProvenanceCoherent(
  batch: BatchProvenanceFacts,
): void {
  const issue = temporalProvenanceIssue(batch);
  if (issue) raise(issue);
}

/** The temporal facts one PRICE carries, resolved from batch + row evidence. */
export interface ResolvedPriceTemporalFacts {
  effectiveDate: Date;
  sourcePeriodLabel: string | null;
  sourcePeriodGranularity: string | null;
  effectiveDateProvenance: string | null;
  effectiveDateDerivationRule: string | null;
}

/**
 * RM-03D1 — resolve ONE price's temporal facts from the batch and its row.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. `effectiveDate` follows a row-level
 * override when there is one, but the provenance columns were copied from the
 * batch unconditionally. A row overriding the date to 2024-06-15 would still
 * inherit the batch's claim of "DERIVED_FROM_SOURCE_PERIOD by PERIOD_START from
 * TA 2024" — a derivation that does not produce 2024-06-15. That is provenance
 * describing a DIFFERENT date, exactly the kind of lie this slice exists to
 * remove, and worse than saying nothing at all.
 *
 * So when the row overrides the date, the batch's derivation no longer explains
 * it and is dropped: provenance and rule become NULL, which reads as UNKNOWN —
 * "SIMPROK does not claim how this date arose". The period LABEL and its
 * GRANULARITY are kept, because they remain true statements about the SOURCE
 * DOCUMENT whichever date this row ended up with; discarding them would throw
 * away a fact that is still correct.
 *
 * Both the create path and the correction path resolve through here, so they
 * cannot drift into disagreeing about what a price's date means.
 */
export function resolvePriceTemporalFacts(
  batch: {
    effectiveDate: Date;
    sourcePeriodLabel: string | null;
    sourcePeriodGranularity: string | null;
    effectiveDateProvenance: string | null;
    effectiveDateDerivationRule: string | null;
  },
  rowEffectiveDateOverride: Date | null | undefined,
): ResolvedPriceTemporalFacts {
  if (!rowEffectiveDateOverride) {
    return {
      effectiveDate: batch.effectiveDate,
      sourcePeriodLabel: batch.sourcePeriodLabel,
      sourcePeriodGranularity: batch.sourcePeriodGranularity,
      effectiveDateProvenance: batch.effectiveDateProvenance,
      effectiveDateDerivationRule: batch.effectiveDateDerivationRule,
    };
  }
  return {
    effectiveDate: rowEffectiveDateOverride,
    // Still true of the source document.
    sourcePeriodLabel: batch.sourcePeriodLabel,
    sourcePeriodGranularity: batch.sourcePeriodGranularity,
    // No longer true of THIS date.
    effectiveDateProvenance: null,
    effectiveDateDerivationRule: null,
  };
}

export interface KeepBatchPrivateResult {
  batchId: string;
  /** Prices this call brought into existence. */
  createdCount: number;
  /** Rows that already had a private price — re-running is not a duplicate. */
  alreadyPrivateCount: number;
  prices: PrivateBasicPriceItem[];
}

/** The exact provenance facts a correction may alter, before and after. */
export interface ProvenanceFacts {
  sourceType: string | null;
  sourceOrigin: string | null;
  effectiveDate: string;
  sourcePeriodLabel: string | null;
  sourcePeriodGranularity: string | null;
  effectiveDateProvenance: string | null;
  effectiveDateDerivationRule: string | null;
}

export interface ProvenanceCorrectionItem {
  basicPriceId: string;
  before: ProvenanceFacts;
  after: ProvenanceFacts;
  price: PrivateBasicPriceItem;
}

export interface CorrectPrivateProvenanceResult {
  batchId: string;
  /** Private prices from this batch that were considered. */
  examinedCount: number;
  /** Prices whose provenance actually changed. */
  correctedCount: number;
  /** Already correct — a re-run is a no-op, not a duplicate. */
  unchangedCount: number;
  corrections: ProvenanceCorrectionItem[];
}

const PRIVATE_PRICE_SELECT = {
  id: true,
  value: true,
  effectiveDate: true,
  status: true,
  verificationStatus: true,
  sourceOrigin: true,
  sourceImportRowId: true,
  // RM-03D1 — selected so the response can state how the date came to be,
  // rather than leaving the caller to assume.
  sourcePeriodLabel: true,
  sourcePeriodGranularity: true,
  effectiveDateProvenance: true,
  effectiveDateDerivationRule: true,
  resource: { select: { id: true, code: true, name: true, type: true } },
  region: { select: { id: true, code: true, name: true } },
} satisfies Prisma.BasicPriceSelect;

/**
 * RM-03C — the ONE production writer of a WORKSPACE_PRIVATE Basic Price.
 *
 * Owner law: a workspace may keep its OWN imported prices and use them
 * immediately. No verifier. No publisher. No second human. Never called
 * PUBLISHED. Never entering the national catalog by itself.
 *
 * WHY THIS IS THE IMPORT ROW, AND NOT A FREE-TEXT PRICE FORM:
 * SIMPROK does not create prices, it finds them. Every private price
 * materialized here comes from a BasicPriceImportRow a human already resolved
 * — which means it already carries the real evidence the import subsystem
 * recorded: the workbook SHA-256, the sheet, the row number, the code/name/
 * unit/price cell ADDRESSES, the raw cell value, plus the batch's supplier or
 * organization name, region and effective date. No second provenance
 * subsystem is introduced, and nothing here invents a price, a source, a
 * resource, a unit, a region or an effective date. Where a value is missing,
 * the call fails closed rather than filling it in.
 *
 * WHY IT DOES NOT REUSE THE PUBLICATION WRITER: making a price usable by
 * stamping it PUBLISHED would call a private asset "published", which the
 * Owner law forbids, and would make it indistinguishable from a curated one.
 * The two axes this writer leaves alone (`status`, `verificationStatus`) take
 * their schema defaults — UNPUBLISHED / UNVERIFIED — which are the honest
 * values: nobody has published this, and nobody has verified it, because for a
 * private asset nobody needs to. The database refuses the lie outright
 * (basic_prices_private_never_published_check).
 *
 * WHY THE BATCH IS NOT ADVANCED: `submitBatch` moves the batch on to catalog
 * curation. Keeping rows private is a DIFFERENT, non-exclusive act — the same
 * batch may later be proposed to SIMPROK, and a rejection there must not
 * invalidate the private asset. So this writer changes no batch status and no
 * row status; the only state it creates is the price itself, and the
 * one-private-price-per-row rule is enforced by the database's unique index on
 * `sourceImportRowId` rather than by a status flag.
 *
 * WHY IT NOW ACCEPTS A BATCH THAT IS STILL `NEEDS_REVIEW`. It used to require
 * `READY_FOR_REVIEW`, described as "the human has finished resolving this
 * batch". That gate belongs to the TERMINAL action, not this one: a batch only
 * reaches `READY_FOR_REVIEW` once EVERY row has been decided, so on the
 * Owner's real 86-row workbook the six rows that WERE finished could not be
 * kept until the other eighty were too. Since this writer selects
 * `READY_FOR_SUBMISSION` rows only, re-checks each row's own resource identity
 * and canonical price, is idempotent per row, and leaves the batch open, an
 * unfinished neighbour was never evidence against a finished row. The gate now
 * says what it means — the batch is still in its mutable window — and lives
 * with the rest of the lifecycle law in
 * `basic-price-batch-actions.policy.ts`, where the review room reads the same
 * answer before offering the action.
 */
@Injectable()
export class BasicPricePrivateAssetService {
  constructor(private readonly prisma: PrismaService) {}

  async keepBatchPrivate(params: {
    batchId: string;
    actor: TrustedBasicPriceActor;
  }): Promise<KeepBatchPrivateResult> {
    const { batchId, actor } = params;

    return this.prisma.$transaction(
      async (tx) => {
        // Lock the exact batch. Mirrors submitBatch's discipline so two
        // concurrent calls (or a concurrent submit) cannot interleave.
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            workspaceId: string;
            organizationId: string;
            status: string;
            effectiveDate: Date | null;
            regionId: string | null;
            sourceType: string | null;
            sourceOrigin: string | null;
            uploadedByAccountId: string;
            sourcePeriodLabel: string | null;
            sourcePeriodGranularity: string | null;
            effectiveDateProvenance: string | null;
            effectiveDateDerivationRule: string | null;
            /** Soft re-verification, human-stated on the metadata form. */
            reviewDate: Date | null;
          }>
        >(
          Prisma.sql`SELECT "id", "workspaceId", "organizationId", "status", "effectiveDate",
                          "regionId", "sourceType", "sourceOrigin", "uploadedByAccountId",
                          "sourcePeriodLabel", "sourcePeriodGranularity", "effectiveDateProvenance", "effectiveDateDerivationRule",
                          "reviewDate"
                     FROM "basic_price_import_batches"
                    WHERE "id" = ${batchId}::uuid
                    FOR UPDATE`,
        );
        const batch = locked[0];
        // The workspace compared against is the SERVER-DERIVED one. A client
        // body/query/header claim never reaches this line.
        if (!batch || batch.workspaceId !== actor.workspaceId) {
          throw new NotFoundException('Batch not found');
        }
        assertBatchOwnedByCaller(batch, actor.accountId, 'Batch not found');

        // Tenant truth: the batch's organization must still be the workspace's
        // own organization. Re-derived, never trusted from the batch row alone.
        const workspace = await tx.workspace.findUnique({
          where: { id: actor.workspaceId },
          select: { organizationId: true },
        });
        if (!workspace || workspace.organizationId !== batch.organizationId) {
          throw new NotFoundException('Batch not found');
        }

        // The rows this call would materialize, locked. Read BEFORE the
        // preconditions now, because the preconditions are no longer stated here:
        // they are asked of `privateUseBlockReason`, which needs the ready-row
        // count to answer, and which is the SAME law the review room reads to
        // decide what to offer. Precedence is unchanged — that function checks
        // status, then metadata, then the row count, in the order this method
        // used to check them inline — so every existing caller still sees the
        // same code for the same batch. What changed is that a user can now be
        // TOLD the reason before acting instead of meeting a dead button.
        const readyRows = await tx.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT "id" FROM "basic_price_import_rows"
                    WHERE "batchId" = ${batchId}::uuid
                      AND "status" = 'READY_FOR_SUBMISSION'
                    ORDER BY "sourceRowNumber" ASC
                    FOR UPDATE`,
        );

        const blocked = privateUseBlockReason({
          status: batch.status,
          effectiveDate: batch.effectiveDate,
          regionId: batch.regionId,
          sourceOrigin: batch.sourceOrigin,
          sourceType: batch.sourceType,
          readyForSubmissionRows: readyRows.length,
        });
        if (blocked) {
          // RM-03D1 — sourceType is a REQUIRED truth, not a defaulted one. This
          // writer once wrote `batch.sourceType ?? 'MARKET_SURVEY'`, which could
          // mint exactly the falsehood this slice exists to correct: a government
          // price list silently classified as a market survey. The incoherent
          // pair re-raises through the classification authority so the caller
          // keeps the richer 409 body it has always had — which names the ONE
          // type the stated origin implies — rather than a bare code.
          throw new ConflictException(blocked);
        }
        // `BatchProvenanceFacts.effectiveDate` is optional/nullable, and the gate
        // above already refused a null one, so the batch is passed as it is — the
        // old `as Date` narrowed nothing the type did not already allow.
        assertTemporalProvenanceCoherent(batch);

        const prices: PrivateBasicPriceItem[] = [];
        let createdCount = 0;
        let alreadyPrivateCount = 0;

        for (const { id: rowId } of readyRows) {
          const existing = await tx.basicPrice.findFirst({
            where: { sourceImportRowId: rowId },
            select: PRIVATE_PRICE_SELECT,
          });
          if (existing) {
            // Idempotent: this row's private price already exists. Returned as
            // it is, never re-created and never mutated.
            alreadyPrivateCount += 1;
            prices.push(mapPrivateBasicPriceItem(existing));
            continue;
          }

          const row = await tx.basicPriceImportRow.findUniqueOrThrow({
            where: { id: rowId },
          });
          // Resource identity and the canonical price are the two facts this
          // writer may not proceed without — and it never derives either.
          if (!row.resourceCatalogId || !row.proposedCanonicalPrice) {
            throw new ConflictException('ROW_NOT_RESOLVED');
          }

          // ONE resolver for the price's temporal facts, so a row-level date
          // override can never inherit a batch derivation that does not explain it.
          const temporal = resolvePriceTemporalFacts(
            { ...batch, effectiveDate: batch.effectiveDate as Date },
            row.effectiveDateOverride,
          );

          const created = await tx.basicPrice.create({
            data: {
              // OWNERSHIP — the axis this whole slice exists for.
              assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
              workspaceId: batch.workspaceId,
              organizationId: batch.organizationId,
              // PROVENANCE — the row is the evidence, and the only evidence.
              sourceImportRowId: row.id,
              // IDENTITY / CONTEXT — all taken from what a human already
              // resolved or set on the batch. Never inferred here.
              resourceId: row.resourceCatalogId,
              regionId: batch.regionId,
              effectiveDate: temporal.effectiveDate,
              // EXACT money. Prisma.Decimal, never Number()/parseFloat().
              value: new Prisma.Decimal(row.proposedCanonicalPrice),
              // BP-KDN-01 — the %KDN of THIS observation, copied only when the
              // import row already holds a lawful canonical value. Null stays
              // null (unknown, never zero). Independent of `value`. Stated 0%
              // is a fact (SOURCE_IMPORT_ROW), never collapsed to unknown.
              kdnPercent: row.proposedCanonicalKdn,
              kdnEstablishment:
                row.proposedCanonicalKdn === null ||
                row.proposedCanonicalKdn === undefined
                  ? null
                  : 'SOURCE_IMPORT_ROW',
              // SOURCE — orthogonal to ownership. A private asset may truthfully
              // come from a government list, a supplier, a store, a distributor
              // or a field report; the batch says which, and this writer copies
              // it verbatim rather than substituting a "private" source family.
              // No fallback. The coherence assertion above already refused an
              // absent or incoherent classification, so this is the batch's
              // stated truth or the write never happened.
              sourceType: batch.sourceType as any,
              sourceOrigin: batch.sourceOrigin as any,
              // FRESHNESS STATUS IS NOT TOUCHED BY RE-VERIFICATION, and that is
              // deliberate. `EXPIRED` is read by
              // `ahsp-resource-price-resolution.kernel.ts`, which degrades a whole
              // resolution to NEEDS_REVIEW when every candidate carries it —
              // so writing it from a predicted date would quietly stop an old but
              // perfectly usable survey price from resolving. Overdue-ness is
              // derived at READ time from `reviewDate` and stored nowhere.
              freshnessStatus: 'CURRENT',
              // SOFT RE-VERIFICATION — "check this again around here", never
              // "expires on". COPIED FROM THE BATCH, never computed.
              //
              // An earlier version derived this from the ingestion channel plus a
              // fixed two-year horizon. Both were invented: no canonical policy
              // in this repository states how long any source stays fresh, and
              // freshness behaviour is not decided by which channel the bytes
              // arrived through. So the value is whatever a HUMAN stated on the
              // metadata form, and null when nobody stated anything — which is an
              // ordinary outcome, not a gap to fill in.
              //
              // `validUntil` stays untouched, because only a source that really
              // states a hard validity limit may set that.
              reviewDate: batch.reviewDate,
              // RM-03D1 — TEMPORAL PROVENANCE, carried verbatim from the batch.
              // `effectiveDate` above is a single calendar day, but a source that
              // states only "TA 2024" never printed one. These three keep the
              // difference visible on the price itself: what the source actually
              // said, whether the date is the source's or SIMPROK's, and by which
              // named rule it was derived. Copied, never inferred — a batch that
              // says nothing leaves all three null, which reads as "unknown" and
              // never as "the source stated this".
              sourcePeriodLabel: temporal.sourcePeriodLabel,
              sourcePeriodGranularity: temporal.sourcePeriodGranularity as any,
              effectiveDateProvenance: temporal.effectiveDateProvenance as any,
              effectiveDateDerivationRule: temporal.effectiveDateDerivationRule,
              // The reporter is the trusted, server-derived actor — never a
              // client-supplied id, and never the batch's stored uploader taken
              // on faith.
              reportedByAccountId: actor.accountId,
              // `status` and `verificationStatus` are deliberately OMITTED so
              // they take their schema defaults (UNPUBLISHED / UNVERIFIED).
              // A private price is usable WITHOUT publication; it must never
              // wear publication's clothes to become so. There is no verifier
              // here, no publisher, no PriceSubmission, no review, and no
              // BasicPricePublicationAudit — by design, not by omission.
            },
            select: PRIVATE_PRICE_SELECT,
          });

          createdCount += 1;
          prices.push(mapPrivateBasicPriceItem(created));
        }

        return {
          batchId: batch.id,
          createdCount,
          alreadyPrivateCount,
          prices,
        };
      },
      {
        // Keep-private copies every READY row in one transaction. Prisma's 5s
        // default is sized for a single write and reports P2028 instead of a
        // finished private asset when the machine is under e2e load.
        timeout: 30_000,
        maxWait: 30_000,
      },
    );
  }

  /**
   * RM-03D1 — re-apply the batch's CURRENT provenance metadata to the private
   * prices that batch already materialized.
   *
   * WHY THIS EXISTS. `keepBatchPrivate` copies the batch's metadata at write
   * time and is deliberately idempotent, so a later correction to the batch —
   * which `updateBatchMetadata` already permits while the batch is still
   * NEEDS_REVIEW/READY_FOR_REVIEW — reached the batch and nothing else. A price
   * born from a mis-stated `sourceType`, or from an effectiveDate whose derived
   * nature was unrecordable, stayed wrong with no lawful way to fix it: the only
   * other writer of a BasicPrice is the publication ladder, and using that would
   * stamp a private asset PUBLISHED. So the choice was a permanent falsehood or
   * an unlawful write. This is the missing third option.
   *
   * WHAT IT MAY TOUCH, AND NOTHING ELSE:
   *   sourceType · sourceOrigin · effectiveDate · sourcePeriodLabel ·
   *   effectiveDateProvenance · effectiveDateDerivationRule
   *
   * `value` is untouched — this corrects how a price is DESCRIBED, never what it
   * costs, so no correction can move money. `status`, `verificationStatus`,
   * `assetScope`, `regionId`, `resourceId` and `sourceImportRowId` are untouched
   * — a correction can never publish, verify, re-scope, re-region or re-identify
   * a price. Publication law is not reachable from here.
   *
   * HISTORY IS NOT OVERWRITTEN. Every change writes an append-only
   * BasicPriceProvenanceCorrection carrying before, after, the reason and the
   * trusted actor, so the claim SIMPROK made yesterday remains readable.
   *
   * IDEMPOTENT. A second call with the batch unchanged finds nothing to change,
   * writes no audit row, and reports zero corrections.
   */
  async correctPrivateProvenanceFromBatch(params: {
    batchId: string;
    actor: TrustedBasicPriceActor;
    reason: string;
  }): Promise<CorrectPrivateProvenanceResult> {
    const { batchId, actor, reason } = params;

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          workspaceId: string;
          organizationId: string;
          status: string;
          effectiveDate: Date | null;
          sourceType: string | null;
          sourceOrigin: string | null;
          uploadedByAccountId: string;
          sourcePeriodLabel: string | null;
          sourcePeriodGranularity: string | null;
          effectiveDateProvenance: string | null;
          effectiveDateDerivationRule: string | null;
        }>
      >(
        Prisma.sql`SELECT "id", "workspaceId", "organizationId", "status", "effectiveDate",
                          "sourceType", "sourceOrigin", "uploadedByAccountId",
                          "sourcePeriodLabel", "sourcePeriodGranularity", "effectiveDateProvenance", "effectiveDateDerivationRule"
                     FROM "basic_price_import_batches"
                    WHERE "id" = ${batchId}::uuid
                    FOR UPDATE`,
      );
      const batch = locked[0];
      // Same ownership boundary as keepBatchPrivate, and the same server-derived
      // workspace. A foreign batch is "not found", never "forbidden".
      if (!batch || batch.workspaceId !== actor.workspaceId) {
        throw new NotFoundException('Batch not found');
      }
      assertBatchOwnedByCaller(batch, actor.accountId, 'Batch not found');

      const workspace = await tx.workspace.findUnique({
        where: { id: actor.workspaceId },
        select: { organizationId: true },
      });
      if (!workspace || workspace.organizationId !== batch.organizationId) {
        throw new NotFoundException('Batch not found');
      }

      // A correction propagates FACTS, so the batch must still hold them. This
      // is the same fail-closed rule keepBatchPrivate applies: never default,
      // never fabricate.
      if (!batch.effectiveDate) {
        throw new ConflictException(
          'EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE',
        );
      }
      // The correction propagates the SAME facts the create path writes, so it
      // is held to the SAME coherence rules. Anything less would let a
      // correction reintroduce the incoherent classification the create path
      // now refuses.
      assertSourceClassificationCoherent(batch.sourceOrigin, batch.sourceType);
      assertTemporalProvenanceCoherent({
        ...batch,
        effectiveDate: batch.effectiveDate as Date,
      });

      const targets = await tx.basicPrice.findMany({
        where: {
          // Strictly this workspace's OWN private prices, born from THIS batch.
          // Never null workspaceId, never an OR — the same shape the private
          // eligibility branch uses, for the same reason.
          assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
          workspaceId: actor.workspaceId,
          sourceImportRow: { batchId },
        },
        orderBy: { createdAt: 'asc' },
      });
      if (targets.length === 0) {
        throw new ConflictException('NO_PRIVATE_PRICE_TO_CORRECT');
      }

      const corrections: ProvenanceCorrectionItem[] = [];

      for (const price of targets) {
        // A correction must never be the thing that publishes or verifies a
        // private price. If either axis has somehow left its private state,
        // refuse rather than write into a curated row.
        if (
          price.status !== 'UNPUBLISHED' ||
          price.verificationStatus === 'PUBLISHED'
        ) {
          throw new ConflictException('PRICE_NOT_PRIVATE_CORRECTABLE');
        }

        const rowOverride = price.sourceImportRowId
          ? await tx.basicPriceImportRow.findUnique({
              where: { id: price.sourceImportRowId },
              select: { effectiveDateOverride: true },
            })
          : null;
        // The SAME resolver the writer uses, so a corrected price lands on
        // exactly the facts keepBatchPrivate would produce today — including
        // dropping a derivation the row's own date does not follow from.
        const temporal = resolvePriceTemporalFacts(
          { ...batch, effectiveDate: batch.effectiveDate as Date },
          rowOverride?.effectiveDateOverride,
        );

        const before = {
          sourceType: price.sourceType,
          sourceOrigin: price.sourceOrigin,
          effectiveDate: price.effectiveDate.toISOString(),
          sourcePeriodLabel: price.sourcePeriodLabel,
          sourcePeriodGranularity: price.sourcePeriodGranularity,
          effectiveDateProvenance: price.effectiveDateProvenance,
          effectiveDateDerivationRule: price.effectiveDateDerivationRule,
        };
        const after = {
          sourceType: batch.sourceType,
          sourceOrigin: batch.sourceOrigin,
          effectiveDate: temporal.effectiveDate.toISOString(),
          sourcePeriodLabel: temporal.sourcePeriodLabel,
          sourcePeriodGranularity: temporal.sourcePeriodGranularity,
          effectiveDateProvenance: temporal.effectiveDateProvenance,
          effectiveDateDerivationRule: temporal.effectiveDateDerivationRule,
        };

        // Idempotency is decided by comparing the correctable fields, not by a
        // flag: a second call with an unchanged batch is a no-op that leaves no
        // audit row behind, so the history stays a record of real changes only.
        if (JSON.stringify(before) === JSON.stringify(after)) {
          continue;
        }

        const updated = await tx.basicPrice.update({
          where: { id: price.id },
          data: {
            sourceType: batch.sourceType as any,
            sourceOrigin: batch.sourceOrigin as any,
            effectiveDate: temporal.effectiveDate,
            sourcePeriodLabel: temporal.sourcePeriodLabel,
            sourcePeriodGranularity: temporal.sourcePeriodGranularity as any,
            effectiveDateProvenance: temporal.effectiveDateProvenance as any,
            effectiveDateDerivationRule: temporal.effectiveDateDerivationRule,
            // value / status / verificationStatus / assetScope / regionId /
            // resourceId / sourceImportRowId are absent on purpose.
          },
          select: PRIVATE_PRICE_SELECT,
        });

        await tx.basicPriceProvenanceCorrection.create({
          data: {
            basicPriceId: price.id,
            workspaceId: actor.workspaceId,
            actorAccountId: actor.accountId,
            reason,
            before,
            after,
          },
        });

        corrections.push({
          basicPriceId: price.id,
          before,
          after,
          price: mapPrivateBasicPriceItem(updated),
        });
      }

      return {
        batchId: batch.id,
        examinedCount: targets.length,
        correctedCount: corrections.length,
        unchangedCount: targets.length - corrections.length,
        corrections,
      };
    });
  }

  /**
   * BP-KDN-01 — fill a previously unknown %KDN on an existing private price.
   *
   * Does not mint a Basic Price. Does not touch `value`. Same identity + same
   * KDN is idempotent. Same identity + different KDN is a conflict, never a
   * silent overwrite. Catalog / foreign-workspace rows are indistinguishable
   * from absence.
   */
  async enrichKdn(params: {
    basicPriceId: string;
    actor: TrustedBasicPriceActor;
    kdnPercent: string;
    reason: string;
    expectedKdnPercent?: string | null;
  }) {
    const { basicPriceId, actor, reason, expectedKdnPercent } = params;
    const reading = interpretKdnLiteral(params.kdnPercent);
    if (reading.status !== 'VALID' || reading.canonicalPercent === null) {
      throw new ConflictException(
        reading.status === 'UNKNOWN' ? 'KDN_REQUIRED' : reading.reason,
      );
    }
    const canonical = reading.canonicalPercent;

    return this.prisma.$transaction(async (tx) => {
      const price = await tx.basicPrice.findFirst({
        where: {
          id: basicPriceId,
          workspaceId: actor.workspaceId,
          assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
        },
        select: {
          id: true,
          value: true,
          kdnPercent: true,
          kdnEstablishment: true,
        },
      });
      if (!price) throw new NotFoundException('BasicPrice not found');

      const existing =
        price.kdnPercent === null || price.kdnPercent === undefined
          ? null
          : toDecimalString2(price.kdnPercent);

      if (!expectedKdnMatchesStored(expectedKdnPercent, existing)) {
        if (existing === canonical) {
          return {
            basicPriceId: price.id,
            kdnPercent: existing,
            unchanged: true,
          };
        }
        throw new ConflictException('KDN_STALE_FACT');
      }

      if (existing === canonical) {
        return {
          basicPriceId: price.id,
          kdnPercent: existing,
          unchanged: true,
        };
      }
      if (existing !== null) {
        throw new ConflictException('KDN_CONFLICT_NO_SILENT_OVERWRITE');
      }

      const before = {
        kdnPercent: null as string | null,
        kdnEstablishment: null as string | null,
      };
      const after = {
        kdnPercent: canonical,
        kdnEstablishment: 'MANUAL_ENRICHMENT' as const,
      };

      const written = await tx.basicPrice.updateMany({
        where: {
          id: price.id,
          workspaceId: actor.workspaceId,
          assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
          kdnPercent: null,
        },
        data: {
          kdnPercent: new Prisma.Decimal(canonical),
          kdnEstablishment: 'MANUAL_ENRICHMENT',
        },
      });

      if (written.count === 0) {
        const again = await tx.basicPrice.findFirst({
          where: {
            id: price.id,
            workspaceId: actor.workspaceId,
            assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
          },
          select: { kdnPercent: true },
        });
        const now =
          again?.kdnPercent === null || again?.kdnPercent === undefined
            ? null
            : toDecimalString2(again.kdnPercent);
        if (now === canonical) {
          return {
            basicPriceId: price.id,
            kdnPercent: now,
            unchanged: true,
          };
        }
        throw new ConflictException(
          expectedKdnPercent !== undefined
            ? 'KDN_STALE_FACT'
            : 'KDN_CONFLICT_NO_SILENT_OVERWRITE',
        );
      }

      await tx.basicPriceProvenanceCorrection.create({
        data: {
          basicPriceId: price.id,
          workspaceId: actor.workspaceId,
          actorAccountId: actor.accountId,
          reason,
          before,
          after,
        },
      });

      return {
        basicPriceId: price.id,
        kdnPercent: canonical,
        unchanged: false,
      };
    });
  }

  /**
   * BP-DETAIL-MAINT-02 — fill a previously unknown %KDN on a SIMPROK Catalog
   * observation. Reuses the same fill-missing law as private enrichKdn.
   * Workspace catalog requires BASIC_PRICE_VERIFY. Shared catalog requires
   * BASIC_PRICE_PROMOTE_SHARED. Ordinary SUBMIT cannot enter.
   */
  async enrichCatalogKdn(params: {
    basicPriceId: string;
    actor: TrustedBasicPriceActor;
    kdnPercent: string;
    reason: string;
    expectedKdnPercent?: string | null;
    canVerify: boolean;
    canPromoteShared: boolean;
  }) {
    const { basicPriceId, actor, reason, expectedKdnPercent } = params;
    const reading = interpretKdnLiteral(params.kdnPercent);
    if (reading.status !== 'VALID' || reading.canonicalPercent === null) {
      throw new ConflictException(
        reading.status === 'UNKNOWN' ? 'KDN_REQUIRED' : reading.reason,
      );
    }
    const canonical = reading.canonicalPercent;

    return this.prisma.$transaction(async (tx) => {
      const price = await tx.basicPrice.findFirst({
        where: {
          id: basicPriceId,
          assetScope: BasicPriceAssetScope.SIMPROK_CATALOG,
        },
        select: {
          id: true,
          workspaceId: true,
          kdnPercent: true,
          kdnEstablishment: true,
        },
      });
      if (!price) throw new NotFoundException('BasicPrice not found');

      const shared = price.workspaceId === null;
      const workspaceOwned = price.workspaceId === actor.workspaceId;
      if (shared && !params.canPromoteShared) {
        throw new NotFoundException('BasicPrice not found');
      }
      if (!shared && !workspaceOwned) {
        throw new NotFoundException('BasicPrice not found');
      }
      if (!shared && !params.canVerify) {
        throw new NotFoundException('BasicPrice not found');
      }

      const existing =
        price.kdnPercent === null || price.kdnPercent === undefined
          ? null
          : toDecimalString2(price.kdnPercent);

      if (!expectedKdnMatchesStored(expectedKdnPercent, existing)) {
        if (existing === canonical) {
          return {
            basicPriceId: price.id,
            kdnPercent: existing,
            unchanged: true,
          };
        }
        throw new ConflictException('KDN_STALE_FACT');
      }
      if (existing === canonical) {
        return {
          basicPriceId: price.id,
          kdnPercent: existing,
          unchanged: true,
        };
      }
      if (existing !== null) {
        throw new ConflictException('KDN_CONFLICT_NO_SILENT_OVERWRITE');
      }

      const written = await tx.basicPrice.updateMany({
        where: {
          id: price.id,
          assetScope: BasicPriceAssetScope.SIMPROK_CATALOG,
          kdnPercent: null,
        },
        data: {
          kdnPercent: new Prisma.Decimal(canonical),
          kdnEstablishment: 'MANUAL_ENRICHMENT',
        },
      });
      if (written.count === 0) {
        const again = await tx.basicPrice.findFirst({
          where: { id: price.id },
          select: { kdnPercent: true },
        });
        const now =
          again?.kdnPercent === null || again?.kdnPercent === undefined
            ? null
            : toDecimalString2(again.kdnPercent);
        if (now === canonical) {
          return {
            basicPriceId: price.id,
            kdnPercent: now,
            unchanged: true,
          };
        }
        throw new ConflictException(
          expectedKdnPercent !== undefined
            ? 'KDN_STALE_FACT'
            : 'KDN_CONFLICT_NO_SILENT_OVERWRITE',
        );
      }

      await tx.basicPriceProvenanceCorrection.create({
        data: {
          basicPriceId: price.id,
          workspaceId: actor.workspaceId,
          actorAccountId: actor.accountId,
          reason,
          before: { kdnPercent: null, kdnEstablishment: null },
          after: {
            kdnPercent: canonical,
            kdnEstablishment: 'MANUAL_ENRICHMENT',
          },
        },
      });

      return {
        basicPriceId: price.id,
        kdnPercent: canonical,
        unchanged: false,
      };
    });
  }

  /**
   * BP-DETAIL-MAINT-02 — private post-create money correction.
   *
   * Creates a successor observation. Does not PATCH the predecessor's `value`.
   * KDN is copied, never restated. History is the supersession pointer.
   */
  async correctPrivatePrice(params: {
    basicPriceId: string;
    actor: TrustedBasicPriceActor;
    expectedValue: string;
    proposedValue: string;
    reason: string;
  }) {
    const { basicPriceId, actor, reason } = params;
    let expected: string;
    let proposed: string;
    try {
      expected = toMoneyDecimal2(params.expectedValue).toFixed(2);
      proposed = toMoneyDecimal2(params.proposedValue).toFixed(2);
    } catch {
      throw new ConflictException('PRICE_NOT_CANONICAL');
    }
    if (expected === proposed) {
      throw new ConflictException('PRICE_UNCHANGED');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "basic_prices"
        WHERE "id" = ${basicPriceId}::uuid
          AND "workspaceId" = ${actor.workspaceId}::uuid
          AND "assetScope" = 'WORKSPACE_PRIVATE'
        FOR UPDATE`;

      const predecessor = await tx.basicPrice.findFirst({
        where: {
          id: basicPriceId,
          workspaceId: actor.workspaceId,
          assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
        },
        include: {
          sourceImportRow: {
            select: {
              batch: {
                select: {
                  sourceVendorName: true,
                  sourceOrganizationName: true,
                },
              },
            },
          },
          sourceSubmission: {
            select: {
              importRow: {
                select: {
                  batch: {
                    select: {
                      sourceVendorName: true,
                      sourceOrganizationName: true,
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (!predecessor) throw new NotFoundException('BasicPrice not found');

      const stored = toDecimalString2(predecessor.value);
      if (stored !== expected) {
        if (stored === proposed) {
          return {
            basicPriceId: predecessor.id,
            value: stored,
            unchanged: true,
          };
        }
        throw new ConflictException('PRICE_STALE_FACT');
      }

      const existingSuccessor = await tx.basicPrice.findFirst({
        where: { supersedesBasicPriceId: predecessor.id },
      });
      if (existingSuccessor) {
        const successorValue = toDecimalString2(existingSuccessor.value);
        if (successorValue === proposed) {
          return {
            basicPriceId: existingSuccessor.id,
            value: successorValue,
            unchanged: true,
          };
        }
        throw new ConflictException('PREDECESSOR_ALREADY_SUPERSEDED');
      }

      try {
        const created = await tx.basicPrice.create({
          data: {
            assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
            workspaceId: predecessor.workspaceId,
            organizationId: predecessor.organizationId,
            resourceId: predecessor.resourceId,
            regionId: predecessor.regionId,
            effectiveDate: predecessor.effectiveDate,
            value: new Prisma.Decimal(proposed),
            kdnPercent: predecessor.kdnPercent,
            kdnEstablishment: predecessor.kdnEstablishment,
            sourceType: predecessor.sourceType,
            sourceOrigin: predecessor.sourceOrigin,
            freshnessStatus: predecessor.freshnessStatus,
            reviewDate: predecessor.reviewDate,
            validUntil: predecessor.validUntil,
            sourcePeriodLabel: predecessor.sourcePeriodLabel,
            sourcePeriodGranularity: predecessor.sourcePeriodGranularity,
            effectiveDateProvenance: predecessor.effectiveDateProvenance,
            effectiveDateDerivationRule: predecessor.effectiveDateDerivationRule,
            reportedByAccountId: actor.accountId,
            supersedesBasicPriceId: predecessor.id,
          },
          select: { id: true, value: true },
        });

        await tx.basicPriceProvenanceCorrection.create({
          data: {
            basicPriceId: created.id,
            workspaceId: actor.workspaceId,
            actorAccountId: actor.accountId,
            reason,
            before: { value: stored },
            after: {
              value: proposed,
              sourceIdentityName: deriveExplorerSourceName(predecessor),
              evidenceClass: predecessor.sourceImportRow
                ? 'SOURCE_DOCUMENT'
                : 'FIELD_REPORTED',
            },
          },
        });

        return {
          basicPriceId: created.id,
          value: toDecimalString2(created.value),
          unchanged: false,
        };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const again = await tx.basicPrice.findFirst({
            where: { supersedesBasicPriceId: predecessor.id },
            select: { id: true, value: true },
          });
          if (again && toDecimalString2(again.value) === proposed) {
            return {
              basicPriceId: again.id,
              value: toDecimalString2(again.value),
              unchanged: true,
            };
          }
          throw new ConflictException('PREDECESSOR_ALREADY_SUPERSEDED');
        }
        throw error;
      }
    });
  }

  /**
   * BP-CHANGE-SEM-03 — later lawful private money observation.
   *
   * Does not PATCH the predecessor. Does not set `supersedesBasicPriceId`.
   * Business date is the caller's `effectiveDate`, never `createdAt`.
   * Predecessor import-row evidence is not reused as proof of the new money.
   */
  async observePrivatePrice(params: {
    basicPriceId: string;
    actor: TrustedBasicPriceActor;
    expectedValue: string;
    proposedValue: string;
    effectiveDate: string;
    reason: string;
    sameSource?: boolean;
    sourceIdentityName?: string;
  }) {
    const { basicPriceId, actor, reason } = params;
    let expected: string;
    let proposed: string;
    try {
      expected = toMoneyDecimal2(params.expectedValue).toFixed(2);
      proposed = toMoneyDecimal2(params.proposedValue).toFixed(2);
    } catch {
      throw new ConflictException('PRICE_NOT_CANONICAL');
    }
    if (expected === proposed) {
      throw new ConflictException('PRICE_UNCHANGED');
    }
    const observationDate = parseDateOnlyUtc(
      params.effectiveDate,
      'effectiveDate',
    );

    return this.prisma.$transaction(async (tx) => {
      const predecessor = await this.lockPrivatePredecessor(
        tx,
        basicPriceId,
        actor.workspaceId,
      );
      const stored = toDecimalString2(predecessor.value);
      if (stored !== expected) {
        if (stored === proposed) {
          return {
            basicPriceId: predecessor.id,
            value: stored,
            unchanged: true,
          };
        }
        throw new ConflictException('PRICE_STALE_FACT');
      }
      const copiedKdn = storedKdnOf(predecessor.kdnPercent);
      const sameSource = params.sameSource !== false;
      const derivedName = deriveExplorerSourceName(predecessor);
      const providedName = blankToNull(params.sourceIdentityName);
      const sourceIdentityName = sameSource
        ? (derivedName ?? providedName)
        : providedName;
      if (!sameSource && !sourceIdentityName) {
        throw new ConflictException('SOURCE_IDENTITY_REQUIRED');
      }
      return this.insertPrivateNewObservation(tx, {
        actor,
        predecessor,
        reason,
        proposedValue: proposed,
        observationDate,
        kdnPercent: copiedKdn,
        kdnEstablishment: predecessor.kdnEstablishment,
        sourceType: PriceSourceType.MARKET_SURVEY,
        sourceOrigin: sameSource
          ? predecessor.sourceOrigin
          : PriceSourceOrigin.FIELD_REPORT,
        sourceIdentityName,
        sameSourceIdentity: sameSource,
        evidenceClass: 'FIELD_REPORTED',
      });
    });
  }

  /**
   * BP-CHANGE-SEM-03 — later lawful private KDN observation.
   *
   * Does not use the null-fill enrich writer. Does not overwrite the older
   * KDN fact. Does not inherit price-import evidence as KDN proof.
   */
  async observePrivateKdn(params: {
    basicPriceId: string;
    actor: TrustedBasicPriceActor;
    expectedValue: string;
    expectedKdnPercent: string;
    proposedKdnPercent: string;
    effectiveDate: string;
    reason: string;
  }) {
    const { basicPriceId, actor, reason } = params;
    let expectedMoney: string;
    try {
      expectedMoney = toMoneyDecimal2(params.expectedValue).toFixed(2);
    } catch {
      throw new ConflictException('PRICE_NOT_CANONICAL');
    }
    const proposedKdn = canonicalKdnOrThrow(params.proposedKdnPercent);
    const observationDate = parseDateOnlyUtc(
      params.effectiveDate,
      'effectiveDate',
    );

    return this.prisma.$transaction(async (tx) => {
      const predecessor = await this.lockPrivatePredecessor(
        tx,
        basicPriceId,
        actor.workspaceId,
      );
      const storedMoney = toDecimalString2(predecessor.value);
      const storedKdn = storedKdnOf(predecessor.kdnPercent);
      if (storedKdn === null) {
        throw new ConflictException('KDN_MISSING_USE_ENRICH');
      }
      if (storedMoney !== expectedMoney) {
        throw new ConflictException('PRICE_STALE_FACT');
      }
      if (storedKdn !== params.expectedKdnPercent) {
        if (storedKdn === proposedKdn) {
          return {
            basicPriceId: predecessor.id,
            value: storedMoney,
            kdnPercent: storedKdn,
            unchanged: true,
          };
        }
        throw new ConflictException('KDN_STALE_FACT');
      }
      if (storedKdn === proposedKdn) {
        throw new ConflictException('KDN_UNCHANGED');
      }
      return this.insertPrivateNewObservation(tx, {
        actor,
        predecessor,
        reason,
        proposedValue: storedMoney,
        observationDate,
        kdnPercent: proposedKdn,
        kdnEstablishment: BasicPriceKdnEstablishment.MANUAL_NEW_OBSERVATION,
        sourceType: predecessor.sourceType,
        sourceOrigin: predecessor.sourceOrigin,
        sourceIdentityName: deriveExplorerSourceName(predecessor),
        sameSourceIdentity: true,
        evidenceClass: 'FIELD_REPORTED',
      });
    });
  }

  /**
   * BP-CHANGE-SEM-03 — stated private KDN was recorded wrong.
   *
   * Successor with supersession. Money and business date are copied.
   * Null KDN cannot enter this writer (that is enrich).
   */
  async correctPrivateKdn(params: {
    basicPriceId: string;
    actor: TrustedBasicPriceActor;
    expectedValue: string;
    expectedKdnPercent: string;
    proposedKdnPercent: string;
    reason: string;
  }) {
    const { basicPriceId, actor, reason } = params;
    let expectedMoney: string;
    try {
      expectedMoney = toMoneyDecimal2(params.expectedValue).toFixed(2);
    } catch {
      throw new ConflictException('PRICE_NOT_CANONICAL');
    }
    const proposedKdn = canonicalKdnOrThrow(params.proposedKdnPercent);

    return this.prisma.$transaction(async (tx) => {
      const predecessor = await this.lockPrivatePredecessor(
        tx,
        basicPriceId,
        actor.workspaceId,
      );
      const storedMoney = toDecimalString2(predecessor.value);
      const storedKdn = storedKdnOf(predecessor.kdnPercent);
      if (storedKdn === null) {
        throw new ConflictException('KDN_MISSING_USE_ENRICH');
      }
      if (storedMoney !== expectedMoney) {
        throw new ConflictException('PRICE_STALE_FACT');
      }
      if (storedKdn !== params.expectedKdnPercent) {
        if (storedKdn === proposedKdn) {
          return {
            basicPriceId: predecessor.id,
            value: storedMoney,
            kdnPercent: storedKdn,
            unchanged: true,
          };
        }
        throw new ConflictException('KDN_STALE_FACT');
      }
      if (storedKdn === proposedKdn) {
        throw new ConflictException('KDN_UNCHANGED');
      }

      const existingSuccessor = await tx.basicPrice.findFirst({
        where: { supersedesBasicPriceId: predecessor.id },
      });
      if (existingSuccessor) {
        const successorKdn = storedKdnOf(existingSuccessor.kdnPercent);
        if (successorKdn === proposedKdn) {
          return {
            basicPriceId: existingSuccessor.id,
            value: toDecimalString2(existingSuccessor.value),
            kdnPercent: successorKdn,
            unchanged: true,
          };
        }
        throw new ConflictException('PREDECESSOR_ALREADY_SUPERSEDED');
      }

      try {
        const created = await tx.basicPrice.create({
          data: {
            assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
            workspaceId: predecessor.workspaceId,
            organizationId: predecessor.organizationId,
            resourceId: predecessor.resourceId,
            regionId: predecessor.regionId,
            effectiveDate: predecessor.effectiveDate,
            value: predecessor.value,
            kdnPercent: new Prisma.Decimal(proposedKdn),
            kdnEstablishment: BasicPriceKdnEstablishment.MANUAL_CORRECTION,
            sourceType: predecessor.sourceType,
            sourceOrigin: predecessor.sourceOrigin,
            freshnessStatus: predecessor.freshnessStatus,
            reviewDate: predecessor.reviewDate,
            validUntil: predecessor.validUntil,
            sourcePeriodLabel: predecessor.sourcePeriodLabel,
            sourcePeriodGranularity: predecessor.sourcePeriodGranularity,
            effectiveDateProvenance: predecessor.effectiveDateProvenance,
            effectiveDateDerivationRule:
              predecessor.effectiveDateDerivationRule,
            reportedByAccountId: actor.accountId,
            supersedesBasicPriceId: predecessor.id,
          },
          select: { id: true, value: true, kdnPercent: true },
        });

        await tx.basicPriceProvenanceCorrection.create({
          data: {
            basicPriceId: created.id,
            workspaceId: actor.workspaceId,
            actorAccountId: actor.accountId,
            reason,
            before: {
              semantic: 'CORRECTION',
              kdnPercent: storedKdn,
            },
            after: {
              semantic: 'CORRECTION',
              kdnPercent: proposedKdn,
              sourceIdentityName: deriveExplorerSourceName(predecessor),
              evidenceClass: 'FIELD_REPORTED',
            },
          },
        });

        return {
          basicPriceId: created.id,
          value: toDecimalString2(created.value),
          kdnPercent: storedKdnOf(created.kdnPercent),
          unchanged: false,
        };
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const again = await tx.basicPrice.findFirst({
            where: { supersedesBasicPriceId: predecessor.id },
            select: { id: true, value: true, kdnPercent: true },
          });
          if (again && storedKdnOf(again.kdnPercent) === proposedKdn) {
            return {
              basicPriceId: again.id,
              value: toDecimalString2(again.value),
              kdnPercent: proposedKdn,
              unchanged: true,
            };
          }
          throw new ConflictException('PREDECESSOR_ALREADY_SUPERSEDED');
        }
        throw error;
      }
    });
  }

  private async lockPrivatePredecessor(
    tx: Prisma.TransactionClient,
    basicPriceId: string,
    workspaceId: string,
  ) {
    await tx.$queryRaw`
      SELECT "id" FROM "basic_prices"
      WHERE "id" = ${basicPriceId}::uuid
        AND "workspaceId" = ${workspaceId}::uuid
        AND "assetScope" = 'WORKSPACE_PRIVATE'
      FOR UPDATE`;

    const predecessor = await tx.basicPrice.findFirst({
      where: {
        id: basicPriceId,
        workspaceId,
        assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
      },
      include: {
        sourceImportRow: {
          select: {
            batch: {
              select: {
                sourceVendorName: true,
                sourceOrganizationName: true,
              },
            },
          },
        },
        sourceSubmission: {
          select: {
            importRow: {
              select: {
                batch: {
                  select: {
                    sourceVendorName: true,
                    sourceOrganizationName: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!predecessor) throw new NotFoundException('BasicPrice not found');
    return predecessor;
  }

  private async insertPrivateNewObservation(
    tx: Prisma.TransactionClient,
    params: {
      actor: TrustedBasicPriceActor;
      predecessor: {
        id: string;
        workspaceId: string | null;
        organizationId: string | null;
        resourceId: string;
        regionId: string | null;
        value: Prisma.Decimal;
        kdnPercent: Prisma.Decimal | null;
        kdnEstablishment: string | null;
        sourceType: string;
        sourceOrigin: string;
        sourceImportRow?: {
          batch?: {
            sourceVendorName: string | null;
            sourceOrganizationName: string | null;
          } | null;
        } | null;
        sourceSubmission?: {
          importRow?: {
            batch?: {
              sourceVendorName: string | null;
              sourceOrganizationName: string | null;
            } | null;
          } | null;
        } | null;
      };
      reason: string;
      proposedValue: string;
      observationDate: Date;
      kdnPercent: string | null;
      kdnEstablishment: string | null;
      sourceType: PriceSourceType;
      sourceOrigin: PriceSourceOrigin;
      sourceIdentityName: string | null;
      sameSourceIdentity: boolean;
      evidenceClass: 'FIELD_REPORTED' | 'SOURCE_DOCUMENT';
    },
  ) {
    const { actor, predecessor, reason, proposedValue, observationDate } =
      params;
    const kdnValue =
      params.kdnPercent === null ? null : new Prisma.Decimal(params.kdnPercent);
    if (kdnValue !== null && params.kdnEstablishment === null) {
      throw new ConflictException('KDN_ESTABLISHMENT_REQUIRED');
    }

    const existing = await tx.basicPrice.findFirst({
      where: {
        workspaceId: actor.workspaceId,
        assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
        resourceId: predecessor.resourceId,
        regionId: predecessor.regionId,
        effectiveDate: observationDate,
        value: new Prisma.Decimal(proposedValue),
        recordsNewObservation: true,
        reportedByAccountId: actor.accountId,
        kdnPercent: kdnValue,
      },
      select: { id: true, value: true, kdnPercent: true },
    });
    if (existing) {
      return {
        basicPriceId: existing.id,
        value: toDecimalString2(existing.value),
        kdnPercent: storedKdnOf(existing.kdnPercent),
        unchanged: true,
      };
    }

    try {
      const created = await tx.basicPrice.create({
        data: {
          assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
          workspaceId: predecessor.workspaceId,
          organizationId: predecessor.organizationId,
          resourceId: predecessor.resourceId,
          regionId: predecessor.regionId,
          effectiveDate: observationDate,
          value: new Prisma.Decimal(proposedValue),
          kdnPercent: kdnValue,
          kdnEstablishment:
            kdnValue === null
              ? null
              : (params.kdnEstablishment as BasicPriceKdnEstablishment),
          sourceType: params.sourceType,
          sourceOrigin: params.sourceOrigin,
          freshnessStatus: 'CURRENT',
          effectiveDateProvenance: 'SOURCE_STATED',
          reportedByAccountId: actor.accountId,
          recordsNewObservation: true,
        },
        select: { id: true, value: true, kdnPercent: true, createdAt: true },
      });

      await tx.basicPriceProvenanceCorrection.create({
        data: {
          basicPriceId: created.id,
          workspaceId: actor.workspaceId,
          actorAccountId: actor.accountId,
          reason,
          before: {
            semantic: 'NEW_OBSERVATION',
            observedAfterBasicPriceId: predecessor.id,
            value: toDecimalString2(predecessor.value),
            kdnPercent: storedKdnOf(predecessor.kdnPercent),
          },
          after: {
            semantic: 'NEW_OBSERVATION',
            value: proposedValue,
            kdnPercent: params.kdnPercent,
            effectiveDate: observationDate.toISOString().slice(0, 10),
            sourceIdentityName: params.sourceIdentityName,
            sameSourceIdentity: params.sameSourceIdentity,
            evidenceClass: params.evidenceClass,
          },
        },
      });

      return {
        basicPriceId: created.id,
        value: toDecimalString2(created.value),
        kdnPercent: storedKdnOf(created.kdnPercent),
        unchanged: false,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const again = await tx.basicPrice.findFirst({
          where: {
            workspaceId: actor.workspaceId,
            assetScope: BasicPriceAssetScope.WORKSPACE_PRIVATE,
            resourceId: predecessor.resourceId,
            regionId: predecessor.regionId,
            effectiveDate: observationDate,
            value: new Prisma.Decimal(proposedValue),
            recordsNewObservation: true,
            reportedByAccountId: actor.accountId,
            kdnPercent: kdnValue,
          },
          select: { id: true, value: true, kdnPercent: true },
        });
        if (again) {
          return {
            basicPriceId: again.id,
            value: toDecimalString2(again.value),
            kdnPercent: storedKdnOf(again.kdnPercent),
            unchanged: true,
          };
        }
        throw new ConflictException('NEW_OBSERVATION_CONFLICT');
      }
      throw error;
    }
  }
}

function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function storedKdnOf(
  value: Prisma.Decimal | string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  return toDecimalString2(value);
}

function canonicalKdnOrThrow(raw: string): string {
  const reading = interpretKdnLiteral(raw);
  if (reading.status !== 'VALID' || reading.canonicalPercent === null) {
    throw new ConflictException(
      reading.status === 'UNKNOWN' ? 'KDN_REQUIRED' : reading.reason,
    );
  }
  return reading.canonicalPercent;
}
