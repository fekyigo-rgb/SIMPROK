import {
  KNOWN_REGION_CONFIRMATION_TOKENS,
  REGION_CONFIRMATION_TOKEN,
  REGION_PLAN_CONTRACT_VERSION,
  RegionProvisionError,
  applyRegionPlan,
  assertRegionDesignation,
  buildRegionPlan,
  canonicalRegionPlanJson,
  computeRegionPlanHash,
  regionProvisioningAdvisoryLockKey,
  type RegionPrismaLike,
  type RegionQueryClient,
  type RegionRow,
  type RegionTransactionClient,
} from './region-provisioner';

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

const harness = (
  rows: RegionRow[],
  createOverride?: Partial<RegionRow>,
): Harness => {
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
          parentId: data.parentId ?? null,
          administrativeLevel: data.administrativeLevel ?? null,
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
      expect(
        assertRegionDesignation({ regionCode: CODE, regionName: NAME }),
      ).toEqual({
        regionCode: CODE,
        regionName: NAME,
      });
    });

    it.each([
      [{ regionCode: '', regionName: NAME }, /STOP_REGION_CODE_REQUIRED/],
      [{ regionCode: CODE, regionName: '' }, /STOP_REGION_NAME_REQUIRED/],
      [
        { regionCode: undefined as never, regionName: NAME },
        /STOP_REGION_CODE_REQUIRED/,
      ],
      [
        { regionCode: CODE, regionName: undefined as never },
        /STOP_REGION_NAME_REQUIRED/,
      ],
    ])(
      'refuses a missing half of the designation (%p)',
      (designation, expected) => {
        expect(() => assertRegionDesignation(designation)).toThrow(expected);
      },
    );

    it('refuses to silently normalise a designated value', () => {
      // Trimming on the Owner's behalf would alter a designated fact.
      expect(() =>
        assertRegionDesignation({
          regionCode: ' TEST-REGION ',
          regionName: NAME,
        }),
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

    it('omitting hierarchy keeps the historical plan JSON', async () => {
      const plan = await buildRegionPlan(readClient([]), {
        regionCode: CODE,
        regionName: NAME,
      });
      expect(canonicalRegionPlanJson(plan)).not.toContain('parentRegionId');
      expect(canonicalRegionPlanJson(plan)).not.toContain(
        'administrativeLevel',
      );
    });

    it('plans CREATE under an existing Kemendagri parent', async () => {
      const parent = existing({
        id: 'parent-1',
        code: '31',
        name: 'DKI Jakarta',
        administrativeLevel: 'PROVINCE',
      });
      const plan = await buildRegionPlan(readClient([parent]), {
        regionCode: CODE,
        regionName: NAME,
        parentRegionCode: '31',
        administrativeLevel: 'REGENCY_CITY',
      });
      expect(plan.disposition).toBe('CREATE_REGION');
      expect(plan.parentRegionId).toBe('parent-1');
      expect(plan.administrativeLevel).toBe('REGENCY_CITY');
    });

    it('refuses a parent that does not exist', async () => {
      await expect(
        buildRegionPlan(readClient([]), {
          regionCode: CODE,
          regionName: NAME,
          parentRegionCode: '31',
          administrativeLevel: 'REGENCY_CITY',
        }),
      ).rejects.toThrow(/STOP_REGION_PARENT_NOT_FOUND/);
    });

    it('refuses partial hierarchy instead of guessing the missing fact', async () => {
      await expect(
        buildRegionPlan(readClient([]), {
          regionCode: CODE,
          regionName: NAME,
          parentRegionCode: '31',
        }),
      ).rejects.toThrow(/STOP_REGION_HIERARCHY_INCOMPLETE/);
      await expect(
        buildRegionPlan(readClient([]), {
          regionCode: CODE,
          regionName: NAME,
          administrativeLevel: 'REGENCY_CITY',
        }),
      ).rejects.toThrow(/STOP_REGION_HIERARCHY_INCOMPLETE/);
    });

    it('refuses inactive, self, and wrong-level parents', async () => {
      const inactiveParent = existing({
        id: 'parent-1',
        code: '31',
        name: 'DKI Jakarta',
        isActive: false,
        administrativeLevel: 'PROVINCE',
      });
      await expect(
        buildRegionPlan(readClient([inactiveParent]), {
          regionCode: CODE,
          regionName: NAME,
          parentRegionCode: '31',
          administrativeLevel: 'REGENCY_CITY',
        }),
      ).rejects.toThrow(/STOP_REGION_PARENT_INACTIVE/);
      await expect(
        buildRegionPlan(readClient([]), {
          regionCode: CODE,
          regionName: NAME,
          parentRegionCode: CODE,
          administrativeLevel: 'REGENCY_CITY',
        }),
      ).rejects.toThrow(/STOP_REGION_PARENT_SELF/);
      await expect(
        buildRegionPlan(
          readClient([
            existing({
              id: 'parent-1',
              code: '31',
              name: 'DKI Jakarta',
              administrativeLevel: 'COUNTRY',
            }),
          ]),
          {
            regionCode: CODE,
            regionName: NAME,
            parentRegionCode: '31',
            administrativeLevel: 'REGENCY_CITY',
          },
        ),
      ).rejects.toThrow(/STOP_REGION_PARENT_LEVEL_MISMATCH/);
    });

    it('refuses COUNTRY with a parent', async () => {
      await expect(
        buildRegionPlan(readClient([]), {
          regionCode: 'ID',
          regionName: 'Indonesia',
          parentRegionCode: '31',
          administrativeLevel: 'COUNTRY',
        }),
      ).rejects.toThrow(/STOP_REGION_COUNTRY_HAS_PARENT/);
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

    it('allows the same official name under a different lawful parent', async () => {
      const requestedParent = existing({
        id: 'parent-a',
        code: '31',
        name: 'Province A',
        administrativeLevel: 'PROVINCE',
      });
      const sameNameElsewhere = existing({
        id: 'elsewhere',
        code: 'OTHER-CODE',
        name: NAME,
        parentId: 'parent-b',
        administrativeLevel: 'REGENCY_CITY',
      });
      const plan = await buildRegionPlan(
        readClient([requestedParent, sameNameElsewhere]),
        {
          regionCode: CODE,
          regionName: NAME,
          parentRegionCode: '31',
          administrativeLevel: 'REGENCY_CITY',
        },
      );
      expect(plan.disposition).toBe('CREATE_REGION');
      expect(plan.parentRegionId).toBe('parent-a');
    });

    it('allows a different official code with the same name, parent, and level', async () => {
      const parent = existing({
        id: 'parent-a',
        code: '31',
        name: 'Province A',
        administrativeLevel: 'PROVINCE',
      });
      const otherCode = existing({
        id: 'collision',
        code: 'OTHER-CODE',
        name: NAME,
        parentId: 'parent-a',
        administrativeLevel: 'REGENCY_CITY',
      });
      const plan = await buildRegionPlan(readClient([parent, otherCode]), {
        regionCode: CODE,
        regionName: NAME,
        parentRegionCode: '31',
        administrativeLevel: 'REGENCY_CITY',
      });
      expect(plan.disposition).toBe('CREATE_REGION');
      expect(plan.regionCode).toBe(CODE);
      expect(plan.existingRegionId).toBeNull();
    });

    it('uses official code identity for a scoped designation even beside a legacy same-name row', async () => {
      const parent = existing({
        id: 'parent-a',
        code: '31',
        name: 'Province A',
        administrativeLevel: 'PROVINCE',
      });
      const legacyCollision = existing({
        id: 'legacy',
        code: 'OTHER-CODE',
        name: NAME,
        parentId: null,
        administrativeLevel: null,
      });
      const plan = await buildRegionPlan(
        readClient([parent, legacyCollision]),
        {
          regionCode: CODE,
          regionName: NAME,
          parentRegionCode: '31',
          administrativeLevel: 'REGENCY_CITY',
        },
      );
      expect(plan.disposition).toBe('CREATE_REGION');
      expect(plan.parentRegionId).toBe('parent-a');
    });

    it('queries scoped identity by official code without imposing name uniqueness', async () => {
      const parent = existing({
        id: 'parent-a',
        code: '31',
        name: 'Province A',
        administrativeLevel: 'PROVINCE',
      });
      const reads: Array<Array<{ code?: string; name?: string }>> = [];
      const client: RegionQueryClient = {
        region: {
          findMany: async ({ where }) => {
            reads.push(where.OR);
            return where.OR.some((entry) => entry.code === '31')
              ? [parent]
              : [];
          },
        },
      };

      await buildRegionPlan(client, {
        regionCode: CODE,
        regionName: NAME,
        parentRegionCode: '31',
        administrativeLevel: 'REGENCY_CITY',
      });

      expect(reads).toEqual([[{ code: '31' }], [{ code: CODE }]]);
    });

    it('retains the same-name fail-closed lookup for hierarchy-free callers', async () => {
      const reads: Array<Array<{ code?: string; name?: string }>> = [];
      const client: RegionQueryClient = {
        region: {
          findMany: async ({ where }) => {
            reads.push(where.OR);
            return [];
          },
        },
      };

      await buildRegionPlan(client, {
        regionCode: CODE,
        regionName: NAME,
      });

      expect(reads).toEqual([[{ code: CODE }, { name: NAME }]]);
    });

    it('reuses only an active same-code row with matching supplied hierarchy', async () => {
      const parent = existing({
        id: 'parent-a',
        code: '31',
        name: 'Province A',
        administrativeLevel: 'PROVINCE',
      });
      const exact = existing({
        parentId: 'parent-a',
        administrativeLevel: 'REGENCY_CITY',
      });
      const plan = await buildRegionPlan(readClient([parent, exact]), {
        regionCode: CODE,
        regionName: NAME,
        parentRegionCode: '31',
        administrativeLevel: 'REGENCY_CITY',
      });
      expect(plan.disposition).toBe('REUSE_EXACT_REGION');

      await expect(
        buildRegionPlan(
          readClient([parent, { ...exact, parentId: 'different-parent' }]),
          {
            regionCode: CODE,
            regionName: NAME,
            parentRegionCode: '31',
            administrativeLevel: 'REGENCY_CITY',
          },
        ),
      ).rejects.toThrow(/STOP_REGION_HIERARCHY_CONFLICT/);

      await expect(
        buildRegionPlan(
          readClient([parent, { ...exact, administrativeLevel: 'DISTRICT' }]),
          {
            regionCode: CODE,
            regionName: NAME,
            parentRegionCode: '31',
            administrativeLevel: 'REGENCY_CITY',
          },
        ),
      ).rejects.toThrow(/STOP_REGION_HIERARCHY_CONFLICT/);
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
      const p1 = await buildRegionPlan(readClient([]), {
        regionCode: CODE,
        regionName: NAME,
      });
      const p2 = await buildRegionPlan(readClient([]), {
        regionCode: CODE,
        regionName: NAME,
      });
      expect(computeRegionPlanHash(p1)).toBe(computeRegionPlanHash(p2));
      expect(canonicalRegionPlanJson(p1)).toBe(canonicalRegionPlanJson(p2));
    });

    it('differs between CREATE and REUSE of the same designation', async () => {
      const create = await buildRegionPlan(readClient([]), {
        regionCode: CODE,
        regionName: NAME,
      });
      const reuse = await buildRegionPlan(readClient([existing()]), {
        regionCode: CODE,
        regionName: NAME,
      });
      expect(computeRegionPlanHash(create)).not.toBe(
        computeRegionPlanHash(reuse),
      );
    });

    it('differs when a DIFFERENT existing row would be reused', async () => {
      const a = await buildRegionPlan(
        readClient([existing({ id: 'region-a' })]),
        {
          regionCode: CODE,
          regionName: NAME,
        },
      );
      const b = await buildRegionPlan(
        readClient([existing({ id: 'region-b' })]),
        {
          regionCode: CODE,
          regionName: NAME,
        },
      );
      expect(computeRegionPlanHash(a)).not.toBe(computeRegionPlanHash(b));
    });

    it('binds the resolved parent and administrative level into the reviewed hash', async () => {
      const first = await buildRegionPlan(
        readClient([
          existing({
            id: 'parent-a',
            code: '31',
            name: 'Province A',
            administrativeLevel: 'PROVINCE',
          }),
        ]),
        {
          regionCode: CODE,
          regionName: NAME,
          parentRegionCode: '31',
          administrativeLevel: 'REGENCY_CITY',
        },
      );
      const second = await buildRegionPlan(
        readClient([
          existing({
            id: 'parent-b',
            code: '32',
            name: 'Province B',
            administrativeLevel: 'PROVINCE',
          }),
        ]),
        {
          regionCode: CODE,
          regionName: NAME,
          parentRegionCode: '32',
          administrativeLevel: 'REGENCY_CITY',
        },
      );
      expect(computeRegionPlanHash(first)).not.toBe(
        computeRegionPlanHash(second),
      );
    });

    it('produces a non-negative lock key that fits Postgres bigint', () => {
      const key = regionProvisioningAdvisoryLockKey();
      expect(key >= 0n).toBe(true);
      expect(key < 2n ** 63n).toBe(true);
      expect(regionProvisioningAdvisoryLockKey()).toBe(key);
    });
  });

  /**
   * CONCURRENCY. The legacy hierarchy-free same-name/different-code rule
   * compares a designation against rows it does NOT share a code with, so its
   * conflict domain remains the whole Region table, not one code. The single
   * domain lock is retained for both legacy and scoped operations.
   */
  describe('the conflict domain is serialized globally, not per code', () => {
    it('uses ONE lock key for every designation', () => {
      // Same key regardless of code: that is the property, not an accident.
      const key = regionProvisioningAdvisoryLockKey();
      expect(regionProvisioningAdvisoryLockKey()).toBe(key);
      expect(String(key)).not.toContain('NaN');
    });

    it('takes the lock BEFORE reading, so the deciding read cannot interleave', async () => {
      const order: string[] = [];
      const tx: RegionTransactionClient = {
        region: {
          findMany: async () => {
            order.push('read');
            return [];
          },
          create: async ({ data }) => {
            order.push('create');
            return {
              id: 'r',
              code: data.code,
              name: data.name,
              isActive: true,
            };
          },
        },
        $executeRawUnsafe: async (sql: string) => {
          order.push(sql.includes('pg_advisory_xact_lock') ? 'lock' : 'other');
          return 0;
        },
      };
      const plan = await buildRegionPlan(readClient([]), {
        regionCode: CODE,
        regionName: NAME,
      });
      await applyRegionPlan(
        { $transaction: async (fn) => fn(tx) },
        {
          regionCode: CODE,
          regionName: NAME,
          expectedPlanSha256: computeRegionPlanHash(plan),
          confirmationToken: CANONICAL_TOKEN,
          expectedConfirmationToken: CANONICAL_TOKEN,
        },
      );
      expect(order).toEqual(['lock', 'read', 'create']);
    });

    it('serializes two designations that share a name under different codes', async () => {
      // Simulates two legacy hierarchy-free designations. The second apply
      // runs AFTER the first committed, so it now sees the same-name row and
      // refuses instead of guessing that the unscoped codes are distinct.
      const committed: RegionRow[] = [];
      const makeTx = (): RegionTransactionClient => ({
        region: {
          findMany: async () => [...committed],
          create: async ({ data }) => {
            const row = {
              id: `region-${committed.length + 1}`,
              code: data.code,
              name: data.name,
              isActive: true,
            };
            committed.push(row);
            return row;
          },
        },
        $executeRawUnsafe: async () => 0,
      });

      const firstPlan = await buildRegionPlan(readClient(committed), {
        regionCode: 'CODE-A',
        regionName: NAME,
      });
      await applyRegionPlan(
        { $transaction: async (fn) => fn(makeTx()) },
        {
          regionCode: 'CODE-A',
          regionName: NAME,
          expectedPlanSha256: computeRegionPlanHash(firstPlan),
          confirmationToken: CANONICAL_TOKEN,
          expectedConfirmationToken: CANONICAL_TOKEN,
        },
      );
      expect(committed).toHaveLength(1);

      // Second designation: same name, different code. Planned before the
      // first committed, applied after — the in-transaction rebuild catches it.
      await expect(
        applyRegionPlan(
          { $transaction: async (fn) => fn(makeTx()) },
          {
            regionCode: 'CODE-B',
            regionName: NAME,
            expectedPlanSha256: 'ANY',
            confirmationToken: CANONICAL_TOKEN,
            expectedConfirmationToken: CANONICAL_TOKEN,
          },
        ),
      ).rejects.toThrow(/STOP_REGION_NAME_CONFLICT/);
      expect(committed).toHaveLength(1);
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
      const result = await applyRegionPlan(h.prisma, {
        regionCode: CODE,
        regionName: NAME,
        expectedPlanSha256: computeRegionPlanHash(plan),
        confirmationToken: CANONICAL_TOKEN,
        expectedConfirmationToken: CANONICAL_TOKEN,
        ...over,
      });
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
        applyRegionPlan(h.prisma, {
          regionCode: CODE,
          regionName: NAME,
          expectedPlanSha256: 'STALE'.repeat(8),
          confirmationToken: CANONICAL_TOKEN,
          expectedConfirmationToken: CANONICAL_TOKEN,
        }),
      ).rejects.toThrow(/STOP_PLAN_HASH_MISMATCH/);
      expect(h.created).toEqual([]);
    });

    it('refuses a missing expected plan hash', async () => {
      const h = harness([]);
      await expect(
        applyRegionPlan(h.prisma, {
          regionCode: CODE,
          regionName: NAME,
          expectedPlanSha256: '',
          confirmationToken: CANONICAL_TOKEN,
          expectedConfirmationToken: CANONICAL_TOKEN,
        }),
      ).rejects.toThrow(/STOP_MISSING_EXPECTED_PLAN_HASH/);
      expect(h.created).toEqual([]);
    });

    it('refuses a wrong confirmation token', async () => {
      const h = harness([]);
      await expect(
        applyRegionPlan(h.prisma, {
          regionCode: CODE,
          regionName: NAME,
          expectedPlanSha256: 'x',
          confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST',
          expectedConfirmationToken: CANONICAL_TOKEN,
        }),
      ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
      expect(h.created).toEqual([]);
    });

    it('refuses an unrecognised confirmation authority even when both strings match', async () => {
      const h = harness([]);
      await expect(
        applyRegionPlan(h.prisma, {
          regionCode: CODE,
          regionName: NAME,
          expectedPlanSha256: 'x',
          confirmationToken: 'INVENTED',
          expectedConfirmationToken: 'INVENTED',
        }),
      ).rejects.toThrow(/STOP_UNKNOWN_CONFIRMATION_AUTHORITY/);
      expect(h.created).toEqual([]);
    });

    /**
     * CLOSED AUTHORITY. The allow-list is owned by the module, not handed in.
     * A caller-supplied list would have meant the gate trusted the very party
     * it defends against.
     */
    describe('the caller cannot widen the recognised authority', () => {
      it('exposes exactly the canonical and governed-rehearsal Region authorities', () => {
        expect(KNOWN_REGION_CONFIRMATION_TOKENS).toEqual([
          'APPLY_RM03D0_CANONICAL_REFERENCES',
          'APPLY_GOVERNED_REHEARSAL_REFERENCES',
        ]);
        expect(REGION_CONFIRMATION_TOKEN).toBe(
          'APPLY_RM03D0_CANONICAL_REFERENCES',
        );
        // The acceptance token is still not a Region authority and never was.
        expect(KNOWN_REGION_CONFIRMATION_TOKENS).not.toContain(
          'APPLY_RM02C1B_TO_SIMPROK_TEST',
        );
      });

      it('never lets one Region authority stand in for the other', async () => {
        const h = harness([]);
        for (const [confirmationToken, expectedConfirmationToken] of [
          [
            'APPLY_GOVERNED_REHEARSAL_REFERENCES',
            'APPLY_RM03D0_CANONICAL_REFERENCES',
          ],
          [
            'APPLY_RM03D0_CANONICAL_REFERENCES',
            'APPLY_GOVERNED_REHEARSAL_REFERENCES',
          ],
        ] as const) {
          await expect(
            applyRegionPlan(h.prisma, {
              regionCode: CODE,
              regionName: NAME,
              expectedPlanSha256: 'x',
              confirmationToken,
              expectedConfirmationToken,
            }),
          ).rejects.toThrow(/STOP_MISSING_CONFIRMATION_TOKEN/);
        }
        expect(h.created).toEqual([]);
      });

      it('takes no allow-list argument at all', () => {
        // Arity is the proof: there is no third parameter to pass a list into.
        expect(applyRegionPlan.length).toBe(2);
      });

      it('refuses the RM-02C1b acceptance token — Region has no acceptance path', async () => {
        const h = harness([]);
        await expect(
          applyRegionPlan(h.prisma, {
            regionCode: CODE,
            regionName: NAME,
            expectedPlanSha256: 'x',
            confirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST',
            expectedConfirmationToken: 'APPLY_RM02C1B_TO_SIMPROK_TEST',
          }),
        ).rejects.toThrow(/STOP_UNKNOWN_CONFIRMATION_AUTHORITY/);
        expect(h.created).toEqual([]);
      });
    });

    it('fails closed if the database stored something other than the designation', async () => {
      const plan = await buildRegionPlan(readClient([]), {
        regionCode: CODE,
        regionName: NAME,
      });
      const h = harness([], { name: 'Mutated By Trigger' });
      await expect(
        applyRegionPlan(h.prisma, {
          regionCode: CODE,
          regionName: NAME,
          expectedPlanSha256: computeRegionPlanHash(plan),
          confirmationToken: CANONICAL_TOKEN,
          expectedConfirmationToken: CANONICAL_TOKEN,
        }),
      ).rejects.toThrow(/STOP_REGION_WRITE_READBACK_MISMATCH/);
    });

    it('fails closed when hierarchy readback differs from the reviewed plan', async () => {
      const parent = existing({
        id: 'parent-1',
        code: '31',
        name: 'DKI Jakarta',
        administrativeLevel: 'PROVINCE',
      });
      const plan = await buildRegionPlan(readClient([parent]), {
        regionCode: CODE,
        regionName: NAME,
        parentRegionCode: '31',
        administrativeLevel: 'REGENCY_CITY',
      });
      const h = harness([parent], { parentId: 'wrong-parent' });
      await expect(
        applyRegionPlan(h.prisma, {
          regionCode: CODE,
          regionName: NAME,
          parentRegionCode: '31',
          administrativeLevel: 'REGENCY_CITY',
          expectedPlanSha256: computeRegionPlanHash(plan),
          confirmationToken: CANONICAL_TOKEN,
          expectedConfirmationToken: CANONICAL_TOKEN,
        }),
      ).rejects.toThrow(/STOP_REGION_WRITE_READBACK_MISMATCH/);
    });
  });

  it('exposes a typed error class carrying a reasonCode', () => {
    const error = new RegionProvisionError('STOP_Y', 'detail');
    expect(error.reasonCode).toBe('STOP_Y');
    expect(error.name).toBe('RegionProvisionError');
  });
});
