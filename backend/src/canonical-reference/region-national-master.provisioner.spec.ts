import * as nationalMasterGate from './region-national-master.gate';
import {
  applyNationalRegionMaster,
  type NationalRegionPrismaLike,
} from './region-national-master.provisioner';
import {
  GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
  type RegionDesignation,
  type RegionRow,
  type RegionTransactionClient,
} from './region-provisioner';

const lawfulTree: RegionDesignation[] = [
  {
    regionCode: 'ID',
    regionName: 'Indonesia',
    administrativeLevel: 'COUNTRY',
  },
  {
    regionCode: '31',
    regionName: 'DKI Jakarta',
    parentRegionCode: 'ID',
    administrativeLevel: 'PROVINCE',
  },
  {
    regionCode: '31.74',
    regionName: 'Jakarta Selatan',
    parentRegionCode: '31',
    administrativeLevel: 'REGENCY_CITY',
  },
  {
    regionCode: '31.74.10',
    regionName: 'Kebayoran Baru',
    parentRegionCode: '31.74',
    administrativeLevel: 'DISTRICT',
  },
  {
    regionCode: '31.74.10.1001',
    regionName: 'Selong',
    parentRegionCode: '31.74.10',
    administrativeLevel: 'VILLAGE',
  },
];

function harness(): { prisma: NationalRegionPrismaLike; rows: RegionRow[] } {
  const rows: RegionRow[] = [];
  const findMany: RegionTransactionClient['region']['findMany'] = async ({
    where,
  }) =>
    rows.filter((row) =>
      where.OR.some(
        (candidate) =>
          ('code' in candidate && candidate.code === row.code) ||
          ('name' in candidate && candidate.name === row.name),
      ),
    );
  const tx: RegionTransactionClient = {
    region: {
      findMany,
      create: async ({ data }) => {
        const row: RegionRow = {
          id: `region-${rows.length + 1}`,
          code: data.code,
          name: data.name,
          isActive: true,
          parentId: data.parentId ?? null,
          administrativeLevel: data.administrativeLevel ?? null,
        };
        rows.push(row);
        return row;
      },
    },
    $executeRawUnsafe: async () => 0,
  };
  return {
    prisma: {
      region: { findMany },
      $transaction: async (run) => run(tx),
    },
    rows,
  };
}

describe('BP-REG-01 national Region provisioner', () => {
  afterEach(() => jest.restoreAllMocks());

  it('refuses an integrity-blocked dump before any Region write', async () => {
    const dump: nationalMasterGate.NationalRegionDump = {
      source: 'KEMENDAGRI',
      sourceDocument: 'TEST-ONLY unproven same-scope fixture',
      rows: [
        {
          regionCode: 'ID',
          regionName: 'Indonesia',
          administrativeLevel: 'COUNTRY',
        },
        {
          regionCode: '31',
          regionName: 'DKI Jakarta',
          parentRegionCode: 'ID',
          administrativeLevel: 'PROVINCE',
        },
        {
          regionCode: '31.74',
          regionName: 'Jakarta Selatan',
          parentRegionCode: '31',
          administrativeLevel: 'REGENCY_CITY',
        },
        {
          regionCode: '31.75',
          regionName: 'Jakarta Selatan',
          parentRegionCode: '31',
          administrativeLevel: 'REGENCY_CITY',
        },
      ],
    };
    const state = harness();
    await expect(
      applyNationalRegionMaster({
        prisma: state.prisma,
        dump,
        confirmationToken: GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
        expectedConfirmationToken: GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
      }),
    ).rejects.toThrow(/STOP_NATIONAL_REGION_MASTER_NOT_COMPLETE/);
    expect(state.rows).toEqual([]);
  });

  it('orchestrates assessed parent-first plans only through applyRegionPlan and is idempotent', async () => {
    jest
      .spyOn(nationalMasterGate, 'assessNationalRegionMaster')
      .mockReturnValue({
        status: 'READY_FOR_APPLY',
        reasonCode: nationalMasterGate.NATIONAL_MASTER_READY_FOR_APPLY,
        nationalMasterComplete: true,
        coverage: {
          COUNTRY: 1,
          PROVINCE: 1,
          REGENCY_CITY: 1,
          DISTRICT: 1,
          VILLAGE: 1,
        },
        integrityErrors: [],
        designations: lawfulTree,
        sameNameSameScopeDistinctValidCodeCount: 0,
        sourceTransformationLossCount: 0,
        supportingProvenance: [],
        historicalSuccession: null,
      });

    const state = harness();
    const progress: number[] = [];
    const apply = () =>
      applyNationalRegionMaster({
        prisma: state.prisma,
        dump: {
          source: 'KEMENDAGRI',
          sourceDocument: 'TEST-ONLY assessed orchestration fixture',
          rows: [],
        },
        confirmationToken: GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
        expectedConfirmationToken: GOVERNED_REHEARSAL_REGION_CONFIRMATION_TOKEN,
        onProgress: ({ processed }) => progress.push(processed),
      });

    await expect(apply()).resolves.toEqual({
      processed: 5,
      total: 5,
      created: 5,
      reused: 0,
      nationalMasterComplete: true,
    });
    expect(state.rows).toHaveLength(5);
    await expect(apply()).resolves.toEqual({
      processed: 5,
      total: 5,
      created: 0,
      reused: 5,
      nationalMasterComplete: true,
    });
    expect(state.rows).toHaveLength(5);
    expect(progress).toEqual([1, 2, 3, 4, 5, 1, 2, 3, 4, 5]);
  });
});
