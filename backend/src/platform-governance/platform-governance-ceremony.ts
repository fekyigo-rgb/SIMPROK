// PLATFORM GOVERNANCE — THE OWNER-AUTHORIZED PRODUCTION CEREMONY.
//
// This is the entry boundary, and ONLY the entry boundary. It validates that a
// deliberate, Owner-authorized act is being performed against the right database,
// and then hands the decision to the ONE writer that exists:
//
//     PlatformGovernanceService.grant() / .revoke()  ->  decide()
//
// It never writes a PlatformGovernanceDecision itself, never touches current
// state, never deletes history, and owns no generation logic. Concurrency,
// idempotency, lineage and fail-closed refusals all remain where they already
// are and were already proven.
//
// WHY A SCRIPT AND NOT AN HTTP ROUTE. SIMPROK's one existing production
// governance act is `rm01b:permission` — an npm script invoking a `src/` module,
// gated by a confirmation token, an Owner authorization id and explicit expected
// targets. That is this repository's established safe boundary for a governed
// act. An HTTP route would put granting platform authority behind a request,
// which no Owner law authorizes and which nothing here needs.
//
// ── WHAT THIS CEREMONY DOES NOT DO ─────────────────────────────────────────
//
// It grants and revokes GOVERNANCE AUTHORITY. It performs no governed business
// action: nothing here admits, publishes or withdraws knowledge, and nothing here
// touches AHSP, Basic Price, RAB, Monitoring, KDN, Resource Identity, the Unit
// Kernel or the Cost Kernel. Holding an authority means a person MAY authorize
// such an act; the act itself remains a separate, future gate.

import { PrismaClient } from '@prisma/client';
import {
  PLATFORM_GOVERNANCE_AUTHORITIES,
  PlatformGovernanceService,
} from './platform-governance.service';

/** The production database, named — the same guard the RBAC seeder and RM01B use. */
export const CEREMONY_DATABASE = 'simprok_db';

/**
 * The operator must type this exactly. Mirrors RM01B's `RM01B_APPLY`.
 *
 * It exists so that a governance act cannot happen by an environment variable
 * being set somewhere and forgotten: performing it requires saying so.
 */
export const CEREMONY_CONFIRMATION = 'PLATFORM_GOVERNANCE_APPLY';

/** Every way the ceremony refuses. Named, never generic. */
export const CEREMONY_REFUSAL = {
  CONFIRMATION_MISMATCH: 'STOP_CEREMONY_CONFIRMATION_MISMATCH',
  DATABASE_MISMATCH: 'STOP_CEREMONY_DATABASE_MISMATCH',
  DECISION_REQUIRED: 'STOP_CEREMONY_DECISION_REQUIRED',
  AUTHORITY_REQUIRED: 'STOP_CEREMONY_AUTHORITY_REQUIRED',
  AUTHORITY_NOT_PLATFORM_SCOPED: 'STOP_CEREMONY_AUTHORITY_NOT_PLATFORM_SCOPED',
  HOLDER_REQUIRED: 'STOP_CEREMONY_HOLDER_REQUIRED',
  ACTOR_REQUIRED: 'STOP_CEREMONY_ACTOR_REQUIRED',
  OWNER_AUTHORIZATION_REQUIRED: 'STOP_CEREMONY_OWNER_AUTHORIZATION_REQUIRED',
  IDEMPOTENCY_KEY_REQUIRED: 'STOP_CEREMONY_IDEMPOTENCY_KEY_REQUIRED',
  REASON_REQUIRED: 'STOP_CEREMONY_REASON_REQUIRED',
} as const;

/** Exactly what an operator must supply. Nothing is defaulted or inferred. */
export interface CeremonyEnvironment {
  PLATFORM_GOVERNANCE_CONFIRM?: string;
  PLATFORM_GOVERNANCE_DECISION?: string;
  PLATFORM_GOVERNANCE_AUTHORITY_CODE?: string;
  PLATFORM_GOVERNANCE_HOLDER_ACCOUNT_ID?: string;
  PLATFORM_GOVERNANCE_EXECUTED_BY_ACCOUNT_ID?: string;
  PLATFORM_GOVERNANCE_OWNER_AUTHORIZATION_ID?: string;
  PLATFORM_GOVERNANCE_REASON?: string;
  PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY?: string;
}

export interface CeremonyCommand {
  readonly decision: 'GRANT' | 'REVOKE';
  readonly authorityCode: string;
  readonly holderAccountId: string;
  readonly executedByAccountId: string;
  readonly ownerAuthorizationReference: string;
  readonly reason: string;
  readonly idempotencyKey: string;
}

const required = (value: string | undefined, refusal: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(refusal);
  return value.trim();
};

const PLATFORM_CODES: ReadonlySet<string> = new Set(
  Object.values(PLATFORM_GOVERNANCE_AUTHORITIES),
);

/**
 * Turn an operator's environment into a command, or refuse.
 *
 * EVERY field is required. There is no default holder, no default actor, no
 * "current user", no first account, no Owner inference. A governance act that
 * cannot name all of its own facts does not happen.
 */
export function commandFromEnvironment(env: CeremonyEnvironment): CeremonyCommand {
  if (env.PLATFORM_GOVERNANCE_CONFIRM !== CEREMONY_CONFIRMATION) {
    throw new Error(CEREMONY_REFUSAL.CONFIRMATION_MISMATCH);
  }

  const decision = required(
    env.PLATFORM_GOVERNANCE_DECISION,
    CEREMONY_REFUSAL.DECISION_REQUIRED,
  );
  if (decision !== 'GRANT' && decision !== 'REVOKE') {
    throw new Error(CEREMONY_REFUSAL.DECISION_REQUIRED);
  }

  const authorityCode = required(
    env.PLATFORM_GOVERNANCE_AUTHORITY_CODE,
    CEREMONY_REFUSAL.AUTHORITY_REQUIRED,
  );
  // THE VOCABULARY GATE, at the door — checked before any database lookup, so a
  // project authority never even becomes a query. The service enforces the same
  // rule independently; this is the outer of two, not a substitute for it.
  if (!PLATFORM_CODES.has(authorityCode)) {
    throw new Error(CEREMONY_REFUSAL.AUTHORITY_NOT_PLATFORM_SCOPED);
  }

  return {
    decision,
    authorityCode,
    holderAccountId: required(
      env.PLATFORM_GOVERNANCE_HOLDER_ACCOUNT_ID,
      CEREMONY_REFUSAL.HOLDER_REQUIRED,
    ),
    // Separate from the holder, deliberately and always. The person executing a
    // grant is not thereby its subject, and the ceremony never fills one in from
    // the other.
    executedByAccountId: required(
      env.PLATFORM_GOVERNANCE_EXECUTED_BY_ACCOUNT_ID,
      CEREMONY_REFUSAL.ACTOR_REQUIRED,
    ),
    // Opaque, required, recorded. SIMPROK states that the act was executed under
    // this reference; it does NOT claim to have verified who issued it.
    ownerAuthorizationReference: required(
      env.PLATFORM_GOVERNANCE_OWNER_AUTHORIZATION_ID,
      CEREMONY_REFUSAL.OWNER_AUTHORIZATION_REQUIRED,
    ),
    reason: required(env.PLATFORM_GOVERNANCE_REASON, CEREMONY_REFUSAL.REASON_REQUIRED),
    idempotencyKey: required(
      env.PLATFORM_GOVERNANCE_IDEMPOTENCY_KEY,
      CEREMONY_REFUSAL.IDEMPOTENCY_KEY_REQUIRED,
    ),
  };
}

/** Refuse to act anywhere but the named production database. */
export async function assertCeremonyDatabase(
  client: Pick<PrismaClient, '$queryRaw'>,
  expected: string = CEREMONY_DATABASE,
): Promise<string> {
  const rows = await client.$queryRaw<Array<{ current_database: string }>>`
    SELECT current_database()
  `;
  const actual = rows[0]?.current_database;
  if (actual !== expected) {
    throw new Error(
      `${CEREMONY_REFUSAL.DATABASE_MISMATCH}: expected ${expected}, got ${actual ?? 'unknown'}.`,
    );
  }
  return actual;
}

export interface CeremonyResult {
  readonly database: string;
  readonly decision: 'GRANT' | 'REVOKE';
  readonly authorityCode: string;
  readonly holderAccountId: string;
  readonly executedByAccountId: string;
  readonly generation: number;
  readonly previousDecisionId: string | null;
  readonly decidedAt: Date;
}

/**
 * Perform the ceremony: validate, then hand the decision to the existing writer.
 *
 * The database guard is a parameter so that a test can prove the ceremony against
 * a guarded test database WITHOUT weakening the production default — the script
 * entry point never passes it, so production always means production.
 */
export async function performCeremony(
  service: PlatformGovernanceService,
  client: Pick<PrismaClient, '$queryRaw'>,
  env: CeremonyEnvironment,
  expectedDatabase: string = CEREMONY_DATABASE,
): Promise<CeremonyResult> {
  const command = commandFromEnvironment(env);
  const database = await assertCeremonyDatabase(client, expectedDatabase);

  const ceremony = {
    holderAccountId: command.holderAccountId,
    authorityCode: command.authorityCode,
    executedByAccountId: command.executedByAccountId,
    ownerAuthorizationReference: command.ownerAuthorizationReference,
    reason: command.reason,
    idempotencyKey: command.idempotencyKey,
  };

  // THE ONLY TWO CALLS THIS FILE MAKES. Everything the decision means —
  // generation, lineage, replay, contention, account liveness, the vocabulary
  // gate again — belongs to the service and stays there.
  const decided =
    command.decision === 'GRANT'
      ? await service.grant(ceremony)
      : await service.revoke(ceremony);

  return {
    database,
    decision: command.decision,
    authorityCode: command.authorityCode,
    holderAccountId: decided.holderAccountId,
    executedByAccountId: decided.executedByAccountId,
    generation: decided.generation,
    previousDecisionId: decided.previousDecisionId,
    decidedAt: decided.decidedAt,
  };
}

/**
 * What the ceremony prints. Deliberately NOT the whole row.
 *
 * The Owner authorization reference is an accountability fact that belongs in the
 * database, not in a terminal scrollback or a CI log.
 */
export function sanitizedCeremonyResult(result: CeremonyResult): string {
  return JSON.stringify(
    {
      database: result.database,
      decision: result.decision,
      authorityCode: result.authorityCode,
      holderAccountId: result.holderAccountId,
      executedByAccountId: result.executedByAccountId,
      generation: result.generation,
      previousDecisionId: result.previousDecisionId,
      decidedAt: result.decidedAt.toISOString(),
      ownerAuthorizationReference: '<redacted>',
    },
    null,
    2,
  );
}
