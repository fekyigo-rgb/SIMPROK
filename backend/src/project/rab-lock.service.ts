import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toDecimalString2 } from '../common/money';
import { buildEligibleAhspVersionWhere } from '../project-ahsp/ahsp-eligibility.policy';
import {
  AhspResourceResolutionOrchestrator,
  type ResolutionCreate,
} from '../project-ahsp/ahsp-resource-resolution.orchestrator';
import {
  PERSISTED_CALCULATION_STATUS,
} from './persisted-calculation.contracts';
import { PersistedCalculationService } from './persisted-calculation.service';
import {
  RAB_STATUS,
  WORKING_DRAFT_STRUCTURE_NAME,
} from './rab-lifecycle-policy.service';
import {
  PRELOCK_FINDING,
  RAB_LOCK_POLICY,
  RAB_LOCK_REASON,
  type PrelockLineFinding,
  type RabLockResult,
} from './rab-lock.contracts';

export interface LockRabDraftInput {
  projectId: string;
  workspaceId: string;
  actorAccountId: string;
}

/** The three columns that together are one lock fact — all or nothing. */
interface LockFactColumns {
  lockedAt: Date | null;
  lockedByAccountId: string | null;
  lockedFromStatus: string | null;
}

/**
 * A lock fact is whole only if it can answer all three questions AND the
 * transition it claims is one v1 can actually perform. LOCK v1 only ever
 * transitions from DRAFT, so a row claiming any other origin is not a freeze
 * this code produced and is not one it will vouch for.
 */
const isWholeLockFact = (row: LockFactColumns): boolean =>
  row.lockedAt !== null &&
  row.lockedByAccountId !== null &&
  row.lockedFromStatus === RAB_STATUS.DRAFT;

/**
 * Describe an already-frozen RAB from the row itself. Callers must have proved
 * `isWholeLockFact` first; the non-null assertions below are safe precisely
 * because nothing here is allowed to substitute a value of its own.
 */
const describeLockedRab = (
  row: LockFactColumns & {
    id: string;
    totalBaseCost: Prisma.Decimal | null;
    totalFinalCost: Prisma.Decimal | null;
  },
  projectId: string,
  workItemCount: number,
): RabLockResult => ({
  status: RAB_STATUS.LOCKED,
  changed: false,
  rabDocumentId: row.id,
  projectId,
  lockedAt: row.lockedAt!.toISOString(),
  lockedByAccountId: row.lockedByAccountId!,
  lockedFromStatus: row.lockedFromStatus!,
  frozen: {
    workItemCount,
    totalBaseCost: row.totalBaseCost === null ? null : toDecimalString2(row.totalBaseCost),
    totalFinalCost: row.totalFinalCost === null ? null : toDecimalString2(row.totalFinalCost),
  },
  lockPolicy: RAB_LOCK_POLICY,
});

/**
 * RM-03D1 — DRAFT → LOCKED, on the SAME RabDocument.
 *
 * LOCK is deliberately the dumbest command in the RAB domain. It creates
 * nothing, copies nothing, recalculates nothing and repairs nothing. It asks
 * the authorities that already exist whether the truth it is about to freeze
 * is still current, and then either flips one status field or refuses.
 *
 * THE TRAVELOKA LAW. A price you were shown earlier is not frozen until the
 * moment you commit. So the revalidation runs INSIDE the same transaction
 * that holds the Project row FOR UPDATE — the identical serialization point
 * every RAB mutator already takes before writing. There is therefore no
 * window in which revalidation passes, another draft write lands, and the
 * lock then freezes something nobody validated.
 *
 * WHY LOCK NEVER REFRESHES. If revalidation finds drift, this command refuses
 * and says what moved. Recalculating on the user's behalf inside a freeze
 * would mean the number they confirmed is not the number that got frozen —
 * which is exactly the harm the pre-lock gate exists to prevent. Refreshing a
 * draft is a normal DRAFT action, and it stays one.
 */
@Injectable()
export class RabLockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly persistedCalculation: PersistedCalculationService,
    private readonly resolution: AhspResourceResolutionOrchestrator,
  ) {}

  /**
   * Ask the shared resolution authority what it would decide NOW for this
   * line's own pricing date, and compare it to what is frozen.
   *
   * Compares IDENTITY first, not just the amount: a different eligible price
   * that happens to carry the same number is still a different basis, and a
   * frozen RAB should name the price it actually stands on. The adapted
   * monetary basis is compared too, because the same price row can adapt
   * differently if unit law has moved underneath it.
   *
   * A price that becomes effective AFTER this line's as-of date is simply not
   * a candidate — the authority's own predicate excludes it — so a newer row
   * in the database can never manufacture drift.
   */
  private async findBasicPriceDrift(
    tx: any,
    line: {
      workspaceId: string;
      projectId: string;
      boqItemId: string;
      wbsCode: string;
      name: string;
      asOf: Date | null;
    },
  ): Promise<PrelockLineFinding[]> {
    const where = { boqItemId: line.boqItemId, wbsCode: line.wbsCode, name: line.name };
    if (line.asOf === null) return [];

    const occurrence = await tx.projectAhspOccurrence.findFirst({
      where: { projectId: line.projectId, workspaceId: line.workspaceId },
      include: {
        ahspVersion: { include: { resources: { orderBy: { id: 'asc' } } } },
        resourceResolutions: { orderBy: { id: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    // No occurrence to compare against is not this gate's finding to raise —
    // the snapshot re-proof above already refuses a line whose provenance is
    // missing, and duplicating that refusal here would report one defect twice.
    if (!occurrence || occurrence.ahspVersion === null) return [];

    const current: ResolutionCreate[] = await this.resolution.resolveVersionResources(tx, {
      workspaceId: line.workspaceId,
      projectId: line.projectId,
      referenceRegionId: occurrence.referenceRegionId,
      asOf: line.asOf,
      version: occurrence.ahspVersion,
    });

    const currentByResource = new Map(
      current.map((row) => [row.ahspResourceId, row]),
    );
    const findings: PrelockLineFinding[] = [];

    for (const frozen of occurrence.resourceResolutions) {
      const now = currentByResource.get(frozen.ahspResourceId);
      const resourceLabel = frozen.rawAhspResourceRef;

      // The authority can no longer decide at all — ambiguity or a missing
      // price. SIMPROK does not choose on the Owner's behalf inside a freeze.
      if (!now || now.status === 'NEEDS_REVIEW') {
        findings.push({
          ...where,
          finding: PRELOCK_FINDING.BASIC_PRICE_AMBIGUOUS,
          detail: resourceLabel,
        });
        continue;
      }
      if (now.status === 'UNRESOLVED' || now.selectedBasicPriceId == null) {
        findings.push({
          ...where,
          finding: PRELOCK_FINDING.BASIC_PRICE_MISSING,
          detail: resourceLabel,
        });
        continue;
      }
      if (frozen.selectedBasicPriceId === null) continue;

      if (now.selectedBasicPriceId !== frozen.selectedBasicPriceId) {
        findings.push({
          ...where,
          finding: PRELOCK_FINDING.BASIC_PRICE_SELECTION_CHANGED,
          detail: resourceLabel,
          storedUnitPrice:
            frozen.adaptedPriceValue === null
              ? null
              : toDecimalString2(frozen.adaptedPriceValue),
          currentUnitPrice:
            now.adaptedPriceValue == null
              ? null
              : toDecimalString2(String(now.adaptedPriceValue)),
        });
        continue;
      }

      // Same row, but the money it adapts to has moved — the basis is no
      // longer what was frozen even though its identity is unchanged.
      const frozenAdapted =
        frozen.adaptedPriceValue === null ? null : toDecimalString2(frozen.adaptedPriceValue);
      const currentAdapted =
        now.adaptedPriceValue == null ? null : toDecimalString2(String(now.adaptedPriceValue));
      if (frozenAdapted !== currentAdapted) {
        findings.push({
          ...where,
          finding: PRELOCK_FINDING.BASIC_PRICE_NO_LONGER_ELIGIBLE,
          detail: resourceLabel,
          storedUnitPrice: frozenAdapted,
          currentUnitPrice: currentAdapted,
        });
      }
    }

    return findings;
  }

  async lockWorkingDraft(input: LockRabDraftInput): Promise<RabLockResult> {
    const { projectId, workspaceId, actorAccountId } = input;

    const refuse = (
      reason: (typeof RAB_LOCK_REASON)[keyof typeof RAB_LOCK_REASON],
      findings?: PrelockLineFinding[],
    ): RabLockResult => ({
      status: 'REFUSED',
      reason,
      ...(findings ? { findings } : {}),
      lockPolicy: RAB_LOCK_POLICY,
    });

    return this.prisma.$transaction(async (tx) => {
      // 1. THE serialization point. Every RAB mutator takes this same lock
      //    before writing, so from here to COMMIT no draft write can land.
      const lockedProject = await tx.$queryRaw<
        Array<{ id: string; workspaceId: string | null }>
      >(
        Prisma.sql`SELECT "id", "workspaceId" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
      );
      const project = lockedProject[0];
      // A foreign project is "not found", never "forbidden" — the same shape
      // the rest of the domain uses, so this never confirms ids the caller
      // cannot see.
      if (!project || project.workspaceId !== workspaceId) {
        return refuse(RAB_LOCK_REASON.PROJECT_NOT_FOUND);
      }

      // 2. The Working Draft, re-read under the lock rather than trusted from
      //    any earlier read.
      const structures = await tx.boqStructure.findMany({
        where: { projectId, status: RAB_STATUS.DRAFT, name: WORKING_DRAFT_STRUCTURE_NAME },
        select: { id: true },
      });
      if (structures.length === 0) return refuse(RAB_LOCK_REASON.WORKING_DRAFT_NOT_FOUND);
      if (structures.length > 1) return refuse(RAB_LOCK_REASON.AMBIGUOUS_WORKING_DRAFT);
      const structureId = structures[0].id;

      const rabDocuments = await tx.rabDocument.findMany({
        where: { projectId, boqStructureId: structureId },
        orderBy: { createdAt: 'asc' },
      });
      if (rabDocuments.length === 0) return refuse(RAB_LOCK_REASON.RAB_DOCUMENT_NOT_FOUND);
      if (rabDocuments.length > 1) return refuse(RAB_LOCK_REASON.AMBIGUOUS_WORKING_DRAFT);
      const rab = rabDocuments[0];

      const workItems = await tx.boqItem.findMany({
        where: { boqStructureId: structureId, itemType: 'WORK_ITEM' },
        select: {
          id: true,
          wbsCode: true,
          name: true,
          priceOrigin: true,
          unitPrice: true,
          lineTotal: true,
          ahspVersionId: true,
          calculationAsOfDate: true,
        },
        orderBy: { sortOrder: 'asc' },
      });

      // 3. IDEMPOTENCY, before any refusal that would contradict it. A second
      //    lock of an already-frozen RAB is a success with changed:false and
      //    writes nothing — no second timestamp, no second actor, no second
      //    audit fact. Re-running a completed step must never look like a
      //    failure, and must never rewrite who froze it.
      if (rab.status === RAB_STATUS.LOCKED) {
        // NEVER FABRICATE A FREEZE. There is deliberately no
        // `lockedAt ?? updatedAt` or `lockedBy ?? currentActor` here: a LOCKED
        // row that cannot say who froze it, when, and from what is an
        // integrity failure, and answering with the current caller and the
        // row's last touch would manufacture a provenance nobody performed.
        // The database CHECK makes this state unreachable; this refuses it
        // anyway, because a constraint proves what the database will accept,
        // not what this process actually read back.
        if (!isWholeLockFact(rab)) {
          return refuse(RAB_LOCK_REASON.RAB_LOCK_PROVENANCE_CORRUPT);
        }
        return describeLockedRab(rab, projectId, workItems.length);
      }

      // Approval is downstream of lock and is never walked back into it.
      if (rab.status === RAB_STATUS.APPROVED) {
        return refuse(RAB_LOCK_REASON.RAB_ALREADY_APPROVED);
      }
      if (rab.status !== RAB_STATUS.DRAFT) {
        return refuse(RAB_LOCK_REASON.RAB_NOT_IN_LOCKABLE_STATE);
      }
      if (workItems.length === 0) {
        return refuse(RAB_LOCK_REASON.RAB_HAS_NO_WORK_ITEM);
      }

      // 4. PRE-LOCK REVALIDATION — existing authorities only.
      const findings: PrelockLineFinding[] = [];

      for (const item of workItems) {
        const where = { boqItemId: item.id, wbsCode: item.wbsCode, name: item.name };

        if (item.priceOrigin === null) {
          findings.push({ ...where, finding: PRELOCK_FINDING.UNPRICED_WORK_ITEM });
          continue;
        }

        // LOCK v1 will not freeze a hand-entered price. There is no kernel
        // provenance to re-prove and no explicit human-confirmation contract
        // yet, so "freeze it as given" would put a number SIMPROK cannot
        // stand behind into a Grade-A frozen RAB. Manual pricing keeps
        // working everywhere else; it just cannot be blessed by this act.
        if (item.priceOrigin !== 'SERVER_COST_KERNEL') {
          findings.push({
            ...where,
            finding: PRELOCK_FINDING.MANUAL_PRICE_REQUIRES_CONFIRMATION,
            storedUnitPrice: item.unitPrice === null ? null : toDecimalString2(item.unitPrice),
            storedLineTotal: item.lineTotal === null ? null : toDecimalString2(item.lineTotal),
          });
          continue;
        }

        // 4a. Is the money still exactly what its own frozen provenance says?
        //     THE existing re-proof authority, run on this transaction.
        const proof = await this.persistedCalculation.getPersistedCalculation(
          item.id,
          projectId,
          workspaceId,
          tx,
        );

        if (proof.status === PERSISTED_CALCULATION_STATUS.FAIL_CLOSED) {
          findings.push({
            ...where,
            finding: PRELOCK_FINDING.CALCULATION_NOT_REPROVABLE,
            detail: proof.reason,
            storedUnitPrice: item.unitPrice === null ? null : toDecimalString2(item.unitPrice),
            storedLineTotal: item.lineTotal === null ? null : toDecimalString2(item.lineTotal),
          });
          continue;
        }

        if (
          proof.status === PERSISTED_CALCULATION_STATUS.MISMATCH ||
          !proof.integrity.unitPriceMatches ||
          !proof.integrity.lineTotalMatches
        ) {
          findings.push({
            ...where,
            finding: PRELOCK_FINDING.CALCULATION_MISMATCH,
            storedUnitPrice: proof.stored.unitPrice,
            currentUnitPrice: proof.recomputed.unitPrice,
            storedLineTotal: proof.stored.lineTotal,
            currentLineTotal: proof.recomputed.lineTotal,
          });
          continue;
        }

        if (!proof.integrity.allResourceCostsReproduced) {
          findings.push({
            ...where,
            finding: PRELOCK_FINDING.RESOURCE_COST_NOT_REPRODUCED,
            storedUnitPrice: proof.stored.unitPrice,
            storedLineTotal: proof.stored.lineTotal,
          });
          continue;
        }

        // 4a-bis. CURRENT RELEVANCE — the second, different question.
        //
        // The re-proof above answers "can this line still reproduce itself from
        // its OWN frozen provenance?". It deliberately never re-reads a Basic
        // Price, so a VERIFIED snapshot says nothing about whether the price
        // basis is still the one SIMPROK would choose. Asking only that
        // question would freeze yesterday's decision while a better-founded
        // price sits eligible in the database.
        //
        // So ask THE resolution authority — the same one that produced the
        // occurrence — what it would decide now, for this line's OWN
        // calculationAsOfDate. Not today's date: re-dating the line would
        // invent drift that the business never experienced.
        const driftFindings = await this.findBasicPriceDrift(tx, {
          workspaceId,
          projectId,
          boqItemId: item.id,
          wbsCode: item.wbsCode,
          name: item.name,
          asOf: item.calculationAsOfDate,
        });
        if (driftFindings.length > 0) {
          findings.push(...driftFindings);
          continue;
        }

        // 4b. Is the AHSP this line is priced against STILL the eligible one
        //     for its own lawful as-of date? Eligibility is asked of the one
        //     existing policy — never re-derived from createdAt, and never
        //     evaluated at "today", which would silently re-date the line.
        if (item.ahspVersionId !== null && item.calculationAsOfDate !== null) {
          const stillEligible = await tx.aHSPVersion.findFirst({
            where: {
              ...buildEligibleAhspVersionWhere(workspaceId, item.calculationAsOfDate),
              id: item.ahspVersionId,
            },
            select: { id: true },
          });
          if (!stillEligible) {
            findings.push({
              ...where,
              finding: PRELOCK_FINDING.AHSP_VERSION_NO_LONGER_ELIGIBLE,
              detail: item.ahspVersionId,
            });
          }
        }
      }

      // 4c. The recap must itself be complete. Gate-2A nulls these totals
      //     whenever pricing is incomplete, so a null total IS the signal —
      //     read from the row rather than recomputed here.
      if (rab.totalBaseCost === null || rab.totalFinalCost === null) {
        findings.push({
          boqItemId: '',
          wbsCode: '',
          name: rab.name,
          finding: PRELOCK_FINDING.RAB_PRICING_INCOMPLETE,
        });
      }

      if (findings.length > 0) {
        // Fail closed, state untouched: still DRAFT, still editable, still
        // refreshable through the normal draft path.
        return refuse(RAB_LOCK_REASON.PRELOCK_REVALIDATION_REQUIRED, findings);
      }

      // 5. FREEZE. One status field, plus the provenance of the freeze itself.
      //    Scoped to `status: DRAFT` so that even if two callers somehow reach
      //    this line, only the first can transition — the second updates zero
      //    rows and is resolved by the row lock as an idempotent no-op.
      const lockedAt = new Date();
      const transitioned = await tx.rabDocument.updateMany({
        where: { id: rab.id, status: RAB_STATUS.DRAFT },
        data: {
          status: RAB_STATUS.LOCKED,
          lockedAt,
          lockedByAccountId: actorAccountId,
          lockedFromStatus: RAB_STATUS.DRAFT,
        },
      });

      if (transitioned.count === 0) {
        // Someone else won the race. Report the SETTLED truth — and prove it
        // is a whole, valid freeze first. The loser never invents the winner's
        // identity or timestamp, and never assumes the row it lost to is
        // lawfully LOCKED just because its own update matched nothing.
        const settled = await tx.rabDocument.findUniqueOrThrow({ where: { id: rab.id } });
        if (settled.status !== RAB_STATUS.LOCKED || !isWholeLockFact(settled)) {
          return refuse(RAB_LOCK_REASON.RAB_LOCK_PROVENANCE_CORRUPT);
        }
        return describeLockedRab(settled, projectId, workItems.length);
      }

      return {
        status: RAB_STATUS.LOCKED,
        changed: true,
        rabDocumentId: rab.id,
        projectId,
        lockedAt: lockedAt.toISOString(),
        lockedByAccountId: actorAccountId,
        lockedFromStatus: RAB_STATUS.DRAFT,
        frozen: {
          workItemCount: workItems.length,
          totalBaseCost: rab.totalBaseCost === null ? null : toDecimalString2(rab.totalBaseCost),
          totalFinalCost: rab.totalFinalCost === null ? null : toDecimalString2(rab.totalFinalCost),
        },
        lockPolicy: RAB_LOCK_POLICY,
      };
    });
  }
}
