/**
 * B1B12 — the governed rehearsal environment.
 *
 * WHAT WAS NOT DETERMINISTIC ENOUGH
 *
 * The launcher used to read the governed secrets file and copy a handful of
 * remembered keys into the backend child. Two things were wrong with that.
 * First, a key the file declares but the launcher had not been taught about
 * would silently not reach the child — the governed file could grow and the
 * runtime would quietly ignore the growth. Second, a conflicting value already
 * sitting in the operator's shell could survive into the child, so the same
 * file could produce two different runtimes on two different machines.
 *
 * THE LAW HERE IS NARROW AND ABSOLUTE:
 *
 *   For EVERY key the governed file declares, the child's value is the
 *   governed file's value — never the ambient shell's.
 *
 * It is deliberately not a sandbox. Ambient variables the governed file says
 * nothing about (PATH, TEMP, NODE_OPTIONS…) are passed through untouched;
 * scrubbing the whole Windows environment would be a different and much larger
 * product. The guarantee is about the keys SIMPROK governs, and it is
 * key-driven rather than list-driven: nothing below enumerates the governed
 * keys, so a key added to the file tomorrow is authoritative tomorrow with no
 * code change.
 *
 * LAUNCHER-OWNED COORDINATES are the one documented exception, and they are
 * not a loophole: the launcher starts the UI on 5183 and must therefore also
 * own the API port and the CORS origin that make the pair coherent. If the
 * governed file states them too, they must AGREE — a disagreement is refused
 * rather than silently resolved, because the two would otherwise drift and the
 * browser would fail with a bare "Failed to fetch" all over again.
 *
 * THE DATABASE TARGET IS NOT RE-STATED HERE. It is delegated to
 * b1b12-rehearsal-target.ts, which is the single authority for what a B1B12
 * rehearsal target is. That is the whole point: there must not be a second,
 * drifting definition of a valid rehearsal database.
 *
 * SECRET DISCIPLINE: values are moved, never logged. No function here returns
 * or throws a secret; refusals name the KEY, never the value.
 */
import {
  assertB1B12RehearsalTarget,
  parseRehearsalTargetFromUrl,
} from './b1b12-rehearsal-target';

/**
 * A rehearsal is a browser session, not a worker host. Every one of these must
 * be present AND explicitly false.
 */
export const B1B12_REQUIRED_WORKER_FLAGS = [
  'INTAKE_WORKER_ENABLED',
  'INTAKE_UNDERSTANDING_WORKER_ENABLED',
  'INTAKE_PUBLICATION_WORKER_ENABLED',
  'INTAKE_BUSINESS_SUBSCRIPTION_WORKER_ENABLED',
] as const;

/** Secrets the rehearsal cannot run without. Presence only is ever checked. */
export const B1B12_REQUIRED_SECRET_KEYS = ['DATABASE_URL', 'JWT_SECRET'] as const;

/**
 * The coordinates the launcher owns because it is the thing that starts both
 * tiers. Non-secret by construction, and asserted to agree with the governed
 * file whenever that file states them too.
 */
export const B1B12_LAUNCHER_OWNED_ENV: Readonly<Record<string, string>> = {
  PORT: '3110',
  CORS_ORIGINS: 'http://127.0.0.1:5183,http://localhost:5183',
};

/** The UI half of the same topology, applied to the frontend child. */
export const B1B12_FRONTEND_ENV: Readonly<Record<string, string>> = {
  VITE_API_BASE_URL: 'http://127.0.0.1:3110',
};

export class B1B12RehearsalEnvironmentError extends Error {
  constructor(
    public readonly reasonCode: string,
    detail: string,
  ) {
    super(`${reasonCode}: ${detail}`);
    this.name = 'B1B12RehearsalEnvironmentError';
  }
}

/**
 * Parses a governed env file. Deliberately small and strict: `KEY=VALUE`, one
 * per line, `#` comments and blank lines ignored, surrounding quotes stripped.
 * A malformed line is skipped rather than guessed at, and a duplicated key
 * takes its LAST value — the same way a shell would read it.
 */
export function parseGovernedEnvFile(contents: string): Map<string, string> {
  const governed = new Map<string, string>();
  for (const rawLine of contents.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (key !== '') governed.set(key, value);
  }
  return governed;
}

/**
 * Proves the governed file describes a lawful B1B12 rehearsal, before any
 * process is started. Every refusal names the key at fault and nothing else.
 */
export function assertGovernedRehearsalContract(
  governed: Map<string, string>,
): void {
  for (const key of B1B12_REQUIRED_SECRET_KEYS) {
    const value = governed.get(key);
    if (value === undefined || value.trim() === '') {
      throw new B1B12RehearsalEnvironmentError(
        'STOP_REHEARSAL_SECRET_INCOMPLETE',
        `The governed environment must declare a non-empty ${key}.`,
      );
    }
  }

  // ABSENCE IS NOT DISABLED. A missing worker flag is an unanswered question
  // about whether this runtime processes queues, and the honest answer to an
  // unanswered question is refusal — never a convenient default of false.
  for (const flag of B1B12_REQUIRED_WORKER_FLAGS) {
    const value = governed.get(flag);
    if (value === undefined || value.trim() === '') {
      throw new B1B12RehearsalEnvironmentError(
        'STOP_REHEARSAL_BACKGROUND_WORKER_NOT_DISABLED',
        `${flag} is not declared. A rehearsal must state it explicitly as false.`,
      );
    }
    if (value.trim().toLowerCase() !== 'false') {
      throw new B1B12RehearsalEnvironmentError(
        'STOP_REHEARSAL_BACKGROUND_WORKER_NOT_DISABLED',
        `${flag} must be exactly false for a rehearsal runtime.`,
      );
    }
  }

  // The launcher and the governed file must not describe two different
  // topologies. If the file states one of these, it has to agree.
  for (const [key, owned] of Object.entries(B1B12_LAUNCHER_OWNED_ENV)) {
    const declared = governed.get(key);
    if (declared !== undefined && declared.trim() !== owned) {
      throw new B1B12RehearsalEnvironmentError(
        'STOP_REHEARSAL_TOPOLOGY_CONFLICT',
        `${key} in the governed environment disagrees with the launcher-owned value.`,
      );
    }
  }

  // ONE authority decides what a rehearsal database is — not this module.
  assertB1B12RehearsalTarget(
    parseRehearsalTargetFromUrl(governed.get('DATABASE_URL')),
  );
}

/**
 * Builds the child environment: ambient first, then GOVERNED wins over
 * ambient, then LAUNCHER-OWNED wins over both.
 *
 * The governed overlay walks the file's own keys, so it stays correct for keys
 * that do not exist yet. `undefined` ambient entries are dropped because a
 * spawned process cannot carry them.
 */
export function composeRehearsalChildEnvironment(params: {
  ambient: NodeJS.ProcessEnv;
  governed: Map<string, string>;
  /** Extra launcher-owned values, e.g. the frontend's API base. */
  launcherOwned?: Readonly<Record<string, string>>;
}): Record<string, string> {
  const child: Record<string, string> = {};
  for (const [key, value] of Object.entries(params.ambient)) {
    if (typeof value === 'string') child[key] = value;
  }
  for (const [key, value] of params.governed) {
    child[key] = value;
  }
  for (const [key, value] of Object.entries({
    ...B1B12_LAUNCHER_OWNED_ENV,
    ...(params.launcherOwned ?? {}),
  })) {
    child[key] = value;
  }
  return child;
}

/** The keys whose child value must equal the governed value. For proofs. */
export function governedKeysOf(governed: Map<string, string>): string[] {
  return [...governed.keys()];
}
