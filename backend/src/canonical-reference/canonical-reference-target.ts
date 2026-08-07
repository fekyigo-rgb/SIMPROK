/**
 * RM-03D0 — the canonical-reference target guard.
 *
 * This is a NEW, NARROW guard. It does not touch, relax or share code paths
 * with the acceptance and E2E guards in scripts/database-role-guards.ts —
 * those keep treating `simprok_db` as FORBIDDEN_PRODUCTION_DATABASE, which is
 * correct for them and must stay correct. The two authorities are independent
 * by construction: nothing here can make an acceptance path accept canonical,
 * and nothing there can make this path accept a test database.
 *
 * It lives in src/ rather than scripts/ deliberately. Everything below is pure
 * (or takes an injected client), so it is covered by the standard `npm test`
 * gate — the CLI wrapper in scripts/ is left as thin wiring, mirroring how
 * resource-catalog-bootstrap-planner.ts keeps its law testable and its
 * environment guard outside.
 *
 * SECRET DISCIPLINE: no function here ever puts a connection string, password
 * or any part of a credential into an error message, a return value or a log.
 * The DSN is parsed and discarded; only the database name, host and port —
 * which the task explicitly permits reporting — ever leave this module.
 */

/** The one canonical database RM-03D0 reference provisioning may ever target. */
export const CANONICAL_REFERENCE_DATABASE = 'simprok_db';

/** Canonical cluster is loopback-only; the legacy cluster on 5432 is forbidden. */
export const CANONICAL_REFERENCE_HOST = '127.0.0.1';
export const CANONICAL_REFERENCE_PORT = 55432;

/**
 * The one workspace authorized to own canonical reference data, from the
 * RM-03D0 verified baseline. Reference rows are never attributed to a
 * workspace inferred at runtime.
 */
export const CANONICAL_REFERENCE_WORKSPACE_ID =
  'a9978fab-d1fc-4bb3-9beb-5d8b89d973e3';

/**
 * The ONE database role permitted to perform a canonical reference WRITE.
 *
 * `simprok_app` is the existing least-privileged role that already holds
 * INSERT on the bounded reference tables. `simprok_migrator` owns every table
 * and `simprok_cluster_admin` is superuser — either would work and both are
 * far too much authority for adding a Region and a resource catalog. Writing
 * as them would also make the audit trail attribute reference data to a
 * schema-owner rather than to the application identity that owns it.
 *
 * Enforced on APPLY only. A dry-run reads nothing it may not read, so it is
 * deliberately allowed to run as `simprok_readonly_audit` — forcing a
 * read-only rehearsal to hold a writer credential would be the opposite of
 * least privilege.
 */
export const CANONICAL_REFERENCE_WRITER_ROLE = 'simprok_app';

/**
 * The acceptance/E2E databases, named here ONLY so this guard can refuse them
 * with a precise reason instead of a generic mismatch. This module never
 * grants anything to them.
 */
export const NON_CANONICAL_DATABASES: readonly string[] = [
  'simprok_test',
  'simprok_e2e',
];

export class CanonicalReferenceTargetError extends Error {
  constructor(
    public readonly reasonCode: string,
    detail: string,
  ) {
    super(`${reasonCode}: ${detail}`);
    this.name = 'CanonicalReferenceTargetError';
  }
}

export interface CanonicalTarget {
  databaseName: string;
  host: string;
  port: number;
}

/**
 * Extracts ONLY the target coordinates from a DSN. Credentials are never
 * returned and never appear in any thrown message — a malformed URL reports
 * that it is malformed, not what it contained.
 */
export function parseCanonicalTargetFromUrl(databaseUrl: string): CanonicalTarget {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_TARGET_URL_MISSING',
      'A database URL is required to resolve the canonical reference target.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_TARGET_URL_INVALID',
      'The supplied database URL is not a valid URL.',
    );
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_TARGET_URL_INVALID',
      'The supplied database URL must use the PostgreSQL protocol.',
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_TARGET_URL_INVALID',
      'The supplied database URL has an invalid database-name encoding.',
    );
  }
  if (!databaseName || databaseName.includes('/')) {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_TARGET_URL_INVALID',
      'The supplied database URL must contain exactly one database name.',
    );
  }

  // An absent port is NOT defaulted to 5432. Silently assuming the postgres
  // default would let a DSN aimed at the forbidden legacy cluster pass as
  // "unspecified"; the canonical target is explicit or it is refused.
  if (parsed.port === '') {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_TARGET_PORT_UNSPECIFIED',
      'The database URL must state its port explicitly; no default is assumed.',
    );
  }

  return {
    databaseName,
    host: parsed.hostname,
    port: Number(parsed.port),
  };
}

/**
 * Fails closed on every axis. Each mismatch gets its own reason code so an
 * operator learns which coordinate was wrong without the DSN being echoed.
 */
export function assertCanonicalReferenceTarget(target: CanonicalTarget): void {
  if (target.databaseName !== CANONICAL_REFERENCE_DATABASE) {
    // Named refusal for the test databases, so pointing an acceptance DSN here
    // reads as a governance error rather than a typo.
    const reason = NON_CANONICAL_DATABASES.includes(target.databaseName)
      ? 'STOP_NON_CANONICAL_DATABASE_REFUSED'
      : 'STOP_CANONICAL_DATABASE_MISMATCH';
    throw new CanonicalReferenceTargetError(
      reason,
      `Canonical reference provisioning targets exactly ${CANONICAL_REFERENCE_DATABASE}.`,
    );
  }
  if (target.host !== CANONICAL_REFERENCE_HOST) {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_HOST_MISMATCH',
      `Canonical reference provisioning targets exactly host ${CANONICAL_REFERENCE_HOST}.`,
    );
  }
  if (target.port !== CANONICAL_REFERENCE_PORT) {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_PORT_MISMATCH',
      `Canonical reference provisioning targets exactly port ${CANONICAL_REFERENCE_PORT}.`,
    );
  }
}

/** The workspace is authorized explicitly, never discovered at runtime. */
export function assertCanonicalReferenceWorkspace(workspaceId: unknown): string {
  if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_WORKSPACE_REQUIRED',
      'An explicit canonical workspace id is required.',
    );
  }
  if (workspaceId !== CANONICAL_REFERENCE_WORKSPACE_ID) {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_WORKSPACE_MISMATCH',
      'The supplied workspace is not the authorized canonical reference workspace.',
    );
  }
  return workspaceId;
}

/** Structural subset of a pg/Prisma-style client, so tests need no database. */
export interface CanonicalProbeClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
  ): Promise<{ rows: Row[] }>;
}

interface LiveTargetRow extends Record<string, unknown> {
  current_database: string;
  server_host: string | null;
  server_port: number | string | null;
  current_role: string | null;
}

export const CANONICAL_TARGET_PROBE_SQL =
  "select current_database() as current_database, host(inet_server_addr()) as server_host, inet_server_port() as server_port, current_user as current_role";

/**
 * The role is always PROBED, but only ENFORCED on apply — see
 * CANONICAL_REFERENCE_WRITER_ROLE. Reporting it even on a dry-run means an
 * operator can see which identity a rehearsal ran as without being forced to
 * hold a writer credential to rehearse.
 */
export function assertCanonicalReferenceWriterRole(currentRole: unknown): string {
  if (typeof currentRole !== 'string' || currentRole.length === 0) {
    throw new CanonicalReferenceTargetError(
      'STOP_REFERENCE_WRITE_ROLE_UNKNOWN',
      'The live connection did not report a current role.',
    );
  }
  if (currentRole !== CANONICAL_REFERENCE_WRITER_ROLE) {
    throw new CanonicalReferenceTargetError(
      'STOP_REFERENCE_WRITE_ROLE_MISMATCH',
      `Canonical reference writes must run as exactly ${CANONICAL_REFERENCE_WRITER_ROLE}.`,
    );
  }
  return currentRole;
}

/**
 * Re-proves the target against the SERVER, not against the DSN we were handed.
 *
 * A DSN can be right while the connection is not — a proxy, a tunnel, a stale
 * pooler. The string check above is necessary but not sufficient, so the live
 * coordinates are read back from the connection itself and asserted through
 * the same predicate.
 */
export async function assertLiveCanonicalReferenceTarget(
  client: CanonicalProbeClient,
): Promise<CanonicalTarget & { currentRole: string | null }> {
  const result = await client.query<LiveTargetRow>(CANONICAL_TARGET_PROBE_SQL);
  const row = result.rows[0];
  if (!row) {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_TARGET_PROBE_EMPTY',
      'The live target probe returned no row.',
    );
  }
  if (row.server_host === null || row.server_port === null) {
    throw new CanonicalReferenceTargetError(
      'STOP_CANONICAL_TARGET_PROBE_INCOMPLETE',
      'The live target probe did not report both host and port.',
    );
  }

  const live: CanonicalTarget = {
    databaseName: row.current_database,
    host: row.server_host,
    port: Number(row.server_port),
  };
  assertCanonicalReferenceTarget(live);
  return { ...live, currentRole: row.current_role ?? null };
}

export interface CanonicalReferenceAuthority {
  readonly target: CanonicalTarget;
  readonly workspaceId: string;
  /** Observed on every mode; enforced only when writing. */
  readonly currentRole: string | null;
  readonly writerRoleEnforced: boolean;
}

/**
 * The single entry point a canonical caller uses: prove the DSN coordinates,
 * prove the live connection agrees, and prove the workspace is the authorized
 * one. Any failure throws; there is no partial or advisory result.
 */
export async function verifyCanonicalReferenceAuthority(params: {
  databaseUrl: string | undefined;
  workspaceId: unknown;
  client: CanonicalProbeClient;
  /**
   * True only for APPLY. A dry-run writes nothing, so it must not be forced to
   * hold the writer credential — requiring one to rehearse would push
   * operators toward using the writer role for everything.
   */
  requireWriterRole: boolean;
}): Promise<CanonicalReferenceAuthority> {
  const declared = parseCanonicalTargetFromUrl(params.databaseUrl ?? '');
  assertCanonicalReferenceTarget(declared);
  const workspaceId = assertCanonicalReferenceWorkspace(params.workspaceId);
  const live = await assertLiveCanonicalReferenceTarget(params.client);

  if (params.requireWriterRole) {
    assertCanonicalReferenceWriterRole(live.currentRole);
  }

  const { currentRole, ...target } = live;
  return {
    target,
    workspaceId,
    currentRole,
    writerRoleEnforced: params.requireWriterRole,
  };
}
