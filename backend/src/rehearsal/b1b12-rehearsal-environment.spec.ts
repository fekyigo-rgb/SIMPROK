import {
  B1B12_FRONTEND_ENV,
  B1B12_LAUNCHER_OWNED_ENV,
  B1B12_REQUIRED_WORKER_FLAGS,
  B1B12RehearsalEnvironmentError,
  assertGovernedRehearsalContract,
  composeRehearsalChildEnvironment,
  governedKeysOf,
  parseGovernedEnvFile,
} from './b1b12-rehearsal-environment';

/**
 * B1B12-BROWSER-FINAL-GAP-01 §11 — the governed environment is the authority.
 *
 * These prove the three things that were not deterministic before: every
 * declared key reaches the child, an ambient shell value cannot beat a
 * governed one, and the four background-worker flags must be explicitly
 * disabled rather than merely absent.
 *
 * Every secret here is synthetic.
 */

const APPROVED_DSN =
  'postgresql://simprok_app:synthetic@127.0.0.1:55433/simprok_b1b12_browser_rehearsal_20260813';

/** A faithful stand-in for the real governed file, values synthetic. */
const GOVERNED_FILE = [
  '# B1B12 governed runtime',
  'JWT_SECRET=synthetic-not-a-real-secret',
  'INTAKE_WORKER_ENABLED=false',
  'INTAKE_UNDERSTANDING_WORKER_ENABLED=false',
  'INTAKE_PUBLICATION_WORKER_ENABLED=false',
  'INTAKE_BUSINESS_SUBSCRIPTION_WORKER_ENABLED=false',
  `DATABASE_URL=${APPROVED_DSN}`,
  'PORT=3110',
  'CORS_ORIGINS=http://127.0.0.1:5183,http://localhost:5183',
  '',
].join('\n');

const reasonOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof B1B12RehearsalEnvironmentError) return error.reasonCode;
    return `UNEXPECTED:${String(error)}`;
  }
  return 'NO_ERROR_THROWN';
};

describe('B1B12 governed rehearsal environment', () => {
  // ── PARSING ─────────────────────────────────────────────────────────────
  describe('reads the governed file the way a shell would', () => {
    it('takes every declared key, ignoring comments and blank lines', () => {
      const governed = parseGovernedEnvFile(GOVERNED_FILE);
      expect(governedKeysOf(governed).sort()).toEqual(
        [
          'CORS_ORIGINS',
          'DATABASE_URL',
          'INTAKE_BUSINESS_SUBSCRIPTION_WORKER_ENABLED',
          'INTAKE_PUBLICATION_WORKER_ENABLED',
          'INTAKE_UNDERSTANDING_WORKER_ENABLED',
          'INTAKE_WORKER_ENABLED',
          'JWT_SECRET',
          'PORT',
        ].sort(),
      );
    });

    it('strips surrounding quotes, keeps "=" inside a value, and takes the last duplicate', () => {
      const governed = parseGovernedEnvFile(
        ['A="quoted"', "B='single'", 'C=a=b=c', 'D=first', 'D=second'].join('\n'),
      );
      expect(Object.fromEntries(governed)).toEqual({
        A: 'quoted',
        B: 'single',
        C: 'a=b=c',
        D: 'second',
      });
    });
  });

  // ── THE AUTHORITY GUARANTEE ─────────────────────────────────────────────
  describe('governed value beats ambient shell value', () => {
    it('overrides a conflicting ambient worker flag — the exact case from the brief', () => {
      const child = composeRehearsalChildEnvironment({
        ambient: { INTAKE_PUBLICATION_WORKER_ENABLED: 'true', PATH: '/usr/bin' },
        governed: parseGovernedEnvFile(GOVERNED_FILE),
      });
      expect(child.INTAKE_PUBLICATION_WORKER_ENABLED).toBe('false');
      // …and an ambient key the governed file says nothing about is untouched.
      expect(child.PATH).toBe('/usr/bin');
    });

    it('EVERY declared key reaches the child with the governed value, whatever the ambient says', () => {
      const governed = parseGovernedEnvFile(GOVERNED_FILE);
      // Ambient deliberately conflicts on every single governed key.
      const ambient: NodeJS.ProcessEnv = {};
      for (const key of governedKeysOf(governed)) {
        ambient[key] = `AMBIENT_${key}_WINS_IF_BROKEN`;
      }

      const child = composeRehearsalChildEnvironment({ ambient, governed });

      for (const key of governedKeysOf(governed)) {
        const expected =
          key in B1B12_LAUNCHER_OWNED_ENV
            ? B1B12_LAUNCHER_OWNED_ENV[key]
            : governed.get(key);
        expect({ key, value: child[key] }).toEqual({ key, value: expected });
      }
    });

    /**
     * The point of §11 D: parity is key-driven, not list-driven. A key that
     * did not exist when this module was written is still authoritative.
     */
    it('a governed key nobody has heard of is authoritative with no code change', () => {
      const governed = parseGovernedEnvFile(
        `${GOVERNED_FILE}SOME_FUTURE_GOVERNED_KEY=governed-wins\n`,
      );
      const child = composeRehearsalChildEnvironment({
        ambient: { SOME_FUTURE_GOVERNED_KEY: 'ambient-must-lose' },
        governed,
      });
      expect(child.SOME_FUTURE_GOVERNED_KEY).toBe('governed-wins');
    });

    it('launcher-owned topology wins over both, and carries the frontend API base', () => {
      const child = composeRehearsalChildEnvironment({
        ambient: { PORT: '3000', CORS_ORIGINS: 'http://evil.example.com' },
        governed: parseGovernedEnvFile(GOVERNED_FILE),
        launcherOwned: B1B12_FRONTEND_ENV,
      });
      expect(child.PORT).toBe('3110');
      expect(child.CORS_ORIGINS).toBe(
        'http://127.0.0.1:5183,http://localhost:5183',
      );
      expect(child.VITE_API_BASE_URL).toBe('http://127.0.0.1:3110');
    });

    it('drops undefined ambient entries, which a spawned process cannot carry', () => {
      const child = composeRehearsalChildEnvironment({
        ambient: { DEFINED: 'yes', MISSING: undefined },
        governed: parseGovernedEnvFile(GOVERNED_FILE),
      });
      expect(child.DEFINED).toBe('yes');
      expect('MISSING' in child).toBe(false);
    });
  });

  // ── BACKGROUND WORKER LAW ───────────────────────────────────────────────
  describe('a rehearsal is not a worker host', () => {
    it('accepts the governed contract when all four workers are explicitly false', () => {
      expect(() =>
        assertGovernedRehearsalContract(parseGovernedEnvFile(GOVERNED_FILE)),
      ).not.toThrow();
    });

    it('refuses when any worker flag is MISSING — absence is not disabled', () => {
      for (const flag of B1B12_REQUIRED_WORKER_FLAGS) {
        const withoutFlag = GOVERNED_FILE.split('\n')
          .filter((line) => !line.startsWith(`${flag}=`))
          .join('\n');
        expect(
          reasonOf(() =>
            assertGovernedRehearsalContract(parseGovernedEnvFile(withoutFlag)),
          ),
        ).toBe('STOP_REHEARSAL_BACKGROUND_WORKER_NOT_DISABLED');
      }
    });

    it('refuses a blank, true, or malformed worker flag', () => {
      for (const bad of ['', '   ', 'true', 'TRUE', '0', 'no', 'disabled']) {
        const mutated = GOVERNED_FILE.replace(
          'INTAKE_WORKER_ENABLED=false',
          `INTAKE_WORKER_ENABLED=${bad}`,
        );
        expect(
          reasonOf(() =>
            assertGovernedRehearsalContract(parseGovernedEnvFile(mutated)),
          ),
        ).toBe('STOP_REHEARSAL_BACKGROUND_WORKER_NOT_DISABLED');
      }
    });

    it('accepts case variations of false, because the fact is the same fact', () => {
      const mutated = GOVERNED_FILE.replace(
        'INTAKE_WORKER_ENABLED=false',
        'INTAKE_WORKER_ENABLED=False',
      );
      expect(() =>
        assertGovernedRehearsalContract(parseGovernedEnvFile(mutated)),
      ).not.toThrow();
    });
  });

  // ── SECRETS + TOPOLOGY + TARGET ─────────────────────────────────────────
  describe('refuses an environment that could not run a lawful rehearsal', () => {
    it('refuses a missing or blank required secret, naming the key only', () => {
      for (const key of ['DATABASE_URL', 'JWT_SECRET']) {
        const withoutKey = GOVERNED_FILE.split('\n')
          .filter((line) => !line.startsWith(`${key}=`))
          .join('\n');
        expect(
          reasonOf(() =>
            assertGovernedRehearsalContract(parseGovernedEnvFile(withoutKey)),
          ),
        ).toBe('STOP_REHEARSAL_SECRET_INCOMPLETE');
      }
    });

    it('refuses a governed topology that disagrees with the launcher', () => {
      for (const mutation of [
        ['PORT=3110', 'PORT=3000'],
        ['CORS_ORIGINS=http://127.0.0.1:5183,http://localhost:5183', 'CORS_ORIGINS=http://127.0.0.1:5999'],
      ] as const) {
        expect(
          reasonOf(() =>
            assertGovernedRehearsalContract(
              parseGovernedEnvFile(GOVERNED_FILE.replace(mutation[0], mutation[1])),
            ),
          ),
        ).toBe('STOP_REHEARSAL_TOPOLOGY_CONFLICT');
      }
    });

    /**
     * GAP B — ONE DATABASE AUTHORITY. This module states no target rule of its
     * own; it delegates. These reason codes are b1b12-rehearsal-target.ts's,
     * which is the proof that the launcher path and the provisioner path are
     * judged by the same law rather than by two that can drift.
     */
    it('delegates the database target to the single B1B12 target authority', () => {
      const withDsn = (dsn: string) =>
        parseGovernedEnvFile(
          GOVERNED_FILE.replace(`DATABASE_URL=${APPROVED_DSN}`, `DATABASE_URL=${dsn}`),
        );

      const cases: Array<[string, string]> = [
        ['postgresql://u:p@127.0.0.1:55432/simprok_db', 'STOP_PERMANENT_DATABASE_REFUSED'],
        ['postgresql://u:p@127.0.0.1:55432/scratch_db', 'STOP_REHEARSAL_DATABASE_MISMATCH'],
        [
          'postgresql://u:p@127.0.0.1:55432/simprok_b1b12_browser_rehearsal_20260813',
          'STOP_PERMANENT_CLUSTER_REFUSED',
        ],
        [
          'postgresql://u:p@127.0.0.1:5432/simprok_b1b12_browser_rehearsal_20260813',
          'STOP_LEGACY_CLUSTER_REFUSED',
        ],
        [
          'postgresql://u:p@10.0.0.5:55433/simprok_b1b12_browser_rehearsal_20260813',
          'STOP_REHEARSAL_HOST_MISMATCH',
        ],
        [
          'postgresql://u:p@127.0.0.1/simprok_b1b12_browser_rehearsal_20260813',
          'STOP_REHEARSAL_PORT_UNSPECIFIED',
        ],
        // The exact-shape cases a prefix check would have let through.
        [
          'postgresql://u:p@127.0.0.1:55433/simprok_b1b12_browser_rehearsal_',
          'STOP_REHEARSAL_DATABASE_MISMATCH',
        ],
        [
          'postgresql://u:p@127.0.0.1:55433/simprok_b1b12_browser_rehearsal_foo',
          'STOP_REHEARSAL_DATABASE_MISMATCH',
        ],
        [
          'postgresql://u:p@127.0.0.1:55433/simprok_b1b12_browser_rehearsal_20260813_extra',
          'STOP_REHEARSAL_DATABASE_MISMATCH',
        ],
      ];

      for (const [dsn, expected] of cases) {
        let reasonCode = 'NO_ERROR_THROWN';
        try {
          assertGovernedRehearsalContract(withDsn(dsn));
        } catch (error) {
          reasonCode = (error as { reasonCode?: string }).reasonCode ?? 'UNKNOWN';
        }
        expect({ dsn, reasonCode }).toEqual({ dsn, reasonCode: expected });
      }
    });

    it('never puts a secret VALUE into a refusal message', () => {
      const secret = 'synthetic-not-a-real-secret';
      const mutated = GOVERNED_FILE.replace(
        'INTAKE_WORKER_ENABLED=false',
        'INTAKE_WORKER_ENABLED=true',
      );
      try {
        assertGovernedRehearsalContract(parseGovernedEnvFile(mutated));
        throw new Error('contract did not refuse');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(secret);
        expect(message).not.toContain('simprok_app');
        expect(message).toContain('INTAKE_WORKER_ENABLED');
      }
    });
  });
});
