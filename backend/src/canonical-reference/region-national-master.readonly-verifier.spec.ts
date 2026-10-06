import {
  indexedRegionQueryClient,
  planNationalRegionReuseReadOnly,
} from './region-national-master.readonly-verifier';
import type { RegionDesignation, RegionRow } from './region-provisioner';

const designations: RegionDesignation[] = [
  {
    regionCode: 'ID',
    regionName: 'Indonesia',
    administrativeLevel: 'COUNTRY',
  },
  {
    regionCode: '94',
    regionName: 'Papua',
    parentRegionCode: 'ID',
    administrativeLevel: 'PROVINCE',
  },
];

const exactRows: RegionRow[] = [
  {
    id: 'country-id',
    code: 'ID',
    name: 'Indonesia',
    isActive: true,
    parentId: null,
    administrativeLevel: 'COUNTRY',
  },
  {
    id: 'province-94',
    code: '94',
    name: 'Papua',
    isActive: true,
    parentId: 'country-id',
    administrativeLevel: 'PROVINCE',
  },
];

describe('BP-REG-01 read-only national reuse verifier', () => {
  it('delegates exact reuse decisions to buildRegionPlan and reports no create/conflict', async () => {
    await expect(
      planNationalRegionReuseReadOnly({ designations, rows: exactRows }),
    ).resolves.toEqual({
      plannedCreate: 0,
      plannedReuse: 2,
      plannedConflict: 0,
      conflictReasonCounts: {},
    });
  });

  it('reports planner create/conflict dispositions without mutating its input snapshot', async () => {
    const rows = exactRows.map((row) => ({ ...row }));
    rows[1].name = 'Stored contradiction';
    const before = JSON.stringify(rows);
    const report = await planNationalRegionReuseReadOnly({
      designations: [
        ...designations,
        {
          regionCode: '95',
          regionName: 'Papua Selatan',
          parentRegionCode: 'ID',
          administrativeLevel: 'PROVINCE',
        },
      ],
      rows,
    });
    expect(report).toEqual({
      plannedCreate: 1,
      plannedReuse: 1,
      plannedConflict: 1,
      conflictReasonCounts: { STOP_REGION_CODE_CONFLICT: 1 },
    });
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('implements only the planner findMany surface and returns detached result arrays', async () => {
    const client = indexedRegionQueryClient(exactRows);
    const first = await client.region.findMany({
      where: { OR: [{ code: 'ID' }, { name: 'Papua' }] },
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        parentId: true,
        administrativeLevel: true,
      },
    });
    expect(first.map((row) => row.code)).toEqual(['ID', '94']);
    first.pop();
    await expect(
      client.region.findMany({
        where: { OR: [{ code: '94' }] },
        select: {
          id: true,
          code: true,
          name: true,
          isActive: true,
          parentId: true,
          administrativeLevel: true,
        },
      }),
    ).resolves.toHaveLength(1);
  });
});
