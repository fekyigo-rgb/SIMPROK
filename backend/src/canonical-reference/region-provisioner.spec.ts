import {
  REGION_PLAN_CONTRACT_VERSION,
  RegionProvisionError,
  applyRegionPlan,
  assertRegionDesignation,
  buildRegionPlan,
  canonicalRegionPlanJson,
  computeRegionPlanHash,
  regionAdvisoryLockKey,
  type RegionPrismaLike,
  type RegionQueryClient,
  type RegionRow,
  type RegionTransactionClient,
} from './region-provisioner';
import { KNOWN_CONFIRMATION_TOKENS } from '../resource-catalog/resource-catalog-bootstrap-planner';

/**
 * RM-03D0 — Region provisioner.
 *
 * TEST-ONLY DESIGNATION. `TEST-REGION` / `Test Region Name` below are fixture
 * strings chosen to be obviously non-geographic. They are NOT a proposal for
 * the canonical Region: the real REGION_CODE / REGION_NAME are the Owner's to
 * designate, and this suite proves the mechanism without ever presuming them.
 */
const CODE = 'TEST-REGION';
const NAME = 'Test Region Name';
const CANONICAL_TOKEN = 'APPLY_RM03D0_CANONICAL_REFERENCES';

const readClient = (rows: RegionRow[]): RegionQueryClient => ({
  region: { findMany: async () => rows },
});

const existing = (over: Partial<RegionRow> = {}): RegionRow => ({
  id: 'region-1',
  code: CODE,
  name: NAME,
  isActive: true,
  ...over,
});

interface Harness {
  prisma: RegionPrismaLike;
  created: Array<{ code: string; name: string }>;
  lockSql: string[];
}

const harness = (rows: RegionRow[], createOverride?: Partial<RegionRow>): Harness => {
  const created: Array<{ code: string; name: string }> = [];
  const lockSql: string[] = [];
  const tx: RegionTransactionClient = {
    region: {
      findMany: async () => rows,
      create: async ({ data }) => {
        created.push({ code: data.code, name: data.name });
        return {
          id: 'region-created',
          code: data.code,
          name: data.name,
          isActive: true,
          ...createOverride,
        };
      },
    },
    $executeRawUnsafe: async (sql: string) => {
      lockSql.push(sql);
      return 0;
    },
  };
  return {
    prisma: { $transaction: async (fn) => fn(tx) },
    created,
    lockSql,
  };
};

describe('RM-03D0 Region provisioner', () => {
  describe('designation is explicit, never derived', () => {
    it('accepts an exact designation', () => {
      expect(assertRegionDesignation({ regionCode: CODE, regionName: NAME })).toEqual({
        regionCode: CODE,
        regionName: NAME,
      });
    });

    it.each([
      [{ regionCode: '', regionName: NAME }, /STOP_REGION_CODE_REQUIRED/],
      [{ regionCode: CODE, regionName: '' }, /STOP_REGION_NAME_REQUIRED/],
      [{ regionCode: undefined as never, regionName: NAME }, /STOP_REGION_CODE_REQUIRED/],
      [{ regionCode: CODE, regionName: undefined as never }, /STOP_REGION_NAME_REQUIRED/],
    ])('refuses a missing half of the designation (%p)', (designation, expected) => {
      expect(() => assertRegionDesignation(designation)).toThrow(expected);
    });

    it('refuses to silently normalise a designated value', () => {
      // Trimming on the Owner's behalf would alter a designated fact.
      expect(() =>
        assertRegionDesignation({ regionCode: ' TEST-REGION ', regionName: NAME }),
      ).toThrow(/STOP_REGION_DESIGNATION_NOT_NORMALISED/);
    });
  });

  describe('dry-run plans without writing', () => {
    it('plans CREATE when the region is absent', async () => {
      const plan = await buildRegionPlan(readClient([]), {
        regionCode: CODE,
        regionName: NAME,
      });
      expect(plan).toEqual({
        planContractVersion: REGION_PLAN_CONTRACT_VERSION,
        regionCode: CODE,
        regionName: NAME,
        disposition: 'CREATE_REGION',
        existingRegionId: null,
        expectedCreateCount: 1,
        expectedReuseCount: 0,
      });
    });

    it('plans REUSE when the exact region already exists', async () => {
      const plan = await buildRegionPlan(readClient([existing()]), {
        regionCode: CODE,
        regionName: NAME,
      });
      expect(plan.disposition).toBe('REUSE_EXACT_REGION');
      expect(plan.existingRegionId).toBe('region-1');
      expect(plan.expectedCreateCount).toBe(0);
      expect(plan.expectedReuseCount).toBe(1);
    });

    it('writes nothing while planning — the read client has no write surface', async () => {
      const client = readClient([]);
      await buildRegionPlan(client, { regionCode: CODE, regionName: NAME });
      expect(Object.keys(client.region)).toEqual(['findMany']);
    });
  });

  describe('conflicting truth fails closed — never a repair', () => {
    it('refuses same code with a different name', async () => {
      await expect(
        buildRegionPlan(readClient([existing({ name: 'Something Else' })]), {
          regionCode: CODE,
          regionName: NAME,
        }),
      ).rejects.toThrow(/STOP_REGION_CODE_CONFLICT/);
    });

    it('refuses same name under a different code', async () => {
      await expect(
        buildRegionPlan(readClient([existing({ code: 'OTHER-CODE' })]), {
          regionCode: CODE,
          regionName: NAME,
        }),
      ).rejects.toThrow(/STOP_REGION_NAME_CONFLICT/);
    });

    it('refuses to quietly reuse an inactive region', async () => {
      await expect(
        buildRegionPlan(readClient([existing({ isActive: false })]), {
          regionCode: CODE,
          regionName: NAME,
        }),
      ).rejects.toThrow(/STOP_REGION_INACTIVE_CONFLICT/);
    });

    it('never plans an update or a rename in any branch', async () => {
      const plan = await buildRegionPlan(readClient([existing()]), {
        regionCode: CODE,
        regionName: NAME,
      });
      expect(JSON.stringify(plan)).not.toMatch(/update|rename|deactivate/i);
    });
  });

  describe('plan hashing is deterministic and meaningful', () => {
    it('is stable across runs', async () => {
      const p1 = await buildRegionPlan(readClient([]), { regionCode: CODE, regionName: NAME });
      const p2 = await buildRegionPlan(readClient([]), { regionCode: CODE, regionName: NAME });
      expect(computeRegionPlanHash(p1)).toBe(computeRegionPlanHash(p2));
      expect(canonicalRegionPlanJson(p1)).toBe(canonicalRegionPlanJson(p2));
    });

    it('differs between CREATE and REUSE of the same designation', async () => {
      const create = await buildRegionPlan(readClient([]), { regionCode: CODE, regionName: NAME });
      const reuse = await buildRegionPlan(readClient([existing()]), {
        regionCode: CODE,
        regionName: NAME,
      });
      expect(computeRegionPlanHash(create)).not.toBe(computeRegionPlanHash(reuse));
    });

    it('differs when a DIFFERENT existing row would be reused', async () => {
      const a = await buildRegionPlan(readClient([existing({ id: 'region-a' })]), {
        regionCode: CODE,
        regionName: NAME,
      });
      const b = await buildRegionPlan(readClient([existing({ id: 'region-b' })]), {
        regionCode: CODE,
        regionName: NAME,
      });
      expect(computeRegionPlanHash(a)).not.toBe(computeRegionPlanHash(b));
    });

    it('produces a non-negative lock key that fits Postgres bigint', () => {
      const key = regionAdvisoryLockKey(CODE);
      expect(key >= 0n).toBe(true);
      expect(key < 2n ** 63n).toBe(true);
      expect(regionAdvisoryLockKey(CODE)).toBe(key);
      expect(regionAdvisoryLockKey('OTHER')).not.toBe(key);
    });
  });

  describe('apply is gated on authority and on the reviewed hash', () => {
    const applyWith = async (
      rows: RegionRow[],
      over: Partial<Parameters<typeof applyRegionPlan>[1]> = {},
    ) => {
      const plan = await buildRegionPlan(readClient(rows), {
        regionCode: CODE,
        regionName: NAME,
      });
      const h = harness(rows);
      const result = await applyRegionPlan(
        h.prisma,
        {
          regionCode: CODE,
          regionName: NAME,
          expectedPlanSha256: computeRegionPlanHash(plan),
          confirmationToken: CANONICAL_TOKEN,
          expectedConfirmationToken: CANONICAL_TOKEN,
          ...over,
        },
        KNOWN_CONFIRMATION_TOKENS,
      );
      return { result, h };
    };

    it('creates the designated region exactly once', async () => {
      const { result, h } = await applyWith([]);
      expect(result.regionCreatedDelta).toBe(1);
      expect(result.regionReusedDelta).toBe(0);
      expect(h.created).toEqual([{ code: CODE, name: NAME }]);
      expect(result.regionId).toBe('region-created');
    });

    it('takes an advisory lock before planning inside the transaction', async () => {
      const { h } = await applyWith([]);
      expect(h.lockSql).toHaveLength(1);
      expect(h.lockSql[0]).toContain('pg_advisory_xact_lock');
    });

    it('is idempotent: a second run reuses and writes nothing', async () => {
      const { result, h } = await applyWith([existing()]);
      expect(result.regionCreatedDelta).toBe(0);
      expect(result.regionReusedDelta).toBe(1);
      expect(result.regionId).toBe('region-1');
      expect(h.created).toEqual([]);
    });

    it('refuses a stale plan hash and writes nothing', async () => {
      const h = harness([]);
      await expect(
        applyRegionPlan(
          h.prisma,
          {
            regionCode: CODE,
            regionName: NAME,
            expectedPlanSha256: 'STALE'.repeat(8),
            confirmationToken: CANONICAL_TOKEN,
            expectedConfirmationToken: CANONICAL_TOKEN,
          },
          KNOWN_CONFIRMATION_TOKENS,
        ),
      ).rejects.toThrow(/STOP_PLAN_HASH_MISMATCH/);
      expect(h.created).toEqual([]);
    });

    it('refuses a missing expected plan hash', async () => {
      const h = harness([]);
      await expect(
        applyRegionPlan(
          h.prisma,
          {
            regionCode: CODE,
            regionName: NAME,
            expectedPlanSha256: '',
            confirmationToken: CANONICAL_TOKEN,
            expectedConfirmationToken: CANONICAL_TOKEN,
          },
          KNOWN_CONFIRMATION_TOKENS,
        ),
      ).rejects.toThrow(/STOP_MISSING_EXPECTED_PLAN_HASH/);
      expect(h.created).toEqual([]);
    });

    it('refuses a wrong confirmation token', async () => {
      const h = harness([]);
      await expect(
        applyRegionPlan(
          h.prisma,
          {
            regionCode: CODE,
            regionName: NAME,
            expectedPlanSha256: 'x',
            confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST',
            expectedConfirmationToken: CANONICAL_TOKEN,
          },
          KNOWN_CONFIRMATION_TOKENS,
        ),
      ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
      expect(h.created).toEqual([]);
    });

    it('refuses an unrecognised confirmation authority even when both strings match', async () => {
      const h = harness([]);
      await expect(
        applyRegionPlan(
          h.prisma,
          {
            regionCode: CODE,
            regionName: NAME,
            expectedPlanSha256: 'x',
            confirmationToken: 'INVENTED',
            expectedConfirmationToken: 'INVENTED',
          },
          KNOWN_CONFIRMATION_TOKENS,
        ),
      ).rejects.toThrow(/STOP_UNKNOWN_CONFIRMATION_AUTHORITY/);
      expect(h.created).toEqual([]);
    });

    it('fails closed if the database stored something other than the designation', async () => {
      const plan = await buildRegionPlan(readClient([]), {
        regionCode: CODE,
        regionName: NAME,
      });
      const h = harness([], { name: 'Mutated By Trigger' });
      await expect(
        applyRegionPlan(
          h.prisma,
          {
            regionCode: CODE,
            regionName: NAME,
            expectedPlanSha256: computeRegionPlanHash(plan),
            confirmationToken: CANONICAL_TOKEN,
            expectedConfirmationToken: CANONICAL_TOKEN,
          },
          KNOWN_CONFIRMATION_TOKENS,
        ),
      ).rejects.toThrow(/STOP_REGION_WRITE_READBACK_MISMATCH/);
    });
  });

  it('exposes a typed error class carrying a reasonCode', () => {
    const error = new RegionProvisionError('STOP_Y', 'detail');
    expect(error.reasonCode).toBe('STOP_Y');
    expect(error.name).toBe('RegionProvisionError');
  });
});
