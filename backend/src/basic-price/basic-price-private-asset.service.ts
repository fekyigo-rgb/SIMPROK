import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BasicPriceAssetScope, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { assertBatchOwnedByCaller } from './basic-price-import-ownership.util';
import {
  mapPrivateBasicPriceItem,
  type PrivateBasicPriceItem,
} from '../common/basic-price-workflow.projection';
import type { TrustedBasicPriceActor } from './trusted-basic-price-actor.service';

export interface KeepBatchPrivateResult {
  batchId: string;
  /** Prices this call brought into existence. */
  createdCount: number;
  /** Rows that already had a private price — re-running is not a duplicate. */
  alreadyPrivateCount: number;
  prices: PrivateBasicPriceItem[];
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
        }>
      >(
        Prisma.sql`SELECT "id", "workspaceId", "organizationId", "status", "effectiveDate",
                          "regionId", "sourceType", "sourceOrigin", "uploadedByAccountId"
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
            sourceType: (batch.sourceType as any) ?? 'MARKET_SURVEY',
            sourceOrigin: batch.sourceOrigin as any,
            freshnessStatus: 'CURRENT',
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
}
