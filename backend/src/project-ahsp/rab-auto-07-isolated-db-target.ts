/**
 * RAB-AUTO-07 test-only guard. No DB mutation, no connection, no credentials.
 * Checks the destination of any proposed E2E run BEFORE a migration or fixture.
 * The existing database-role-guards.ts must ALSO approve the target.
 */
export function assertRabIsolatedDatabaseTarget(raw: string): {
  host: '127.0.0.1';
  port: 56543;
  database: 'simprok_e2e';
  actor: 'simprok_rab_test_admin';
} {
  let uri: URL;
  try {
    uri = new URL(raw);
  } catch {
    throw new Error('RAB_E2E_DATABASE_URL_INVALID');
  }
  // Fail closed, without printing the password, URL or environment variable.
  if (
    !['postgresql:', 'postgres:'].includes(uri.protocol) ||
    uri.hostname !== '127.0.0.1' ||
    uri.port !== '56543' ||
    uri.pathname !== '/simprok_e2e' ||
    decodeURIComponent(uri.username) !== 'simprok_rab_test_admin' ||
    !uri.password ||
    (uri.searchParams.has('schema') &&
      uri.searchParams.get('schema') !== 'public')
  ) {
    throw new Error('RAB_E2E_TARGET_NOT_ISOLATED');
  }
  return {
    host: '127.0.0.1',
    port: 56543,
    database: 'simprok_e2e',
    actor: 'simprok_rab_test_admin',
  };
}
