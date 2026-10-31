/**
 * Basic Price Explorer item summary, read-only view.
 * Resource ID is the ONLY grouping key: same-name/different-resource
 * identities remain distinct, while differently sourced price observations
 * for the same resource remain separate behind the summary.
 * Counts originate exclusively from the canonical eligible server predicate.
 */
export interface BasicPriceItemCount {
  resourceId: string;
  count: number;
}
export interface BasicPriceItemIdentity {
  id: string;
  name: string;
  code: string | null;
  type: string;
  baseUnit: string;
}
export interface BasicPriceItemSummary extends BasicPriceItemIdentity {
  priceCount: number;
}
export interface BasicPriceItemIndex {
  totalPrices: number;
  totalItems: number;
  items: BasicPriceItemSummary[];
}
export const buildBasicPriceItemIndex = (
  counts: readonly BasicPriceItemCount[],
  resources: readonly BasicPriceItemIdentity[],
): BasicPriceItemIndex => {
  const names = new Map(resources.map((r) => [r.id, r]));
  const items: BasicPriceItemSummary[] = [];
  const seen = new Set<string>();
  for (const count of counts) {
    if (!Number.isSafeInteger(count.count) || count.count < 0) {
      throw new Error('BP_ITEM_SUMMARY_INVALID_COUNT');
    }
    if (seen.has(count.resourceId)) {
      throw new Error('BP_ITEM_SUMMARY_DUPLICATE_ID');
    }
    seen.add(count.resourceId);
    const resource = names.get(count.resourceId);
    if (!resource) throw new Error('BP_ITEM_SUMMARY_MISSING_RESOURCE_IDENTITY');
    items.push({ ...resource, priceCount: count.count });
  }
  items.sort((a, b) =>
    a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }) ||
    (a.code ?? '').localeCompare(b.code ?? '', 'id') ||
    a.id.localeCompare(b.id),
  );
  return {
    totalPrices: counts.reduce((sum, c) => sum + c.count, 0),
    totalItems: items.length,
    items,
  };
};

export const basicPriceItemIds = (index: BasicPriceItemIndex): string[] =>
  index.items.map((x) => x.id);

/** Unknown ID must fail closed. It must not widen the visible price list. */
export const selectBasicPriceItemId = (
  index: BasicPriceItemIndex, requested?: string,
): string | null => {
  if (!index.items.length) return null;
  if (!requested || requested === 'first') return index.items[0].id;
  return index.items.some((item) => item.id === requested) ? requested : null;
};
