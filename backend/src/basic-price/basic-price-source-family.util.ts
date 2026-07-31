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
