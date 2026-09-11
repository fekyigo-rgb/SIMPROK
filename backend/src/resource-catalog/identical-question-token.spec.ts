import { UnauthorizedException } from '@nestjs/common';

import {
  GhxDecisionContextConfigurationError,
  GhxDecisionContextTokenService,
  GHX_DECISION_CONTEXT_TTL_SECONDS,
} from './ghx-decision-context-token.service';

/**
 * IQL-01 — the exact-question decision context: the SAME signing machinery as
 * GHX, a different purpose and a different claim tuple, so the two can never be
 * spent in each other's place.
 */
describe('IQL-01 decision context (second purpose of the GHX token service)', () => {
  const ORIGINAL = process.env.GHX_DECISION_CONTEXT_SECRET;
  const tokens = new GhxDecisionContextTokenService();
  const NOW = 1_800_000_000;

  const input = {
    workspaceId: 'ws-A',
    questionKey: 'a'.repeat(64),
    actorAccountId: 'acct-owner',
    resolutionPolicyVersion: 'IQL01_IDENTICAL_QUESTION_V1',
    expectedGeneration: 0,
    candidateContextDigest: 'digest-A',
  };
  const expectation = {
    workspaceId: 'ws-A',
    questionKey: 'a'.repeat(64),
    actorAccountId: 'acct-owner',
    resolutionPolicyVersion: 'IQL01_IDENTICAL_QUESTION_V1',
  };

  beforeEach(() => {
    process.env.GHX_DECISION_CONTEXT_SECRET = 'iql01-test-secret-'.padEnd(
      48,
      'x',
    );
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.GHX_DECISION_CONTEXT_SECRET;
    else process.env.GHX_DECISION_CONTEXT_SECRET = ORIGINAL;
  });

  it('issues and verifies a context bound to workspace, question, actor, policy, generation and digest', () => {
    const token = tokens.issueIdenticalQuestionContext(input, NOW);
    const claims = tokens.verifyIdenticalQuestionContext(
      token,
      expectation,
      NOW + 1,
    );
    expect(claims).toMatchObject({
      purpose: 'IQL01_DECISION_CONTEXT',
      ...input,
      issuedAt: NOW,
      expiresAt: NOW + GHX_DECISION_CONTEXT_TTL_SECONDS,
    });
  });

  it.each([
    ['another actor', { actorAccountId: 'acct-second' }],
    ['another question', { questionKey: 'b'.repeat(64) }],
    ['another workspace', { workspaceId: 'ws-B' }],
    ['another policy', { resolutionPolicyVersion: 'OTHER_V1' }],
  ])('refuses a context presented for %s', (_label, change) => {
    const token = tokens.issueIdenticalQuestionContext(input, NOW);
    expect(() =>
      tokens.verifyIdenticalQuestionContext(
        token,
        { ...expectation, ...change },
        NOW + 1,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('refuses an expired context', () => {
    const token = tokens.issueIdenticalQuestionContext(input, NOW);
    expect(() =>
      tokens.verifyIdenticalQuestionContext(
        token,
        expectation,
        NOW + GHX_DECISION_CONTEXT_TTL_SECONDS,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('refuses a tampered payload', () => {
    const token = tokens.issueIdenticalQuestionContext(input, NOW);
    const [payload, signature] = token.split('.');
    const forged =
      Buffer.from(
        JSON.stringify([
          'IQL01_DECISION_CONTEXT',
          'ws-A',
          'a'.repeat(64),
          'acct-owner',
          'IQL01_IDENTICAL_QUESTION_V1',
          9,
          'digest-A',
          NOW,
          NOW + 900,
        ]),
      ).toString('base64url') +
      '.' +
      signature;
    expect(payload).not.toBe(forged.split('.')[0]);
    expect(() =>
      tokens.verifyIdenticalQuestionContext(forged, expectation, NOW + 1),
    ).toThrow(UnauthorizedException);
  });

  it('a GHX context can NEVER be spent as an IQL context, and vice versa', () => {
    const ghx = tokens.issue(
      {
        workspaceId: 'ws-A',
        ahspResourceId: 'a'.repeat(64),
        originResolutionId: 'res-1',
        actorAccountId: 'acct-owner',
        resolutionPolicyVersion: 'IQL01_IDENTICAL_QUESTION_V1',
        expectedGeneration: 0,
        candidateContextDigest: 'digest-A',
      },
      NOW,
    );
    expect(() =>
      tokens.verifyIdenticalQuestionContext(ghx, expectation, NOW + 1),
    ).toThrow(UnauthorizedException);
    const iql = tokens.issueIdenticalQuestionContext(input, NOW);
    expect(() =>
      tokens.verify(
        iql,
        {
          workspaceId: 'ws-A',
          ahspResourceId: 'a'.repeat(64),
          originResolutionId: 'res-1',
          actorAccountId: 'acct-owner',
          resolutionPolicyVersion: 'IQL01_IDENTICAL_QUESTION_V1',
        },
        NOW + 1,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('with no secret configured, issuance fails closed — there is no fallback key', () => {
    delete process.env.GHX_DECISION_CONTEXT_SECRET;
    expect(() => tokens.issueIdenticalQuestionContext(input, NOW)).toThrow(
      GhxDecisionContextConfigurationError,
    );
  });
});
