import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectAccessContext } from '../auth/project-access-policy.service';
import { PERMISSIONS } from '../common/constants/permissions';
import { ProgressAuthorityService } from '../progress/progress-authority.service';
import {
  RAB_STATUS,
  WORKING_DRAFT_STRUCTURE_NAME,
} from './rab-lifecycle-policy.service';
import {
  RAB_APPROVAL_AUTHORITY,
  RAB_APPROVAL_GATE_BLOCKER,
  RAB_APPROVAL_OBJECT_TYPE,
  RAB_APPROVAL_POLICY,
  RAB_APPROVAL_REASON,
  type RabApprovalGate,
  type RabApprovalPositionSummary,
  type RabApprovalResult,
} from './rab-approval.contracts';

export interface ApproveLockedRabInput {
  projectId: string;
  /** Server-derived, from the guard-resolved project context. Never client input. */
  workspaceId: string;
  actorAccountId: string;
  /** The guard-resolved access context — carries membership + project assignment. */
  projectAccess: ProjectAccessContext;
  justification?: string | null;
}

/** The three columns that together are one lock fact — all or nothing. */
interface LockFactColumns {
  lockedAt: Date | null;
  lockedByAccountId: string | null;
  lockedFromStatus: string | null;
}

/**
 * The SAME wholeness standard RabLockService applies. A LOCKED row that
 * cannot answer who/when/from-what is an integrity failure, and approval —
 * which turns that freeze into the project's execution reference — is the
 * last place that should be papered over.
 */
const isWholeLockFact = (row: LockFactColumns): boolean =>
  row.lockedAt !== null &&
  row.lockedByAccountId !== null &&
  row.lockedFromStatus === RAB_STATUS.DRAFT;

/**
 * PAB-03 — LOCKED -> APPROVED, plus the ACTIVE ProjectBaseline, as ONE act.
 *
 * THE BRIDGE, AND ONLY THE BRIDGE. This command owns no governance of its
 * own. It asks components that already exist and already work:
 *
 *   who may approve      -> ProgressAuthorityService.requireWithinTransaction,
 *                           the live Position -> PositionAuthority -> Authority
 *                           resolver (generic: the authority code is a parameter)
 *   which Position, band -> ApprovalMatrix, read through its own columns
 *   what may be approved -> RAB_STATUS, the one RAB lifecycle
 *   what execution reads -> ProjectBaseline, which Progress already consumes
 *
 * It creates no engine, no resolver, no role model and no second lifecycle.
 *
 * SIMPROK WORKS, THE HUMAN GOVERNS. The human performs exactly one decision:
 * approve this RAB. Everything mechanical that follows — resolving the
 * authority, finding the current holder, validating the project and tenant,
 * numbering the baseline version, writing the baseline, binding its lineage
 * to the approved RAB — SIMPROK does by itself, inside the same transaction.
 * The Owner is never asked to create a baseline, re-select the RAB, copy an
 * identifier, or repair a governance relationship SIMPROK already knows.
 *
 * ATOMICITY. Approval and baseline are one transaction on purpose: an
 * APPROVED RAB without a baseline is a plan nothing executes against, and an
 * ACTIVE baseline over an unapproved RAB is execution against something
 * nobody authorized. Either both land or neither does, and on any failure
 * the RAB simply remains LOCKED.
 */
@Injectable()
export class RabApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authority: ProgressAuthorityService,
  ) {}

  /**
   * The project's own RAB, found exactly the way LOCK finds it, so both acts
   * always mean the same document. Locking does not touch the BoqStructure,
   * so a frozen RAB is still reached through its Working Draft structure.
   */
  private async findProjectRab(tx: Prisma.TransactionClient, projectId: string) {
    const structures = await tx.boqStructure.findMany({
      where: {
        projectId,
        status: RAB_STATUS.DRAFT,
        name: WORKING_DRAFT_STRUCTURE_NAME,
      },
      select: { id: true },
    });
    if (structures.length === 0) {
      return { kind: 'WORKING_DRAFT_NOT_FOUND' as const };
    }
    if (structures.length > 1) {
      return { kind: 'AMBIGUOUS_WORKING_DRAFT' as const };
    }

    const rabDocuments = await tx.rabDocument.findMany({
      where: { projectId, boqStructureId: structures[0].id },
      orderBy: { createdAt: 'asc' },
    });
    if (rabDocuments.length === 0) {
      return { kind: 'RAB_DOCUMENT_NOT_FOUND' as const };
    }
    if (rabDocuments.length > 1) {
      return { kind: 'AMBIGUOUS_WORKING_DRAFT' as const };
    }
    return { kind: 'FOUND' as const, rab: rabDocuments[0] };
  }

  /**
   * ApprovalMatrix, read through its own contract and never widened.
   *
   * A workspace with NO active row for this act has configured no extra
   * restriction, and the authority chain alone governs — that is the
   * existing meaning of an absent matrix row everywhere else in SIMPROK,
   * and inventing a "matrix required" rule here would lock out every
   * organization that has not configured one.
   *
   * A workspace WITH rows has said something specific: these Positions, in
   * these value bands. Both halves are obeyed. `priority` orders the rows;
   * a holder matching any applicable row passes.
   */
  private async approvalMatrixVerdict(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    positionId: string,
    totalFinalCost: Prisma.Decimal | null,
  ): Promise<
    | { ok: true }
    | {
        ok: false;
        reason:
          | typeof RAB_APPROVAL_REASON.APPROVAL_MATRIX_POSITION_NOT_AUTHORIZED
          | typeof RAB_APPROVAL_REASON.APPROVAL_MATRIX_VALUE_OUT_OF_BAND
          | typeof RAB_APPROVAL_REASON.RAB_TOTAL_UNKNOWN;
      }
  > {
    const rows = await tx.approvalMatrix.findMany({
      where: {
        workspaceId,
        isActive: true,
        objectType: RAB_APPROVAL_OBJECT_TYPE,
        authority: { code: RAB_APPROVAL_AUTHORITY },
      },
      orderBy: { priority: 'desc' },
      select: { requiredPositionId: true, minValue: true, maxValue: true },
    });
    if (rows.length === 0) return { ok: true };

    const forPosition = rows.filter(
      (row) => row.requiredPositionId === positionId,
    );
    if (forPosition.length === 0) {
      return {
        ok: false,
        reason: RAB_APPROVAL_REASON.APPROVAL_MATRIX_POSITION_NOT_AUTHORIZED,
      };
    }

    // A band is a comparison against a number. Treating an unknown total as
    // zero would slip an unpriced RAB through the lowest band.
    const banded = forPosition.filter(
      (row) => row.minValue !== null || row.maxValue !== null,
    );
    if (banded.length < forPosition.length) return { ok: true };
    if (totalFinalCost === null) {
      return { ok: false, reason: RAB_APPROVAL_REASON.RAB_TOTAL_UNKNOWN };
    }

    const total = new Prisma.Decimal(totalFinalCost as unknown as string);
    const covered = banded.some((row) => {
      if (row.minValue !== null && total.lessThan(new Prisma.Decimal(row.minValue as unknown as string))) {
        return false;
      }
      if (row.maxValue !== null && total.greaterThan(new Prisma.Decimal(row.maxValue as unknown as string))) {
        return false;
      }
      return true;
    });
    return covered
      ? { ok: true }
      : { ok: false, reason: RAB_APPROVAL_REASON.APPROVAL_MATRIX_VALUE_OUT_OF_BAND };
  }

  async approveLockedRab(
    input: ApproveLockedRabInput,
  ): Promise<RabApprovalResult> {
    const { projectId, workspaceId, actorAccountId, projectAccess } = input;
    const justification =
      typeof input.justification === 'string' && input.justification.trim() !== ''
        ? input.justification.trim()
        : null;

    const refuse = (
      reason: (typeof RAB_APPROVAL_REASON)[keyof typeof RAB_APPROVAL_REASON],
      rabStatus?: string,
    ): RabApprovalResult => ({
      status: 'REFUSED',
      reason,
      ...(rabStatus ? { rabStatus } : {}),
      approvalPolicy: RAB_APPROVAL_POLICY,
    });

    return this.prisma.$transaction(async (tx) => {
      // 1. THE serialization point — the identical lock every RAB mutator and
      //    RabLockService already takes. From here to COMMIT no concurrent
      //    lock, edit or approval of this project can land.
      const lockedProject = await tx.$queryRaw<
        Array<{ id: string; workspaceId: string | null }>
      >(
        Prisma.sql`SELECT "id", "workspaceId" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
      );
      const project = lockedProject[0];
      // A foreign project is "not found", never "forbidden" — the same shape
      // the rest of the domain uses, so this never confirms ids the caller
      // cannot see. projectAccess.workspaceId is itself guard-resolved, so
      // this compares two server-derived facts, never a client claim.
      if (
        !project ||
        project.workspaceId !== workspaceId ||
        projectAccess.workspaceId !== workspaceId ||
        projectAccess.projectId !== projectId
      ) {
        return refuse(RAB_APPROVAL_REASON.PROJECT_NOT_FOUND);
      }

      // 2. ORGANIZATIONAL LEGITIMACY, asked of the existing authority chain
      //    and re-asked inside this transaction rather than trusted from any
      //    earlier read. Throws ForbiddenException — DECISION_AUTHORITY_REQUIRED,
      //    DECISION_AUTHORITY_REVOKED or PROJECT_ASSIGNMENT_REVOKED — which
      //    rolls this transaction back with the RAB untouched.
      //
      //    Asked BEFORE any RAB state is reported, so an unauthorized caller
      //    learns nothing about the document they may not act on.
      const holder = await this.authority.requireWithinTransaction(
        tx,
        actorAccountId,
        projectAccess,
        RAB_APPROVAL_AUTHORITY,
      );

      // 3. The RAB, re-read under the project lock.
      const found = await this.findProjectRab(tx, projectId);
      if (found.kind !== 'FOUND') {
        return refuse(RAB_APPROVAL_REASON[found.kind]);
      }
      const rab = found.rab;

      // 4. Baselines for this project, locked so no concurrent approval can
      //    create a second ACTIVE one between this read and the write.
      const baselineRows = await tx.$queryRaw<
        Array<{ id: string; rabDocumentId: string; versionNumber: number; status: string }>
      >(
        Prisma.sql`SELECT "id", "rabDocumentId", "versionNumber", "status"
                     FROM "project_baselines"
                    WHERE "projectId" = ${projectId}::uuid
                    ORDER BY "versionNumber" ASC
                    FOR UPDATE`,
      );
      const activeBaselines = baselineRows.filter((row) => row.status === 'ACTIVE');

      // 5. IDEMPOTENCY, before any refusal that would contradict it. Re-running
      //    a completed approval is a success with changed:false that writes
      //    nothing — no second baseline, no second version, no new approver.
      if (rab.status === RAB_STATUS.APPROVED) {
        const existing = activeBaselines.find(
          (row) => row.rabDocumentId === rab.id,
        );
        if (!existing) {
          // APPROVED with no ACTIVE baseline of its own is exactly the
          // half-state this command exists to make impossible. Report it;
          // never manufacture the missing baseline, which would date an
          // execution reference to today and bury the integrity failure.
          return refuse(RAB_APPROVAL_REASON.APPROVED_WITHOUT_ACTIVE_BASELINE);
        }
        const settled = await tx.projectBaseline.findUniqueOrThrow({
          where: { id: existing.id },
        });
        return {
          status: RAB_STATUS.APPROVED,
          changed: false,
          rabDocumentId: rab.id,
          projectId,
          approvedByPositionId: settled.approvedByPositionId ?? holder.positionId,
          approvedByPositionCode: holder.positionCode,
          authorityCode: RAB_APPROVAL_AUTHORITY,
          baseline: {
            id: settled.id,
            projectId,
            rabDocumentId: settled.rabDocumentId,
            versionNumber: settled.versionNumber,
            status: 'ACTIVE',
            approvedAt: settled.approvedAt.toISOString(),
            approvedByPositionId: settled.approvedByPositionId ?? holder.positionId,
            justification: settled.justification,
          },
          approvalPolicy: RAB_APPROVAL_POLICY,
        };
      }

      // 6. LIFECYCLE. DRAFT is never approvable: locking is a separate,
      //    earlier human act and APPROVE does not perform it for anyone.
      if (rab.status !== RAB_STATUS.LOCKED) {
        return refuse(RAB_APPROVAL_REASON.RAB_NOT_LOCKED, rab.status);
      }
      if (!isWholeLockFact(rab)) {
        return refuse(RAB_APPROVAL_REASON.RAB_LOCK_PROVENANCE_CORRUPT);
      }

      // 7. ONE ACTIVE BASELINE PER PROJECT — enforced here, transactionally,
      //    on rows this transaction already holds locked. No new uniqueness
      //    constraint is added: this is a bridge, not a schema redesign.
      if (activeBaselines.length > 0) {
        return refuse(RAB_APPROVAL_REASON.ACTIVE_BASELINE_EXISTS);
      }

      // 8. The organization's own extra rules, where it configured any.
      const matrix = await this.approvalMatrixVerdict(
        tx,
        workspaceId,
        holder.positionId,
        rab.totalFinalCost,
      );
      if (!matrix.ok) return refuse(matrix.reason);

      // 9. APPROVE. One status field, scoped to `status: LOCKED` so that even
      //    if two callers somehow reach this line only the first transitions.
      const approvedAt = new Date();
      const transitioned = await tx.rabDocument.updateMany({
        where: { id: rab.id, status: RAB_STATUS.LOCKED },
        data: { status: RAB_STATUS.APPROVED },
      });
      if (transitioned.count === 0) {
        // Defensive, and deliberately not guessed at. Holding the project row
        // FOR UPDATE should make this unreachable, so if it happens the row is
        // simply no longer the LOCKED document this transaction read. Report
        // the SETTLED status rather than describing a baseline this
        // transaction did not create; a retry then reads the winner's own
        // commit through the idempotent path above.
        const settled = await tx.rabDocument.findUniqueOrThrow({ where: { id: rab.id } });
        return refuse(RAB_APPROVAL_REASON.RAB_NOT_LOCKED, settled.status);
      }

      // 10. THE BASELINE — the governed approved-plan reference for execution.
      //     It copies no BOQ values, duplicates no totals and recalculates
      //     nothing: it POINTS at the approved RAB, which is why Progress can
      //     read the plan through `baseline.rabDocument.boqStructureId` with
      //     no snapshot engine anywhere.
      const versionNumber =
        baselineRows.reduce((max, row) => Math.max(max, row.versionNumber), 0) + 1;

      const baseline = await tx.projectBaseline.create({
        data: {
          projectId,
          rabDocumentId: rab.id,
          versionNumber,
          status: 'ACTIVE',
          approvedAt,
          // AUTHORITY BELONGS TO POSITION, EXECUTION BELONGS TO USER. The
          // baseline records the Position that held the act — the column the
          // existing schema already provides — so the fact survives the
          // person leaving it.
          approvedByPositionId: holder.positionId,
          justification,
        },
      });

      return {
        status: RAB_STATUS.APPROVED,
        changed: true,
        rabDocumentId: rab.id,
        projectId,
        approvedByPositionId: holder.positionId,
        approvedByPositionCode: holder.positionCode,
        authorityCode: RAB_APPROVAL_AUTHORITY,
        baseline: {
          id: baseline.id,
          projectId,
          rabDocumentId: baseline.rabDocumentId,
          versionNumber: baseline.versionNumber,
          status: 'ACTIVE',
          approvedAt: baseline.approvedAt.toISOString(),
          approvedByPositionId: holder.positionId,
          justification: baseline.justification,
        },
        approvalPolicy: RAB_APPROVAL_POLICY,
      };
    });
  }

  /**
   * READ-ONLY. What the approval door should say to THIS reader, derived from
   * the same existing governance the command consults. It authorizes nothing:
   * the command re-derives every fact under its own lock before writing, so a
   * stale or generous answer here can never approve anything.
   *
   * Its purpose is UI LAW: a reader must never be asked to "choose an
   * approver" or to wire ApprovalMatrix rows by hand. Either SIMPROK can name
   * the legitimate holder from the organization structure, or it says plainly
   * that the organization has not configured one yet.
   */
  async describeApprovalGate(
    projectId: string,
    projectAccess: ProjectAccessContext,
    accountId: string,
    heldPermissions: readonly string[],
  ): Promise<RabApprovalGate> {
    const { workspaceId } = projectAccess;

    const [structures, activeBaselineCount, grants, holder] = await Promise.all([
      this.prisma.boqStructure.findMany({
        where: {
          projectId,
          status: RAB_STATUS.DRAFT,
          name: WORKING_DRAFT_STRUCTURE_NAME,
        },
        select: { id: true },
      }),
      this.prisma.projectBaseline.count({
        where: { projectId, status: 'ACTIVE' },
      }),
      // WHO may approve here, straight from the existing chain — never a
      // hard-coded title, never a guess.
      this.prisma.positionAuthority.findMany({
        where: {
          isActive: true,
          revokedAt: null,
          authority: { code: RAB_APPROVAL_AUTHORITY },
          position: { workspaceId },
        },
        select: { position: { select: { id: true, code: true, name: true } } },
      }),
      this.authority.resolve(accountId, projectAccess, RAB_APPROVAL_AUTHORITY),
    ]);

    const authorizedPositions: RabApprovalPositionSummary[] = grants.map(
      (grant) => grant.position,
    );

    const rab =
      structures.length === 1
        ? await this.prisma.rabDocument.findFirst({
            where: { projectId, boqStructureId: structures[0].id },
            orderBy: { createdAt: 'asc' },
            select: { id: true, status: true },
          })
        : null;

    const gate = (
      canApprove: boolean,
      blocker: RabApprovalGate['blocker'],
    ): RabApprovalGate => ({
      rabStatus: rab?.status ?? null,
      rabDocumentId: rab?.id ?? null,
      canApprove,
      blocker,
      authorizedPositions,
      holderPositionId: holder?.positionId ?? null,
      activeBaselineCount,
      authorityCode: RAB_APPROVAL_AUTHORITY,
      approvalPolicy: RAB_APPROVAL_POLICY,
    });

    // GOVERNANCE first, because it is the blocker the reader can actually act
    // on (by asking their organization to configure a Position) and the one
    // that must never be reported as a permission problem.
    if (authorizedPositions.length === 0) {
      return gate(false, RAB_APPROVAL_GATE_BLOCKER.NO_CONFIGURED_AUTHORITY);
    }
    if (!holder) {
      return gate(false, RAB_APPROVAL_GATE_BLOCKER.ACTOR_IS_NOT_HOLDER);
    }
    if (!heldPermissions.includes(PERMISSIONS.RAB_APPROVE)) {
      return gate(false, RAB_APPROVAL_GATE_BLOCKER.PERMISSION_REQUIRED);
    }
    if (activeBaselineCount > 0) {
      return gate(false, RAB_APPROVAL_REASON.ACTIVE_BASELINE_EXISTS);
    }
    if (!rab) {
      return gate(false, RAB_APPROVAL_REASON.RAB_DOCUMENT_NOT_FOUND);
    }
    if (rab.status === RAB_STATUS.APPROVED) {
      return gate(false, RAB_APPROVAL_REASON.APPROVED_WITHOUT_ACTIVE_BASELINE);
    }
    if (rab.status !== RAB_STATUS.LOCKED) {
      return gate(false, RAB_APPROVAL_REASON.RAB_NOT_LOCKED);
    }
    return gate(true, null);
  }
}
