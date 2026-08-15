import {
  LEGACY_CLUSTER_PORT,
  PERMANENT_RUNTIME_DATABASE,
  PERMANENT_RUNTIME_HOST,
  PERMANENT_RUNTIME_PORT,
  PERMANENT_TARGET_PROBE_SQL,
  PermanentRuntimeTargetError,
  REHEARSAL_CLUSTER_PORT,
  RUNTIME_ENVIRONMENT_ENV,
  assertLivePermanentRuntimeTarget,
  assertPermanentCanonicalBoundary,
  assertPermanentRuntimeTarget,
  describePermanentRuntimeTarget,
  isCanonicalTargetUrl,
  isPermanentRuntimeDeclared,
  parsePermanentTargetFromUrl,
  verifyPermanentRuntimeTarget,
} from './permanent-runtime-target';

const CANONICAL_URL = `postgresql://u:p@127.0.0.1:55432/simprok_db?schema=public`;

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
    // These are the runtimes the repository keeps under OTHER, independent
    // authorities. This guard must never bind them.
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
  it('accepts the canonical DSN and reports only coordinates', () => {
    expect(parsePermanentTargetFromUrl(CANONICAL_URL)).toEqual({
      databaseName: PERMANENT_RUNTIME_DATABASE,
      host: PERMANENT_RUNTIME_HOST,
      port: PERMANENT_RUNTIME_PORT,
    });
  });

  it('refuses a DSN that states no port instead of defaulting to 5432', () => {
    expect(
      reasonOf(() =>
        parsePermanentTargetFromUrl('postgresql://u:p@127.0.0.1/simprok_db'),
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
        parsePermanentTargetFromUrl('mysql://u:p@127.0.0.1:55432/simprok_db'),
      ),
    ).toBe('STOP_PERMANENT_TARGET_URL_INVALID');
    expect(
      reasonOf(() => parsePermanentTargetFromUrl('postgresql://u:p@127.0.0.1:55432/')),
    ).toBe('STOP_PERMANENT_TARGET_URL_INVALID');
  });

  it('never puts any part of the DSN into a refusal message', () => {
    try {
      parsePermanentTargetFromUrl('postgresql://owner:sup3rs3cret@127.0.0.1/db');
      throw new Error('expected a refusal');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('sup3rs3cret');
      expect(message).not.toContain('owner');
    }
  });
});

describe('permanent target refusal — the wrong targets that actually exist here', () => {
  it('refuses the legacy cluster on the default PostgreSQL port BY NAME', () => {
    expect(
      reasonOf(() =>
        assertPermanentRuntimeTarget({
          databaseName: 'simprok_db',
          host: '127.0.0.1',
          port: LEGACY_CLUSTER_PORT,
        }),
      ),
    ).toBe('STOP_LEGACY_CLUSTER_REFUSED');
  });

  it('refuses the rehearsal cluster BY NAME', () => {
    expect(
      reasonOf(() =>
        assertPermanentRuntimeTarget({
          databaseName: 'simprok_db',
          host: '127.0.0.1',
          port: REHEARSAL_CLUSTER_PORT,
        }),
      ),
    ).toBe('STOP_REHEARSAL_CLUSTER_REFUSED');
  });

  it('refuses `localhost`, which can select either loopback stack', () => {
    expect(
      reasonOf(() =>
        assertPermanentRuntimeTarget({
          databaseName: 'simprok_db',
          host: 'localhost',
          port: PERMANENT_RUNTIME_PORT,
        }),
      ),
    ).toBe('STOP_PERMANENT_HOST_MISMATCH');
  });

  it('refuses a remote host even on the canonical port and database', () => {
    expect(
      reasonOf(() =>
        assertPermanentRuntimeTarget({
          databaseName: 'simprok_db',
          host: '10.0.0.5',
          port: PERMANENT_RUNTIME_PORT,
        }),
      ),
    ).toBe('STOP_PERMANENT_HOST_MISMATCH');
  });

  it.each(['simprok_test', 'simprok_e2e'])(
    'refuses the acceptance/E2E database %s with its own verdict',
    (databaseName) => {
      expect(
        reasonOf(() =>
          assertPermanentRuntimeTarget({
            databaseName,
            host: PERMANENT_RUNTIME_HOST,
            port: PERMANENT_RUNTIME_PORT,
          }),
        ),
      ).toBe('STOP_NON_PERMANENT_DATABASE_REFUSED');
    },
  );

  it('refuses any other database name', () => {
    expect(
      reasonOf(() =>
        assertPermanentRuntimeTarget({
          databaseName: 'simprok_b1b12_browser_rehearsal_20260813',
          host: PERMANENT_RUNTIME_HOST,
          port: PERMANENT_RUNTIME_PORT,
        }),
      ),
    ).toBe('STOP_PERMANENT_DATABASE_MISMATCH');
  });

  it('accepts exactly one target', () => {
    expect(() =>
      assertPermanentRuntimeTarget({
        databaseName: PERMANENT_RUNTIME_DATABASE,
        host: PERMANENT_RUNTIME_HOST,
        port: PERMANENT_RUNTIME_PORT,
      }),
    ).not.toThrow();
  });
});

describe('live target re-proof', () => {
  it('accepts a connection whose server reports the canonical coordinates', async () => {
    await expect(
      assertLivePermanentRuntimeTarget(
        probeClient({
          current_database: 'simprok_db',
          server_host: '127.0.0.1',
          server_port: 55432,
        }),
      ),
    ).resolves.toEqual({
      databaseName: 'simprok_db',
      host: '127.0.0.1',
      port: 55432,
    });
  });

  it('accepts a port reported as a string or bigint', async () => {
    await expect(
      assertLivePermanentRuntimeTarget(
        probeClient({
          current_database: 'simprok_db',
          server_host: '127.0.0.1',
          server_port: '55432',
        }),
      ),
    ).resolves.toMatchObject({ port: 55432 });
    await expect(
      assertLivePermanentRuntimeTarget(
        probeClient({
          current_database: 'simprok_db',
          server_host: '127.0.0.1',
          server_port: BigInt(55432),
        }),
      ),
    ).resolves.toMatchObject({ port: 55432 });
  });

  it('refuses a RIGHT DSN whose LIVE connection landed on the legacy cluster', async () => {
    // The whole reason the live probe exists: the string was allowed, the
    // socket was not.
    expect(
      await asyncReasonOf(() =>
        assertLivePermanentRuntimeTarget(
          probeClient({
            current_database: 'simprok_db',
            server_host: '127.0.0.1',
            server_port: 5432,
          }),
        ),
      ),
    ).toBe('STOP_LEGACY_CLUSTER_REFUSED');
  });

  it('refuses an empty or incomplete probe answer', async () => {
    expect(
      await asyncReasonOf(() =>
        assertLivePermanentRuntimeTarget(probeClient(undefined)),
      ),
    ).toBe('STOP_PERMANENT_TARGET_PROBE_EMPTY');
    expect(
      await asyncReasonOf(() =>
        assertLivePermanentRuntimeTarget(
          probeClient({
            current_database: 'simprok_db',
            server_host: null,
            server_port: 55432,
          }),
        ),
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
          databaseUrl: 'postgresql://u:p@127.0.0.1:5432/simprok_db',
          connect,
        }),
      ),
    ).toBe('STOP_LEGACY_CLUSTER_REFUSED');
    expect(connect).not.toHaveBeenCalled();
  });

  it('proves the DSN and then the live server', async () => {
    const client = probeClient({
      current_database: 'simprok_db',
      server_host: '127.0.0.1',
      server_port: 55432,
    });
    await expect(
      verifyPermanentRuntimeTarget({
        databaseUrl: CANONICAL_URL,
        connect: async () => client,
      }),
    ).resolves.toEqual({
      databaseName: 'simprok_db',
      host: '127.0.0.1',
      port: 55432,
    });
  });
});

describe('PERMANENT ⇔ CANONICAL boundary', () => {
  const CANONICAL = 'postgresql://u:p@127.0.0.1:55432/simprok_db?schema=public';
  const PERMANENT = { [RUNTIME_ENVIRONMENT_ENV]: 'PERMANENT' };

  describe('forward half — declared PERMANENT must be canonical', () => {
    it('accepts PERMANENT + canonical', () => {
      expect(
        assertPermanentCanonicalBoundary({ databaseUrl: CANONICAL, env: PERMANENT }),
      ).toEqual({ permanent: true });
    });

    it.each([
      ['legacy cluster', 'postgresql://u:p@127.0.0.1:5432/simprok_db', 'STOP_LEGACY_CLUSTER_REFUSED'],
      ['rehearsal cluster', 'postgresql://u:p@127.0.0.1:55433/simprok_db', 'STOP_REHEARSAL_CLUSTER_REFUSED'],
      ['simprok_test', 'postgresql://u:p@127.0.0.1:55432/simprok_test', 'STOP_NON_PERMANENT_DATABASE_REFUSED'],
      ['simprok_e2e', 'postgresql://u:p@127.0.0.1:55432/simprok_e2e', 'STOP_NON_PERMANENT_DATABASE_REFUSED'],
      ['localhost', 'postgresql://u:p@localhost:55432/simprok_db', 'STOP_PERMANENT_HOST_MISMATCH'],
      ['unspecified port', 'postgresql://u:p@127.0.0.1/simprok_db', 'STOP_PERMANENT_PORT_UNSPECIFIED'],
    ])('refuses PERMANENT + %s', (_label, databaseUrl, expected) => {
      expect(
        reasonOf(() =>
          assertPermanentCanonicalBoundary({ databaseUrl, env: PERMANENT }),
        ),
      ).toBe(expected);
    });
  });

  describe('inverse half — canonical requires a PERMANENT declaration', () => {
    it.each([
      ['UNDECLARED', {}],
      ['DEVELOPMENT', { [RUNTIME_ENVIRONMENT_ENV]: 'DEVELOPMENT' }],
      ['TEST', { [RUNTIME_ENVIRONMENT_ENV]: 'TEST' }],
      ['REHEARSAL', { [RUNTIME_ENVIRONMENT_ENV]: 'REHEARSAL' }],
      ['NODE_ENV=production but undeclared', { NODE_ENV: 'production' }],
    ])('refuses %s + canonical', (_label, env) => {
      expect(
        reasonOf(() =>
          assertPermanentCanonicalBoundary({ databaseUrl: CANONICAL, env }),
        ),
      ).toBe('STOP_CANONICAL_TARGET_REQUIRES_PERMANENT');
    });

    it('refuses canonical named without the ?schema suffix too', () => {
      expect(
        reasonOf(() =>
          assertPermanentCanonicalBoundary({
            databaseUrl: 'postgres://u:p@127.0.0.1:55432/simprok_db',
            env: {},
          }),
        ),
      ).toBe('STOP_CANONICAL_TARGET_REQUIRES_PERMANENT');
    });
  });

  describe('it leaves every non-canonical target to its own guard', () => {
    it.each([
      ['legacy simprok_db', 'postgresql://u:p@127.0.0.1:5432/simprok_db'],
      ['acceptance', 'postgresql://u:p@127.0.0.1:5432/simprok_test'],
      ['e2e', 'postgresql://u:p@127.0.0.1:5432/simprok_e2e'],
      ['rehearsal', 'postgresql://u:p@127.0.0.1:55433/simprok_b1b12_browser_rehearsal_20260813'],
      ['no port stated', 'postgresql://u:p@127.0.0.1/simprok_db'],
      ['unparseable', 'not-a-url'],
    ])('says nothing about %s when undeclared', (_label, databaseUrl) => {
      expect(
        assertPermanentCanonicalBoundary({ databaseUrl, env: {} }),
      ).toEqual({ permanent: false });
    });

    it('does not require a DATABASE_URL to exist at all', () => {
      expect(assertPermanentCanonicalBoundary({ databaseUrl: undefined, env: {} }))
        .toEqual({ permanent: false });
      expect(assertPermanentCanonicalBoundary({ databaseUrl: '', env: {} }))
        .toEqual({ permanent: false });
    });
  });

  describe('isCanonicalTargetUrl never throws', () => {
    it.each([
      [undefined, false],
      ['', false],
      ['not-a-url', false],
      ['postgresql://u:p@127.0.0.1/simprok_db', false],
      ['postgresql://u:p@127.0.0.1:5432/simprok_db', false],
      ['postgresql://u:p@localhost:55432/simprok_db', false],
      ['postgresql://u:p@127.0.0.1:55432/simprok_test', false],
      ['postgresql://u:p@127.0.0.1:55432/simprok_db', true],
    ])('%s -> %s', (url, expected) => {
      expect(isCanonicalTargetUrl(url as string | undefined)).toBe(expected);
    });
  });

  it('refuses before anything could connect — the check is on the string only', () => {
    // The boundary call takes no client and returns no client. There is
    // nothing it could have opened by the time it throws.
    expect(assertPermanentCanonicalBoundary.length).toBe(1);
    expect(
      reasonOf(() =>
        assertPermanentCanonicalBoundary({ databaseUrl: CANONICAL, env: {} }),
      ),
    ).toBe('STOP_CANONICAL_TARGET_REQUIRES_PERMANENT');
  });
});

describe('startup description', () => {
  it('states the coordinates and no credential', () => {
    const line = describePermanentRuntimeTarget({
      databaseName: 'simprok_db',
      host: '127.0.0.1',
      port: 55432,
    });
    expect(line).toContain('host=127.0.0.1');
    expect(line).toContain('port=55432');
    expect(line).toContain('database=simprok_db');
    expect(line).not.toMatch(/password|:\/\//i);
  });
});
