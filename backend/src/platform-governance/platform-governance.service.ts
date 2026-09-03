// PLATFORM GOVERNANCE — WHO MAY ACT ON SIMPROK'S OWN KNOWLEDGE.
//
// OWNER-LOCKED PRODUCT LAW, implemented here and nowhere else:
//
//   1. The HOLDER of a platform authority is a PERSON, represented by `Account`.
//   2. The POWER is an EXISTING `Authority`. No second vocabulary is created.
//   3. Granting or revoking is NOT itself a platform authority. Holding one
//      confers no power to hand one out.
//   4. Every grant and every revoke is an explicit OWNER-AUTHORIZED CEREMONY,
//      recorded by an opaque `ownerAuthorizationReference`.
//   5. Nothing incidental — login, account creation, workspace creation,
//      membership, role or permission assignment, import, cron, event or
//      ordinary bootstrap — may produce a platform authority.
//
// WHY THERE IS NO CONTROLLER HERE. A grant is an Owner ceremony performed out of
// band, exactly as `rm01b-production-permission-activation.ts` performs the one
// governed act SIMPROK already has. Exposing an HTTP route would create an
// in-product grant surface that no Owner law authorizes, and would immediately
// widen the very boundary this service exists to keep narrow. The service is
// internal; the ceremony calls it.
//
// WHY IT DOES NOT TOUCH THE WORKSPACE AUTHORITY CHAIN. `Position`,
// `PositionAssignment` and `PositionAuthority` keep their exact existing
// meaning and remain workspace machinery. This service never reads or writes
// them, never reads a Role, a Permission or a workspace, and never consults
// `AuthorityService` — which stays broken, dormant and unused by Owner ruling.
//
// STATE AND HISTORY ARE ONE LINEAGE, following the pattern
// `AhspResourceIdentityDecision` already proves in production: history is
// appended, never rewritten, and the highest generation for a subject is the
// current truth.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  Prisma,
  PlatformGovernanceDecision,
  PlatformGovernanceDecisionType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * THE PLATFORM GOVERNANCE AUTHORITY VOCABULARY — Owner-locked, exactly three.
 *
 * These are governance POWERS in the existing `Authority` vocabulary. They are
 * not Permissions, not Roles, not ApprovalMatrix requirements, and they are
 * never held through a Position.
 *
 * DELIBERATELY THREE, NOT ONE. Their business acts and consequences are
 * materially different — admitting a fact into SIMPROK's shared knowledge is
 * not the same act as publishing a validated version of it, and neither is
 * withdrawing something already published. SIMPROK's own precedent separates
 * powers this way: Field Progress splits VERIFY / CORRECT / ACCEPT rather than
 * holding one FIELD_PROGRESS_MANAGE. There is deliberately NO generic
 * PLATFORM_KNOWLEDGE_MANAGE.
 *
 * AN AUTHORITY DOES NOT PERFORM THE ACT. Holding one means a person MAY
 * authorize a governance action; the act itself still runs through the existing
 * domain workflow. Nothing here publishes, admits or withdraws anything.
 *
 * Mirrors the shape `PROGRESS_AUTHORITIES` already uses in
 * `progress-authority.service.ts` — one named constant, no new mechanism.
 */
export const PLATFORM_GOVERNANCE_AUTHORITIES = {
  /** Approve promotion of an eligible fact into SIMPROK-owned Shared Knowledge. */
  ADMIT: 'PLATFORM_KNOWLEDGE_ADMIT',
  /** Approve publication of an eligible validated version into the shared state. */
  PUBLISH: 'PLATFORM_KNOWLEDGE_PUBLISH',
  /** Approve withdrawal of previously published/shared knowledge from active state. */
  WITHDRAW: 'PLATFORM_KNOWLEDGE_WITHDRAW',
} as const;

export type PlatformGovernanceAuthorityCode =
  (typeof PLATFORM_GOVERNANCE_AUTHORITIES)[keyof typeof PLATFORM_GOVERNANCE_AUTHORITIES];

const PLATFORM_AUTHORITY_CODES: ReadonlySet<string> = new Set(
  Object.values(PLATFORM_GOVERNANCE_AUTHORITIES),
);

/**
 * Every way this service refuses. Named, so a caller can tell a governance
 * refusal from an infrastructure failure without reading prose.
 */
export const PLATFORM_GOVERNANCE_REFUSAL = {
  /** The Owner authorization reference was absent or blank. */
  OWNER_AUTHORIZATION_REQUIRED: 'PLATFORM_GOVERNANCE_OWNER_AUTHORIZATION_REQUIRED',
  /** No idempotency key was supplied; a replay could not be distinguished. */
  IDEMPOTENCY_KEY_REQUIRED: 'PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY_REQUIRED',
  /** The holder id was absent or blank. */
  HOLDER_REQUIRED: 'PLATFORM_GOVERNANCE_HOLDER_REQUIRED',
  /** The executing actor id was absent or blank. */
  ACTOR_REQUIRED: 'PLATFORM_GOVERNANCE_ACTOR_REQUIRED',
  /** The authority code was absent or blank. */
  AUTHORITY_REQUIRED: 'PLATFORM_GOVERNANCE_AUTHORITY_REQUIRED',
  /** No such Account. */
  HOLDER_NOT_FOUND: 'PLATFORM_GOVERNANCE_HOLDER_NOT_FOUND',
  /** The holder exists but is not an ACTIVE account. */
  HOLDER_INACTIVE: 'PLATFORM_GOVERNANCE_HOLDER_INACTIVE',
  /** No such executing Account. */
  ACTOR_NOT_FOUND: 'PLATFORM_GOVERNANCE_ACTOR_NOT_FOUND',
  /** The executing actor exists but is not an ACTIVE account. */
  ACTOR_INACTIVE: 'PLATFORM_GOVERNANCE_ACTOR_INACTIVE',
  /** No `Authority` carries that code. Codes are never invented here. */
  AUTHORITY_NOT_FOUND: 'PLATFORM_GOVERNANCE_AUTHORITY_NOT_FOUND',
  /**
   * A real `Authority` — but not a PLATFORM one.
   *
   * `Authority` is one global vocabulary holding powers of several scopes:
   * `FIELD_PROGRESS_VERIFY` is a genuine Authority and a genuine power, and it
   * is a PROJECT decision authority held through a workspace Position. Binding
   * it to an Account as though it were platform governance would smuggle a
   * project power across the boundary Owner law puts between them.
   *
   * So membership of the platform vocabulary is checked explicitly, and a
   * workspace or project authority presented where a platform authority is
   * required is refused — never silently accepted, never quietly substituted.
   */
  AUTHORITY_NOT_PLATFORM_SCOPED: 'PLATFORM_GOVERNANCE_AUTHORITY_NOT_PLATFORM_SCOPED',
  /**
   * The same idempotency key arrived carrying a DIFFERENT command.
   *
   * A replay must be the same command; a different command wearing a used name
   * is refused rather than silently treated as one.
   */
  COMMAND_FINGERPRINT_CONFLICT: 'PLATFORM_GOVERNANCE_COMMAND_FINGERPRINT_CONFLICT',
  /**
   * The requested decision would not change the current state.
   *
   * Granting what is already held, or revoking what is not held, records a
   * generation that asserts nothing. Refused so that every generation in the
   * lineage means something happened.
   */
  DECISION_WOULD_NOT_CHANGE_STATE: 'PLATFORM_GOVERNANCE_DECISION_WOULD_NOT_CHANGE_STATE',
  /**
   * Two ceremonies raced for the same next generation and this one lost.
   *
   * The winner's row stands. Nothing is overwritten and nothing is guessed —
   * the loser is told to re-read.
   */
  GENERATION_CONTENDED: 'PLATFORM_GOVERNANCE_GENERATION_CONTENDED',
} as const;

export type PlatformGovernanceRefusal =
  (typeof PLATFORM_GOVERNANCE_REFUSAL)[keyof typeof PLATFORM_GOVERNANCE_REFUSAL];

/**
 * One Owner-authorized ceremony.
 *
 * HOLDER, ACTOR and OWNER AUTHORIZATION are three separate inputs on purpose.
 * The person who receives the authority, the person who executed the ceremony,
 * and the Owner's authorization for it are three different facts, and collapsing
 * any two of them would destroy the accountability this record exists to keep.
 */
export interface PlatformGovernanceCeremony {
  /** The Account that will hold, or stop holding, the authority. */
  readonly holderAccountId: string;
  /** An EXISTING `Authority.code`. Never created here. */
  readonly authorityCode: string;
  /** The Account that executes the ceremony. May differ from the holder. */
  readonly executedByAccountId: string;
  /**
   * The opaque Owner-issued accountability reference.
   *
   * REQUIRED and persisted. NOT MACHINE-VERIFIED: SIMPROK records that the act
   * was executed under this reference, and claims nothing about who issued it.
   */
  readonly ownerAuthorizationReference: string;
  /** Why. Free prose for whoever reads the lineage later. */
  readonly reason?: string;
  /** Replay identity for this exact command. */
  readonly idempotencyKey: string;
}

/** What the resolver answers. Null means the authority is not held. */
export interface PlatformAuthorityState {
  readonly holderAccountId: string;
  readonly authorityCode: string;
  readonly held: boolean;
  readonly generation: number;
  readonly decidedAt: Date;
  readonly ownerAuthorizationReference: string;
  readonly executedByAccountId: string;
}

const blank = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim().length === 0;

@Injectable()
export class PlatformGovernanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Owner-authorized ceremony: this Account now holds this authority. */
  async grant(
    ceremony: PlatformGovernanceCeremony,
  ): Promise<PlatformGovernanceDecision> {
    return this.decide(ceremony, PlatformGovernanceDecisionType.GRANT);
  }

  /** Owner-authorized ceremony: this Account no longer holds this authority. */
  async revoke(
    ceremony: PlatformGovernanceCeremony,
  ): Promise<PlatformGovernanceDecision> {
    return this.decide(ceremony, PlatformGovernanceDecisionType.REVOKE);
  }

  /**
   * THE CURRENT TRUTH for one exact subject — the highest generation.
   *
   * One bounded, indexed read. Never a scan, never "load all history": the
   * lineage may be long, and the answer is always its newest row.
   */
  async currentState(
    holderAccountId: string,
    authorityCode: string,
  ): Promise<PlatformAuthorityState | null> {
    if (blank(holderAccountId) || blank(authorityCode)) return null;
    // Fail-closed on the read side too. A caller asking whether an Account
    // "holds" FIELD_PROGRESS_VERIFY at platform scope is asking a question with
    // no true answer, and the honest reply is no — never the project grant.
    if (!PLATFORM_AUTHORITY_CODES.has(authorityCode.trim())) return null;

    const authority = await this.prisma.authority.findUnique({
      where: { code: authorityCode.trim() },
      select: { id: true },
    });
    // An authority SIMPROK does not know cannot be held. Fail closed rather
    // than treating an unknown code as an unheld-but-valid one.
    if (!authority) return null;

    const latest = await this.prisma.platformGovernanceDecision.findFirst({
      where: { holderAccountId, authorityId: authority.id },
      orderBy: { generation: 'desc' },
    });
    if (!latest) return null;

    return {
      holderAccountId,
      authorityCode: authorityCode.trim(),
      held: latest.decision === PlatformGovernanceDecisionType.GRANT,
      generation: latest.generation,
      decidedAt: latest.decidedAt,
      ownerAuthorizationReference: latest.ownerAuthorizationReference,
      executedByAccountId: latest.executedByAccountId,
    };
  }

  /**
   * Does this Account hold this authority RIGHT NOW?
   *
   * Fail-closed in every uncertain case: unknown account, unknown authority, no
   * lineage, a lineage whose newest generation is a REVOKE, or a holder whose
   * account is no longer ACTIVE all answer false. Absence is never authority.
   */
  async holds(holderAccountId: string, authorityCode: string): Promise<boolean> {
    const state = await this.currentState(holderAccountId, authorityCode);
    if (!state?.held) return false;

    // A deactivated person does not keep a platform authority just because the
    // lineage was never revoked. The account check is deliberately here as well
    // as at authentication: this method may be called by an out-of-band
    // ceremony that never passed through a guard.
    const account = await this.prisma.account.findUnique({
      where: { id: holderAccountId },
      select: { status: true },
    });
    return account?.status === 'ACTIVE';
  }

  /** Full lineage for one subject, oldest first. History, never rewritten. */
  async history(
    holderAccountId: string,
    authorityCode: string,
  ): Promise<PlatformGovernanceDecision[]> {
    // Same gate: there is no platform lineage for a non-platform authority, and
    // returning a project authority's history here would answer a question the
    // caller did not ask.
    if (blank(authorityCode) || !PLATFORM_AUTHORITY_CODES.has(authorityCode.trim())) {
      return [];
    }
    const authority = await this.prisma.authority.findUnique({
      where: { code: authorityCode.trim() },
      select: { id: true },
    });
    if (!authority) return [];
    return this.prisma.platformGovernanceDecision.findMany({
      where: { holderAccountId, authorityId: authority.id },
      orderBy: { generation: 'asc' },
    });
  }

  // ── the one write path ──────────────────────────────────────────────────

  private async decide(
    ceremony: PlatformGovernanceCeremony,
    decision: PlatformGovernanceDecisionType,
  ): Promise<PlatformGovernanceDecision> {
    // ── FAIL-CLOSED INPUT GATES, before any read ────────────────────────────
    //
    // The Owner authorization reference is checked FIRST and hardest. It is the
    // only evidence that a ceremony happened at all, and a governance act that
    // cannot name its authorization must never be recorded — not even as a
    // refused one.
    if (blank(ceremony.ownerAuthorizationReference)) {
      throw new BadRequestException(
        PLATFORM_GOVERNANCE_REFUSAL.OWNER_AUTHORIZATION_REQUIRED,
      );
    }
    if (blank(ceremony.idempotencyKey)) {
      throw new BadRequestException(
        PLATFORM_GOVERNANCE_REFUSAL.IDEMPOTENCY_KEY_REQUIRED,
      );
    }
    if (blank(ceremony.holderAccountId)) {
      throw new BadRequestException(PLATFORM_GOVERNANCE_REFUSAL.HOLDER_REQUIRED);
    }
    if (blank(ceremony.executedByAccountId)) {
      throw new BadRequestException(PLATFORM_GOVERNANCE_REFUSAL.ACTOR_REQUIRED);
    }
    if (blank(ceremony.authorityCode)) {
      throw new BadRequestException(PLATFORM_GOVERNANCE_REFUSAL.AUTHORITY_REQUIRED);
    }
    // THE VOCABULARY GATE. Checked here, before any read, because "is this a
    // platform power at all?" is answerable from the code alone and a project
    // authority must never reach the binding path.
    if (!PLATFORM_AUTHORITY_CODES.has(ceremony.authorityCode.trim())) {
      throw new BadRequestException(
        PLATFORM_GOVERNANCE_REFUSAL.AUTHORITY_NOT_PLATFORM_SCOPED,
      );
    }

    const authorizationReference = ceremony.ownerAuthorizationReference.trim();
    const idempotencyKey = ceremony.idempotencyKey.trim();
    const authorityCode = ceremony.authorityCode.trim();
    const fingerprint = this.fingerprint(ceremony, decision);

    try {
      return await this.prisma.$transaction(async (tx) => {
        // ── REPLAY FIRST ────────────────────────────────────────────────────
        // Checked before anything is validated or written: a genuine replay of
        // a completed ceremony must return the SAME generation, not attempt a
        // second one.
        const replayed = await tx.platformGovernanceDecision.findUnique({
          where: { idempotencyKey },
        });
        if (replayed) {
          if (replayed.commandFingerprint !== fingerprint) {
            throw new ConflictException(
              PLATFORM_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT,
            );
          }
          return replayed;
        }

        // ── THE SUBJECT MUST EXIST AND BE REAL ──────────────────────────────
        const holder = await tx.account.findUnique({
          where: { id: ceremony.holderAccountId },
          select: { status: true },
        });
        if (!holder) {
          throw new NotFoundException(
            PLATFORM_GOVERNANCE_REFUSAL.HOLDER_NOT_FOUND,
          );
        }
        if (holder.status !== 'ACTIVE') {
          throw new ConflictException(
            PLATFORM_GOVERNANCE_REFUSAL.HOLDER_INACTIVE,
          );
        }

        // ── SO MUST THE PERSON PERFORMING THE CEREMONY ──────────────────────
        // Accountability is only real if the actor is a real, live person.
        const actor = await tx.account.findUnique({
          where: { id: ceremony.executedByAccountId },
          select: { status: true },
        });
        if (!actor) {
          throw new NotFoundException(PLATFORM_GOVERNANCE_REFUSAL.ACTOR_NOT_FOUND);
        }
        if (actor.status !== 'ACTIVE') {
          throw new ConflictException(PLATFORM_GOVERNANCE_REFUSAL.ACTOR_INACTIVE);
        }

        // ── THE POWER MUST ALREADY EXIST ────────────────────────────────────
        // Looked up by code, never created. If SIMPROK has no such Authority,
        // there is nothing to grant and inventing one here would be a second
        // vocabulary by the back door.
        const authority = await tx.authority.findUnique({
          where: { code: authorityCode },
          select: { id: true },
        });
        if (!authority) {
          throw new NotFoundException(
            PLATFORM_GOVERNANCE_REFUSAL.AUTHORITY_NOT_FOUND,
          );
        }

        // ── CURRENT TRUTH, THEN THE TRANSITION ──────────────────────────────
        const current = await tx.platformGovernanceDecision.findFirst({
          where: {
            holderAccountId: ceremony.holderAccountId,
            authorityId: authority.id,
          },
          orderBy: { generation: 'desc' },
        });

        const alreadyHeld = current?.decision === PlatformGovernanceDecisionType.GRANT;
        const wouldChange =
          decision === PlatformGovernanceDecisionType.GRANT
            ? !alreadyHeld
            : alreadyHeld;
        if (!wouldChange) {
          // ── THE STATE GATE IS ALSO A REPLAY BOUNDARY ──────────────────────
          // Arriving here does NOT prove the command is invalid. The replay read
          // at the top of this transaction took an EARLIER snapshot — this runs
          // at READ COMMITTED, where every statement takes its own — so a
          // concurrent submission of THIS SAME command may have committed in
          // between, and the state we are refusing to change may be its effect.
          // Refusing without looking would answer a legitimate replay with
          // DECISION_WOULD_NOT_CHANGE_STATE instead of the result it earned.
          //
          // WHY THIS CLOSES THE WINDOW COMPLETELY, rather than narrowing it.
          // We are here only because the state read observed a committed row, so
          // that commit happened before the state read's snapshot. This re-read
          // is a LATER statement, so its snapshot is later still, and under READ
          // COMMITTED a statement sees everything committed before it begins.
          // The row that put us here therefore cannot be invisible to this read.
          // Isolation is what makes this work — not what needed changing.
          const landed = await tx.platformGovernanceDecision.findUnique({
            where: { idempotencyKey },
          });
          if (landed) {
            // Same key, different command: the second is refused, never handed
            // the first one's result. Identical to every other replay boundary.
            if (landed.commandFingerprint !== fingerprint) {
              throw new ConflictException(
                PLATFORM_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT,
              );
            }
            return landed;
          }

          // Nothing under OUR key landed, so this is not a replay of anything —
          // it is a genuinely state-invalid transition, and keeps its original
          // refusal untouched.
          throw new ConflictException(
            PLATFORM_GOVERNANCE_REFUSAL.DECISION_WOULD_NOT_CHANGE_STATE,
          );
        }

        // APPEND. Never update, never delete: the previous generation stays
        // exactly as it was written, and this row supersedes it by being newer.
        return tx.platformGovernanceDecision.create({
          data: {
            holderAccountId: ceremony.holderAccountId,
            authorityId: authority.id,
            decision,
            generation: (current?.generation ?? 0) + 1,
            previousDecisionId: current?.id ?? null,
            executedByAccountId: ceremony.executedByAccountId,
            ownerAuthorizationReference: authorizationReference,
            reason: ceremony.reason ?? null,
            idempotencyKey,
            commandFingerprint: fingerprint,
          },
        });
      });
    } catch (error) {
      // ── THE GENERATION RACE ─────────────────────────────────────────────
      // Two DIFFERENT ceremonies read the same current generation and both tried
      // to write the next one. The generation index let exactly one through.
      //
      // The loser re-reads rather than retrying blindly, and is told it was
      // contended. Nothing is overwritten either way.
      if (this.isGenerationRace(error)) {
        const settled = await this.prisma.platformGovernanceDecision.findUnique({
          where: { idempotencyKey },
        });
        if (settled && settled.commandFingerprint === fingerprint) return settled;
        throw new ConflictException(
          PLATFORM_GOVERNANCE_REFUSAL.GENERATION_CONTENDED,
        );
      }

      // ── THE CONCURRENT REPLAY ───────────────────────────────────────────
      // The SAME idempotency key, submitted twice at once. Both submissions
      // passed the replay read above — under READ COMMITTED neither could see
      // the other's uncommitted row — and both inserted. What stops the loser is
      // the IDEMPOTENCY index, not the generation index: a different constraint,
      // which therefore has to be recognised on its own. Recognising only the
      // generation index let this case escape as a raw driver error, which is
      // neither a named refusal nor an answer.
      //
      // The outcome here is deliberately IDENTICAL to the sequential replay path
      // above: the winner's row for the same command, the named fingerprint
      // conflict for a different one.
      //
      // THIS IS THE LAST OF THREE REPLAY BOUNDARIES, and they all answer alike.
      // A concurrent submission is caught by whichever it reaches first —
      //
      //   1. the replay read, when the winner committed before this began;
      //   2. the state gate, when the winner committed while this was validating;
      //   3. here, when both submissions reached the insert.
      //
      // Each re-reads by idempotency key and returns the winner's row for the
      // same command, the named fingerprint conflict for a different one. So
      // WHICH of the three catches a caller varies with timing, while the answer
      // the three of them give does not.
      //
      // That is the whole of the claim. It is about these replay boundaries, not
      // about decide() as a whole: a lost connection, a transaction timeout or
      // any other failure outside them is still reported as itself, unchanged.
      if (this.isIdempotencyReplay(error)) {
        const settled = await this.prisma.platformGovernanceDecision.findUnique({
          where: { idempotencyKey },
        });
        if (settled) {
          if (settled.commandFingerprint !== fingerprint) {
            throw new ConflictException(
              PLATFORM_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT,
            );
          }
          return settled;
        }
        // The row whose key we collided with is not readable. Append-only data
        // should make this unreachable, so nothing is assumed: refuse, never
        // retry, and never invent a result.
        throw new ConflictException(
          PLATFORM_GOVERNANCE_REFUSAL.GENERATION_CONTENDED,
        );
      }

      // Any other P2002 is a duplicate this code should never have attempted.
      // It is a defect, not contention, and is left to surface as itself.
      throw error;
    }
  }

  /**
   * The command's MEANING, digested.
   *
   * Everything that makes this ceremony the ceremony it is. Two requests sharing
   * an idempotency key but differing in any of these are different commands, and
   * the second is refused rather than answered with the first one's result.
   */
  private fingerprint(
    ceremony: PlatformGovernanceCeremony,
    decision: PlatformGovernanceDecisionType,
  ): string {
    return createHash('sha256')
      .update(
        [
          decision,
          ceremony.holderAccountId,
          ceremony.authorityCode.trim(),
          ceremony.executedByAccountId,
          ceremony.ownerAuthorizationReference.trim(),
          ceremony.reason?.trim() ?? '',
        ].join(' '),
      )
      .digest('hex');
  }

  /**
   * The ONE unique violation a legitimate race produces.
   *
   * Named individually and deliberately. Catching every P2002 would swallow a
   * genuine defect — a duplicate this code should never have attempted — and
   * report it as contention that resolved itself. PostgreSQL truncates an
   * identifier at 63 bytes, so both the field-list form Prisma reports and the
   * truncated index name are accepted, and nothing else is.
   */
  private isGenerationRace(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (error.code !== 'P2002') return false;
    const target = error.meta?.target;
    const reported = (Array.isArray(target) ? target : [target])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());
    if (reported.length === 0) return false;
    const fieldList = ['holderaccountid', 'authorityid', 'generation'];
    if (fieldList.every((field) => reported.includes(field))) return true;
    return reported.some((value) =>
      value.startsWith('platform_governance_decisions_holderaccountid_authorityid_g'),
    );
  }

  /**
   * The ONE unique violation a concurrent replay produces.
   *
   * Deliberately a SEPARATE predicate from the generation race, and deliberately
   * as narrow. `idempotencyKey` is globally unique on its own, so the field-list
   * form Prisma reports is exactly one field — a composite that merely CONTAINS
   * the key is some other constraint and is not accepted here.
   *
   * Which of the two indexes fires is not something this code should depend on,
   * so it does not: both are recognised, each by its own predicate, and each
   * resolves to its own named outcome.
   */
  private isIdempotencyReplay(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (error.code !== 'P2002') return false;
    const target = error.meta?.target;
    const reported = (Array.isArray(target) ? target : [target])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());
    if (reported.length !== 1) return false;
    return (
      reported[0] === 'idempotencykey' ||
      reported[0].startsWith('platform_governance_decisions_idempotencykey')
    );
  }
}
