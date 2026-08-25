import { PriceSourceOrigin } from '@prisma/client';

/**
 * Owner-locked, human-facing Basic Price source families (Owner Decision:
 * ONE SIMPROK BASIC PRICE PRODUCT MODEL, §5 Source and Origin Model). No new
 * enum or schema field — this is a pure grouping over the existing
 * PriceSourceOrigin values, used only for filtering/labeling.
 *
 * GOVERNMENT      -> Harga Pemerintah
 * STORE_SUPPLIER  -> Harga Toko/Supplier
 * FIELD_PRICE     -> Harga Lapangan
 */
export const SOURCE_FAMILIES = [
  'GOVERNMENT',
  'STORE_SUPPLIER',
  'FIELD_PRICE',
] as const;
export type SourceFamily = (typeof SOURCE_FAMILIES)[number];

export const SOURCE_FAMILY_ORIGIN_MAP: Record<
  SourceFamily,
  PriceSourceOrigin[]
> = {
  GOVERNMENT: [PriceSourceOrigin.GOVERNMENT],
  STORE_SUPPLIER: [
    PriceSourceOrigin.SUPPLIER,
    PriceSourceOrigin.STORE,
    PriceSourceOrigin.DISTRIBUTOR,
  ],
  FIELD_PRICE: [
    PriceSourceOrigin.FIELD_REPORT,
    PriceSourceOrigin.COMMUNITY_REPORT,
  ],
};

export function sourceOriginsForFamily(
  family: SourceFamily,
): PriceSourceOrigin[] {
  return SOURCE_FAMILY_ORIGIN_MAP[family];
}

/**
 * The same grouping, read the other way: which family does THIS origin belong
 * to? Needed by source-policy routing, which starts from a batch's stated
 * origin rather than from a filter's chosen family.
 *
 * INVERTED FROM THE MAP ABOVE AT MODULE LOAD, never restated. A second literal
 * table is how "SUPPLIER is STORE_SUPPLIER here and FIELD_PRICE over there"
 * becomes representable, and this file exists precisely so that one grouping
 * has one meaning.
 *
 * Returns null for an origin the map does not place — impossible today, since
 * `SOURCE_FAMILY_ORIGIN_MAP` covers every `PriceSourceOrigin`, but a new enum
 * value must read as "not yet classified" rather than be silently folded into
 * whichever family happens to be first.
 */
const FAMILY_BY_ORIGIN: ReadonlyMap<PriceSourceOrigin, SourceFamily> = new Map(
  (
    Object.entries(SOURCE_FAMILY_ORIGIN_MAP) as [
      SourceFamily,
      PriceSourceOrigin[],
    ][]
  ).flatMap(([family, origins]) =>
    origins.map((origin) => [origin, family] as const),
  ),
);

export function sourceFamilyOfOrigin(
  origin: PriceSourceOrigin,
): SourceFamily | null {
  return FAMILY_BY_ORIGIN.get(origin) ?? null;
}
