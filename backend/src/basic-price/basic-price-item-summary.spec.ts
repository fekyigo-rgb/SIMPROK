import { buildBasicPriceItemIndex, pageBasicPriceItems, selectBasicPriceItemId } from './basic-price-item-summary';

describe('BP item summary canonical resource identity', () => {
  const resources = [
    { id: 'r2', name: 'Agregat Halus', code: 'M04-B', type: 'MATERIAL', baseUnit: 'm3' },
    { id: 'r1', name: 'Agregat Halus', code: 'M04-A', type: 'MATERIAL', baseUnit: 'm3' },
    { id: 'r3', name: 'Semen Portland', code: 'M05', type: 'MATERIAL', baseUnit: 'zak' },
  ];
  it('one summary per canonical id, retaining every price observation', () => {
    const result = buildBasicPriceItemIndex([
      { resourceId: 'r3', count: 1 },
      { resourceId: 'r2', count: 71 },
      { resourceId: 'r1', count: 58 },
    ], resources);
    expect(result.totalPrices).toBe(130);
    expect(result.totalItems).toBe(3);
    expect(result.items.map(r => [r.id, r.priceCount])).toEqual([
      ['r1', 58], ['r2', 71], ['r3', 1],
    ]);
    expect(result.items[0].name).toBe(result.items[1].name);
    expect(result.items[0].duplicateName).toBe(true);
    expect(result.items[1].duplicateName).toBe(true);
    expect(selectBasicPriceItemId(result)).toBe('r1');
    expect(selectBasicPriceItemId(result, 'r2')).toBe('r2');
    expect(selectBasicPriceItemId(result, 'forged')).toBeNull();
  });
  it('empty index contains zero items and no invented selection', () => {
    const result = buildBasicPriceItemIndex([], []);
    expect(result).toEqual({ totalPrices: 0, totalItems: 0, items: [] });
    expect(selectBasicPriceItemId(result, 'first')).toBeNull();
  });
  it('unknown resource id fails closed rather than using a similar name', () => {
    expect(() => buildBasicPriceItemIndex([{ resourceId: 'lost', count: 1 }], resources))
      .toThrow('BP_ITEM_SUMMARY_MISSING_RESOURCE_IDENTITY');
  });
  it('bad counts and duplicate ids never produce untruthful summaries', () => {
    expect(() => buildBasicPriceItemIndex([{ resourceId: 'r1', count: -1 }], resources))
      .toThrow('BP_ITEM_SUMMARY_INVALID_COUNT');
    expect(() => buildBasicPriceItemIndex([
      { resourceId: 'r1', count: 1 }, { resourceId: 'r1', count: 2 },
    ], resources)).toThrow('BP_ITEM_SUMMARY_DUPLICATE_ID');
  });
  it('bounded summary returns at most 50 item rows with complete global counts', () => {
    const all = Array.from({ length: 123 }, (_, i) => ({
      id: 'r-' + String(i).padStart(3, '0'),
      name: 'Item ' + String(i).padStart(3, '0'),
      code: 'M' + String(i).padStart(3, '0'),
      type: 'MATERIAL', baseUnit: 'm3',
    }));
    const full = buildBasicPriceItemIndex(
      all.map((r) => ({ resourceId: r.id, count: 2 })), all,
    );
    const first = pageBasicPriceItems(full, 1);
    const second = pageBasicPriceItems(full, 2);
    const third = pageBasicPriceItems(full, 3);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(50);
    expect(third.items).toHaveLength(23);
    expect(third.totalPrices).toBe(246);
    expect(third.totalItems).toBe(123);
    expect(third.totalPages).toBe(3);
    expect([...first.items, ...second.items, ...third.items].map((x) => x.id))
      .toEqual(full.items.map((x) => x.id));
    expect(pageBasicPriceItems(full, 999).page).toBe(3);
    expect(() => pageBasicPriceItems(full, 0)).toThrow('BP_ITEM_SUMMARY_INVALID_PAGE');
  });
  it('duplicate names remain marked across a 50-item summary page boundary', () => {
    const resources = Array.from({ length: 51 }, (_, i) => ({
      id: 'r-' + i,
      name: i < 49 ? 'A' + String(i).padStart(3, '0') : 'ZZZ',
      code: 'C' + i,
      type: 'MATERIAL', baseUnit: 'm3',
    }));
    const all = buildBasicPriceItemIndex(
      resources.map((resource) => ({ resourceId: resource.id, count: 1 })), resources,
    );
    const first = pageBasicPriceItems(all, 1);
    const second = pageBasicPriceItems(all, 2);
    expect(first.items.at(-1)?.duplicateName).toBe(true);
    expect(second.items[0].duplicateName).toBe(true);
    expect(first.items.at(-1)?.id).not.toBe(second.items[0].id);
  });
});
