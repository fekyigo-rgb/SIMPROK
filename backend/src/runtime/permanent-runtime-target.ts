/**
 * The PERMANENT ⇔ CANONICAL runtime boundary guard.
 *
 * SIMPROK has exactly ONE canonical data authority: 127.0.0.1:55432/simprok_db.
 * It is protected by SEVERAL INDEPENDENT ENFORCEMENT GUARDS. This module is one
 * of those guards — it is not a second authority, and nothing here may be read
 * as creating one.
 *
 * THE DRIFT THIS CLOSES, observed on this machine and not hypothetically:
 * the permanent backend is started by a launcher that sources a runtime env
 * file, while a second, machine-local `backend/.env` existed that named
 * `localhost:5432/simprok_db` — the LEGACY cluster. Both files spell the same
 * database name. Nothing in the application refused either one. The only thing
 * standing between the permanent runtime and a stale, test-polluted database
 * was which file happened to be loaded first.
 *
 * The other guards in this repository cover different seams, and none should be
 * widened to cover this one:
 *
 *   canonical-reference/canonical-reference-target.ts  RM-03D0 reference
 *                                                      PROVISIONING (a CLI)
 *   rehearsal/b1b12-rehearsal-target.ts                B1B12 rehearsal
 *                                                      PROVISIONING (a CLI)
 *   scripts/database-role-guards.ts                    acceptance/E2E, by
 *                                                      database NAME
 *
 * Each states in its own words that it shares no code path with the others by
 * construction, so that nothing in one can widen another. This module keeps
 * that arrangement: it duplicates a small amount of coordinate parsing on
 * purpose, and it grants nothing to anybody. Extracting a shared parser would
 * couple boundaries that were each deliberately made unable to weaken the
 * others.
 *
 * THE LAW IS A BICONDITIONAL, and both halves matter:
 *
 *   declared PERMANENT  ⇒  the target must be exactly the canonical one
 *   target is CANONICAL ⇒  the runtime must have declared itself PERMANENT
 *
 * The first half alone left the inverse hole open: any process that simply did
 * NOT declare itself — a developer shell, a stray script, a test run with a
 * borrowed env — could still open the canonical database, because a guard that
 * only inspects declared runtimes never looks at undeclared ones. The second
 * half closes it without claiming authority over anybody's database choice: it
 * refuses exactly one target, and only when the claim to it is missing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. For a NON-canonical target it says nothing
 * at all — it neither grants nor withholds, and it does not replace whatever
 * guard that environment already answers to. Deciding what `npm test`, an E2E
 * run, a rehearsal or a developer shell may touch belongs to those guards, not
 * to this one.
 *
 * SECRET DISCIPLINE: the DSN is parsed and discarded. No connection string,
 * user or password ever appears in a return value, an error message or a log —
 * a malformed URL reports that it is malformed, never what it contained.
 */

/** The env var by which a process declares which runtime it is. */
export const RUNTIME_ENVIRONMENT_ENV = 'SIMPROK_RUNTIME_ENVIRONMENT';

/** The one declaration this module binds. Anything else is not its business. */
export const PERMANENT_RUNTIME_ENVIRONMENT = 'PERMANENT';

/**
 * Loopback stated as an ADDRESS, never as the name `localhost`.
 * `localhost` resolves to ::1 on this machine as well as 127.0.0.1, and the
 * legacy cluster listens on both. A name that can select either of two clusters
 * is not an explicit target, so it is refused rather than resolved.
 */
export const PERMANENT_RUNTIME_HOST = '127.0.0.1';

/** The canonical cluster. NOT the default PostgreSQL port. */
export const PERMANENT_RUNTIME_PORT = 55432;

/** The canonical database. */
export const PERMANENT_RUNTIME_DATABASE = 'simprok_db';

/**
 * Named ONLY so a refusal can say WHICH boundary was crossed instead of
 * "mismatch". Nothing below grants anything to these; the allowlist above has
 * already refused them before they are recognised.
 */
export const LEGACY_CLUSTER_PORT = 5432;
export const REHEARSAL_CLUSTER_PORT = 55433;
export const NON_PERMANENT_DATABASES: readonly string[] = [
  'simprok_test',
  'simprok_e2e',
];

export class PermanentRuntimeTargetError extends Error {
  constructor(
    public readonly reasonCode: string,
    detail: string,
  ) {
    super(`${reasonCode}: ${detail}`);
    this.name = 'PermanentRuntimeTargetError';
  }
}

export interface PermanentRuntimeTarget {
  databaseName: string;
  host: string;
  port: number;
}

/**
 * Whether THIS process claims to be the permanent runtime. Trimmed and
 * case-insensitive so a launcher cannot miss the guard over whitespace, but
 * never inferred from NODE_ENV: `production` is set by builds, containers and
 * scripts that are not the permanent runtime, and inferring the claim from it
 * would bind processes that never made it.
 */
export function isPermanentRuntimeDeclared(
  env: Record<string, string | undefined>,
): boolean {
  const declared = env[RUNTIME_ENVIRONMENT_ENV];
  if (typeof declared !== 'string') return false;
  return declared.trim().toUpperCase() === PERMANENT_RUNTIME_ENVIRONMENT;
}

/**
 * Extracts ONLY the target coordinates from a DSN. Credentials are never
 * returned and never appear in any thrown message.
 */
export function parsePermanentTargetFromUrl(
  databaseUrl: string | undefined,
): PermanentRuntimeTarget {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    throw new PermanentRuntimeTargetError(
      'STOP_PERMANENT_TARGET_URL_MISSING',
      'A database URL is required to resolve the permanent runtime target.',
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new PermanentRuntimeTargetError(
      'STOP_PERMANENT_TARGET_URL_INVALID',
      'The supplied database URL is not a valid URL.',
    );
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new PermanentRuntimeTargetError(
      'STOP_PERMANENT_TARGET_URL_INVALID',
      'The supplied database URL must use the PostgreSQL protocol.',
    );
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(parsed.pathname.slice(1));
  } catch {
    throw new PermanentRuntimeTargetError(
      'STOP_PERMANENT_TARGET_URL_INVALID',
      'The supplied database URL has an invalid database-name encoding.',
    );
  }
  if (!databaseName || databaseName.includes('/')) {
    throw new PermanentRuntimeTargetError(
      'STOP_PERMANENT_TARGET_URL_INVALID',
      'The supplied database URL must contain exactly one database name.',
    );
  }

  // An absent port is NOT defaulted to 5432. On this machine that default is a
  // live legacy cluster holding a database of the same name, so "unspecified"
  // is the single most dangerous value this field can take.
  if (parsed.port === '') {
    throw new PermanentRuntimeTargetError(
      'STOP_PERMANENT_PORT_UNSPECIFIED',
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
export function assertPermanentRuntimeTarget(
  target: PermanentRuntimeTarget,
): void {
  if (target.databaseName !== PERMANENT_RUNTIME_DATABASE) {
    // The acceptance/E2E databases get their own verdict, so pointing a test
    // DSN at the permanent runtime reads as a governance error, not a typo.
    const reason = NON_PERMANENT_DATABASES.includes(target.databaseName)
      ? 'STOP_NON_PERMANENT_DATABASE_REFUSED'
      : 'STOP_PERMANENT_DATABASE_MISMATCH';
    throw new PermanentRuntimeTargetError(
      reason,
      `The permanent runtime targets exactly ${PERMANENT_RUNTIME_DATABASE}.`,
    );
  }
  if (target.host !== PERMANENT_RUNTIME_HOST) {
    throw new PermanentRuntimeTargetError(
      'STOP_PERMANENT_HOST_MISMATCH',
      `The permanent runtime targets exactly host ${PERMANENT_RUNTIME_HOST}; a resolvable name is not an explicit address.`,
    );
  }
  if (target.port !== PERMANENT_RUNTIME_PORT) {
    // The two ports the permanent runtime is most likely to reach by accident
    // are the two that would do real damage, so each is refused by name.
    const reason =
      target.port === LEGACY_CLUSTER_PORT
        ? 'STOP_LEGACY_CLUSTER_REFUSED'
        : target.port === REHEARSAL_CLUSTER_PORT
          ? 'STOP_REHEARSAL_CLUSTER_REFUSED'
          : 'STOP_PERMANENT_PORT_MISMATCH';
    throw new PermanentRuntimeTargetError(
      reason,
      `The permanent runtime targets exactly port ${PERMANENT_RUNTIME_PORT}.`,
    );
  }
}

/**
 * Whether a DSN names the canonical target — WITHOUT throwing on anything.
 *
 * The inverse half of the law has to inspect DSNs belonging to runtimes this
 * module has no authority over. A DSN it cannot parse, or one that states no
 * port, is simply NOT the canonical target: `simprok_db` with no port resolves
 * to 5432, which is the legacy cluster. Reporting "not canonical" for those is
 * correct, and it is the only answer that leaves other environments alone.
 */
export function isCanonicalTargetUrl(databaseUrl: string | undefined): boolean {
  let target: PermanentRuntimeTarget;
  try {
    target = parsePermanentTargetFromUrl(databaseUrl);
  } catch {
    return false;
  }
  return (
    target.databaseName === PERMANENT_RUNTIME_DATABASE &&
    target.host === PERMANENT_RUNTIME_HOST &&
    target.port === PERMANENT_RUNTIME_PORT
  );
}

/**
 * Enforces the biconditional on the DSN alone, before any client exists.
 *
 * Runs on EVERY bootstrap, declared or not, because the undeclared case is the
 * one the first version of this guard could not see. It stays silent for every
 * combination except the two the law forbids.
 */
export function assertPermanentCanonicalBoundary(params: {
  databaseUrl: string | undefined;
  env: Record<string, string | undefined>;
}): { permanent: boolean } {
  const permanent = isPermanentRuntimeDeclared(params.env);

  if (permanent) {
    // declared PERMANENT ⇒ target must be exactly canonical
    assertPermanentRuntimeTarget(parsePermanentTargetFromUrl(params.databaseUrl));
    return { permanent };
  }

  // target is CANONICAL ⇒ the runtime must have said so
  if (isCanonicalTargetUrl(params.databaseUrl)) {
    throw new PermanentRuntimeTargetError(
      'STOP_CANONICAL_TARGET_REQUIRES_PERMANENT',
      `The canonical database may only be opened by a runtime that declares ${RUNTIME_ENVIRONMENT_ENV}=${PERMANENT_RUNTIME_ENVIRONMENT}.`,
    );
  }

  // Any other target belongs to another guard. Say nothing; grant nothing.
  return { permanent };
}

/** Structural subset of a pg/Prisma-style client, so tests need no database. */
export interface PermanentRuntimeProbeClient {
  query<Row extends Record<string, unknown>>(sql: string): Promise<Row[]>;
}

interface LiveTargetRow extends Record<string, unknown> {
  current_database: string;
  server_host: string | null;
  server_port: number | string | bigint | null;
}

export const PERMANENT_TARGET_PROBE_SQL =
  'select current_database() as current_database, host(inet_server_addr()) as server_host, inet_server_port() as server_port';

/**
 * Re-proves the target against the SERVER, not against the string we were
 * handed. A DSN can be right while the connection is not — a pooler, a tunnel,
 * a stale PGPORT, an SSH forward. The string check is necessary and not
 * sufficient, so the live coordinates are read back from the connection and put
 * through the same predicate that judged the DSN.
 */
export async function assertLivePermanentRuntimeTarget(
  client: PermanentRuntimeProbeClient,
): Promise<PermanentRuntimeTarget> {
  const rows = await client.query<LiveTargetRow>(PERMANENT_TARGET_PROBE_SQL);
  const row = rows[0];
  if (!row) {
    throw new PermanentRuntimeTargetError(
      'STOP_PERMANENT_TARGET_PROBE_EMPTY',
      'The live target probe returned no row.',
    );
  }
  if (
    row.server_host === null ||
    row.server_host === undefined ||
    row.server_port === null ||
    row.server_port === undefined
  ) {
    throw new PermanentRuntimeTargetError(
      'STOP_PERMANENT_TARGET_PROBE_INCOMPLETE',
      'The live target probe did not report both host and port.',
    );
  }

  const live: PermanentRuntimeTarget = {
    databaseName: row.current_database,
    host: String(row.server_host),
    port: Number(row.server_port),
  };
  assertPermanentRuntimeTarget(live);
  return live;
}

/**
 * A one-line, secret-free statement of where the permanent runtime is actually
 * pointed. Startup drift is only cheap to fix while it is visible, and the
 * coordinates below are exactly the ones this module already permits reporting.
 */
export function describePermanentRuntimeTarget(
  target: PermanentRuntimeTarget,
): string {
  return `SIMPROK permanent runtime: environment=${PERMANENT_RUNTIME_ENVIRONMENT} host=${target.host} port=${target.port} database=${target.databaseName}`;
}

/**
 * The single entry point the permanent bootstrap uses.
 *
 * The DSN is judged BEFORE a client is ever built — a wrong target must never
 * get as far as opening a connection to the database it was not allowed to
 * touch — and the live connection is then judged against the same predicate.
 */
export async function verifyPermanentRuntimeTarget(params: {
  databaseUrl: string | undefined;
  connect: () => Promise<PermanentRuntimeProbeClient>;
}): Promise<PermanentRuntimeTarget> {
  const declared = parsePermanentTargetFromUrl(params.databaseUrl);
  assertPermanentRuntimeTarget(declared);
  const client = await params.connect();
  return assertLivePermanentRuntimeTarget(client);
}
