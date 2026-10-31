import { buildBasicPriceItemIndex, selectBasicPriceItemId } from './basic-price-item-summary';

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
});
