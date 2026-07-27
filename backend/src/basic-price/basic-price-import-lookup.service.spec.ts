import { Test } from '@nestjs/testing';
import { BasicPriceImportLookupService } from './basic-price-import-lookup.service';
import { PrismaService } from '../prisma/prisma.service';

describe('BasicPriceImportLookupService', () => {
  let service: BasicPriceImportLookupService;
  let queryRaw: jest.Mock;

  beforeEach(async () => {
    queryRaw = jest.fn();
    const module = await Test.createTestingModule({
      providers: [
        BasicPriceImportLookupService,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
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
});
