import { Prisma } from '@prisma/client';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';

/**
 * OWNER LAW D — ORIGIN KDN = SHARED KDN.
 *
 * WHY THIS FILE USES A REAL IN-MEMORY STORE AND NOT `jest.fn()` STUBS.
 *
 * The defect being closed was never "a function is missing". Both writes were
 * individually lawful; the failure only existed ACROSS two rows, and only
 * became visible in the state left behind. A stub that records the arguments
 * it was handed cannot observe that state, so it cannot distinguish a lineage
 * that was filled completely from one that was filled halfway — which is the
 * single thing these laws are about.
 *
 * So `$transaction` here snapshots the store, runs the body, and RESTORES the
 * snapshot if the body throws. That is the same guarantee PostgreSQL gives,
 * and it is what lets a test assert the difference between "refused" and
 * "refused after already writing something".
 */

type Scope = 'SIMPROK_CATALOG' | 'WORKSPACE_PRIVATE';

interface Row {
  id: string;
  workspaceId: string | null;
  assetScope: Scope;
  promotedFromBasicPriceId: string | null;
  kdnPercent: Prisma.Decimal | null;
  kdnEstablishment: string | null;
  /** Money and the publication axes. Nothing in this method may move them. */
  value: Prisma.Decimal;
  status: string;
  verificationStatus: string;
}

const ACTOR = { accountId: 'acct-1', userId: 'user-1', workspaceId: 'ws-1' };

const kdn = (value: string | null) =>
  value === null ? null : new Prisma.Decimal(value);

const read = (row: Row | undefined) =>
  row?.kdnPercent === null || row?.kdnPercent === undefined
    ? null
    : row.kdnPercent.toFixed(2);

function makeStore(seed: Row[]) {
  let rows: Row[] = seed.map((row) => ({ ...row }));
  const provenance: Array<{ basicPriceId: string; reason: string }> = [];

  /**
   * Injected between the origin's own UPDATE and the propagation UPDATE, so a
   * test can simulate another transaction touching a descendant in exactly the
   * window the propagation guard exists to police.
   */
  let afterFirstUpdate: (() => void) | null = null;
  let updateCalls = 0;

  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    for (const [key, expected] of Object.entries(where)) {
      const actual = (row as unknown as Record<string, unknown>)[key];
      if (
        expected !== null &&
        typeof expected === 'object' &&
        'in' in (expected as Record<string, unknown>)
      ) {
        const list = (expected as { in: unknown[] }).in;
        if (!list.includes(actual)) return false;
        continue;
      }
      if (key === 'kdnPercent' && expected === null) {
        if (actual !== null) return false;
        continue;
      }
      if (actual !== expected) return false;
    }
    return true;
  };

  const basicPrice = {
    findFirst: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.find((row) => matches(row, where)) ?? null),
    findMany: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((row) => matches(row, where))),
    count: ({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(rows.filter((row) => matches(row, where)).length),
    updateMany: ({
      where,
      data,
    }: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      const hit = rows.filter((row) => matches(row, where));
      for (const row of hit) Object.assign(row, data);
      updateCalls += 1;
      if (updateCalls === 1 && afterFirstUpdate) afterFirstUpdate();
      return Promise.resolve({ count: hit.length });
    },
  };

  const prisma = {
    $transaction: async (fn: (tx: unknown) => unknown) => {
      const snapshot = rows.map((row) => ({ ...row }));
      const provenanceDepth = provenance.length;
      try {
        return await fn({
          basicPrice,
          basicPriceProvenanceCorrection: {
            create: ({
              data,
            }: {
              data: { basicPriceId: string; reason: string };
            }) => {
              provenance.push({
                basicPriceId: data.basicPriceId,
                reason: data.reason,
              });
              return Promise.resolve({});
            },
          },
        });
      } catch (error) {
        rows = snapshot;
        provenance.length = provenanceDepth;
        throw error;
      }
    },
  };

  return {
    prisma,
    provenance,
    row: (id: string) => rows.find((r) => r.id === id),
    all: () => rows,
    setAfterFirstUpdate: (fn: () => void) => {
      afterFirstUpdate = fn;
    },
    mutate: (id: string, patch: Partial<Row>) => {
      const row = rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    },
  };
}

const catalogRow = (over: Partial<Row> & { id: string }): Row => ({
  workspaceId: ACTOR.workspaceId,
  assetScope: 'SIMPROK_CATALOG',
  promotedFromBasicPriceId: null,
  kdnPercent: null,
  kdnEstablishment: null,
  value: new Prisma.Decimal('100000.00'),
  status: 'PUBLISHED',
  verificationStatus: 'PUBLISHED',
  ...over,
});

const enrich = (
  store: ReturnType<typeof makeStore>,
  basicPriceId: string,
  over?: {
    kdnPercent?: string;
    canPromoteShared?: boolean;
    canVerify?: boolean;
  },
) =>
  new BasicPricePrivateAssetService(store.prisma as never).enrichCatalogKdn({
    basicPriceId,
    actor: ACTOR,
    kdnPercent: over?.kdnPercent ?? '72.5',
    reason: 'kurasi KDN',
    canVerify: over?.canVerify ?? true,
    canPromoteShared: over?.canPromoteShared ?? true,
  });

describe('OWNER LAW D — origin-authoritative KDN lineage', () => {
  /** T1 — promote, then enrich the ORIGIN: the shared copy receives the same fact. */
  it('T1 fills the origin and every promoted descendant with one identical KDN', async () => {
    const store = makeStore([
      catalogRow({ id: 'origin' }),
      catalogRow({
        id: 'shared',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
      }),
    ]);

    const result = await enrich(store, 'origin');

    expect(result).toEqual({
      basicPriceId: 'origin',
      kdnPercent: '72.50',
      unchanged: false,
    });
    expect(read(store.row('origin'))).toBe('72.50');
    expect(read(store.row('shared'))).toBe('72.50');
    expect(store.row('shared')?.kdnEstablishment).toBe('MANUAL_ENRICHMENT');
  });

  /** T2 — the copy may not become an independent source of the fact. */
  it('T2 refuses a promoted copy as KDN authority and writes nothing', async () => {
    const store = makeStore([
      catalogRow({ id: 'origin' }),
      catalogRow({
        id: 'shared',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
      }),
    ]);

    await expect(
      enrich(store, 'shared', { kdnPercent: '65' }),
    ).rejects.toMatchObject({ message: 'KDN_PROMOTED_COPY_NOT_KDN_AUTHORITY' });

    expect(read(store.row('shared'))).toBeNull();
    expect(read(store.row('origin'))).toBeNull();
    expect(store.provenance).toHaveLength(0);
  });

  /**
   * T2b — the exact two-actor sequence from the forensic audit. Actor A fills
   * the origin; actor B then tries to give the national copy a different
   * number. The second write is refused, so 72.50/65.00 never comes into being.
   */
  it('T2b closes the audited divergence sequence end to end', async () => {
    const store = makeStore([
      catalogRow({ id: 'origin' }),
      catalogRow({
        id: 'shared',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
      }),
    ]);

    await enrich(store, 'origin', { kdnPercent: '72.5' });
    await expect(
      enrich(store, 'shared', { kdnPercent: '65' }),
    ).rejects.toMatchObject({ message: 'KDN_PROMOTED_COPY_NOT_KDN_AUTHORITY' });

    expect(read(store.row('origin'))).toBe('72.50');
    expect(read(store.row('shared'))).toBe('72.50');
  });

  /** T3 — a divergence that already exists is reported, never resolved. */
  it('T3 refuses a pre-existing divergence without choosing a side', async () => {
    const store = makeStore([
      catalogRow({ id: 'origin', kdnPercent: kdn('72.50') }),
      catalogRow({
        id: 'shared',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
        kdnPercent: kdn('65.00'),
      }),
    ]);

    await expect(
      enrich(store, 'origin', { kdnPercent: '72.5' }),
    ).rejects.toMatchObject({ message: 'KDN_LINEAGE_DIVERGENT' });

    // Neither number was preferred, overwritten, or averaged away.
    expect(read(store.row('origin'))).toBe('72.50');
    expect(read(store.row('shared'))).toBe('65.00');
    expect(store.provenance).toHaveLength(0);
  });

  /**
   * T3b — a half-filled lineage is a disagreement too. The origin already
   * states nothing while its copy states a number; "fill the null side" is
   * exactly the auto-resolution the Owner refused.
   */
  it('T3b treats null-vs-stated as divergence, not as a gap to fill', async () => {
    const store = makeStore([
      catalogRow({ id: 'origin' }),
      catalogRow({
        id: 'shared',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
        kdnPercent: kdn('65.00'),
      }),
    ]);

    await expect(enrich(store, 'origin')).rejects.toMatchObject({
      message: 'KDN_LINEAGE_DIVERGENT',
    });
    expect(read(store.row('origin'))).toBeNull();
    expect(read(store.row('shared'))).toBe('65.00');
  });

  /**
   * T4 — every descendant, or none.
   *
   * `promotedFromBasicPriceId` is UNIQUE, so today the database admits exactly
   * one descendant per origin. The propagation is written set-based anyway, and
   * this proves it stays correct for N rather than relying on that constraint.
   */
  it('T4 keeps multiple descendants consistent in one atomic write', async () => {
    const store = makeStore([
      catalogRow({ id: 'origin' }),
      catalogRow({
        id: 'shared-a',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
      }),
      catalogRow({
        id: 'shared-b',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
      }),
    ]);

    await enrich(store, 'origin');

    expect(read(store.row('origin'))).toBe('72.50');
    expect(read(store.row('shared-a'))).toBe('72.50');
    expect(read(store.row('shared-b'))).toBe('72.50');
    expect(store.provenance.map((p) => p.basicPriceId).sort()).toEqual([
      'origin',
      'shared-a',
      'shared-b',
    ]);
  });

  /**
   * T4b — ATOMICITY UNDER CONCURRENCY. Another transaction claims one
   * descendant between the origin's update and the propagation. The
   * fill-missing guard then reaches one row short, and a short count is not a
   * partial success: the whole transaction rolls back, origin included.
   */
  it('T4b rolls the origin back when a descendant cannot be carried with it', async () => {
    const store = makeStore([
      catalogRow({ id: 'origin' }),
      catalogRow({
        id: 'shared-a',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
      }),
      catalogRow({
        id: 'shared-b',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
      }),
    ]);
    store.setAfterFirstUpdate(() => {
      store.mutate('shared-b', { kdnPercent: kdn('65.00') });
    });

    await expect(enrich(store, 'origin')).rejects.toMatchObject({
      message: 'KDN_LINEAGE_PROPAGATION_INCOMPLETE',
    });

    // THE POINT OF THE TEST: the origin does not keep the number it briefly had.
    expect(read(store.row('origin'))).toBeNull();
    expect(read(store.row('shared-a'))).toBeNull();
    expect(store.provenance).toHaveLength(0);
  });

  /** T5 — a lineage this method cannot see all of is refused, not guessed at. */
  it('T5 fails closed when the lineage extends past what was read', async () => {
    const store = makeStore([
      catalogRow({ id: 'origin' }),
      catalogRow({
        id: 'shared',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
      }),
      catalogRow({
        id: 'grandchild',
        workspaceId: null,
        promotedFromBasicPriceId: 'shared',
      }),
    ]);

    await expect(enrich(store, 'origin')).rejects.toMatchObject({
      message: 'KDN_LINEAGE_NOT_PROVABLE',
    });
    expect(read(store.row('origin'))).toBeNull();
    expect(read(store.row('shared'))).toBeNull();
  });

  /** T6 — the pre-existing no-silent-overwrite law is unchanged by all this. */
  it('T6 still refuses to overwrite a stated KDN on a consistent lineage', async () => {
    const store = makeStore([
      catalogRow({ id: 'origin', kdnPercent: kdn('72.50') }),
      catalogRow({
        id: 'shared',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
        kdnPercent: kdn('72.50'),
      }),
    ]);

    await expect(
      enrich(store, 'origin', { kdnPercent: '40' }),
    ).rejects.toMatchObject({ message: 'KDN_CONFLICT_NO_SILENT_OVERWRITE' });
    expect(read(store.row('origin'))).toBe('72.50');
    expect(read(store.row('shared'))).toBe('72.50');
  });

  /** T7 — money and both publication axes are untouched on every row. */
  it('T7 moves no price, status or verification anywhere in the lineage', async () => {
    const store = makeStore([
      catalogRow({ id: 'origin' }),
      catalogRow({
        id: 'shared',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
      }),
    ]);
    const before = store.all().map((row) => ({
      id: row.id,
      value: row.value.toFixed(2),
      status: row.status,
      verificationStatus: row.verificationStatus,
    }));

    await enrich(store, 'origin');

    expect(
      store.all().map((row) => ({
        id: row.id,
        value: row.value.toFixed(2),
        status: row.status,
        verificationStatus: row.verificationStatus,
      })),
    ).toEqual(before);
  });

  /** T8 — every row that changed carries its own attribution. */
  it('T8 writes one provenance record per row actually changed', async () => {
    const store = makeStore([
      catalogRow({ id: 'origin' }),
      catalogRow({
        id: 'shared',
        workspaceId: null,
        promotedFromBasicPriceId: 'origin',
      }),
    ]);

    await enrich(store, 'origin');

    expect(store.provenance).toEqual([
      { basicPriceId: 'origin', reason: 'kurasi KDN' },
      { basicPriceId: 'shared', reason: 'kurasi KDN' },
    ]);
  });

  /** A lineage-free catalog row keeps behaving exactly as it did before. */
  it('leaves an unpromoted catalog row on its original single-row path', async () => {
    const store = makeStore([catalogRow({ id: 'solo' })]);

    const result = await enrich(store, 'solo');

    expect(result.unchanged).toBe(false);
    expect(read(store.row('solo'))).toBe('72.50');
    expect(store.provenance).toEqual([
      { basicPriceId: 'solo', reason: 'kurasi KDN' },
    ]);
  });
});
