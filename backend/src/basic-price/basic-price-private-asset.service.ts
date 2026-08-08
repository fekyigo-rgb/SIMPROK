import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BasicPriceAssetScope, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertBatchOwnedByCaller } from './basic-price-import-ownership.util';
import {
  mapPrivateBasicPriceItem,
  type PrivateBasicPriceItem,
} from '../common/basic-price-workflow.projection';
import type { TrustedBasicPriceActor } from './trusted-basic-price-actor.service';
import {
  expectedSourceTypeFor,
  isCoherentSourcePair,
} from '../common/price-source-coherence';

/**
 * The batch facts every private-price write depends on. Read once, asserted
 * once, used by both the create path and the correction path so the two can
 * never disagree about what "truthful enough to write" means.
 */
interface BatchProvenanceFacts {
  sourceOrigin: string | null;
  sourceType: string | null;
  sourcePeriodLabel: string | null;
  sourcePeriodGranularity: string | null;
  effectiveDateProvenance: string | null;
  effectiveDateDerivationRule: string | null;
}

const isBlank = (value: string | null | undefined): boolean =>
  value === null || value === undefined || value.trim().length === 0;

/**
 * RM-03D1 — a private price may never carry an unstated or incoherent source
 * classification.
 *
 * The writer used to fall back to MARKET_SURVEY when the batch said nothing,
 * which could mint the very falsehood this slice exists to correct: a
 * government standard price list recorded as a market survey. There is no
 * fallback now, and the pair is checked against the ONE shared origin→type
 * authority rather than a second opinion local to this file.
 */
export function assertSourceClassificationCoherent(
  sourceOrigin: string | null,
  sourceType: string | null,
): void {
  if (!sourceOrigin) {
    throw new ConflictException('SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE');
  }
  if (!sourceType) {
    throw new ConflictException('SOURCE_TYPE_REQUIRED_BEFORE_PRIVATE_USE');
  }
  if (!isCoherentSourcePair(sourceOrigin as any, sourceType as any)) {
    throw new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      message: 'SOURCE_ORIGIN_TYPE_INCOHERENT',
      sourceOrigin,
      sourceType,
      expectedSourceType: expectedSourceTypeFor(sourceOrigin as any) ?? null,
    });
  }
}

/**
 * RM-03D1 — a DERIVED date must be re-derivable, and a stated date must not
 * pretend to have been derived.
 *
 * The database enforces the same shape, and deliberately so: this gives a
 * caller a named error instead of a constraint violation, while the constraint
 * makes the incoherent row unrepresentable even to a writer that forgets to
 * ask. Whitespace is rejected here because `'   '` is not a period label, and a
 * NOT NULL column would happily accept it.
 */
export function assertTemporalProvenanceCoherent(
  batch: BatchProvenanceFacts,
): void {
  const provenance = batch.effectiveDateProvenance;
  if (!provenance) {
    // Unknown provenance stays legal — it reads as "we do not claim", which is
    // honest for anything imported before this distinction existed.
    if (!isBlank(batch.effectiveDateDerivationRule)) {
      throw new ConflictException('DERIVATION_RULE_REQUIRES_PROVENANCE');
    }
    return;
  }
  if (provenance === 'DERIVED_FROM_SOURCE_PERIOD') {
    if (isBlank(batch.sourcePeriodLabel)) {
      throw new ConflictException('SOURCE_PERIOD_LABEL_REQUIRED_FOR_DERIVED_DATE');
    }
    if (!batch.sourcePeriodGranularity) {
      throw new ConflictException(
        'SOURCE_PERIOD_GRANULARITY_REQUIRED_FOR_DERIVED_DATE',
      );
    }
    if (isBlank(batch.effectiveDateDerivationRule)) {
      throw new ConflictException(
        'DERIVATION_RULE_REQUIRED_FOR_DERIVED_DATE',
      );
    }
    return;
  }
  // SOURCE_STATED: the source printed the date, so there is no rule to carry.
  // A period LABEL may still be present — a document can truthfully state both
  // "TA 2024" and an exact date — so only the rule is forbidden.
  if (!isBlank(batch.effectiveDateDerivationRule)) {
    throw new ConflictException('DERIVATION_RULE_FORBIDDEN_FOR_SOURCE_STATED');
  }
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
 */
@Injectable()
export class BasicPricePrivateAssetService {
  constructor(private readonly prisma: PrismaService) {}

  async keepBatchPrivate(params: {
    batchId: string;
    actor: TrustedBasicPriceActor;
  }): Promise<KeepBatchPrivateResult> {
    const { batchId, actor } = params;

    return this.prisma.$transaction(async (tx) => {
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
        }>
      >(
        Prisma.sql`SELECT "id", "workspaceId", "organizationId", "status", "effectiveDate",
                          "regionId", "sourceType", "sourceOrigin", "uploadedByAccountId",
                          "sourcePeriodLabel", "sourcePeriodGranularity", "effectiveDateProvenance", "effectiveDateDerivationRule"
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

      // Same readiness gate as submitBatch: the human has finished resolving
      // this batch. A batch still being worked on has no settled facts to keep.
      if (batch.status !== 'READY_FOR_REVIEW') {
        throw new ConflictException('BATCH_NOT_READY_FOR_REVIEW');
      }
      // Truthfulness preconditions — identical to submitBatch's, because a
      // private price needs exactly the same honest context a submitted one
      // does. None of these is ever defaulted or fabricated.
      if (!batch.effectiveDate) {
        throw new ConflictException('EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE');
      }
      if (!batch.regionId) {
        throw new ConflictException('REGION_REQUIRED_BEFORE_PRIVATE_USE');
      }
      if (!batch.sourceOrigin) {
        throw new ConflictException('SOURCE_ORIGIN_REQUIRED_BEFORE_PRIVATE_USE');
      }
      // RM-03D1 — sourceType is now a REQUIRED truth, not a defaulted one. This
      // writer previously wrote `batch.sourceType ?? 'MARKET_SURVEY'`, which
      // could mint exactly the falsehood this slice exists to correct: a
      // government price list silently classified as a market survey. There is
      // no default any more; an unstated source type fails closed.
      assertSourceClassificationCoherent(batch.sourceOrigin, batch.sourceType);
      assertTemporalProvenanceCoherent(batch);

      const readyRows = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "basic_price_import_rows"
                    WHERE "batchId" = ${batchId}::uuid
                      AND "status" = 'READY_FOR_SUBMISSION'
                    ORDER BY "sourceRowNumber" ASC
                    FOR UPDATE`,
      );
      if (readyRows.length === 0) {
        throw new ConflictException('NO_ROWS_READY_FOR_PRIVATE_USE');
      }

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
            effectiveDate: row.effectiveDateOverride ?? batch.effectiveDate,
            // EXACT money. Prisma.Decimal, never Number()/parseFloat().
            value: new Prisma.Decimal(row.proposedCanonicalPrice),
            // SOURCE — orthogonal to ownership. A private asset may truthfully
            // come from a government list, a supplier, a store, a distributor
            // or a field report; the batch says which, and this writer copies
            // it verbatim rather than substituting a "private" source family.
            // No fallback. The coherence assertion above already refused an
            // absent or incoherent classification, so this is the batch's
            // stated truth or the write never happened.
            sourceType: batch.sourceType as any,
            sourceOrigin: batch.sourceOrigin as any,
            freshnessStatus: 'CURRENT',
            // RM-03D1 — TEMPORAL PROVENANCE, carried verbatim from the batch.
            // `effectiveDate` above is a single calendar day, but a source that
            // states only "TA 2024" never printed one. These three keep the
            // difference visible on the price itself: what the source actually
            // said, whether the date is the source's or SIMPROK's, and by which
            // named rule it was derived. Copied, never inferred — a batch that
            // says nothing leaves all three null, which reads as "unknown" and
            // never as "the source stated this".
            sourcePeriodLabel: batch.sourcePeriodLabel,
            sourcePeriodGranularity: batch.sourcePeriodGranularity as any,
            effectiveDateProvenance: batch.effectiveDateProvenance as any,
            effectiveDateDerivationRule: batch.effectiveDateDerivationRule,
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
    });
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
        throw new ConflictException('EFFECTIVE_DATE_REQUIRED_BEFORE_PRIVATE_USE');
      }
      // The correction propagates the SAME facts the create path writes, so it
      // is held to the SAME coherence rules. Anything less would let a
      // correction reintroduce the incoherent classification the create path
      // now refuses.
      assertSourceClassificationCoherent(batch.sourceOrigin, batch.sourceType);
      assertTemporalProvenanceCoherent(batch);

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
        if (price.status !== 'UNPUBLISHED' || price.verificationStatus === 'PUBLISHED') {
          throw new ConflictException('PRICE_NOT_PRIVATE_CORRECTABLE');
        }

        const rowOverride = price.sourceImportRowId
          ? await tx.basicPriceImportRow.findUnique({
              where: { id: price.sourceImportRowId },
              select: { effectiveDateOverride: true },
            })
          : null;
        // Exactly the precedence keepBatchPrivate used, so a corrected price
        // lands on the same date the writer would have produced today.
        const nextEffectiveDate =
          rowOverride?.effectiveDateOverride ?? batch.effectiveDate;

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
          effectiveDate: nextEffectiveDate.toISOString(),
          sourcePeriodLabel: batch.sourcePeriodLabel,
          sourcePeriodGranularity: batch.sourcePeriodGranularity,
          effectiveDateProvenance: batch.effectiveDateProvenance,
          effectiveDateDerivationRule: batch.effectiveDateDerivationRule,
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
            effectiveDate: nextEffectiveDate,
            sourcePeriodLabel: batch.sourcePeriodLabel,
            sourcePeriodGranularity: batch.sourcePeriodGranularity as any,
            effectiveDateProvenance: batch.effectiveDateProvenance as any,
            effectiveDateDerivationRule: batch.effectiveDateDerivationRule,
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
}
