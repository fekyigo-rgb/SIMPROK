import {
  ACCEPTANCE_DATABASE,
  assertAcceptanceEnvironment,
  assertE2EEnvironment,
  assertLiveDatabaseName,
  databaseNameFromUrl,
  E2E_DATABASE,
  E2E_DESTRUCTIVE_CAPABILITY,
} from './database-role-guards';
import {
  ACCEPTANCE_ENV_PATH,
  E2E_ENV_PATH,
} from './database-role-guards';
import {
  compareDatabaseFingerprints,
  resetAndSeedE2EDatabase,
  TableFingerprint,
} from './e2e-database-lifecycle';

const acceptanceEnvironment = {
  databaseUrl:
    'postgresql://user:encoded%40password@localhost:5432/simprok_test?schema=public',
  nodeEnv: 'test',
  destructiveCapability: undefined,
};

const e2eEnvironment = {
  databaseUrl:
    'postgresql://user:encoded%40password@localhost:5432/simprok_e2e?schema=public',
  nodeEnv: 'test',
  destructiveCapability: E2E_DESTRUCTIVE_CAPABILITY,
};

describe('database role guard safety', () => {
  it('uses distinct role-specific environment paths', () => {
    expect(ACCEPTANCE_ENV_PATH).toMatch(/[\\\/]\.env\.test$/);
    expect(E2E_ENV_PATH).toMatch(/[\\\/]\.env\.e2e$/);
    expect(ACCEPTANCE_ENV_PATH).not.toBe(E2E_ENV_PATH);
  });

  it('parses encoded credentials without exposing or splitting them', () => {
    expect(databaseNameFromUrl(e2eEnvironment.databaseUrl)).toBe(E2E_DATABASE);
  });

  it('accepts only the persistent acceptance database without reset authority', () => {
    expect(assertAcceptanceEnvironment(acceptanceEnvironment)).toBe(
      ACCEPTANCE_DATABASE,
    );
  });

  it.each([
    ['E2E database', { databaseUrl: e2eEnvironment.databaseUrl }],
    ['production database', { databaseUrl: 'postgresql://localhost/simprok_db' }],
    ['URL/live role confusion', { databaseUrl: 'postgresql://localhost/other' }],
    ['destructive token', { destructiveCapability: E2E_DESTRUCTIVE_CAPABILITY }],
  ])('acceptance guard rejects %s', (_label, override) => {
    expect(() =>
      assertAcceptanceEnvironment({ ...acceptanceEnvironment, ...override }),
    ).toThrow();
  });

  it('accepts only E2E database with its exact destructive capability', () => {
    expect(assertE2EEnvironment(e2eEnvironment)).toBe(E2E_DATABASE);
  });

  it('rejects URL/live database role mismatches', () => {
    expect(() =>
      assertLiveDatabaseName(ACCEPTANCE_DATABASE, E2E_DATABASE),
    ).toThrow('Live database must be exactly simprok_e2e');
    expect(() =>
      assertLiveDatabaseName(E2E_DATABASE, ACCEPTANCE_DATABASE),
    ).toThrow('Live database must be exactly simprok_test');
  });

  it.each([
    ['acceptance database', { databaseUrl: acceptanceEnvironment.databaseUrl }],
    ['production database', { databaseUrl: 'postgresql://localhost/simprok_db' }],
    ['missing token', { destructiveCapability: undefined }],
    ['wrong token', { destructiveCapability: 'RESET_SOMETHING_ELSE' }],
    ['non-test environment', { nodeEnv: 'development' }],
  ])('E2E guard rejects %s', (_label, override) => {
    expect(() => assertE2EEnvironment({ ...e2eEnvironment, ...override })).toThrow();
  });

  it('fails malformed URLs without including their value in the error', () => {
    const malformed = 'not a database URL with secret-fragment';
    expect(() => databaseNameFromUrl(malformed)).toThrow(
      'DATABASE_URL is not a valid URL',
    );
    try {
      databaseNameFromUrl(malformed);
    } catch (error) {
      expect(String(error)).not.toContain('secret-fragment');
    }
  });
});

describe('E2E database lifecycle residual safety', () => {
  it('rejects unverified reset authority before invoking a command', async () => {
    await expect(resetAndSeedE2EDatabase({} as never)).rejects.toThrow(
      'Verified E2E destructive authority is required',
    );
  });

  it('compares sorted deterministic fingerprints without relying on input order', () => {
    const baseline: TableFingerprint[] = [
      { table: 'Workspace', rowCount: 2, digest: 'bbb' },
      { table: 'Account', rowCount: 4, digest: 'aaa' },
    ];
    expect(compareDatabaseFingerprints(baseline, [...baseline].reverse())).toEqual([]);
  });

  it('reports count and content residuals separately by table', () => {
    const baseline: TableFingerprint[] = [
      { table: 'Account', rowCount: 4, digest: 'aaa' },
      { table: 'Workspace', rowCount: 2, digest: 'bbb' },
    ];
    const final: TableFingerprint[] = [
      { table: 'Account', rowCount: 5, digest: 'ccc' },
      { table: 'Workspace', rowCount: 2, digest: 'changed' },
    ];
    expect(compareDatabaseFingerprints(baseline, final).map(({ table }) => table)).toEqual([
      'Account',
      'Workspace',
    ]);
  });
});
