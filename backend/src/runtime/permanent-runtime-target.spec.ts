import {
  LEGACY_CLUSTER_PORT,
  PERMANENT_RUNTIME_DATABASE,
  PERMANENT_RUNTIME_HOST,
  PERMANENT_RUNTIME_PORT,
  PERMANENT_RUNTIME_ROLE,
  PERMANENT_TARGET_PROBE_SQL,
  PermanentRuntimeTargetError,
  REHEARSAL_CLUSTER_PORT,
  RUNTIME_ENVIRONMENT_ENV,
  assertLivePermanentRuntimeTarget,
  assertPermanentCanonicalBoundary,
  assertPermanentRuntimeRole,
  assertPermanentRuntimeTarget,
  describePermanentRuntimeTarget,
  isCanonicalTargetUrl,
  isPermanentRuntimeDeclared,
  parsePermanentTargetFromUrl,
  verifyPermanentRuntimeTarget,
} from './permanent-runtime-target';

const CANONICAL_URL = `postgresql://simprok_app:p@127.0.0.1:55432/simprok_db?schema=public`;
const PERMANENT = { [RUNTIME_ENVIRONMENT_ENV]: 'PERMANENT' };

/** The one target the forward half accepts, as an already-parsed object. */
const CANONICAL_TARGET = {
  databaseName: PERMANENT_RUNTIME_DATABASE,
  host: PERMANENT_RUNTIME_HOST,
  port: PERMANENT_RUNTIME_PORT,
  role: PERMANENT_RUNTIME_ROLE,
};

function reasonOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof PermanentRuntimeTargetError) return error.reasonCode;
    throw error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

async function asyncReasonOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof PermanentRuntimeTargetError) return error.reasonCode;
    throw error;
  }
  throw new Error('expected a refusal, but the call succeeded');
}

/** A client that answers the probe with whatever coordinates a test names. */
function probeClient(row: Record<string, unknown> | undefined) {
  return {
    query: jest.fn(async (sql: string) => {
      expect(sql).toBe(PERMANENT_TARGET_PROBE_SQL);
      return row === undefined ? [] : [row];
    }),
  } as never;
}

/** A correct live probe answer, so each test varies exactly one field. */
function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    current_database: 'simprok_db',
    server_host: '127.0.0.1',
    server_port: 55432,
    current_role: 'simprok_app',
    session_role: 'simprok_app',
    ...overrides,
  };
}

describe('permanent runtime declaration', () => {
  it('binds only a process that declares itself PERMANENT', () => {
    expect(
      isPermanentRuntimeDeclared({ [RUNTIME_ENVIRONMENT_ENV]: 'PERMANENT' }),
    ).toBe(true);
    expect(
      isPermanentRuntimeDeclared({ [RUNTIME_ENVIRONMENT_ENV]: '  permanent ' }),
    ).toBe(true);
  });

  it('leaves every undeclared or differently-declared runtime alone', () => {
    // These runtimes are kept under OTHER, independent guards. This one must
    // never bind them.
    expect(isPermanentRuntimeDeclared({})).toBe(false);
    expect(
      isPermanentRuntimeDeclared({ [RUNTIME_ENVIRONMENT_ENV]: 'REHEARSAL' }),
    ).toBe(false);
    expect(
      isPermanentRuntimeDeclared({ [RUNTIME_ENVIRONMENT_ENV]: 'TEST' }),
    ).toBe(false);
    expect(isPermanentRuntimeDeclared({ [RUNTIME_ENVIRONMENT_ENV]: '' })).toBe(
      false,
    );
    // NODE_ENV is deliberately not a declaration.
    expect(isPermanentRuntimeDeclared({ NODE_ENV: 'production' })).toBe(false);
  });
});

describe('permanent target parsing', () => {
  it('accepts the canonical DSN and reports only coordinates and role', () => {
    expect(parsePermanentTargetFromUrl(CANONICAL_URL)).toEqual(CANONICAL_TARGET);
  });

  it('percent-decodes the role', () => {
    expect(
      parsePermanentTargetFromUrl(
        'postgresql://simprok%5Fapp:p@127.0.0.1:55432/simprok_db',
      ).role,
    ).toBe('simprok_app');
  });

  it('refuses a DSN that states no port instead of defaulting to 5432', () => {
    expect(
      reasonOf(() =>
        parsePermanentTargetFromUrl(
          'postgresql://simprok_app:p@127.0.0.1/simprok_db',
        ),
      ),
    ).toBe('STOP_PERMANENT_PORT_UNSPECIFIED');
  });

  it('refuses a missing, non-postgres or malformed URL', () => {
    expect(reasonOf(() => parsePermanentTargetFromUrl(undefined))).toBe(
      'STOP_PERMANENT_TARGET_URL_MISSING',
    );
    expect(reasonOf(() => parsePermanentTargetFromUrl(''))).toBe(
      'STOP_PERMANENT_TARGET_URL_MISSING',
    );
    expect(reasonOf(() => parsePermanentTargetFromUrl('not-a-url'))).toBe(
      'STOP_PERMANENT_TARGET_URL_INVALID',
    );
    expect(
      reasonOf(() =>
        parsePermanentTargetFromUrl(
          'mysql://simprok_app:p@127.0.0.1:55432/simprok_db',
        ),
      ),
    ).toBe('STOP_PERMANENT_TARGET_URL_INVALID');
    expect(
      reasonOf(() =>
        parsePermanentTargetFromUrl('postgresql://simprok_app:p@127.0.0.1:55432/'),
      ),
    ).toBe('STOP_PERMANENT_TARGET_URL_INVALID');
  });

  it('refuses a malformed username encoding without echoing it', () => {
    const reason = reasonOf(() =>
      parsePermanentTargetFromUrl('postgresql://%E0%A4%A:p@127.0.0.1:55432/simprok_db'),
    );
    expect(reason).toBe('STOP_PERMANENT_TARGET_URL_INVALID');
  });

  it('never puts any part of the DSN into a refusal message', () => {
    try {
      parsePermanentTargetFromUrl(
        'postgresql://owneruser:sup3rs3cret@127.0.0.1/db',
      );
      throw new Error('expected a refusal');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('sup3rs3cret');
      expect(message).not.toContain('owneruser');
    }
  });
});

describe('permanent target refusal — the wrong targets that actually exist here', () => {
  it('refuses the legacy cluster on the default PostgreSQL port BY NAME', () => {
    expect(
      reasonOf(() =>
        assertPermanentRuntimeTarget({
          ...CANONICAL_TARGET,
          port: LEGACY_CLUSTER_PORT,
        }),
      ),
    ).toBe('STOP_LEGACY_CLUSTER_REFUSED');
  });

  it('refuses the rehearsal cluster BY NAME', () => {
    expect(
      reasonOf(() =>
        assertPermanentRuntimeTarget({
          ...CANONICAL_TARGET,
          port: REHEARSAL_CLUSTER_PORT,
        }),
      ),
    ).toBe('STOP_REHEARSAL_CLUSTER_REFUSED');
  });

  it('refuses `localhost` for the PERMANENT runtime — it must state the address', () => {
    // The forward half is deliberately STRICTER than the inverse half. The
    // permanent runtime states 127.0.0.1 or it does not start, even though
    // localhost would reach the same server.
    expect(
      reasonOf(() =>
        assertPermanentRuntimeTarget({ ...CANONICAL_TARGET, host: 'localhost' }),
      ),
    ).toBe('STOP_PERMANENT_HOST_MISMATCH');
  });

  it('refuses a remote host even on the canonical port and database', () => {
    expect(
      reasonOf(() =>
        assertPermanentRuntimeTarget({ ...CANONICAL_TARGET, host: '10.0.0.5' }),
      ),
    ).toBe('STOP_PERMANENT_HOST_MISMATCH');
  });

  it.each(['simprok_test', 'simprok_e2e'])(
    'refuses the acceptance/E2E database %s with its own verdict',
    (databaseName) => {
      expect(
        reasonOf(() =>
          assertPermanentRuntimeTarget({ ...CANONICAL_TARGET, databaseName }),
        ),
      ).toBe('STOP_NON_PERMANENT_DATABASE_REFUSED');
    },
  );

  it('refuses any other database name', () => {
    expect(
      reasonOf(() =>
        assertPermanentRuntimeTarget({
          ...CANONICAL_TARGET,
          databaseName: 'simprok_b1b12_browser_rehearsal_20260813',
        }),
      ),
    ).toBe('STOP_PERMANENT_DATABASE_MISMATCH');
  });

  it('accepts exactly one target', () => {
    expect(() => assertPermanentRuntimeTarget(CANONICAL_TARGET)).not.toThrow();
  });
});

describe('permanent application role pin', () => {
  it.each(['postgres', 'simprok_cluster_admin', 'simprok_migrator', 'simprok_readonly_audit'])(
    'refuses the over-privileged or wrong role %s at the exact canonical target',
    (role) => {
      expect(
        reasonOf(() =>
          assertPermanentCanonicalBoundary({
            databaseUrl: `postgresql://${role}:p@127.0.0.1:55432/simprok_db`,
            env: PERMANENT,
          }),
        ),
      ).toBe('STOP_PERMANENT_ROLE_MISMATCH');
    },
  );

  it('accepts only simprok_app', () => {
    expect(() => assertPermanentRuntimeRole('simprok_app')).not.toThrow();
    expect(reasonOf(() => assertPermanentRuntimeRole('simprok_app '))).toBe(
      'STOP_PERMANENT_ROLE_MISMATCH',
    );
    expect(reasonOf(() => assertPermanentRuntimeRole('SIMPROK_APP'))).toBe(
      'STOP_PERMANENT_ROLE_MISMATCH',
    );
    expect(reasonOf(() => assertPermanentRuntimeRole(''))).toBe(
      'STOP_PERMANENT_ROLE_MISMATCH',
    );
  });

  it('never echoes the supplied role back in the refusal', () => {
    try {
      assertPermanentRuntimeRole('simprok_cluster_admin');
      throw new Error('expected a refusal');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('simprok_cluster_admin');
      expect(message).toContain('simprok_app');
    }
  });
});

describe('live target re-proof', () => {
  it('accepts a connection whose server reports the canonical coordinates and role', async () => {
    await expect(
      assertLivePermanentRuntimeTarget(probeClient(liveRow())),
    ).resolves.toEqual(CANONICAL_TARGET);
  });

  it('accepts a port reported as a string or bigint', async () => {
    await expect(
      assertLivePermanentRuntimeTarget(probeClient(liveRow({ server_port: '55432' }))),
    ).resolves.toMatchObject({ port: 55432 });
    await expect(
      assertLivePermanentRuntimeTarget(
        probeClient(liveRow({ server_port: BigInt(55432) })),
      ),
    ).resolves.toMatchObject({ port: 55432 });
  });

  it('refuses a RIGHT DSN whose LIVE connection landed on the legacy cluster', async () => {
    // The whole reason the live probe exists: the string was allowed, the
    // socket was not.
    expect(
      await asyncReasonOf(() =>
        assertLivePermanentRuntimeTarget(probeClient(liveRow({ server_port: 5432 }))),
      ),
    ).toBe('STOP_LEGACY_CLUSTER_REFUSED');
  });

  it('refuses a session that AUTHENTICATED as another role', async () => {
    // session_user does not move. A connection that logged in as the migrator
    // and dropped to simprok_app is caught here and nowhere else.
    expect(
      await asyncReasonOf(() =>
        assertLivePermanentRuntimeTarget(
          probeClient(liveRow({ session_role: 'simprok_migrator' })),
        ),
      ),
    ).toBe('STOP_PERMANENT_ROLE_MISMATCH');
  });

  it('refuses a session that ESCALATED after connecting', async () => {
    // current_user does move — SET ROLE, SECURITY DEFINER. Authenticating
    // correctly and then escalating is caught by the current_user assertion.
    expect(
      await asyncReasonOf(() =>
        assertLivePermanentRuntimeTarget(
          probeClient(liveRow({ current_role: 'simprok_cluster_admin' })),
        ),
      ),
    ).toBe('STOP_PERMANENT_ROLE_MISMATCH');
  });

  it('refuses an empty or incomplete probe answer', async () => {
    expect(
      await asyncReasonOf(() =>
        assertLivePermanentRuntimeTarget(probeClient(undefined)),
      ),
    ).toBe('STOP_PERMANENT_TARGET_PROBE_EMPTY');
    expect(
      await asyncReasonOf(() =>
        assertLivePermanentRuntimeTarget(probeClient(liveRow({ server_host: null }))),
      ),
    ).toBe('STOP_PERMANENT_TARGET_PROBE_INCOMPLETE');
    expect(
      await asyncReasonOf(() =>
        assertLivePermanentRuntimeTarget(probeClient(liveRow({ current_role: null }))),
      ),
    ).toBe('STOP_PERMANENT_TARGET_PROBE_INCOMPLETE');
    expect(
      await asyncReasonOf(() =>
        assertLivePermanentRuntimeTarget(probeClient(liveRow({ session_role: null }))),
      ),
    ).toBe('STOP_PERMANENT_TARGET_PROBE_INCOMPLETE');
  });
});

describe('verifyPermanentRuntimeTarget', () => {
  it('never opens a connection when the DSN is already refused', async () => {
    const connect = jest.fn();
    expect(
      await asyncReasonOf(() =>
        verifyPermanentRuntimeTarget({
          databaseUrl: 'postgresql://simprok_app:p@127.0.0.1:5432/simprok_db',
          connect,
        }),
      ),
    ).toBe('STOP_LEGACY_CLUSTER_REFUSED');
    expect(connect).not.toHaveBeenCalled();
  });

  it('never opens a connection when the ROLE is already refused', async () => {
    const connect = jest.fn();
    expect(
      await asyncReasonOf(() =>
        verifyPermanentRuntimeTarget({
          databaseUrl: 'postgresql://simprok_cluster_admin:p@127.0.0.1:55432/simprok_db',
          connect,
        }),
      ),
    ).toBe('STOP_PERMANENT_ROLE_MISMATCH');
    expect(connect).not.toHaveBeenCalled();
  });

  it('proves the DSN and then the live server', async () => {
    const client = probeClient(liveRow());
    await expect(
      verifyPermanentRuntimeTarget({
        databaseUrl: CANONICAL_URL,
        connect: async () => client,
      }),
    ).resolves.toEqual(CANONICAL_TARGET);
  });
});

describe('PERMANENT ⇔ CANONICAL boundary', () => {
  describe('forward half — declared PERMANENT must be canonical', () => {
    it('accepts PERMANENT + canonical + simprok_app', () => {
      expect(
        assertPermanentCanonicalBoundary({ databaseUrl: CANONICAL_URL, env: PERMANENT }),
      ).toEqual({ permanent: true });
    });

    it.each([
      ['legacy cluster', 'postgresql://simprok_app:p@127.0.0.1:5432/simprok_db', 'STOP_LEGACY_CLUSTER_REFUSED'],
      ['rehearsal cluster', 'postgresql://simprok_app:p@127.0.0.1:55433/simprok_db', 'STOP_REHEARSAL_CLUSTER_REFUSED'],
      ['simprok_test', 'postgresql://simprok_app:p@127.0.0.1:55432/simprok_test', 'STOP_NON_PERMANENT_DATABASE_REFUSED'],
      ['simprok_e2e', 'postgresql://simprok_app:p@127.0.0.1:55432/simprok_e2e', 'STOP_NON_PERMANENT_DATABASE_REFUSED'],
      ['localhost', 'postgresql://simprok_app:p@localhost:55432/simprok_db', 'STOP_PERMANENT_HOST_MISMATCH'],
      ['unspecified port', 'postgresql://simprok_app:p@127.0.0.1/simprok_db', 'STOP_PERMANENT_PORT_UNSPECIFIED'],
      ['wrong role', 'postgresql://postgres:p@127.0.0.1:55432/simprok_db', 'STOP_PERMANENT_ROLE_MISMATCH'],
    ])('refuses PERMANENT + %s', (_label, databaseUrl, expected) => {
      expect(
        reasonOf(() =>
          assertPermanentCanonicalBoundary({ databaseUrl, env: PERMANENT }),
        ),
      ).toBe(expected);
    });
  });

  describe('inverse half — canonical requires a PERMANENT declaration', () => {
    const NON_PERMANENT: [string, Record<string, string | undefined>][] = [
      ['UNDECLARED', {}],
      ['DEVELOPMENT', { [RUNTIME_ENVIRONMENT_ENV]: 'DEVELOPMENT' }],
      ['TEST', { [RUNTIME_ENVIRONMENT_ENV]: 'TEST' }],
      ['REHEARSAL', { [RUNTIME_ENVIRONMENT_ENV]: 'REHEARSAL' }],
      ['NODE_ENV=production but undeclared', { NODE_ENV: 'production' }],
    ];

    it.each(NON_PERMANENT)('refuses %s + exact canonical', (_label, env) => {
      expect(
        reasonOf(() =>
          assertPermanentCanonicalBoundary({ databaseUrl: CANONICAL_URL, env }),
        ),
      ).toBe('STOP_CANONICAL_TARGET_REQUIRES_PERMANENT');
    });

    // THE ALIAS SEAM. Each spelling below was PROVEN on this machine to reach
    // 127.0.0.1:55432 and answer as simprok_db. An undeclared runtime must not
    // get in through any of them.
    const CANONICAL_ALIASES = [
      'localhost',
      'LOCALHOST',
      'LocalHost',
      'localhost.',
      'LOCALHOST.',
    ];

    it.each(CANONICAL_ALIASES)(
      'refuses an UNDECLARED runtime reaching canonical via %s',
      (host) => {
        expect(
          reasonOf(() =>
            assertPermanentCanonicalBoundary({
              databaseUrl: `postgresql://simprok_app:p@${host}:55432/simprok_db`,
              env: {},
            }),
          ),
        ).toBe('STOP_CANONICAL_TARGET_REQUIRES_PERMANENT');
      },
    );

    it.each(NON_PERMANENT)('refuses %s + canonical via localhost alias', (_label, env) => {
      expect(
        reasonOf(() =>
          assertPermanentCanonicalBoundary({
            databaseUrl: 'postgresql://simprok_app:p@localhost:55432/simprok_db',
            env,
          }),
        ),
      ).toBe('STOP_CANONICAL_TARGET_REQUIRES_PERMANENT');
    });

    it('refuses the alias regardless of which role the DSN names', () => {
      // The inverse half asks "does this reach canonical", not "is the role
      // right" — an undeclared runtime is refused whatever it calls itself.
      for (const role of ['postgres', 'simprok_migrator', 'simprok_app']) {
        expect(
          reasonOf(() =>
            assertPermanentCanonicalBoundary({
              databaseUrl: `postgresql://${role}:p@localhost:55432/simprok_db`,
              env: {},
            }),
          ),
        ).toBe('STOP_CANONICAL_TARGET_REQUIRES_PERMANENT');
      }
    });

    it('refuses canonical named without the ?schema suffix too', () => {
      expect(
        reasonOf(() =>
          assertPermanentCanonicalBoundary({
            databaseUrl: 'postgres://simprok_app:p@127.0.0.1:55432/simprok_db',
            env: {},
          }),
        ),
      ).toBe('STOP_CANONICAL_TARGET_REQUIRES_PERMANENT');
    });
  });

  describe('it leaves every non-canonical target to its own guard', () => {
    it.each([
      ['legacy simprok_db', 'postgresql://postgres:p@127.0.0.1:5432/simprok_db'],
      ['legacy via localhost', 'postgresql://postgres:p@localhost:5432/simprok_db'],
      ['acceptance', 'postgresql://postgres:p@localhost:5432/simprok_test'],
      ['e2e', 'postgresql://postgres:p@localhost:5432/simprok_e2e'],
      ['rehearsal', 'postgresql://simprok_app:p@127.0.0.1:55433/simprok_b1b12_browser_rehearsal_20260813'],
      ['canonical db name on the rehearsal cluster', 'postgresql://simprok_app:p@localhost:55433/simprok_db'],
      ['no port stated', 'postgresql://simprok_app:p@127.0.0.1/simprok_db'],
      ['unreachable loopback spelling ::1', 'postgresql://simprok_app:p@[::1]:55432/simprok_db'],
      ['unparseable', 'not-a-url'],
    ])('says nothing about %s when undeclared', (_label, databaseUrl) => {
      expect(assertPermanentCanonicalBoundary({ databaseUrl, env: {} })).toEqual({
        permanent: false,
      });
    });

    it('does not require a DATABASE_URL to exist at all', () => {
      expect(assertPermanentCanonicalBoundary({ databaseUrl: undefined, env: {} }))
        .toEqual({ permanent: false });
      expect(assertPermanentCanonicalBoundary({ databaseUrl: '', env: {} }))
        .toEqual({ permanent: false });
    });
  });

  describe('isCanonicalTargetUrl never throws', () => {
    it.each<[string | undefined, boolean]>([
      [undefined, false],
      ['', false],
      ['not-a-url', false],
      ['postgresql://simprok_app:p@127.0.0.1/simprok_db', false],
      ['postgresql://simprok_app:p@127.0.0.1:5432/simprok_db', false],
      ['postgresql://simprok_app:p@127.0.0.1:55432/simprok_test', false],
      // Loopback spellings that CANNOT reach the canonical server, because it
      // listens on 127.0.0.1 only. Not canonical-equivalent.
      ['postgresql://simprok_app:p@[::1]:55432/simprok_db', false],
      ['postgresql://simprok_app:p@127.0.0.2:55432/simprok_db', false],
      ['postgresql://simprok_app:p@127.1:55432/simprok_db', false],
      ['postgresql://simprok_app:p@2130706433:55432/simprok_db', false],
      // Spellings PROVEN to reach it.
      ['postgresql://simprok_app:p@127.0.0.1:55432/simprok_db', true],
      ['postgresql://simprok_app:p@localhost:55432/simprok_db', true],
      ['postgresql://simprok_app:p@LOCALHOST:55432/simprok_db', true],
      ['postgresql://simprok_app:p@localhost.:55432/simprok_db', true],
      ['postgresql://simprok_app:p@LocalHost.:55432/simprok_db', true],
    ])('%s -> %s', (url, expected) => {
      expect(isCanonicalTargetUrl(url)).toBe(expected);
    });
  });

  it('refuses before anything could connect — the check is on the string only', () => {
    // The boundary call takes no client and returns no client. There is
    // nothing it could have opened by the time it throws.
    expect(assertPermanentCanonicalBoundary.length).toBe(1);
    expect(
      reasonOf(() =>
        assertPermanentCanonicalBoundary({ databaseUrl: CANONICAL_URL, env: {} }),
      ),
    ).toBe('STOP_CANONICAL_TARGET_REQUIRES_PERMANENT');
  });
});

describe('startup description', () => {
  it('states the coordinates and role, and no credential', () => {
    const line = describePermanentRuntimeTarget(CANONICAL_TARGET);
    expect(line).toContain('host=127.0.0.1');
    expect(line).toContain('port=55432');
    expect(line).toContain('database=simprok_db');
    expect(line).toContain('role=simprok_app');
    expect(line).not.toMatch(/password|:\/\//i);
  });
});
