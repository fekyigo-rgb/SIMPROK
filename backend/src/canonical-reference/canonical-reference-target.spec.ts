import {
  CANONICAL_REFERENCE_DATABASE,
  CANONICAL_REFERENCE_HOST,
  CANONICAL_REFERENCE_PORT,
  CANONICAL_REFERENCE_WORKSPACE_ID,
  CANONICAL_TARGET_PROBE_SQL,
  CanonicalReferenceTargetError,
  assertCanonicalReferenceTarget,
  assertCanonicalReferenceWorkspace,
  assertLiveCanonicalReferenceTarget,
  parseCanonicalTargetFromUrl,
  verifyCanonicalReferenceAuthority,
  type CanonicalProbeClient,
} from './canonical-reference-target';
import {
  ACCEPTANCE_DATABASE,
  E2E_DATABASE,
  FORBIDDEN_PRODUCTION_DATABASE,
  assertAcceptanceEnvironment,
  assertE2EEnvironment,
} from '../../scripts/database-role-guards';

/**
 * RM-03D0 — the canonical reference guard.
 *
 * These tests never touch a database. The live probe is exercised through an
 * injected structural client, which is what lets a guard for production be
 * proven without connecting to production.
 */
describe('RM-03D0 canonical reference target guard', () => {
  const CANONICAL_URL = `postgresql://user:secret@${CANONICAL_REFERENCE_HOST}:${CANONICAL_REFERENCE_PORT}/${CANONICAL_REFERENCE_DATABASE}?schema=public`;

  const probe = (
    rows: Array<Record<string, unknown>>,
  ): CanonicalProbeClient => ({
    query: async () => ({ rows: rows as never }),
  });

  const canonicalRow = {
    current_database: CANONICAL_REFERENCE_DATABASE,
    server_host: CANONICAL_REFERENCE_HOST,
    server_port: CANONICAL_REFERENCE_PORT,
  };

  describe('the exact canonical target is accepted', () => {
    it('parses only the coordinates from a DSN', () => {
      expect(parseCanonicalTargetFromUrl(CANONICAL_URL)).toEqual({
        databaseName: CANONICAL_REFERENCE_DATABASE,
        host: CANONICAL_REFERENCE_HOST,
        port: CANONICAL_REFERENCE_PORT,
      });
    });

    it('accepts the exact canonical coordinates', () => {
      expect(() =>
        assertCanonicalReferenceTarget({
          databaseName: CANONICAL_REFERENCE_DATABASE,
          host: CANONICAL_REFERENCE_HOST,
          port: CANONICAL_REFERENCE_PORT,
        }),
      ).not.toThrow();
    });

    it('accepts the authorized canonical workspace', () => {
      expect(
        assertCanonicalReferenceWorkspace(CANONICAL_REFERENCE_WORKSPACE_ID),
      ).toBe(CANONICAL_REFERENCE_WORKSPACE_ID);
    });

    it('verifies end to end when DSN, live probe and workspace all agree', async () => {
      await expect(
        verifyCanonicalReferenceAuthority({
          databaseUrl: CANONICAL_URL,
          workspaceId: CANONICAL_REFERENCE_WORKSPACE_ID,
          client: probe([canonicalRow]),
        }),
      ).resolves.toEqual({
        target: {
          databaseName: CANONICAL_REFERENCE_DATABASE,
          host: CANONICAL_REFERENCE_HOST,
          port: CANONICAL_REFERENCE_PORT,
        },
        workspaceId: CANONICAL_REFERENCE_WORKSPACE_ID,
      });
    });
  });

  describe('wrong database is refused', () => {
    it.each(['simprok_test', 'simprok_e2e'])(
      'refuses the %s database by name, as a governance error',
      (databaseName) => {
        expect(() =>
          assertCanonicalReferenceTarget({
            databaseName,
            host: CANONICAL_REFERENCE_HOST,
            port: CANONICAL_REFERENCE_PORT,
          }),
        ).toThrow(/STOP_NON_CANONICAL_DATABASE_REFUSED/);
      },
    );

    it('refuses any other database name', () => {
      expect(() =>
        assertCanonicalReferenceTarget({
          databaseName: 'somebody_elses_db',
          host: CANONICAL_REFERENCE_HOST,
          port: CANONICAL_REFERENCE_PORT,
        }),
      ).toThrow(/STOP_CANONICAL_DATABASE_MISMATCH/);
    });
  });

  describe('wrong host or port is refused — the legacy cluster in particular', () => {
    it('refuses a non-loopback host', () => {
      expect(() =>
        assertCanonicalReferenceTarget({
          databaseName: CANONICAL_REFERENCE_DATABASE,
          host: '10.0.0.5',
          port: CANONICAL_REFERENCE_PORT,
        }),
      ).toThrow(/STOP_CANONICAL_HOST_MISMATCH/);
    });

    it('refuses port 5432 — the forbidden legacy cluster', () => {
      expect(() =>
        assertCanonicalReferenceTarget({
          databaseName: CANONICAL_REFERENCE_DATABASE,
          host: CANONICAL_REFERENCE_HOST,
          port: 5432,
        }),
      ).toThrow(/STOP_CANONICAL_PORT_MISMATCH/);
    });

    it('refuses a DSN with no explicit port instead of defaulting to 5432', () => {
      // The trap this closes: an unspecified port silently becoming the
      // postgres default, which is exactly the forbidden legacy cluster.
      expect(() =>
        parseCanonicalTargetFromUrl(
          `postgresql://user:secret@${CANONICAL_REFERENCE_HOST}/${CANONICAL_REFERENCE_DATABASE}`,
        ),
      ).toThrow(/STOP_CANONICAL_TARGET_PORT_UNSPECIFIED/);
    });
  });

  describe('wrong or missing workspace is refused', () => {
    it.each([undefined, null, '', 42, {}])(
      'refuses a non-string or empty workspace (%p)',
      (workspaceId) => {
        expect(() => assertCanonicalReferenceWorkspace(workspaceId)).toThrow(
          /STOP_CANONICAL_WORKSPACE_REQUIRED/,
        );
      },
    );

    it('refuses a different workspace id', () => {
      expect(() =>
        assertCanonicalReferenceWorkspace(
          '00000000-0000-4000-8000-000000000000',
        ),
      ).toThrow(/STOP_CANONICAL_WORKSPACE_MISMATCH/);
    });
  });

  describe('malformed authority is refused, and never echoed', () => {
    it.each([
      ['', /STOP_CANONICAL_TARGET_URL_MISSING/],
      ['not-a-url', /STOP_CANONICAL_TARGET_URL_INVALID/],
      ['mysql://u:p@127.0.0.1:55432/simprok_db', /STOP_CANONICAL_TARGET_URL_INVALID/],
      ['postgresql://u:p@127.0.0.1:55432/', /STOP_CANONICAL_TARGET_URL_INVALID/],
    ])('refuses %s', (url, expected) => {
      expect(() => parseCanonicalTargetFromUrl(url as string)).toThrow(expected);
    });

    it('never puts the credential into the error message', () => {
      const secretUrl =
        'postgresql://simprok_app:SUPER-SECRET-VALUE@127.0.0.1:5432/simprok_db';
      let message = '';
      try {
        assertCanonicalReferenceTarget(parseCanonicalTargetFromUrl(secretUrl));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/STOP_CANONICAL_PORT_MISMATCH/);
      expect(message).not.toContain('SUPER-SECRET-VALUE');
      expect(message).not.toContain('simprok_app:');
      expect(message).not.toContain('postgresql://');
    });
  });

  describe('the live connection is re-proved, not trusted from the DSN', () => {
    it('uses a read-only probe of current_database/host/port', async () => {
      const query = jest.fn().mockResolvedValue({ rows: [canonicalRow] });
      await assertLiveCanonicalReferenceTarget({ query } as never);
      expect(query).toHaveBeenCalledWith(CANONICAL_TARGET_PROBE_SQL);
      expect(CANONICAL_TARGET_PROBE_SQL.toLowerCase()).toContain('select');
      // The probe must never mutate anything.
      expect(CANONICAL_TARGET_PROBE_SQL.toLowerCase()).not.toMatch(
        /insert|update|delete|create|alter|drop/,
      );
    });

    it('refuses when the DSN says canonical but the connection does not', async () => {
      // A right-looking DSN reaching the wrong server (tunnel, pooler, proxy)
      // is exactly why the live probe exists.
      await expect(
        verifyCanonicalReferenceAuthority({
          databaseUrl: CANONICAL_URL,
          workspaceId: CANONICAL_REFERENCE_WORKSPACE_ID,
          client: probe([
            { ...canonicalRow, current_database: 'simprok_test' },
          ]),
        }),
      ).rejects.toThrow(/STOP_NON_CANONICAL_DATABASE_REFUSED/);
    });

    it('refuses when the live server reports the legacy port', async () => {
      await expect(
        assertLiveCanonicalReferenceTarget(
          probe([{ ...canonicalRow, server_port: 5432 }]),
        ),
      ).rejects.toThrow(/STOP_CANONICAL_PORT_MISMATCH/);
    });

    it('refuses an empty or incomplete probe result', async () => {
      await expect(
        assertLiveCanonicalReferenceTarget(probe([])),
      ).rejects.toThrow(/STOP_CANONICAL_TARGET_PROBE_EMPTY/);
      await expect(
        assertLiveCanonicalReferenceTarget(
          probe([{ ...canonicalRow, server_host: null }]),
        ),
      ).rejects.toThrow(/STOP_CANONICAL_TARGET_PROBE_INCOMPLETE/);
    });

    it('accepts a string port from the driver', async () => {
      await expect(
        assertLiveCanonicalReferenceTarget(
          probe([{ ...canonicalRow, server_port: '55432' }]),
        ),
      ).resolves.toEqual({
        databaseName: CANONICAL_REFERENCE_DATABASE,
        host: CANONICAL_REFERENCE_HOST,
        port: CANONICAL_REFERENCE_PORT,
      });
    });
  });

  it('exposes a typed error class so callers can branch on reasonCode', () => {
    const error = new CanonicalReferenceTargetError('STOP_X', 'detail');
    expect(error.reasonCode).toBe('STOP_X');
    expect(error.name).toBe('CanonicalReferenceTargetError');
  });

  /**
   * The independence property, stated against the OTHER guard's own constants
   * rather than against a copy of them. If anyone later weakens the acceptance
   * or E2E guard so that canonical stops being forbidden there, or repoints
   * this guard away from canonical, these assertions fail.
   */
  describe('old law preserved — the guards remain independent and opposed', () => {
    it('targets exactly the database the acceptance/E2E guards forbid', () => {
      expect(FORBIDDEN_PRODUCTION_DATABASE).toBe(CANONICAL_REFERENCE_DATABASE);
    });

    it('acceptance still refuses canonical, with NODE_ENV=test and a canonical DSN', () => {
      expect(() =>
        assertAcceptanceEnvironment({
          databaseUrl: CANONICAL_URL,
          nodeEnv: 'test',
          destructiveCapability: undefined,
        }),
      ).toThrow(/Acceptance database must be exactly simprok_test/);
    });

    it('E2E still refuses canonical, even holding the destructive capability', () => {
      expect(() =>
        assertE2EEnvironment({
          databaseUrl: CANONICAL_URL,
          nodeEnv: 'test',
          destructiveCapability: 'RESET_SIMPROK_E2E_DATABASE',
        }),
      ).toThrow(/E2E database must be exactly simprok_e2e/);
    });

    it('acceptance still accepts its own database, so nothing was broken in passing', () => {
      expect(() =>
        assertAcceptanceEnvironment({
          databaseUrl: 'postgresql://u:p@127.0.0.1:5432/simprok_test',
          nodeEnv: 'test',
          destructiveCapability: undefined,
        }),
      ).not.toThrow();
    });

    it('the canonical guard refuses both test databases in the opposite direction', () => {
      for (const databaseName of [ACCEPTANCE_DATABASE, E2E_DATABASE]) {
        expect(() =>
          assertCanonicalReferenceTarget({
            databaseName,
            host: CANONICAL_REFERENCE_HOST,
            port: CANONICAL_REFERENCE_PORT,
          }),
        ).toThrow(/STOP_NON_CANONICAL_DATABASE_REFUSED/);
      }
    });
  });
});
