import { Test } from '@nestjs/testing';
import { BasicPriceImportLookupService } from './basic-price-import-lookup.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BasicPriceImportLookupService', () => {
  let service: BasicPriceImportLookupService;
  let queryRaw: jest.Mock;
  let regionFindMany: jest.Mock;
  let regionCount: jest.Mock;

  beforeEach(async () => {
    queryRaw = jest.fn();
    regionFindMany = jest.fn();
    regionCount = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        BasicPriceImportLookupService,
        {
          provide: PrismaService,
          useValue: { $queryRaw: queryRaw, region: { findMany: regionFindMany, count: regionCount } },
        },
      ],
    }).compile();
    service = module.get(BasicPriceImportLookupService);
  });

  const sqlText = (query: { strings?: readonly string[] }) => query.strings?.join('') ?? '';
  const sqlValues = (query: { values?: unknown[] }) => query.values ?? [];

  it('returns a stable resource page and derives total/hasNext without writes', async () => {
    queryRaw
      .mockResolvedValueOnce([
        { id: 'r1', code: null, name: 'Kerikil', type: 'MATERIAL', baseUnit: 'M3', status: 'ACTIVE' },
      ])
      .mockResolvedValueOnce([{ count: 3n }]);

    await expect(service.searchResources('10000000-0000-4000-8000-000000000004', { q: '', page: 1, limit: 1 }))
      .resolves.toEqual({
        items: [{ id: 'r1', code: null, name: 'Kerikil', type: 'MATERIAL', baseUnit: 'M3', status: 'ACTIVE' }],
        page: 1,
        limit: 1,
        total: 3,
        hasNext: true,
      });
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });

  it('resource SQL enforces active workspace ownership, type, deterministic ranking, and bounded fields', async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0n }]);
    await service.searchResources('10000000-0000-4000-8000-000000000004', {
      q: 'brc',
      type: 'MATERIAL',
      page: 2,
      limit: 20,
    });

    const pageQuery = queryRaw.mock.calls[0][0];
    const text = sqlText(pageQuery);
    expect(text).toContain('"workspaceId" =');
    expect(text).toContain('"status" = \'ACTIVE\'');
    expect(text).toContain('"type" =');
    expect(text).toContain('NULLS LAST');
    expect(text).not.toContain('specifications');
    expect(text).not.toContain('sourceIdentity');
    expect(text).not.toContain('resource_source_identities');
    expect(sqlValues(pageQuery)).toEqual(expect.arrayContaining(['brc', 20]));
  });

  it('resource search is case-insensitive and ranks exact code/name before prefixes and contains', async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0n }]);
    await service.searchResources('10000000-0000-4000-8000-000000000004', { q: 'KaWaT', page: 1, limit: 20 });
    const text = sqlText(queryRaw.mock.calls[0][0]);
    expect((text.match(/lower\(/g) ?? []).length).toBeGreaterThan(5);
    expect(text).toMatch(/CASE[\s\S]*"code"[\s\S]*THEN 0[\s\S]*"name"[\s\S]*THEN 1[\s\S]*THEN 2[\s\S]*THEN 3/);
    expect(text).toContain('position(');
  });

  it('unit SQL is active-only, alias-active-only, deduplicated, filtered, and exposes no conversion rule', async () => {
    queryRaw
      .mockResolvedValueOnce([
        { id: 'u1', code: 'M3', displayName: 'Meter Kubik', symbol: 'm³', dimension: 'VOLUME', kind: 'CANONICAL' },
      ])
      .mockResolvedValueOnce([{ count: 1n }]);

    const result = await service.searchUnits({
      q: 'meter',
      dimension: 'VOLUME',
      kind: 'CANONICAL',
      page: 1,
      limit: 20,
    });
    const text = sqlText(queryRaw.mock.calls[0][0]);
    expect(text).toContain('unit."isActive" = true');
    expect(text).toContain('alias."isActive" = true');
    expect(text).toContain('unit."dimension" =');
    expect(text).toContain('unit."kind" =');
    expect(text).not.toContain('JOIN');
    expect(text).not.toContain('conversion');
    expect(result.total).toBe(1);
    expect(result.hasNext).toBe(false);
  });

  it('unit ranking orders exact code, symbol, display name, alias, prefix, then contains', async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0n }]);
    await service.searchUnits({ q: 'OH', page: 1, limit: 20 });
    const text = sqlText(queryRaw.mock.calls[0][0]);
    expect(text).toMatch(/CASE[\s\S]*"code"[\s\S]*THEN 0[\s\S]*"symbol"[\s\S]*THEN 1[\s\S]*"displayName"[\s\S]*THEN 2/);
    expect(text).toContain('THEN 3');
    expect(text).toContain('THEN 4');
    expect(text).toContain('ELSE 5');
  });

  it('empty unit query returns the deterministic first page without requiring aliases', async () => {
    queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0n }]);
    await expect(service.searchUnits({ page: 1, limit: 20 })).resolves.toEqual({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      hasNext: false,
    });
    expect(sqlText(queryRaw.mock.calls[0][0])).toContain('lower(unit."displayName") ASC');
  });

  describe('searchRegions (RM-02D2A2)', () => {
    it('returns active regions with optional parent identity and derives total/hasNext', async () => {
      regionFindMany.mockResolvedValue([
        {
          id: 'reg1',
          code: 'ID-JK',
          name: 'DKI Jakarta',
          administrativeLevel: null,
          parentId: null,
          parent: null,
        },
      ]);
      regionCount.mockResolvedValue(3);

      await expect(service.searchRegions({ q: '', page: 1, limit: 1 })).resolves.toEqual({
        items: [
          {
            id: 'reg1',
            code: 'ID-JK',
            name: 'DKI Jakarta',
            administrativeLevel: null,
            parentId: null,
            parentName: null,
          },
        ],
        page: 1,
        limit: 1,
        total: 3,
        hasNext: true,
      });

      const args = regionFindMany.mock.calls[0][0];
      expect(args.where).toEqual({ isActive: true });
      expect(args.select).toEqual({
        id: true,
        code: true,
        name: true,
        administrativeLevel: true,
        parentId: true,
        parent: { select: { name: true } },
      });
      expect(args.take).toBe(1);
      expect(args.skip).toBe(0);
    });

    it('adds a case-insensitive code-or-name filter when q is present, still active-only', async () => {
      regionFindMany.mockResolvedValue([]);
      regionCount.mockResolvedValue(0);

      await service.searchRegions({ q: 'jak', page: 2, limit: 20 });

      const args = regionFindMany.mock.calls[0][0];
      expect(args.where.isActive).toBe(true);
      expect(JSON.stringify(args.where.OR)).toContain('insensitive');
      expect(JSON.stringify(args.where.OR)).toContain('jak');
      expect(JSON.stringify(args.where.OR)).toContain('parent');
      expect(args.skip).toBe(20);
    });

    it('returns every matching Region rather than auto-selecting one', async () => {
      regionFindMany.mockResolvedValue([
        {
          id: 'a',
          code: '3174',
          name: 'Jakarta Selatan',
          administrativeLevel: 'REGENCY_CITY',
          parentId: 'p1',
          parent: { name: 'DKI Jakarta' },
        },
        {
          id: 'b',
          code: '3171',
          name: 'Jakarta Selatan',
          administrativeLevel: null,
          parentId: null,
          parent: null,
        },
      ]);
      regionCount.mockResolvedValue(2);

      const page = await service.searchRegions({ q: 'Jakarta Selatan', page: 1, limit: 20 });
      expect(page.items).toHaveLength(2);
      expect(page.items.map((item) => item.id).sort()).toEqual(['a', 'b']);
      expect(page.items.find((item) => item.id === 'a')?.parentName).toBe('DKI Jakarta');
    });

    it('still resolves the live Permanent Region names', async () => {
      regionFindMany.mockResolvedValue([
        {
          id: '8ef1d647-0828-43c6-9941-f0b88a1fd8a1',
          code: '3171',
          name: 'Jakarta Selatan',
          administrativeLevel: null,
          parentId: null,
          parent: null,
        },
      ]);
      regionCount.mockResolvedValue(1);
      await expect(
        service.searchRegions({ q: 'Jakarta Selatan', page: 1, limit: 20 }),
      ).resolves.toMatchObject({
        items: [{ id: '8ef1d647-0828-43c6-9941-f0b88a1fd8a1', name: 'Jakarta Selatan' }],
        total: 1,
      });

      regionFindMany.mockResolvedValue([
        {
          id: '655440a8-6b34-4545-bf0f-f10f31d42173',
          code: '8171030',
          name: 'Kecamatan Teluk Ambon Baguala, Kota Ambon',
          administrativeLevel: null,
          parentId: null,
          parent: null,
        },
      ]);
      regionCount.mockResolvedValue(1);
      await expect(
        service.searchRegions({ q: 'Baguala', page: 1, limit: 20 }),
      ).resolves.toMatchObject({
        items: [
          {
            id: '655440a8-6b34-4545-bf0f-f10f31d42173',
            name: 'Kecamatan Teluk Ambon Baguala, Kota Ambon',
          },
        ],
      });
    });

    it('walks existing parent-child identity without inventing a second Region engine', async () => {
      regionFindMany.mockResolvedValue([]);
      regionCount.mockResolvedValue(0);
      await service.searchRegions({
        parentId: '8ef1d647-0828-43c6-9941-f0b88a1fd8a1',
        administrativeLevel: 'DISTRICT',
        page: 1,
        limit: 20,
      });
      const args = regionFindMany.mock.calls[0][0];
      expect(args.where.isActive).toBe(true);
      expect(args.where.parentId).toBe('8ef1d647-0828-43c6-9941-f0b88a1fd8a1');
      expect(args.where.administrativeLevel).toBe('DISTRICT');
    });
  });
});
