import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  BasicPriceAssetScope,
  BasicPriceImportRowResolutionStatus,
  Prisma,
  ProjectStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  RabLifecyclePolicyService,
  WORKING_DRAFT_STRUCTURE_NAME,
} from './rab-lifecycle-policy.service';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { parseDateOnlyUtc } from '../common/date-only.util';
import { toMoneyDecimal2 } from '../common/money';
import { buildDraftRecap } from './rab-draft-recap';
import {
  RAB_KERNEL_PERSISTENCE_POLICY,
  RAB_KERNEL_PERSISTENCE_REASON,
} from './rab-kernel-persistence.contracts';
import { calculateCostKernel } from './cost-kernel.kernel';
import {
  COST_CALCULATION_REASON,
  COST_CALCULATION_STATUS,
  CostKernelResourceInput,
} from './cost-kernel.contracts';

export interface PersistBoqItemCalculationParams {
  projectId: string;
  boqItemId: string;
  workspaceId: string;
  calculationAsOfDateRaw: string;
}

export interface PersistBoqItemCalculationResult {
  boqItemId: string;
  unitPrice: string;
  lineTotal: string;
  priceOrigin: 'SERVER_COST_KERNEL';
  calculationOccurrenceId: string;
  calculationAsOfDate: string;
  calculatedAt: string;
  calculationPolicyVersion: string;
  /**
   * The SECTION's total, which is a different fact from this line's money.
   * COMPLETE carries the exact recap; INCOMPLETE carries nulls because at
   * least one other WORK_ITEM is still unpriced and a partial sum would be a
   * false total, not a smaller one.
   */
  rabTotals:
    | {
        pricingStatus: 'COMPLETE';
        totalBaseCost: string;
        totalFinalCost: string;
      }
    | {
        pricingStatus: 'INCOMPLETE';
        totalBaseCost: null;
        totalFinalCost: null;
      };
}

/**
 * GATE-2A — the one and only server-authoritative command that may write
 * BoqItem.unitPrice/lineTotal from a Cost Kernel calculation, and the one
 * and only writer of priceOrigin = SERVER_COST_KERNEL. Distinct from (and
 * never called by) the read-only GET cost-calculation endpoints — this is
 * the "separate server-authoritative command" the locked contract requires.
 *
 * §5.1 — NO PARTIAL RAB TOTAL, EVER. What §5.1 protects is the TOTAL, and
 * that protection is absolute: `totalBaseCost`/`totalFinalCost` are written
 * only when every WORK_ITEM in the Working Draft is priced. While even one
 * line is still unpriced they are set to NULL — the columns are nullable for
 * exactly this, and it is the same "no authoritative total yet" fact the read
 * path already reports through `hasIncompletePricing`/`incompletePricingRecap`.
 *
 * It does NOT withhold THIS line's own money, and it must not: an unpriced
 * sibling is a fact about that sibling, not about this line. Refusing here
 * used to make a whole section unpriceable the moment one row was genuinely
 * unresolvable — every healthy row was destroyed by one bad fact, which is the
 * exact inversion of the locked law:
 *
 *   FAIL-CLOSED ON FACT. CONTINUE SAFELY ON WORKFLOW.
 *   resolve automatically -> isolate unresolved -> continue safely ->
 *   consolidate attention -> human decision if needed.
 *
 * A row whose OWN evidence is incomplete still fails closed, loudly, above:
 * UNRESOLVED_RESOURCE, MISSING_ADAPTED_PRICE and every Cost Kernel refusal are
 * untouched. Only the sibling's fact stops being this line's verdict.
 */
@Injectable()
export class RabKernelPersistenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rabLifecyclePolicy: RabLifecyclePolicyService,
    private readonly eligibility: BasicPriceEligibilityPolicy,
  ) {}

  async persistBoqItemCalculation(
    params: PersistBoqItemCalculationParams,
  ): Promise<PersistBoqItemCalculationResult> {
    const calculationAsOfDate = parseDateOnlyUtc(
      params.calculationAsOfDateRaw,
      'calculationAsOfDate',
    );

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock the Project row — the same serialization point saveDraftBoq
      // and initiateSetup already use for every RAB-draft-touching write.
      const lockedProject = await tx.$queryRaw<
        Array<{ id: string; status: string; workspaceId: string | null }>
      >(
        Prisma.sql`SELECT "id", "status", "workspaceId" FROM "projects" WHERE "id" = ${params.projectId}::uuid FOR UPDATE`,
      );
      const project = lockedProject[0];
      if (!project) {
        throw new NotFoundException(
          RAB_KERNEL_PERSISTENCE_REASON.PROJECT_NOT_FOUND,
        );
      }

      // 2. Tenant scope: the trusted workspaceId from ProjectAccessGuard must
      // match the locked row. A mismatch is indistinguishable from "not
      // found" — never a distinguishable 403 that would leak existence.
      if (project.workspaceId !== params.workspaceId) {
        throw new NotFoundException(
          RAB_KERNEL_PERSISTENCE_REASON.PROJECT_NOT_FOUND,
        );
      }

      // 3. RabLifecyclePolicyService — the single canonical lifecycle
      // authority. No parallel guard is introduced here.
      const capability = await this.rabLifecyclePolicy.evaluateInTransaction(
        tx,
        params.projectId,
        project.status as ProjectStatus,
      );
      if (!capability.canEditDraft) {
        throw new ConflictException(capability.reasonCode);
      }

      // 4. Working Draft + the target WORK_ITEM — DRAFT only, never a
      // baseline/approved structure.
      const structure = await tx.boqStructure.findFirst({
        where: {
          projectId: params.projectId,
          name: WORKING_DRAFT_STRUCTURE_NAME,
          status: 'DRAFT',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!structure) {
        throw new NotFoundException(
          RAB_KERNEL_PERSISTENCE_REASON.WORKING_DRAFT_NOT_FOUND,
        );
      }

      const item = await tx.boqItem.findFirst({
        where: { id: params.boqItemId, boqStructureId: structure.id },
      });
      if (!item) {
        throw new NotFoundException(
          RAB_KERNEL_PERSISTENCE_REASON.BOQ_ITEM_NOT_FOUND,
        );
      }
      if (item.itemType !== 'WORK_ITEM') {
        throw new ConflictException(COST_CALCULATION_REASON.BOQ_ITEM_NOT_WORK_ITEM);
      }
      if (!item.ahspVersionId) {
        throw new ConflictException(COST_CALCULATION_REASON.MISSING_AHSP_VERSION);
      }
      if (!item.workingOccurrenceId) {
        throw new ConflictException(
          RAB_KERNEL_PERSISTENCE_REASON.OCCURRENCE_NOT_FOUND,
        );
      }

      const ahspVersion = await tx.aHSPVersion.findUnique({
        where: { id: item.ahspVersionId },
      });
      if (!ahspVersion || ahspVersion.status === 'SUPERSEDED') {
        throw new ConflictException('AHSP_VERSION_NOT_ELIGIBLE');
      }

      // 5. Current ProjectAhspOccurrence + resource resolutions — tenant- and
      // AHSP-version-scoped exactly like CostKernelService's own read path.
      const occurrence = await tx.projectAhspOccurrence.findFirst({
        where: {
          id: item.workingOccurrenceId,
          projectId: params.projectId,
          workspaceId: params.workspaceId,
          ahspVersionId: item.ahspVersionId,
        },
        include: { resourceResolutions: { include: { originalResource: true } } },
      });
      if (!occurrence) {
        throw new ConflictException(
          RAB_KERNEL_PERSISTENCE_REASON.OCCURRENCE_NOT_FOUND,
        );
      }
      if (!occurrence.referenceRegionId) {
        throw new ConflictException('REFERENCE_REGION_REQUIRED');
      }
      if (
        !occurrence.businessPricingAsOfDate ||
        occurrence.businessPricingAsOfDate.getTime() !==
          calculationAsOfDate.getTime()
      ) {
        throw new ConflictException('OCCURRENCE_PRICING_DATE_MISMATCH');
      }
      if (occurrence.resourceResolutions.length === 0) {
        throw new ConflictException(
          RAB_KERNEL_PERSISTENCE_REASON.EMPTY_RESOURCES,
        );
      }

      // 6-8. Every resolution must be RESOLVED; its selected BasicPrice is
      // re-read fresh (never trusted from the frozen resolution snapshot),
      // must still be publicly eligible, must satisfy
      // effectiveDate <= asOf AND (validUntil IS NULL OR validUntil >= asOf),
      // must not have drifted from the value the resolution adapted, and
      // must be traceable end-to-end through the real publication chain
      // (§3.3) — never inferred from status fields alone.
      const resources: CostKernelResourceInput[] = [];
      for (const resolution of occurrence.resourceResolutions) {
        if (resolution.status !== 'RESOLVED') {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.UNRESOLVED_RESOURCE,
          );
        }
        if (
          !resolution.selectedBasicPriceId ||
          resolution.adaptedPriceValue === null ||
          resolution.sourcePriceValue === null
        ) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.MISSING_ADAPTED_PRICE,
          );
        }

        // §PR57 Gap A: a RESOLVED resolution must carry the exact
        // ResourceCatalog identity it was resolved against — checked before
        // the BasicPrice is even re-read, since a null identity can never
        // legitimately match anything.
        if (!resolution.resourceCatalogId) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_RESOURCE_IDENTITY_MISMATCH,
          );
        }

        const basicPrice = await tx.basicPrice.findFirst({
          where: {
            id: resolution.selectedBasicPriceId,
            // RM-03C: same shared predicate as the picker and the AHSP
            // re-verification — publicly published catalog price, OR this
            // workspace's own private price. Never a widened single predicate.
            ...this.eligibility.usableWhere(params.workspaceId),
          },
          select: {
            id: true,
            value: true,
            effectiveDate: true,
            validUntil: true,
            assetScope: true,
            sourceSubmissionId: true,
            sourceImportRowId: true,
            // BP-CAT-01B — a shared catalog row carries its provenance through
            // the price it was promoted from, so the chain to prove is chosen
            // from this column too.
            promotedFromBasicPriceId: true,
            resourceId: true,
            workspaceId: true,
            organizationId: true,
            regionId: true,
          },
        });
        if (!basicPrice) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.SELECTED_BASIC_PRICE_NOT_ELIGIBLE,
          );
        }
        if (basicPrice.regionId !== occurrence.referenceRegionId) {
          throw new ConflictException('BASIC_PRICE_REGION_MISMATCH');
        }
        // §PR57 Gap A: exact id equality only — never a name/fuzzy match,
        // never a remap. A resolution may only ever consume a price
        // actually priced for the same ResourceCatalog row.
        if (basicPrice.resourceId !== resolution.resourceCatalogId) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_RESOURCE_IDENTITY_MISMATCH,
          );
        }
        if (basicPrice.effectiveDate.getTime() > calculationAsOfDate.getTime()) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_NOT_YET_EFFECTIVE,
          );
        }
        if (
          basicPrice.validUntil !== null &&
          basicPrice.validUntil.getTime() < calculationAsOfDate.getTime()
        ) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_EXPIRED,
          );
        }
        if (!basicPrice.value.equals(resolution.sourcePriceValue)) {
          throw new ConflictException(
            RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_VALUE_DRIFTED,
          );
        }

        await this.assertTraceableProvenance(tx, basicPrice, params.workspaceId);

        resources.push({
          ahspResourceId: resolution.ahspResourceId,
          resolutionId: resolution.id,
          status: resolution.status,
          ahspVersionId: resolution.originalResource.ahspVersionId,
          coefficient: resolution.ahspCoefficient.toString(),
          adaptedPriceValue: resolution.adaptedPriceValue.toString(),
        });
      }

      // 9. The existing Cost Kernel, unchanged — exact Decimal, no
      // intermediate rounding.
      const kernelResult = calculateCostKernel({
        boqItemId: item.id,
        ahspVersionId: item.ahspVersionId,
        occurrenceId: occurrence.id,
        occurrenceCount: 1,
        itemType: item.itemType,
        volume: item.quantity.toString(),
        boqUnit: item.unit,
        outputUnit: ahspVersion?.outputUnit ?? null,
        ownershipMatches: true,
        resources,
      });
      if (kernelResult.status !== COST_CALCULATION_STATUS.CALCULATED) {
        throw new ConflictException(kernelResult.reason);
      }

      const unitPrice = toMoneyDecimal2(kernelResult.ahspUnitPrice);
      const lineTotal = toMoneyDecimal2(kernelResult.lineTotal);
      const calculatedAt = new Date();

      // §5.1 — projected completeness, decided BEFORE any monetary write.
      // Read every other WORK_ITEM row and judge the draft as though this
      // line's result were already applied. The answer decides ONE thing:
      // whether the RAB total may be stated at all. It never decides whether
      // this line's own, independently proven money may be written — see the
      // class comment: fail closed on the fact, continue safely on the flow.
      const otherItems = await tx.boqItem.findMany({
        where: { boqStructureId: structure.id, id: { not: item.id } },
        select: { itemType: true, unitPrice: true },
      });
      const anyOtherIncomplete = otherItems.some(
        (row) => row.itemType === 'WORK_ITEM' && row.unitPrice === null,
      );

      // 10-11. Persist server unitPrice/lineTotal + SERVER_COST_KERNEL
      // provenance. OD-04 rounding (scale 2, ROUND_HALF_UP) happens exactly
      // once, here, at the canonical persistence boundary.
      await tx.boqItem.update({
        where: { id: item.id },
        data: {
          unitPrice,
          lineTotal,
          priceOrigin: 'SERVER_COST_KERNEL',
          calculationOccurrenceId: occurrence.id,
          calculationAsOfDate,
          calculatedAt,
          calculationPolicyVersion: RAB_KERNEL_PERSISTENCE_POLICY,
          workingOccurrenceId: null,
        },
      });

      // 12-13. Re-read the full current row set (including this line's own
      // just-written unitPrice/lineTotal) and state the RAB total using the
      // same canonical recap formula saveDraftBoq already uses — but ONLY if
      // every WORK_ITEM is now priced.
      //
      // If any sibling is still unpriced the total is written as NULL rather
      // than as a number derived from part of the section. A partial sum is
      // not a smaller truth, it is a false one: it would read as the cost of
      // the work while silently omitting whatever could not be proven. NULL is
      // the honest answer the read path already speaks
      // (`incompletePricingRecap`), and the columns are nullable for it.
      const subtotal = await this.computeSubtotal(tx, structure.id);

      const existingRab = await tx.rabDocument.findFirst({
        where: {
          projectId: params.projectId,
          boqStructureId: structure.id,
          status: 'DRAFT',
        },
        orderBy: { updatedAt: 'desc' },
      });

      const recap = buildDraftRecap(
        subtotal,
        existingRab?.profitPercent,
        existingRab?.taxPercent,
      );
      const rabData = {
        overheadPercent: new Prisma.Decimal(0),
        profitPercent: toMoneyDecimal2(recap.marginPercent),
        taxPercent: toMoneyDecimal2(recap.taxPercent),
        totalBaseCost: anyOtherIncomplete
          ? null
          : toMoneyDecimal2(recap.subtotal),
        totalFinalCost: anyOtherIncomplete
          ? null
          : toMoneyDecimal2(recap.grandTotal),
      };

      const updated = await tx.rabDocument.updateMany({
        where: {
          projectId: params.projectId,
          boqStructureId: structure.id,
          status: 'DRAFT',
        },
        data: rabData,
      });
      if (updated.count === 0) {
        await tx.rabDocument.create({
          data: {
            projectId: params.projectId,
            boqStructureId: structure.id,
            name: 'Working Draft RAB',
            version: 1,
            status: 'DRAFT',
            ...rabData,
          },
        });
      }

      // 14. Any failure above throws inside this callback — Prisma rolls the
      // whole interactive transaction back, so no step 10-13 write is ever
      // partially committed.
      return {
        boqItemId: item.id,
        unitPrice: unitPrice.toFixed(2),
        lineTotal: lineTotal.toFixed(2),
        priceOrigin: 'SERVER_COST_KERNEL' as const,
        calculationOccurrenceId: occurrence.id,
        calculationAsOfDate: calculationAsOfDate.toISOString().slice(0, 10),
        calculatedAt: calculatedAt.toISOString(),
        calculationPolicyVersion: RAB_KERNEL_PERSISTENCE_POLICY,
        rabTotals: anyOtherIncomplete
          ? {
              // This line IS priced and persisted; the SECTION is not yet
              // whole. The caller is told both facts, and neither is dressed
              // up as the other.
              pricingStatus: 'INCOMPLETE' as const,
              totalBaseCost: null,
              totalFinalCost: null,
            }
          : {
              pricingStatus: 'COMPLETE' as const,
              totalBaseCost: rabData.totalBaseCost!.toFixed(2),
              totalFinalCost: rabData.totalFinalCost!.toFixed(2),
            },
      };
    });
  }

  /** Subtotal re-read fresh after this line's own update, over the full current row set. */
  private async computeSubtotal(
    tx: Prisma.TransactionClient,
    boqStructureId: string,
  ): Promise<Prisma.Decimal> {
    const allItems = await tx.boqItem.findMany({
      where: { boqStructureId },
      select: { itemType: true, lineTotal: true },
    });
    return allItems.reduce(
      (sum, row) =>
        sum.add(row.itemType === 'WORK_ITEM' && row.lineTotal ? row.lineTotal : 0),
      new Prisma.Decimal(0),
    );
  }

  /**
   * §3.3 / §PR57 Gap B — reuses the exact relations
   * BasicPricePublicationService.publish() already relies on (PriceSubmission
   * -> PriceSubmissionReview -> an ACCEPT PriceSubmissionReviewDecision ->
   * User -> WorkspaceMembership for the verifier; BasicPricePublicationAudit
   * for the publisher). No second lifecycle implementation, no inference
   * from status fields alone, and no re-authorization of a historical
   * actor's CURRENT status — authorization was enforced once, at
   * publication time; a publisher/verifier who has since been suspended or
   * deactivated does not retroactively invalidate a valid past publication.
   * Every link in the chain is bound by exact id/workspace/organization
   * equality, never inferred. Any missing or mismatched link fails closed
   * with one stable reason.
   */
  private async assertTraceableProvenance(
    tx: Prisma.TransactionClient,
    basicPrice: {
      id: string;
      assetScope: BasicPriceAssetScope;
      sourceSubmissionId: string | null;
      sourceImportRowId: string | null;
      promotedFromBasicPriceId?: string | null;
      resourceId: string;
      workspaceId: string | null;
      organizationId: string | null;
      regionId: string | null;
    },
    trustedWorkspaceId: string,
  ): Promise<void> {
    const INCOMPLETE = RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE;

    // RM-03C: which chain must be proved is decided by the row's OWN
    // ownership column — never by the absence of a submission id, which would
    // be an inference from a hole rather than from a fact.
    if (basicPrice.assetScope === BasicPriceAssetScope.WORKSPACE_PRIVATE) {
      return this.assertTraceablePrivateProvenance(
        tx,
        basicPrice,
        trustedWorkspaceId,
      );
    }

    // BP-CAT-01B — A SHARED CATALOG ROW'S PROVENANCE IS ITS ORIGIN'S PROVENANCE.
    //
    // A promoted row deliberately holds no `sourceSubmissionId` of its own:
    // that column is UNIQUE and still belongs to the price it was promoted from,
    // and `sourceImportRowId` may never sit on a catalog row at all. Without
    // this branch such a row would pass canonical eligibility and then be
    // refused here — selectable but unusable, which is worse than not being
    // offered. So the chain is proved against the ORIGIN, which owns the real
    // submission, the real ACCEPT decision and the real PUBLISH audit.
    //
    // This is not a second lifecycle: it re-enters the SAME catalog chain below,
    // one level down, bound to the origin's own workspace and organization. The
    // origin is re-read rather than trusted, and a lineage pointing at a missing
    // or private row fails closed like any other broken link. The recursion is
    // bounded to exactly one hop because `basic_prices_promoted_row_is_shared_check`
    // makes a promoted row's own lineage the only one it can carry, and a
    // promoted row can never itself be an origin that is workspace-owned.
    if (basicPrice.promotedFromBasicPriceId) {
      const origin = await tx.basicPrice.findUnique({
        where: { id: basicPrice.promotedFromBasicPriceId },
        select: {
          id: true,
          assetScope: true,
          sourceSubmissionId: true,
          sourceImportRowId: true,
          resourceId: true,
          workspaceId: true,
          organizationId: true,
          regionId: true,
        },
      });
      // The promoted row must genuinely restate its origin's facts. An origin
      // that names a different resource or region than the row standing on it
      // is not evidence for that row, however intact its own chain is.
      if (
        !origin ||
        origin.assetScope !== BasicPriceAssetScope.SIMPROK_CATALOG ||
        origin.workspaceId === null ||
        origin.resourceId !== basicPrice.resourceId ||
        origin.regionId !== basicPrice.regionId
      ) {
        throw new ConflictException(INCOMPLETE);
      }
      return this.assertTraceableProvenance(tx, origin, origin.workspaceId);
    }

    if (basicPrice.sourceSubmissionId === null) {
      throw new ConflictException(INCOMPLETE);
    }
    const sourceSubmissionId: string = basicPrice.sourceSubmissionId;

    const submission = await tx.priceSubmission.findFirst({
      where: { id: sourceSubmissionId },
      include: {
        review: {
          include: { decisions: { where: { action: 'ACCEPT' } } },
        },
      },
    });
    if (!submission) {
      throw new ConflictException(INCOMPLETE);
    }
    // Source-chain binding: the submission must genuinely be FOR this exact
    // resource, workspace, and organization — matching ids alone is not
    // enough to prove the chain, since an id match says nothing about
    // whether the submission was ever actually for the same resource/tenant.
    if (
      submission.resourceId !== basicPrice.resourceId ||
      submission.workspaceId !== basicPrice.workspaceId ||
      submission.organizationId !== basicPrice.organizationId
    ) {
      throw new ConflictException(INCOMPLETE);
    }

    const review = submission.review;
    if (
      !review ||
      review.workspaceId !== basicPrice.workspaceId ||
      review.organizationId !== basicPrice.organizationId
    ) {
      throw new ConflictException(INCOMPLETE);
    }

    const acceptDecisions = review.decisions ?? [];
    if (acceptDecisions.length !== 1) {
      throw new ConflictException(INCOMPLETE);
    }

    const verifierUser = await tx.user.findFirst({
      where: { id: acceptDecisions[0].decidedByUserId },
      select: { membership: { select: { accountId: true, workspaceId: true } } },
    });
    const verifierAccountId = verifierUser?.membership?.accountId;
    if (
      !verifierAccountId ||
      verifierUser.membership.workspaceId !== submission.workspaceId
    ) {
      throw new ConflictException(INCOMPLETE);
    }

    // Publication audit + its Account FK (schema-enforced — see the Gate-2A
    // migration's fk_basic_price_publication_audit_actor) belongs to this
    // exact BasicPrice. No re-check of the publisher Account's CURRENT
    // status: that was BasicPricePublicationService's job at publish time,
    // not this consumption-time read's job to re-litigate.
    const publicationAudit = await tx.basicPricePublicationAudit.findFirst({
      where: { basicPriceId: basicPrice.id, action: 'PUBLISH' },
      orderBy: { createdAt: 'desc' },
    });
    const publisherAccountId = publicationAudit?.actorAccountId;
    if (!publisherAccountId) {
      throw new ConflictException(INCOMPLETE);
    }

    if (verifierAccountId === publisherAccountId) {
      throw new ConflictException(INCOMPLETE);
    }
  }

  /**
   * RM-03C §3.3 for WORKSPACE_PRIVATE prices.
   *
   * A private price is usable WITHOUT a verifier, a publisher, or a second
   * human — so demanding the catalog chain here would make the Owner law
   * unimplementable. What it must still prove is that the number is TRACEABLE:
   * every private price is materialized from a human-resolved
   * BasicPriceImportRow, which carries the real workbook evidence
   * (SHA-256, sheet, row, cell addresses, raw cell value) and belongs to a
   * batch that carries the real source identity (vendor/organization, region,
   * effective date). Same provenance subsystem as the catalog chain, one link
   * shorter, because there is no PriceSubmission in between.
   *
   * Every link is bound by exact id/workspace/organization/region equality,
   * never inferred, and the whole chain fails closed with the SAME single
   * reason code as the catalog chain — a consumer must not be able to tell
   * from the failure which asset family a price belonged to.
   *
   * No re-authorization of the resolving human's CURRENT status: authority was
   * exercised once, when the row was resolved and kept private. A member who
   * has since left does not retroactively unmake a price their workspace has
   * been using — the same principle the catalog chain applies to a historical
   * verifier/publisher.
   */
  private async assertTraceablePrivateProvenance(
    tx: Prisma.TransactionClient,
    basicPrice: {
      id: string;
      sourceSubmissionId: string | null;
      sourceImportRowId: string | null;
      resourceId: string;
      workspaceId: string | null;
      organizationId: string | null;
      regionId: string | null;
    },
    trustedWorkspaceId: string,
  ): Promise<void> {
    const INCOMPLETE = RAB_KERNEL_PERSISTENCE_REASON.BASIC_PRICE_PROVENANCE_INCOMPLETE;

    // Ownership, re-proved at consumption time against the trusted server
    // context rather than trusted from the row that the query just returned.
    if (
      basicPrice.workspaceId === null ||
      basicPrice.workspaceId !== trustedWorkspaceId
    ) {
      throw new ConflictException(INCOMPLETE);
    }
    // A private asset is never submission-born. If it carried one it would be
    // sitting in the national curation queue, which is precisely what
    // "private" must not mean.
    if (basicPrice.sourceSubmissionId !== null) {
      throw new ConflictException(INCOMPLETE);
    }
    if (basicPrice.sourceImportRowId === null) {
      throw new ConflictException(INCOMPLETE);
    }

    const importRow = await tx.basicPriceImportRow.findFirst({
      where: { id: basicPrice.sourceImportRowId },
      select: {
        resourceCatalogId: true,
        resolutionStatus: true,
        batch: {
          select: {
            workspaceId: true,
            organizationId: true,
            regionId: true,
            effectiveDate: true,
            sourceOrigin: true,
            sourceSha256: true,
          },
        },
      },
    });
    if (!importRow) {
      throw new ConflictException(INCOMPLETE);
    }

    // The evidence must genuinely be evidence FOR THIS price: same resource
    // identity, same tenant, same region. An id match alone says nothing about
    // whether the row was ever about the same thing.
    if (importRow.resourceCatalogId !== basicPrice.resourceId) {
      throw new ConflictException(INCOMPLETE);
    }
    if (
      importRow.resolutionStatus !== BasicPriceImportRowResolutionStatus.RESOLVED
    ) {
      throw new ConflictException(INCOMPLETE);
    }
    if (
      importRow.batch.workspaceId !== basicPrice.workspaceId ||
      importRow.batch.organizationId !== basicPrice.organizationId ||
      importRow.batch.regionId !== basicPrice.regionId
    ) {
      throw new ConflictException(INCOMPLETE);
    }
    // The batch must carry the real workbook and the real source identity.
    // SIMPROK never invents a source, a region, or an effective date; an
    // evidence record missing any of them is not evidence.
    if (
      !importRow.batch.sourceSha256 ||
      !importRow.batch.sourceOrigin ||
      importRow.batch.effectiveDate === null
    ) {
      throw new ConflictException(INCOMPLETE);
    }
  }
}
