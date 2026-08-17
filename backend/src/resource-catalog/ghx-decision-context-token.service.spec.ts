/**
 * GHX-01 — the decision-context token, attacked.
 *
 * The token is the only thing standing between "an authorized human decided this
 * ambiguity" and "someone replayed a context they were never issued". Every case
 * below is an attempt to spend a context somewhere it does not belong.
 */
import {
  GHX_DECISION_CONTEXT_PURPOSE,
  GHX_DECISION_CONTEXT_TTL_SECONDS,
  GhxDecisionContextConfigurationError,
  GhxDecisionContextTokenService,
} from './ghx-decision-context-token.service';

const SECRET = 'ghx-test-only-secret-value-0123456789abcdef';
const OTHER_SECRET = 'a-different-test-only-secret-0123456789abcd';

const EXPECTATION = {
  workspaceId: 'ws-1',
  ahspResourceId: 'ahspres-X',
  originResolutionId: 'res-1',
  actorAccountId: 'acct-andi',
  resolutionPolicyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V2',
};

const INPUT = { ...EXPECTATION, expectedGeneration: 0, candidateContextDigest: 'digest-AB' };

const NOW = 1_800_000_000;

describe('GhxDecisionContextTokenService', () => {
  let service: GhxDecisionContextTokenService;

  beforeEach(() => {
    process.env.GHX_DECISION_CONTEXT_SECRET = SECRET;
    service = new GhxDecisionContextTokenService();
  });
  afterEach(() => {
    delete process.env.GHX_DECISION_CONTEXT_SECRET;
    delete process.env.JWT_SECRET;
  });

  it('issues a token that verifies against the exact context it was issued for', () => {
    const claims = service.verify(service.issue(INPUT, NOW), EXPECTATION, NOW + 10);

    expect(claims).toMatchObject({
      purpose: GHX_DECISION_CONTEXT_PURPOSE,
      workspaceId: 'ws-1',
      ahspResourceId: 'ahspres-X',
      candidateContextDigest: 'digest-AB',
      expectedGeneration: 0,
      expiresAt: NOW + GHX_DECISION_CONTEXT_TTL_SECONDS,
    });
  });

  // ---------- REPLAY: the token is a capability, not a content hash ----------
  it.each([
    ['CROSS_ACTOR', { actorAccountId: 'acct-budi' }],
    ['CROSS_WORKSPACE', { workspaceId: 'ws-2' }],
    ['CROSS_SUBJECT', { ahspResourceId: 'ahspres-Y' }],
    ['CROSS_RESOLUTION', { originResolutionId: 'res-2' }],
    ['CROSS_POLICY', { resolutionPolicyVersion: 'E1A_CONTEXTUAL_EXACT_REGION_V1' }],
  ])('%s replay is refused', (_label, override) => {
    const token = service.issue(INPUT, NOW);

    expect(() =>
      service.verify(token, { ...EXPECTATION, ...override }, NOW + 10),
    ).toThrow(/DECISION_CONTEXT_TOKEN_INVALID/u);
  });

  it('an IDENTICAL candidate digest on another subject authorizes nothing', () => {
    // The exact hostile shape a bare digest could not defend: two subjects whose
    // candidate sets are byte-identical. The signature covers the subject, so the
    // matching digest buys the caller nothing at all.
    const token = service.issue(INPUT, NOW);

    expect(() =>
      service.verify(token, { ...EXPECTATION, ahspResourceId: 'ahspres-Y' }, NOW + 10),
    ).toThrow(/DECISION_CONTEXT_TOKEN_INVALID/u);
  });

  // ---------- NO BINDING ORACLE (PM delta correction) ----------
  it('every refusal is byte-identical — the message names no binding', () => {
    // An earlier version appended the failing binding to the thrown message,
    // which let a caller probe which workspace/subject/actor actually exists.
    // Every distinguishable failure must now look the same from outside.
    const token = service.issue(INPUT, NOW);
    const messages = new Set<string>();
    const attempts: Array<() => unknown> = [
      () => service.verify(token, { ...EXPECTATION, workspaceId: 'ws-2' }, NOW + 10),
      () => service.verify(token, { ...EXPECTATION, ahspResourceId: 'ahspres-Y' }, NOW + 10),
      () => service.verify(token, { ...EXPECTATION, actorAccountId: 'acct-budi' }, NOW + 10),
      () => service.verify(token, { ...EXPECTATION, originResolutionId: 'res-2' }, NOW + 10),
      () => service.verify(token, { ...EXPECTATION, resolutionPolicyVersion: 'V1' }, NOW + 10),
      () => service.verify(token, EXPECTATION, NOW + 10_000),
      () => service.verify('tampered.signature', EXPECTATION, NOW + 10),
      () => service.verify('', EXPECTATION, NOW + 10),
    ];

    for (const attempt of attempts) {
      try {
        attempt();
        throw new Error('expected refusal');
      } catch (error) {
        messages.add((error as Error).message);
      }
    }

    expect([...messages]).toEqual(['DECISION_CONTEXT_TOKEN_INVALID']);
  });

  it('no per-request failure reason is retained as shared service state', () => {
    // The service is a singleton serving concurrent requests; a remembered
    // reason would let one caller read another caller's failure.
    try {
      service.verify(service.issue(INPUT, NOW), { ...EXPECTATION, workspaceId: 'ws-2' }, NOW);
    } catch (error) {
      expect((error as Error).message).toBe('DECISION_CONTEXT_TOKEN_INVALID');
    }
    expect(Object.keys(service)).not.toContain('lastRefusalReason');
    expect((service as unknown as Record<string, unknown>).lastRefusal).toBeUndefined();
  });

  it('an expired token is refused even when every binding matches', () => {
    const token = service.issue(INPUT, NOW);

    expect(() =>
      service.verify(token, EXPECTATION, NOW + GHX_DECISION_CONTEXT_TTL_SECONDS + 1),
    ).toThrow(/DECISION_CONTEXT_TOKEN_INVALID/u);
  });

  it('a tampered payload is refused — claims cannot be edited in flight', () => {
    const token = service.issue(INPUT, NOW);
    const [payload, signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify([
        GHX_DECISION_CONTEXT_PURPOSE, 'ws-1', 'ahspres-X', 'res-1', 'acct-andi',
        'E1A_CONTEXTUAL_EXACT_REGION_V2', 0, 'digest-SOMETHING-ELSE', NOW, NOW + 900,
      ]),
      'utf8',
    ).toString('base64url');

    expect(payload).not.toBe(forged);
    expect(() => service.verify(`${forged}.${signature}`, EXPECTATION, NOW + 10)).toThrow(
      /DECISION_CONTEXT_TOKEN_INVALID/u,
    );
  });

  it('a token signed with a different key is refused', () => {
    process.env.GHX_DECISION_CONTEXT_SECRET = OTHER_SECRET;
    const foreign = new GhxDecisionContextTokenService().issue(INPUT, NOW);
    process.env.GHX_DECISION_CONTEXT_SECRET = SECRET;

    expect(() => service.verify(foreign, EXPECTATION, NOW + 10)).toThrow(
      /DECISION_CONTEXT_TOKEN_INVALID/u,
    );
  });

  // ---------- TOKEN CONFUSION ----------
  it('an access-token-shaped JWT is refused as a decision context', () => {
    const jwtish =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhY2N0LWFuZGkifQ.c2lnbmF0dXJl';

    expect(() => service.verify(jwtish, EXPECTATION, NOW)).toThrow(
      /DECISION_CONTEXT_TOKEN_INVALID/u,
    );
  });

  it('a decision-context token carries a purpose claim, so it cannot pose as a session', () => {
    const [payload] = service.issue(INPUT, NOW).split('.');
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    expect(decoded[0]).toBe(GHX_DECISION_CONTEXT_PURPOSE);
  });

  it.each([['missing', ''], ['malformed', 'not-a-token'], ['no-signature', 'abc.']])(
    'a %s token is refused',
    (_label, token) => {
      expect(() => service.verify(token, EXPECTATION, NOW)).toThrow(
        /DECISION_CONTEXT_TOKEN_INVALID/u,
      );
    },
  );

  // ---------- FAIL-CLOSED CONFIGURATION ----------
  it('refuses to issue OR verify when the dedicated secret is absent', () => {
    delete process.env.GHX_DECISION_CONTEXT_SECRET;

    expect(() => service.issue(INPUT, NOW)).toThrow(GhxDecisionContextConfigurationError);
    expect(() => service.verify('a.b', EXPECTATION, NOW)).toThrow(
      GhxDecisionContextConfigurationError,
    );
  });

  it('NEVER falls back to the access-token secret', () => {
    // THE load-bearing separation. With only JWT_SECRET present the capability
    // must refuse — silently borrowing the session key would make any component
    // that can mint a login able to forge a governed decision context.
    delete process.env.GHX_DECISION_CONTEXT_SECRET;
    process.env.JWT_SECRET = 'an-access-token-secret-that-must-not-be-used-here';

    expect(() => service.issue(INPUT, NOW)).toThrow(
      /GHX_DECISION_CONTEXT_SECRET is not configured/u,
    );
  });

  it('refuses a secret too weak to be a guard', () => {
    process.env.GHX_DECISION_CONTEXT_SECRET = 'short';

    expect(() => new GhxDecisionContextTokenService().issue(INPUT, NOW)).toThrow(
      GhxDecisionContextConfigurationError,
    );
  });
});
