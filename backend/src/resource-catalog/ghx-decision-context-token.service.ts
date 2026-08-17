import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

/**
 * GHX-01 — the DECISION CONTEXT TOKEN.
 *
 * WHY A RAW DIGEST WAS NOT ENOUGH
 *
 * A candidate-context digest is a CONTENT HASH, not a capability. Anyone who can
 * see the candidate set can recompute it, and on its own it says nothing about
 * WHICH subject, workspace, actor or policy it was computed for. Accepting a bare
 * digest on the write command would let a caller present a digest obtained for one
 * ambiguity and spend it on a different one. So the server issues a signed,
 * subject-bound, short-lived token instead, and the client only ever echoes it
 * back — it never parses, derives or constructs one.
 *
 * A DEDICATED KEY, AND NO FALLBACK
 *
 * This is signed with GHX_DECISION_CONTEXT_SECRET and nothing else. It must never
 * share the access-token signing secret: two different authorities signed by one
 * key means a flaw in either becomes a flaw in both, and it would make a decision
 * context forgeable by anything that can mint a session. If the secret is absent
 * or too weak, issuance AND verification both refuse — a missing key fails closed
 * rather than silently degrading to some other secret.
 *
 * The `purpose` claim is checked on every verification, so an access token can
 * never be spent here and a decision context can never be spent as a session.
 *
 * WHAT THE SERVER TRUTHFULLY GUARANTEES
 *
 * Only this: the write is bound to a candidate context THIS SERVER ISSUED, for
 * this subject, in this workspace, to this actor, under this policy, at this
 * generation, and still unexpired. It does NOT prove a human visually inspected
 * the candidates — presenting them is the UI's responsibility in a later
 * milestone, and claiming otherwise here would be a false certainty.
 *
 * HMAC-SHA256 over a canonical JSON payload, not a JWT library: the payload is
 * ours, the audience is ourselves, and nothing here needs issuer discovery,
 * algorithm negotiation or key rotation metadata. `alg: none` and algorithm
 * confusion are unrepresentable because no algorithm field is ever read.
 */

export const GHX_DECISION_CONTEXT_PURPOSE = 'GHX01_DECISION_CONTEXT' as const;

/** A short life on purpose: a decision context is meant to be acted on now. */
export const GHX_DECISION_CONTEXT_TTL_SECONDS = 900;

/**
 * Refused below this length. A guard with a trivially guessable key is not a
 * guard, and a rehearsal-grade secret must not be able to sign production truth.
 */
const MINIMUM_SECRET_LENGTH = 32;

export interface GhxDecisionContextClaims {
  readonly purpose: typeof GHX_DECISION_CONTEXT_PURPOSE;
  readonly workspaceId: string;
  readonly ahspResourceId: string;
  readonly originResolutionId: string;
  readonly actorAccountId: string;
  readonly resolutionPolicyVersion: string;
  readonly expectedGeneration: number;
  readonly candidateContextDigest: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** Everything the caller states; the server owns issuedAt/expiresAt/purpose. */
export type GhxDecisionContextInput = Omit<
  GhxDecisionContextClaims,
  'purpose' | 'issuedAt' | 'expiresAt'
>;

export class GhxDecisionContextConfigurationError extends Error {
  constructor(detail: string) {
    super(`STOP_GHX_DECISION_CONTEXT_SECRET_UNAVAILABLE: ${detail}`);
    this.name = 'GhxDecisionContextConfigurationError';
  }
}

function base64url(input: Buffer): string {
  return input.toString('base64url');
}

/**
 * Canonical claim serialization. Keys are emitted in a fixed order rather than
 * whatever `JSON.stringify` happens to produce, so a token verifies against the
 * exact bytes that were signed and never against a re-ordered equivalent.
 */
function encodeClaims(claims: GhxDecisionContextClaims): string {
  return base64url(
    Buffer.from(
      JSON.stringify([
        claims.purpose,
        claims.workspaceId,
        claims.ahspResourceId,
        claims.originResolutionId,
        claims.actorAccountId,
        claims.resolutionPolicyVersion,
        claims.expectedGeneration,
        claims.candidateContextDigest,
        claims.issuedAt,
        claims.expiresAt,
      ]),
      'utf8',
    ),
  );
}

function decodeClaims(payload: string): GhxDecisionContextClaims | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length !== 10) return null;
  const [
    purpose,
    workspaceId,
    ahspResourceId,
    originResolutionId,
    actorAccountId,
    resolutionPolicyVersion,
    expectedGeneration,
    digest,
    issuedAt,
    expiresAt,
  ] = parsed as unknown[];

  if (
    purpose !== GHX_DECISION_CONTEXT_PURPOSE ||
    typeof workspaceId !== 'string' ||
    typeof ahspResourceId !== 'string' ||
    typeof originResolutionId !== 'string' ||
    typeof actorAccountId !== 'string' ||
    typeof resolutionPolicyVersion !== 'string' ||
    typeof expectedGeneration !== 'number' ||
    !Number.isInteger(expectedGeneration) ||
    typeof digest !== 'string' ||
    typeof issuedAt !== 'number' ||
    typeof expiresAt !== 'number'
  ) {
    return null;
  }

  return {
    purpose: GHX_DECISION_CONTEXT_PURPOSE,
    workspaceId,
    ahspResourceId,
    originResolutionId,
    actorAccountId,
    resolutionPolicyVersion,
    expectedGeneration,
    candidateContextDigest: digest,
    issuedAt,
    expiresAt,
  };
}

/** What the write command must prove the token was issued FOR. */
export interface GhxDecisionContextExpectation {
  readonly workspaceId: string;
  readonly ahspResourceId: string;
  readonly originResolutionId: string;
  readonly actorAccountId: string;
  readonly resolutionPolicyVersion: string;
}

@Injectable()
export class GhxDecisionContextTokenService {
  /**
   * Refusals are LOGGED, never remembered.
   *
   * An earlier version kept the last failure reason on the instance. This service
   * is a singleton serving concurrent requests, so that field was shared mutable
   * state: request B could read the reason request A produced, and any code that
   * trusted it would be reading another caller's truth. Diagnosis belongs in the
   * log line for the request that caused it, and nowhere else.
   */
  private readonly logger = new Logger(GhxDecisionContextTokenService.name);

  /**
   * Read lazily rather than at construction so a missing secret disables exactly
   * this capability instead of preventing the whole application from booting.
   * Every other SIMPROK route keeps working; only GHX issuance and verification
   * refuse, which is the item-scoped failure this product law asks for.
   */
  private secret(): string {
    const value = process.env.GHX_DECISION_CONTEXT_SECRET;
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new GhxDecisionContextConfigurationError(
        'GHX_DECISION_CONTEXT_SECRET is not configured. There is no fallback to the access-token secret.',
      );
    }
    if (value.trim().length < MINIMUM_SECRET_LENGTH) {
      throw new GhxDecisionContextConfigurationError(
        `GHX_DECISION_CONTEXT_SECRET must be at least ${MINIMUM_SECRET_LENGTH} characters.`,
      );
    }
    return value;
  }

  private sign(payload: string): string {
    return base64url(
      createHmac('sha256', this.secret()).update(payload, 'utf8').digest(),
    );
  }

  /** `nowSeconds` is injectable so tests state time instead of racing it. */
  issue(input: GhxDecisionContextInput, nowSeconds = Math.floor(Date.now() / 1000)): string {
    const claims: GhxDecisionContextClaims = {
      purpose: GHX_DECISION_CONTEXT_PURPOSE,
      ...input,
      issuedAt: nowSeconds,
      expiresAt: nowSeconds + GHX_DECISION_CONTEXT_TTL_SECONDS,
    };
    const payload = encodeClaims(claims);
    return `${payload}.${this.sign(payload)}`;
  }

  /**
   * Verify integrity FIRST, then every binding, then expiry.
   *
   * Order matters: nothing about an unauthenticated token is trusted enough to
   * compare against real subject ids, so the signature is checked before any
   * claim is read as meaningful.
   */
  verify(
    token: string,
    expectation: GhxDecisionContextExpectation,
    nowSeconds = Math.floor(Date.now() / 1000),
  ): GhxDecisionContextClaims {
    const refuse = (reason: string): never => {
      // ONE MESSAGE FOR EVERY REFUSAL, AND THE REASON NEVER LEAVES THIS PROCESS.
      //
      // An earlier version appended the failing binding ("workspace", "subject",
      // "actor"…) to the thrown message. That was an oracle: a caller could
      // submit a token against varying routes and read back which binding
      // matched, learning that some other workspace's subject exists. The reason
      // is kept for server-side diagnosis only; the client is told solely that
      // the context is unusable.
      // Log-only, scoped to THIS request. Nothing is retained on the instance.
      this.logger.debug(`decision context refused: ${reason}`);
      throw new UnauthorizedException('DECISION_CONTEXT_TOKEN_INVALID');
    };

    if (typeof token !== 'string' || token.length === 0) refuse('missing');
    const separator = token.lastIndexOf('.');
    if (separator < 1) refuse('malformed');

    const payload = token.slice(0, separator);
    const provided = Buffer.from(token.slice(separator + 1), 'utf8');
    const expected = Buffer.from(this.sign(payload), 'utf8');
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      refuse('signature');
    }

    const claims = decodeClaims(payload);
    // A non-GHX token (an access token, say) fails here: its shape is not this
    // shape and its purpose claim is not this purpose.
    if (claims === null) refuse('claims');

    const proven = claims as GhxDecisionContextClaims;
    if (proven.workspaceId !== expectation.workspaceId) refuse('workspace');
    if (proven.ahspResourceId !== expectation.ahspResourceId) refuse('subject');
    if (proven.originResolutionId !== expectation.originResolutionId) refuse('resolution');
    if (proven.actorAccountId !== expectation.actorAccountId) refuse('actor');
    if (proven.resolutionPolicyVersion !== expectation.resolutionPolicyVersion) refuse('policy');
    if (proven.expiresAt <= nowSeconds) refuse('expired');

    return proven;
  }
}
