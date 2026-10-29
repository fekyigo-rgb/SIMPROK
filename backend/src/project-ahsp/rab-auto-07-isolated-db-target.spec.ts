import { assertRabIsolatedDatabaseTarget } from './rab-auto-07-isolated-db-target';

describe('RAB-AUTO-07 — database target isolation proof', () => {
  const valid =
    'postgresql://simprok_rab_test_admin:test-only-example@127.0.0.1:56543/simprok_e2e?schema=public';

  it('allows only the dedicated localhost E2E database', () => {
    expect(assertRabIsolatedDatabaseTarget(valid)).toEqual({
      host: '127.0.0.1',
      port: 56543,
      database: 'simprok_e2e',
      actor: 'simprok_rab_test_admin',
    });
  });

  it.each([
    'postgresql://simprok_rab_test_admin:secret@127.0.0.1:5432/simprok_e2e',
    'postgresql://simprok_rab_test_admin:secret@127.0.0.1:56543/simprok_db',
    'postgresql://simprok_rab_test_admin:secret@localhost:56543/simprok_e2e',
    'postgresql://simprok_rab_test_admin:secret@192.168.1.12:56543/simprok_e2e',
    'postgresql://simprok_rab_test_admin:secret@127.0.0.1:56544/simprok_e2e',
    'postgresql://postgres:secret@127.0.0.1:56543/simprok_e2e',
    'postgresql://simprok_rab_test_admin@127.0.0.1:56543/simprok_e2e',
    'postgresql://simprok_rab_test_admin:secret@127.0.0.1:56543/simprok_e2e?schema=production',
    'not-a-connection-string',
  ])(
    'refuses wrong port, database, host, account, password or schema',
    (url) => {
      expect(() => assertRabIsolatedDatabaseTarget(url)).toThrow();
    },
  );

  it('never includes credentials in guard error messages', () => {
    const secret = 'DO-NOT-EXPOSE-PASSWORD';
    try {
      assertRabIsolatedDatabaseTarget(
        `postgresql://postgres:${secret}@127.0.0.1:5432/simprok_db`,
      );
      throw new Error('EXPECTED_REJECTION');
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toMatch(/RAB_E2E_TARGET_NOT_ISOLATED/);
    }
  });
});
