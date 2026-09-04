// AUTHORITY GOVERNANCE — THE ONE WRITER OF AUTHORITY GRANT/REVOKE.
//
// SIMPROK already had the whole authority chain and could not energize it:
//
//   Authority (global vocabulary)
//     -> PositionAuthority   CURRENT STATE — the only thing the resolver reads
//   Position (workspace-scoped seat)
//     -> PositionAssignment  who occupies the seat
//   ProjectAssignment        whether it applies to a given project, at read time
//
// `PositionAuthority` answers "does this seat hold this power NOW". With one row
// per (position, authority) it TOGGLES, so GRANT -> REVOKE -> GRANT leaves a row
// indistinguishable from a grant that was never revoked. "By whose authorization
// did it come to?" had no home anywhere in the schema. This service is the only
// thing that writes either half, and it writes both together.
//
// WHY THIS IS NOT A SECOND AUTHORITY ENGINE. It resolves nothing. It grants no
// entitlement by existing. `ProgressAuthorityService` remains the sole resolver
// and never reads this lineage — it reads `PositionAuthority`, exactly as before.
// Nothing here repairs, replaces or calls `AuthorityService`.
//
// WHY NO CONTROLLER. Granting authority is a governed ceremony, not a request.
// The module is deliberately not wired into AppModule, mirroring platform
// governance. An HTTP surface is a separate, future Owner decision.

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma, AuthorityGovernanceAction } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Every way this service refuses. Named, never generic. */
export const AUTHORITY_GOVERNANCE_REFUSAL = {
  OWNER_AUTHORIZATION_REQUIRED: 'AUTHORITY_GOVERNANCE_OWNER_AUTHORIZATION_REQUIRED',
  IDEMPOTENCY_KEY_REQUIRED: 'AUTHORITY_GOVERNANCE_IDEMPOTENCY_KEY_REQUIRED',
  POSITION_REQUIRED: 'AUTHORITY_GOVERNANCE_POSITION_REQUIRED',
  ACTOR_REQUIRED: 'AUTHORITY_GOVERNANCE_ACTOR_REQUIRED',
  AUTHORITY_REQUIRED: 'AUTHORITY_GOVERNANCE_AUTHORITY_REQUIRED',
  POSITION_NOT_FOUND: 'AUTHORITY_GOVERNANCE_POSITION_NOT_FOUND',
  ACTOR_NOT_FOUND: 'AUTHORITY_GOVERNANCE_ACTOR_NOT_FOUND',
  ACTOR_INACTIVE: 'AUTHORITY_GOVERNANCE_ACTOR_INACTIVE',
  AUTHORITY_NOT_FOUND: 'AUTHORITY_GOVERNANCE_AUTHORITY_NOT_FOUND',
  COMMAND_FINGERPRINT_CONFLICT: 'AUTHORITY_GOVERNANCE_COMMAND_FINGERPRINT_CONFLICT',
  DECISION_WOULD_NOT_CHANGE_STATE: 'AUTHORITY_GOVERNANCE_DECISION_WOULD_NOT_CHANGE_STATE',
  GENERATION_CONTENDED: 'AUTHORITY_GOVERNANCE_GENERATION_CONTENDED',
} as const;

/**
 * Every fact a governed grant or revoke must name. Nothing is defaulted, and
 * nothing is inferred from anything else.
 *
 * `executedByAccountId` and `positionId` are deliberately separate inputs even
 * when the actor occupies the target seat: SELF-GRANT IS STRUCTURALLY POSSIBLE
 * AND NEVER AUTOMATICALLY LEGITIMATE. This service therefore contains no branch
 * that compares them — occupying the target Position is not, and must never
 * become, evidence that the actor may grant to it. Legitimacy comes from the
 * Owner authorization reference, which is required on every ceremony.
 */
export interface AuthorityGovernanceCeremony {
  readonly positionId: string;
  readonly authorityCode: string;
  readonly executedByAccountId: string;
  readonly ownerAuthorizationReference: string;
  readonly reason?: string;
  readonly idempotencyKey: string;
}

const blank = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim() === '';

@Injectable()
export class AuthorityGovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  grant(ceremony: AuthorityGovernanceCeremony) {
    return this.decide(ceremony, AuthorityGovernanceAction.GRANT);
  }

  revoke(ceremony: AuthorityGovernanceCeremony) {
    return this.decide(ceremony, AuthorityGovernanceAction.REVOKE);
  }

  /**
   * THE ONE ATOMIC ACT.
   *
   * Provenance and current state change together or not at all. Neither
   * `authority_governance_decisions` nor `position_authorities` is ever written
   * outside this transaction by this service, and no other production code
   * writes `position_authorities` at all.
   */
  private async decide(
    ceremony: AuthorityGovernanceCeremony,
    action: AuthorityGovernanceAction,
  ) {
    // ── FAIL-CLOSED INPUT GATES, before any read ────────────────────────────
    // The Owner authorization is the only evidence that a ceremony happened at
    // all. A governance act that cannot name it must never be recorded.
    if (blank(ceremony.ownerAuthorizationReference)) {
      throw new ForbiddenException(
        AUTHORITY_GOVERNANCE_REFUSAL.OWNER_AUTHORIZATION_REQUIRED,
      );
    }
    if (blank(ceremony.idempotencyKey)) {
      throw new ForbiddenException(
        AUTHORITY_GOVERNANCE_REFUSAL.IDEMPOTENCY_KEY_REQUIRED,
      );
    }
    if (blank(ceremony.positionId)) {
      throw new ForbiddenException(AUTHORITY_GOVERNANCE_REFUSAL.POSITION_REQUIRED);
    }
    if (blank(ceremony.executedByAccountId)) {
      throw new ForbiddenException(AUTHORITY_GOVERNANCE_REFUSAL.ACTOR_REQUIRED);
    }
    if (blank(ceremony.authorityCode)) {
      throw new ForbiddenException(AUTHORITY_GOVERNANCE_REFUSAL.AUTHORITY_REQUIRED);
    }

    const idempotencyKey = ceremony.idempotencyKey.trim();
    const authorityCode = ceremony.authorityCode.trim();
    const fingerprint = this.fingerprint(ceremony, action);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // ── REPLAY FIRST ──────────────────────────────────────────────────
        const replayed = await tx.authorityGovernanceDecision.findUnique({
          where: { idempotencyKey },
        });
        if (replayed) {
          if (replayed.commandFingerprint !== fingerprint) {
            throw new ConflictException(
              AUTHORITY_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT,
            );
          }
          return replayed;
        }

        // ── THE SEAT MUST EXIST ───────────────────────────────────────────
        const position = await tx.position.findUnique({
          where: { id: ceremony.positionId },
          select: { id: true },
        });
        if (!position) {
          throw new NotFoundException(
            AUTHORITY_GOVERNANCE_REFUSAL.POSITION_NOT_FOUND,
          );
        }

        // ── SO MUST THE HAND ──────────────────────────────────────────────
        const actor = await tx.account.findUnique({
          where: { id: ceremony.executedByAccountId },
          select: { status: true },
        });
        if (!actor) {
          throw new NotFoundException(AUTHORITY_GOVERNANCE_REFUSAL.ACTOR_NOT_FOUND);
        }
        if (actor.status !== 'ACTIVE') {
          throw new ConflictException(AUTHORITY_GOVERNANCE_REFUSAL.ACTOR_INACTIVE);
        }

        // ── AND THE POWER. Looked up by code, never created. ───────────────
        const authority = await tx.authority.findUnique({
          where: { code: authorityCode },
          select: { id: true },
        });
        if (!authority) {
          throw new NotFoundException(
            AUTHORITY_GOVERNANCE_REFUSAL.AUTHORITY_NOT_FOUND,
          );
        }

        // ── CURRENT TRUTH, THEN THE TRANSITION ────────────────────────────
        const current = await tx.authorityGovernanceDecision.findFirst({
          where: { positionId: position.id, authorityId: authority.id },
          orderBy: { generation: 'desc' },
        });

        const alreadyHeld =
          current?.action === AuthorityGovernanceAction.GRANT;
        const wouldChange =
          action === AuthorityGovernanceAction.GRANT ? !alreadyHeld : alreadyHeld;

        if (!wouldChange) {
          // THE STATE GATE IS ALSO A REPLAY BOUNDARY. Under READ COMMITTED the
          // replay read above took an earlier snapshot, so a concurrent
          // submission of THIS SAME command may have committed in between and
          // the state we are refusing to change may be its effect. This re-read
          // is a LATER statement, so it cannot miss the row that put us here.
          const landed = await tx.authorityGovernanceDecision.findUnique({
            where: { idempotencyKey },
          });
          if (landed) {
            if (landed.commandFingerprint !== fingerprint) {
              throw new ConflictException(
                AUTHORITY_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT,
              );
            }
            return landed;
          }
          throw new ConflictException(
            AUTHORITY_GOVERNANCE_REFUSAL.DECISION_WOULD_NOT_CHANGE_STATE,
          );
        }

        const generation = (current?.generation ?? 0) + 1;
        const decidedAt = new Date();

        // ── 1. APPEND THE IMMUTABLE HISTORY ───────────────────────────────
        const decision = await tx.authorityGovernanceDecision.create({
          data: {
            positionId: position.id,
            authorityId: authority.id,
            action,
            generation,
            previousDecisionId: current?.id ?? null,
            executedByAccountId: ceremony.executedByAccountId,
            ownerAuthorizationReference:
              ceremony.ownerAuthorizationReference.trim(),
            reason: ceremony.reason?.trim() || null,
            idempotencyKey,
            commandFingerprint: fingerprint,
            decidedAt,
          },
        });

        // ── 2. MOVE THE CURRENT STATE, IN THE SAME TRANSACTION ────────────
        // The existing DB CHECK requires isActive XOR revokedAt, and the
        // existing @@unique([positionId, authorityId]) means one row per pair —
        // so this is an upsert onto that pair, never a second row.
        const granted = action === AuthorityGovernanceAction.GRANT;
        await tx.positionAuthority.upsert({
          where: {
            positionId_authorityId: {
              positionId: position.id,
              authorityId: authority.id,
            },
          },
          create: {
            positionId: position.id,
            authorityId: authority.id,
            isActive: granted,
            revokedAt: granted ? null : decidedAt,
          },
          update: {
            isActive: granted,
            revokedAt: granted ? null : decidedAt,
          },
        });

        return decision;
      });
    } catch (error) {
      // ── THE GENERATION RACE ─────────────────────────────────────────────
      // Two ceremonies read the same head and both tried to write the next
      // generation. The unique index let exactly one through.
      if (this.isGenerationRace(error)) {
        const settled = await this.prisma.authorityGovernanceDecision.findUnique(
          { where: { idempotencyKey } },
        );
        if (settled && settled.commandFingerprint === fingerprint) return settled;
        throw new ConflictException(
          AUTHORITY_GOVERNANCE_REFUSAL.GENERATION_CONTENDED,
        );
      }

      // ── THE CONCURRENT REPLAY ───────────────────────────────────────────
      // The SAME idempotency key twice at once: both passed the replay read,
      // both inserted, and the IDEMPOTENCY index stopped the loser. A different
      // constraint from the race above, so it is recognised on its own.
      if (this.isIdempotencyReplay(error)) {
        const settled = await this.prisma.authorityGovernanceDecision.findUnique(
          { where: { idempotencyKey } },
        );
        if (settled) {
          if (settled.commandFingerprint !== fingerprint) {
            throw new ConflictException(
              AUTHORITY_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT,
            );
          }
          return settled;
        }
        throw new ConflictException(
          AUTHORITY_GOVERNANCE_REFUSAL.GENERATION_CONTENDED,
        );
      }

      // Any other error is a defect, not contention. It surfaces as itself.
      throw error;
    }
  }

  /** The whole governed history of one seat holding one power. */
  history(positionId: string, authorityCode: string) {
    return this.prisma.authorityGovernanceDecision.findMany({
      where: { positionId, authority: { code: authorityCode } },
      orderBy: { generation: 'asc' },
    });
  }

  /** The latest governance act. NOT an entitlement check — see currentState(). */
  latestDecision(positionId: string, authorityCode: string) {
    return this.prisma.authorityGovernanceDecision.findFirst({
      where: { positionId, authority: { code: authorityCode } },
      orderBy: { generation: 'desc' },
    });
  }

  /**
   * The command's MEANING, digested. Two requests sharing an idempotency key but
   * differing in any of these are different commands, and the second is refused
   * rather than answered with the first one's result.
   */
  private fingerprint(
    ceremony: AuthorityGovernanceCeremony,
    action: AuthorityGovernanceAction,
  ): string {
    return createHash('sha256')
      .update(
        [
          action,
          ceremony.positionId,
          ceremony.authorityCode.trim(),
          ceremony.executedByAccountId,
          ceremony.ownerAuthorizationReference.trim(),
          ceremony.reason?.trim() ?? '',
        ].join(' '),
      )
      .digest('hex');
  }

  private reportedTargets(error: unknown): string[] | null {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
    if (error.code !== 'P2002') return null;
    const target = error.meta?.target;
    const reported = (Array.isArray(target) ? target : [target])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());
    return reported.length === 0 ? null : reported;
  }

  /** The unique violation a legitimate generation race produces. */
  private isGenerationRace(error: unknown): boolean {
    const reported = this.reportedTargets(error);
    if (!reported) return false;
    const fieldList = ['positionid', 'authorityid', 'generation'];
    if (fieldList.every((field) => reported.includes(field))) return true;
    return reported.some((value) =>
      value.startsWith('authority_governance_decisions_positionid_authorityid_gener'),
    );
  }

  /**
   * The unique violation a concurrent replay produces. Narrow on purpose:
   * `idempotencyKey` is globally unique on its own, so exactly one reported
   * field. A composite that merely contains it is some other constraint.
   */
  private isIdempotencyReplay(error: unknown): boolean {
    const reported = this.reportedTargets(error);
    if (!reported || reported.length !== 1) return false;
    return (
      reported[0] === 'idempotencykey' ||
      reported[0].startsWith('authority_governance_decisions_idempotencykey')
    );
  }
}
