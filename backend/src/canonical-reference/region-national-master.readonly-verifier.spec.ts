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

const malukuHierarchy: RegionDesignation[] = [
  {
    regionCode: 'ID',
    regionName: 'Indonesia',
    administrativeLevel: 'COUNTRY',
  },
  {
    regionCode: '81',
    regionName: 'Maluku',
    parentRegionCode: 'ID',
    administrativeLevel: 'PROVINCE',
  },
  {
    regionCode: '81.71',
    regionName: 'Kota Ambon',
    parentRegionCode: '81',
    administrativeLevel: 'REGENCY_CITY',
  },
  {
    regionCode: '81.71.01',
    regionName: 'Sirimau',
    parentRegionCode: '81.71',
    administrativeLevel: 'DISTRICT',
  },
  {
    regionCode: '81.71.01.1001',
    regionName: 'Batu Meja',
    parentRegionCode: '81.71.01',
    administrativeLevel: 'VILLAGE',
  },
];

describe('BP-REG-01 read-only national reuse verifier', () => {
  it('plans an empty-snapshot parent and child as prospective creates', async () => {
    await expect(
      planNationalRegionReuseReadOnly({
        designations: malukuHierarchy.slice(0, 2),
        rows: [],
      }),
    ).resolves.toEqual({
      plannedCreate: 2,
      plannedReuse: 0,
      plannedConflict: 0,
      conflictReasonCounts: {},
    });
  });

  it('plans a five-level hierarchy prospectively from an empty snapshot', async () => {
    await expect(
      planNationalRegionReuseReadOnly({
        designations: malukuHierarchy,
        rows: [],
      }),
    ).resolves.toEqual({
      plannedCreate: 5,
      plannedReuse: 0,
      plannedConflict: 0,
      conflictReasonCounts: {},
    });
  });

  it('reuses a persisted parent chain and prospectively creates its missing descendants', async () => {
    const partialRows: RegionRow[] = [
      {
        id: 'country-id',
        code: 'ID',
        name: 'Indonesia',
        isActive: true,
        parentId: null,
        administrativeLevel: 'COUNTRY',
      },
      {
        id: 'province-81',
        code: '81',
        name: 'Maluku',
        isActive: true,
        parentId: 'country-id',
        administrativeLevel: 'PROVINCE',
      },
    ];

    await expect(
      planNationalRegionReuseReadOnly({
        designations: malukuHierarchy,
        rows: partialRows,
      }),
    ).resolves.toEqual({
      plannedCreate: 3,
      plannedReuse: 2,
      plannedConflict: 0,
      conflictReasonCounts: {},
    });
  });

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

  it('preserves a persisted hierarchy contradiction as a real conflict', async () => {
    const contradictoryRows: RegionRow[] = [
      {
        id: 'country-id',
        code: 'ID',
        name: 'Indonesia',
        isActive: true,
        parentId: null,
        administrativeLevel: 'COUNTRY',
      },
      {
        id: 'province-81',
        code: '81',
        name: 'Maluku',
        isActive: true,
        parentId: 'wrong-parent',
        administrativeLevel: 'PROVINCE',
      },
    ];

    await expect(
      planNationalRegionReuseReadOnly({
        designations: malukuHierarchy.slice(0, 2),
        rows: contradictoryRows,
      }),
    ).resolves.toEqual({
      plannedCreate: 0,
      plannedReuse: 1,
      plannedConflict: 1,
      conflictReasonCounts: { STOP_REGION_HIERARCHY_CONFLICT: 1 },
    });
  });

  it('preserves an inactive persisted row as a real conflict', async () => {
    await expect(
      planNationalRegionReuseReadOnly({
        designations: malukuHierarchy.slice(0, 1),
        rows: [{ ...exactRows[0], isActive: false }],
      }),
    ).resolves.toEqual({
      plannedCreate: 0,
      plannedReuse: 0,
      plannedConflict: 1,
      conflictReasonCounts: { STOP_REGION_INACTIVE_CONFLICT: 1 },
    });
  });

  it('preserves legacy unscoped same-name fail-closed behavior', async () => {
    await expect(
      planNationalRegionReuseReadOnly({
        designations: [{ regionCode: 'legacy-2', regionName: 'Shared name' }],
        rows: [
          {
            id: 'legacy-1',
            code: 'legacy-1',
            name: 'Shared name',
            isActive: true,
            parentId: null,
            administrativeLevel: null,
          },
        ],
      }),
    ).resolves.toEqual({
      plannedCreate: 0,
      plannedReuse: 0,
      plannedConflict: 1,
      conflictReasonCounts: { STOP_REGION_NAME_CONFLICT: 1 },
    });
  });

  it('keeps prospective rows inside local planning state and leaves caller rows byte-for-byte unchanged', async () => {
    const rows: RegionRow[] = [];
    const before = JSON.stringify(rows);

    await expect(
      planNationalRegionReuseReadOnly({
        designations: malukuHierarchy,
        rows,
      }),
    ).resolves.toMatchObject({ plannedCreate: 5, plannedConflict: 0 });
    expect(JSON.stringify(rows)).toBe(before);
    expect(rows).toHaveLength(0);
  });

  it('indexes the caller snapshot once while extending prospective state incrementally', async () => {
    const rows: RegionRow[] = [];
    const baseIterator = rows[Symbol.iterator].bind(rows);
    const iteratorSpy = jest.fn(() => baseIterator());
    Object.defineProperty(rows, Symbol.iterator, { value: iteratorSpy });

    await expect(
      planNationalRegionReuseReadOnly({
        designations: malukuHierarchy,
        rows,
      }),
    ).resolves.toMatchObject({ plannedCreate: 5, plannedConflict: 0 });
    expect(iteratorSpy).toHaveBeenCalledTimes(1);
  });

  it('does not turn an unrelated sparse two-row snapshot into blanket descendant conflicts', async () => {
    const sparseRows: RegionRow[] = [
      {
        id: 'legacy-a',
        code: 'LEGACY-A',
        name: 'Legacy A',
        isActive: true,
        parentId: null,
        administrativeLevel: null,
      },
      {
        id: 'legacy-b',
        code: 'LEGACY-B',
        name: 'Legacy B',
        isActive: true,
        parentId: null,
        administrativeLevel: null,
      },
    ];

    await expect(
      planNationalRegionReuseReadOnly({
        designations: malukuHierarchy,
        rows: sparseRows,
      }),
    ).resolves.toEqual({
      plannedCreate: 5,
      plannedReuse: 0,
      plannedConflict: 0,
      conflictReasonCounts: {},
    });
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
