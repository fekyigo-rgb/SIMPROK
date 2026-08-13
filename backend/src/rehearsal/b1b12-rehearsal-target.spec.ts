import * as rehearsalTargetModule from './b1b12-rehearsal-target';
import {
  B1B12_REHEARSAL_DATABASE_PATTERN,
  B1B12_REHEARSAL_HOST,
  B1B12_REHEARSAL_PORT,
  B1B12RehearsalTargetError,
  LEGACY_CLUSTER_PORT,
  PERMANENT_CLUSTER_PORT,
  PERMANENT_DATABASE,
  RehearsalProbeClient,
  assertB1B12RehearsalTarget,
  assertLiveB1B12RehearsalTarget,
  parseRehearsalTargetFromUrl,
  verifyB1B12RehearsalTarget,
} from './b1b12-rehearsal-target';

/**
 * The safety proof for B1B12-BROWSER-CLOSEOUT-01 §10.
 *
 * The thing being proven is not "the guard has some checks". It is that the
 * ONE approved rehearsal target is accepted and every other coordinate in the
 * universe is refused — most of all the two the previous blacklist let
 * through: the Permanent cluster on 55432, and any database name that simply
 * is not `simprok_db`.
 */

/** The one target that is real: the database the Owner's browser pass ran on. */
const APPROVED_DATABASE = 'simprok_b1b12_browser_rehearsal_20260813';
const APPROVED_URL = `postgresql://simprok_app:pw@127.0.0.1:55433/${APPROVED_DATABASE}`;

const probe = (
  rows: Array<Record<string, unknown>>,
): RehearsalProbeClient => ({
  query: <Row extends Record<string, unknown>>() =>
    Promise.resolve({ rows: rows as Row[] }),
});

const liveRow = (
  database: string,
  host: string,
  port: number | string,
): Record<string, unknown> => ({
  current_database: database,
  server_host: host,
  server_port: port,
});

const reasonOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof B1B12RehearsalTargetError) return error.reasonCode;
    return `UNEXPECTED_ERROR_TYPE:${String(error)}`;
  }
  return 'NO_ERROR_THROWN';
};

describe('B1B12 rehearsal target guard', () => {
  // ── THE ONE TARGET THAT IS ALLOWED ──────────────────────────────────────
  describe('accepts the exact approved rehearsal target', () => {
    it('parses it to its coordinates and admits it', () => {
      const target = parseRehearsalTargetFromUrl(APPROVED_URL);
      expect(target).toEqual({
        databaseName: APPROVED_DATABASE,
        host: B1B12_REHEARSAL_HOST,
        port: B1B12_REHEARSAL_PORT,
      });
      expect(() => assertB1B12RehearsalTarget(target)).not.toThrow();
    });

    it('admits any date in the rehearsal namespace, and nothing merely near it', () => {
      const admits = (name: string) =>
        B1B12_REHEARSAL_DATABASE_PATTERN.test(name);
      expect(admits('simprok_b1b12_browser_rehearsal_20260813')).toBe(true);
      expect(admits('simprok_b1b12_browser_rehearsal_20270101')).toBe(true);
      // A bare prefix is not an identity, and nothing may be appended to one.
      expect(admits('simprok_b1b12_browser_rehearsal_')).toBe(false);
      expect(admits('simprok_b1b12_browser_rehearsal_20260813_evil')).toBe(false);
      expect(admits('simprok_b1b12_browser_rehearsal_2026081')).toBe(false);
      expect(admits('x_simprok_b1b12_browser_rehearsal_20260813')).toBe(false);
      expect(admits('SIMPROK_B1B12_BROWSER_REHEARSAL_20260813')).toBe(false);
    });

    it('passes end to end when the live server agrees with the DSN', async () => {
      await expect(
        verifyB1B12RehearsalTarget({
          databaseUrl: APPROVED_URL,
          client: probe([liveRow(APPROVED_DATABASE, '127.0.0.1', 55433)]),
        }),
      ).resolves.toEqual({
        databaseName: APPROVED_DATABASE,
        host: B1B12_REHEARSAL_HOST,
        port: B1B12_REHEARSAL_PORT,
      });
    });
  });

  // ── THE PERMANENT CLUSTER ───────────────────────────────────────────────
  describe('refuses the Permanent cluster', () => {
    it('refuses the Permanent database on the Permanent port', () => {
      expect(
        reasonOf(() =>
          assertB1B12RehearsalTarget(
            parseRehearsalTargetFromUrl(
              `postgresql://u:p@127.0.0.1:${PERMANENT_CLUSTER_PORT}/${PERMANENT_DATABASE}`,
            ),
          ),
        ),
      ).toBe('STOP_PERMANENT_DATABASE_REFUSED');
    });

    /**
     * THE DEFECT THIS GUARD EXISTS FOR.
     *
     * The previous blacklist refused the name `simprok_db` and the port 5432.
     * The Permanent cluster is on 55432, so ANY other database name on it —
     * a scratch database, a restore, a colleague's copy — passed every check
     * and would have been provisioned into the Permanent cluster.
     */
    it('refuses ANY other database on the Permanent port — the case the blacklist let through', () => {
      for (const database of [
        'other_db',
        'scratch',
        'simprok_db_restore_20260813',
        'postgres',
      ]) {
        expect(
          reasonOf(() =>
            assertB1B12RehearsalTarget(
              parseRehearsalTargetFromUrl(
                `postgresql://u:p@127.0.0.1:${PERMANENT_CLUSTER_PORT}/${database}`,
              ),
            ),
          ),
        ).toBe('STOP_REHEARSAL_DATABASE_MISMATCH');
      }
    });

    it('refuses a correctly-named rehearsal database aimed at the Permanent port', () => {
      expect(
        reasonOf(() =>
          assertB1B12RehearsalTarget({
            databaseName: APPROVED_DATABASE,
            host: '127.0.0.1',
            port: PERMANENT_CLUSTER_PORT,
          }),
        ),
      ).toBe('STOP_PERMANENT_CLUSTER_REFUSED');
    });

    it('refuses `simprok_db` on ANY port, including the rehearsal port itself', () => {
      for (const port of [
        LEGACY_CLUSTER_PORT,
        PERMANENT_CLUSTER_PORT,
        B1B12_REHEARSAL_PORT,
        6543,
      ]) {
        expect(
          reasonOf(() =>
            assertB1B12RehearsalTarget({
              databaseName: PERMANENT_DATABASE,
              host: '127.0.0.1',
              port,
            }),
          ),
        ).toBe('STOP_PERMANENT_DATABASE_REFUSED');
      }
    });
  });

  // ── THE LEGACY CLUSTER ──────────────────────────────────────────────────
  it('refuses the legacy 5432 cluster, which on this machine answers on every interface', () => {
    expect(
      reasonOf(() =>
        assertB1B12RehearsalTarget({
          databaseName: APPROVED_DATABASE,
          host: '127.0.0.1',
          port: LEGACY_CLUSTER_PORT,
        }),
      ),
    ).toBe('STOP_LEGACY_CLUSTER_REFUSED');
  });

  // ── HOST ────────────────────────────────────────────────────────────────
  describe('refuses anything that is not loopback', () => {
    it('refuses a remote host', () => {
      for (const host of [
        'db.internal',
        '10.0.0.5',
        'simprok.example.com',
        '0.0.0.0',
      ]) {
        expect(
          reasonOf(() =>
            assertB1B12RehearsalTarget({
              databaseName: APPROVED_DATABASE,
              host,
              port: B1B12_REHEARSAL_PORT,
            }),
          ),
        ).toBe('STOP_REHEARSAL_HOST_MISMATCH');
      }
    });

    /**
     * `localhost` is a NAME, and a name is resolved by whatever the machine's
     * resolver says today — it can answer ::1, or a hosts-file entry pointing
     * anywhere. The approved target is an address, not a name.
     */
    it('refuses `localhost`, because a name is not an address', () => {
      expect(
        reasonOf(() =>
          assertB1B12RehearsalTarget(
            parseRehearsalTargetFromUrl(
              `postgresql://u:p@localhost:${B1B12_REHEARSAL_PORT}/${APPROVED_DATABASE}`,
            ),
          ),
        ),
      ).toBe('STOP_REHEARSAL_HOST_MISMATCH');
    });
  });

  // ── PORT / URL SHAPE ────────────────────────────────────────────────────
  describe('refuses an unstated or unusable target', () => {
    it('refuses a DSN with no port rather than defaulting it to 5432', () => {
      expect(
        reasonOf(() =>
          parseRehearsalTargetFromUrl(
            `postgresql://u:p@127.0.0.1/${APPROVED_DATABASE}`,
          ),
        ),
      ).toBe('STOP_REHEARSAL_PORT_UNSPECIFIED');
    });

    it('refuses a missing or empty DATABASE_URL', () => {
      expect(reasonOf(() => parseRehearsalTargetFromUrl(undefined))).toBe(
        'STOP_REHEARSAL_TARGET_URL_MISSING',
      );
      expect(reasonOf(() => parseRehearsalTargetFromUrl(''))).toBe(
        'STOP_REHEARSAL_TARGET_URL_MISSING',
      );
    });

    it('refuses a non-PostgreSQL, malformed, or database-less URL', () => {
      for (const url of [
        'mysql://u:p@127.0.0.1:55433/simprok_b1b12_browser_rehearsal_20260813',
        'http://127.0.0.1:55433/simprok_b1b12_browser_rehearsal_20260813',
        'not a url',
        'postgresql://u:p@127.0.0.1:55433/',
      ]) {
        expect(reasonOf(() => parseRehearsalTargetFromUrl(url))).toBe(
          'STOP_REHEARSAL_TARGET_URL_INVALID',
        );
      }
    });

    it('never echoes the connection string, so a refusal cannot leak a credential', () => {
      const secret = 'sup3r-s3cret-password';
      try {
        parseRehearsalTargetFromUrl(
          `postgresql://simprok_app:${secret}@127.0.0.1:${PERMANENT_CLUSTER_PORT}/${PERMANENT_DATABASE}`,
        );
        assertB1B12RehearsalTarget({
          databaseName: PERMANENT_DATABASE,
          host: '127.0.0.1',
          port: PERMANENT_CLUSTER_PORT,
        });
        throw new Error('guard did not refuse');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).not.toContain(secret);
        expect(message).not.toContain('simprok_app');
      }
    });
  });

  // ── THE LIVE CONNECTION, NOT THE STRING ─────────────────────────────────
  describe('re-proves the target against the live server', () => {
    it('refuses when the connection lands on the Permanent database despite a valid DSN', async () => {
      await expect(
        verifyB1B12RehearsalTarget({
          databaseUrl: APPROVED_URL,
          client: probe([liveRow(PERMANENT_DATABASE, '127.0.0.1', 55432)]),
        }),
      ).rejects.toMatchObject({
        reasonCode: 'STOP_PERMANENT_DATABASE_REFUSED',
      });
    });

    it('refuses when the connection lands on the Permanent PORT despite a valid DSN', async () => {
      await expect(
        verifyB1B12RehearsalTarget({
          databaseUrl: APPROVED_URL,
          client: probe([liveRow(APPROVED_DATABASE, '127.0.0.1', 55432)]),
        }),
      ).rejects.toMatchObject({ reasonCode: 'STOP_PERMANENT_CLUSTER_REFUSED' });
    });

    it('refuses an empty or incomplete probe rather than assuming the best', async () => {
      await expect(assertLiveB1B12RehearsalTarget(probe([]))).rejects.toMatchObject(
        { reasonCode: 'STOP_REHEARSAL_TARGET_PROBE_EMPTY' },
      );
      await expect(
        assertLiveB1B12RehearsalTarget(
          probe([liveRow(APPROVED_DATABASE, null as never, 55433)]),
        ),
      ).rejects.toMatchObject({
        reasonCode: 'STOP_REHEARSAL_TARGET_PROBE_INCOMPLETE',
      });
    });

    it('accepts the port whether the driver reports it as a number or a string', async () => {
      await expect(
        assertLiveB1B12RehearsalTarget(
          probe([liveRow(APPROVED_DATABASE, '127.0.0.1', '55433')]),
        ),
      ).resolves.toMatchObject({ port: B1B12_REHEARSAL_PORT });
    });
  });

  // ── NO WAY OUT ──────────────────────────────────────────────────────────
  it('exposes no override, force or bypass of any kind', () => {
    for (const exported of Object.keys(rehearsalTargetModule)) {
      expect(exported).not.toMatch(/force|override|bypass|skip|allow_?any/iu);
    }
  });
});
