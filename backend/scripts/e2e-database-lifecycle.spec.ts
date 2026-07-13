import {
  assertLiveDatabaseName,
  assertSafeTestDatabaseEnvironment,
  DESTRUCTIVE_CAPABILITY,
} from './test-database-guard';
import {
  compareDatabaseFingerprints,
  TableFingerprint,
} from './e2e-database-lifecycle';

const safeEnvironment = {
  databaseUrl: 'postgresql://user:secret@localhost:5432/simprok_test?schema=public',
  nodeEnv: 'test',
  destructiveCapability: DESTRUCTIVE_CAPABILITY,
};

describe('E2E database lifecycle safety', () => {
  it('accepts only the exact test database with explicit destructive capability', () => {
    expect(assertSafeTestDatabaseEnvironment(safeEnvironment)).toBe('simprok_test');
    expect(() => assertLiveDatabaseName('simprok_test')).not.toThrow();
  });

  it.each([
    ['production database', { databaseUrl: 'postgresql://localhost/simprok_db' }],
    ['other database', { databaseUrl: 'postgresql://localhost/other_test' }],
    ['non-test NODE_ENV', { nodeEnv: 'development' }],
    ['missing capability', { destructiveCapability: undefined }],
    ['wrong capability', { destructiveCapability: 'yes' }],
  ])('rejects %s', (_label, override) => {
    expect(() =>
      assertSafeTestDatabaseEnvironment({ ...safeEnvironment, ...override }),
    ).toThrow();
  });

  it.each(['simprok_db', 'other_test', undefined])(
    'rejects unsafe live database %s',
    (databaseName) => {
      expect(() => assertLiveDatabaseName(databaseName)).toThrow();
    },
  );

  it('compares sorted deterministic fingerprints without relying on input order', () => {
    const baseline: TableFingerprint[] = [
      { table: 'Workspace', rowCount: 2, digest: 'bbb' },
      { table: 'Account', rowCount: 4, digest: 'aaa' },
    ];
    const reordered = [...baseline].reverse();

    expect(compareDatabaseFingerprints(baseline, reordered)).toEqual([]);
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
