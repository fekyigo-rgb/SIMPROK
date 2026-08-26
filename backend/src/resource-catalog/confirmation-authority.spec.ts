import {
  CANONICAL_REFERENCE_CONFIRMATION_TOKEN,
  CONFIRMATION_TOKEN,
  GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
  KNOWN_CONFIRMATION_TOKENS,
  applyBootstrapPlan,
} from './resource-catalog-bootstrap-planner';

/**
 * RM-03D0 — confirmation authority.
 *
 * The reviewed RM-02C1b planner is target-agnostic in its planning, identity
 * and provenance law, but its apply gate demanded a token whose literal text
 * means "apply to simprok_test". RM-03D0 removes only that coupling.
 *
 * These tests pin the property that matters: the two authorities are disjoint
 * and neither can stand in for the other. They stop before any database is
 * involved — every case here is refused at the gate, so a bare object is a
 * sufficient stand-in for Prisma and no connection is ever attempted.
 */
describe('RM-03D0 confirmation authority generalization', () => {
  const neverCalled = {
    $transaction: () => {
      throw new Error('the gate must refuse before any transaction is opened');
    },
  } as never;

  const params = (over: Record<string, unknown> = {}) =>
    ({
      expectedPlanSha256: 'IRRELEVANT',
      confirmationToken: CONFIRMATION_TOKEN,
      workspaceId: 'workspace-1',
      inventory: {} as never,
      inventoryPath: '/dev/null',
      inventorySha256: 'IRRELEVANT',
      generatedFromGitHead: 'HEAD',
      ...over,
    }) as never;

  describe('the two authorities are distinct and closed', () => {
    it('keeps the legacy acceptance token byte-identical', () => {
      expect(CONFIRMATION_TOKEN).toBe('APPLY_RM02C1B_TO_SIMPROK_TEST');
    });

    it('names the canonical authority explicitly', () => {
      expect(CANONICAL_REFERENCE_CONFIRMATION_TOKEN).toBe(
        'APPLY_RM03D0_CANONICAL_REFERENCES',
      );
    });

    it('names the governed rehearsal authority explicitly', () => {
      expect(GOVERNED_REHEARSAL_CONFIRMATION_TOKEN).toBe(
        'APPLY_GOVERNED_REHEARSAL_REFERENCES',
      );
    });

    it('recognises exactly these three authorities and nothing else', () => {
      expect([...KNOWN_CONFIRMATION_TOKENS].sort()).toEqual(
        [
          CONFIRMATION_TOKEN,
          CANONICAL_REFERENCE_CONFIRMATION_TOKEN,
          GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
        ].sort(),
      );
      expect(KNOWN_CONFIRMATION_TOKENS).toHaveLength(3);
    });

    it('never lets one authority describe another target', () => {
      expect(CANONICAL_REFERENCE_CONFIRMATION_TOKEN).not.toMatch(/SIMPROK_TEST/i);
      expect(CONFIRMATION_TOKEN).not.toMatch(/CANONICAL/i);
      // The rehearsal authority must not claim to be canonical, and the
      // canonical one must not claim to be a rehearsal. An audit line that
      // names the wrong environment is the coupling RM-03D0 removed.
      expect(GOVERNED_REHEARSAL_CONFIRMATION_TOKEN).not.toMatch(/CANONICAL/i);
      expect(GOVERNED_REHEARSAL_CONFIRMATION_TOKEN).not.toMatch(
        /SIMPROK_TEST/i,
      );
      expect(CANONICAL_REFERENCE_CONFIRMATION_TOKEN).not.toMatch(/REHEARSAL/i);
      expect(new Set(KNOWN_CONFIRMATION_TOKENS).size).toBe(
        KNOWN_CONFIRMATION_TOKENS.length,
      );
    });
  });

  describe('LEGACY PRESERVED — omitting the expectation behaves exactly as before', () => {
    it('still rejects a wrong token with the original reason code', async () => {
      await expect(
        applyBootstrapPlan(neverCalled, params({ confirmationToken: 'WRONG_TOKEN' })),
      ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
    });

    it('still names the legacy token in the refusal message', async () => {
      await expect(
        applyBootstrapPlan(neverCalled, params({ confirmationToken: 'WRONG_TOKEN' })),
      ).rejects.toThrow(new RegExp(CONFIRMATION_TOKEN));
    });

    it('rejects an empty token', async () => {
      await expect(
        applyBootstrapPlan(neverCalled, params({ confirmationToken: '' })),
      ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
    });
  });

  describe('NO CROSS-AUTHORIZATION', () => {
    it('the acceptance token cannot authorize a canonical apply', async () => {
      await expect(
        applyBootstrapPlan(
          neverCalled,
          params({
            confirmationToken: CONFIRMATION_TOKEN,
            expectedConfirmationToken: CANONICAL_REFERENCE_CONFIRMATION_TOKEN,
          }),
        ),
      ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
    });

    it('the canonical token cannot silently authorize the legacy default path', async () => {
      // No expectation supplied => legacy authority => canonical token refused.
      await expect(
        applyBootstrapPlan(
          neverCalled,
          params({ confirmationToken: CANONICAL_REFERENCE_CONFIRMATION_TOKEN }),
        ),
      ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
    });

    it('the canonical token cannot authorize an explicitly acceptance-expecting apply', async () => {
      await expect(
        applyBootstrapPlan(
          neverCalled,
          params({
            confirmationToken: CANONICAL_REFERENCE_CONFIRMATION_TOKEN,
            expectedConfirmationToken: CONFIRMATION_TOKEN,
          }),
        ),
      ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
    });

    /**
     * THE REHEARSAL AUTHORITY IS NOT A SKELETON KEY. It was added so a
     * rehearsal database could hold the Owner's real reference knowledge; it
     * must never become a way to reach canonical, and canonical must never
     * reach a rehearsal.
     */
    it.each([
      [
        'rehearsal token',
        'canonical apply',
        GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
        CANONICAL_REFERENCE_CONFIRMATION_TOKEN,
      ],
      [
        'rehearsal token',
        'acceptance apply',
        GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
        CONFIRMATION_TOKEN,
      ],
      [
        'canonical token',
        'rehearsal apply',
        CANONICAL_REFERENCE_CONFIRMATION_TOKEN,
        GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
      ],
      [
        'acceptance token',
        'rehearsal apply',
        CONFIRMATION_TOKEN,
        GOVERNED_REHEARSAL_CONFIRMATION_TOKEN,
      ],
    ])(
      'the %s cannot authorize a %s',
      async (
        _supplied,
        _expected,
        confirmationToken,
        expectedConfirmationToken,
      ) => {
        await expect(
          applyBootstrapPlan(
            neverCalled,
            params({ confirmationToken, expectedConfirmationToken }),
          ),
        ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
      },
    );

    it('the rehearsal token cannot silently authorize the legacy default path', async () => {
      // No expectation supplied => legacy authority => rehearsal token refused.
      await expect(
        applyBootstrapPlan(
          neverCalled,
          params({ confirmationToken: GOVERNED_REHEARSAL_CONFIRMATION_TOKEN }),
        ),
      ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
    });
  });

  describe('NO INVENTED AUTHORITY — the allow-list closes the tautology', () => {
    it('refuses an unknown expectation even when the supplied token matches it', async () => {
      // Without membership-before-equality, a caller could pass the same
      // arbitrary string twice and the gate would degrade into "x === x".
      await expect(
        applyBootstrapPlan(
          neverCalled,
          params({
            confirmationToken: 'APPLY_WHATEVER_I_LIKE',
            expectedConfirmationToken: 'APPLY_WHATEVER_I_LIKE',
          }),
        ),
      ).rejects.toThrow(/STOP_UNKNOWN_CONFIRMATION_AUTHORITY/);
    });

    it.each(['', 'apply_rm03d0_canonical_references', 'APPLY_RM03D0_CANONICAL_REFERENCE'])(
      'refuses near-miss expectation %p',
      async (expectedConfirmationToken) => {
        await expect(
          applyBootstrapPlan(
            neverCalled,
            params({
              confirmationToken: expectedConfirmationToken,
              expectedConfirmationToken,
            }),
          ),
        ).rejects.toThrow(/STOP_UNKNOWN_CONFIRMATION_AUTHORITY/);
      },
    );

    it('checks authority before opening any transaction', async () => {
      // neverCalled.$transaction throws a distinctive message; seeing the STOP
      // instead proves nothing was opened.
      await expect(
        applyBootstrapPlan(
          neverCalled,
          params({ confirmationToken: 'WRONG_TOKEN' }),
        ),
      ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
    });
  });
});
