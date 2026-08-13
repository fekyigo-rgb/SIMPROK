/**
 * B1B12 — the rehearsal target guard.
 *
 * WHY A POSITIVE ALLOWLIST, AND WHY THE OLD ONE WAS NOT SAFE
 *
 * The first guard refused a blacklist: the database name `simprok_db` and the
 * port `5432`. Both entries were true, and together they were still not enough,
 * because the SIMPROK Permanent cluster does not listen on 5432 — it listens on
 * 127.0.0.1:55432. A DSN aimed at `127.0.0.1:55432/anything_but_simprok_db`
 * therefore passed every check and would have been provisioned into the
 * Permanent cluster. That is not a hypothetical: 55432 is up on this machine,
 * and a separate legacy PostgreSQL answers on 5432 on ALL interfaces, so the
 * one port the blacklist did name was the one that mattered least.
 *
 * A blacklist can only ever refuse the harm someone already thought of. This
 * module states the single target that IS allowed and refuses the entire rest
 * of the universe:
 *
 *   host      exactly 127.0.0.1        (loopback only; no remote, no name)
 *   port      exactly 55433            (stated explicitly; never defaulted)
 *   database  simprok_b1b12_browser_rehearsal_<YYYYMMDD>
 *
 * Adding a new Permanent port, a new cluster, a tunnel or a pooler cannot widen
 * it, because nothing here enumerates what is forbidden.
 *
 * THERE IS NO OVERRIDE. No flag, no environment variable, no "force" argument.
 * A guard with a bypass is a guard that will be bypassed on the night it
 * matters, and a rehearsal that cannot run is a cost the Permanent database
 * never has to pay for.
 *
 * IT LIVES IN src/ DELIBERATELY, for the reason canonical-reference-target.ts
 * already states for itself: everything here is pure or takes an injected
 * client, so it is covered by the standard `npm test` gate. The script in
 * scripts/b1b12/ is left as thin wiring. Law that cannot be tested by the
 * normal gate should not be the thing standing between a fixture and the
 * Permanent database.
 *
 * IT SHARES NO CODE PATH with canonical-reference-target.ts or with
 * scripts/database-role-guards.ts, and that is by construction, exactly as
 * RM-03D0 chose for itself. Those authorities admit `simprok_db` (canonical)
 * and `simprok_test`/`simprok_e2e` (acceptance/E2E) respectively. This one
 * admits none of them. Nothing here can widen those guards, and nothing there
 * can widen this one.
 *
 * SECRET DISCIPLINE: the DSN is parsed and discarded. No connection string,
 * user or password ever appears in a return value, an error message or a log —
 * a malformed URL reports that it is malformed, never what it contained.
 */

/** Loopback only. A rehearsal is never reachable from another machine. */
export const B1B12_REHEARSAL_HOST = '127.0.0.1';

/** The isolated rehearsal cluster. NOT the Permanent cluster. */
export const B1B12_REHEARSAL_PORT = 55433;

/** The rehearsal namespace. A database outside it is not a rehearsal database. */
export const B1B12_REHEARSAL_DATABASE_PREFIX =
  'simprok_b1b12_browser_rehearsal_';

/**
 * The full shape, not merely the prefix. `startsWith` alone would admit
 * `simprok_b1b12_browser_rehearsal_` with nothing after it, and anything at all
 * appended to it. The rehearsal identity is the prefix plus its YYYYMMDD stamp.
 */
export const B1B12_REHEARSAL_DATABASE_PATTERN =
  /^simprok_b1b12_browser_rehearsal_\d{8}$/u;

/**
 * Named ONLY so a refusal can say WHICH boundary was crossed instead of
 * "mismatch". Nothing below grants anything to these; they are already refused
 * by the allowlist before they are recognised.
 */
export const PERMANENT_DATABASE = 'simprok_db';
export const PERMANENT_CLUSTER_PORT = 55432;
export const LEGACY_CLUSTER_PORT = 5432;

export class B1B12RehearsalTargetError extends Error {
  constructor(
    public readonly reasonCode: string,
    detail: string,
  ) {
    super(`${reasonCode}: ${detail}`);
    this.name = 'B1B12RehearsalTargetError';
  }
}

export interface RehearsalTarget {
  databaseName: string;
  host: string;
  port: number;
}

/**
 * Extracts ONLY the target coordinates from a DSN. Credentials are never
 * returned and never appear in any thrown message.
 */
export function parseRehearsalTargetFromUrl(
  databaseUrl: string | undefined,
): RehearsalTarget {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    throw new B1B12RehearsalTargetError(
      'STOP_REHEARSAL_TARGET_URL_MISSING',
      'A database URL is required to resolve the B1B12 rehearsal target.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new B1B12RehearsalTargetError(
      'STOP_REHEARSAL_TARGET_URL_INVALID',
      'The supplied database URL is not a valid URL.',
    );
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new B1B12RehearsalTargetError(
      'STOP_REHEARSAL_TARGET_URL_INVALID',
      'The supplied database URL must use the PostgreSQL protocol.',
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new B1B12RehearsalTargetError(
      'STOP_REHEARSAL_TARGET_URL_INVALID',
      'The supplied database URL has an invalid database-name encoding.',
    );
  }
  if (!databaseName || databaseName.includes('/')) {
    throw new B1B12RehearsalTargetError(
      'STOP_REHEARSAL_TARGET_URL_INVALID',
      'The supplied database URL must contain exactly one database name.',
    );
  }

  // An absent port is NOT defaulted to 5432. Defaulting is how a DSN that
  // names no port at all becomes a connection to whatever happens to be
  // listening — on this machine, a legacy cluster bound to every interface.
  // The rehearsal target is stated explicitly or it is refused.
  if (parsed.port === '') {
    throw new B1B12RehearsalTargetError(
      'STOP_REHEARSAL_PORT_UNSPECIFIED',
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
 * Fails closed on every axis. Each refusal carries its own reason code so an
 * operator learns which coordinate was wrong without the DSN being echoed.
 */
export function assertB1B12RehearsalTarget(target: RehearsalTarget): void {
  if (!B1B12_REHEARSAL_DATABASE_PATTERN.test(target.databaseName)) {
    // The Permanent database gets its own verdict. Pointing a rehearsal at it
    // is a governance error, and it should not read like a typo.
    const reason =
      target.databaseName === PERMANENT_DATABASE
        ? 'STOP_PERMANENT_DATABASE_REFUSED'
        : 'STOP_REHEARSAL_DATABASE_MISMATCH';
    throw new B1B12RehearsalTargetError(
      reason,
      `B1B12 provisioning targets exactly ${B1B12_REHEARSAL_DATABASE_PREFIX}<YYYYMMDD>.`,
    );
  }
  if (target.host !== B1B12_REHEARSAL_HOST) {
    throw new B1B12RehearsalTargetError(
      'STOP_REHEARSAL_HOST_MISMATCH',
      `B1B12 provisioning targets exactly host ${B1B12_REHEARSAL_HOST}.`,
    );
  }
  if (target.port !== B1B12_REHEARSAL_PORT) {
    // The two ports a rehearsal is most likely to be aimed at by accident are
    // the two that would do real damage, so each is refused by name.
    const reason =
      target.port === PERMANENT_CLUSTER_PORT
        ? 'STOP_PERMANENT_CLUSTER_REFUSED'
        : target.port === LEGACY_CLUSTER_PORT
          ? 'STOP_LEGACY_CLUSTER_REFUSED'
          : 'STOP_REHEARSAL_PORT_MISMATCH';
    throw new B1B12RehearsalTargetError(
      reason,
      `B1B12 provisioning targets exactly port ${B1B12_REHEARSAL_PORT}.`,
    );
  }
}

/** Structural subset of a pg/Prisma-style client, so tests need no database. */
export interface RehearsalProbeClient {
  query<Row extends Record<string, unknown>>(
    sql: string,
  ): Promise<{ rows: Row[] }>;
}

interface LiveTargetRow extends Record<string, unknown> {
  current_database: string;
  server_host: string | null;
  server_port: number | string | null;
}

export const REHEARSAL_TARGET_PROBE_SQL =
  'select current_database() as current_database, host(inet_server_addr()) as server_host, inet_server_port() as server_port';

/**
 * Re-proves the target against the SERVER, not against the string we were
 * handed. A DSN can be right while the connection is not — a pooler, a tunnel,
 * a stale PGPORT. The string check is necessary and not sufficient, so the live
 * coordinates are read back from the connection and put through the same
 * predicate that judged the DSN.
 */
export async function assertLiveB1B12RehearsalTarget(
  client: RehearsalProbeClient,
): Promise<RehearsalTarget> {
  const result = await client.query<LiveTargetRow>(REHEARSAL_TARGET_PROBE_SQL);
  const row = result.rows[0];
  if (!row) {
    throw new B1B12RehearsalTargetError(
      'STOP_REHEARSAL_TARGET_PROBE_EMPTY',
      'The live target probe returned no row.',
    );
  }
  if (row.server_host === null || row.server_port === null) {
    throw new B1B12RehearsalTargetError(
      'STOP_REHEARSAL_TARGET_PROBE_INCOMPLETE',
      'The live target probe did not report both host and port.',
    );
  }

  const live: RehearsalTarget = {
    databaseName: row.current_database,
    host: row.server_host,
    port: Number(row.server_port),
  };
  assertB1B12RehearsalTarget(live);
  return live;
}

/**
 * The single entry point a rehearsal caller uses: prove the DSN's coordinates,
 * then prove the live connection agrees with them. Any failure throws; there is
 * no partial, advisory or overridable result.
 */
export async function verifyB1B12RehearsalTarget(params: {
  databaseUrl: string | undefined;
  client: RehearsalProbeClient;
}): Promise<RehearsalTarget> {
  const declared = parseRehearsalTargetFromUrl(params.databaseUrl);
  assertB1B12RehearsalTarget(declared);
  return assertLiveB1B12RehearsalTarget(params.client);
}
