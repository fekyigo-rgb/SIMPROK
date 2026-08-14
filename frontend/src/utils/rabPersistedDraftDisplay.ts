import {
  SERVER_KERNEL_PERSISTED_BADGE,
  groupThousands,
  parseCanonicalDecimalString,
} from './rabCostDisplay.ts';
import {
  resolveAhspIdentity,
  type AhspIdentityView,
  type AhspIdentityWire,
  type PriceSourceAuthorityWire,
} from './rabTraceDisplay.ts';
import { assignStructuralNumbers } from './rabRowNumbering.ts';

/**
 * Canonical persisted-draft read path (Gate 2A). Every value here is
 * rendered directly from what the server persisted — this module never
 * multiplies, sums, rounds, or otherwise recomputes a canonical money field.
 * Formatting reuses the one shared decimal parse/grouping rule from
 * rabCostDisplay.ts rather than a second regex/grouping implementation.
 *
 * GATE2A-AB-RUNTIME-WIRE-TYPE-01: formatExactMoney/formatExactPercent/
 * formatExactQuantity below keep their typed signature (`string | null`) —
 * that is the TypeScript contract, not the runtime defense. The actual
 * runtime guard against a JSON payload that violates that contract (e.g. a
 * JSON number where an exact decimal string was promised) lives once, in
 * parseCanonicalDecimalString (rabCostDisplay.ts), which every formatter
 * here calls before ever touching the value. Fixing it there fixes it for
 * all three formatters — no second `typeof` check is duplicated here.
 */

export const NULL_DISPLAY = '—';
export const INVALID_DECIMAL_DISPLAY = 'Nilai tidak valid';

/**
 * Canonical money is always exactly two fraction digits. A shorter fraction
 * is zero-padded (lossless); a longer one is a contract violation this
 * adapter refuses to silently round away, so it fails closed instead.
 */
export const formatExactMoney = (value: string | null): string => {
  if (value === null) return NULL_DISPLAY;
  const parsed = parseCanonicalDecimalString(value);
  if (!parsed || parsed.fracPart.length > 2) return INVALID_DECIMAL_DISPLAY;
  const fraction = parsed.fracPart.padEnd(2, '0');
  return `Rp ${parsed.negative ? '-' : ''}${groupThousands(parsed.intPart)},${fraction}`;
};

/** Same exact scale-2 rule as money, no "Rp" prefix — used for margin/tax/PPN percentages. */
export const formatExactPercent = (value: string | null): string => {
  if (value === null) return NULL_DISPLAY;
  const parsed = parseCanonicalDecimalString(value);
  if (!parsed || parsed.fracPart.length > 2) return INVALID_DECIMAL_DISPLAY;
  const fraction = parsed.fracPart.padEnd(2, '0');
  return `${parsed.negative ? '-' : ''}${groupThousands(parsed.intPart)},${fraction}`;
};

/**
 * Quantity has no canonical display scale — every digit the server sent
 * (Decimal(18,6)) is preserved exactly, only the integer part is grouped.
 */
export const formatExactQuantity = (value: string | null): string => {
  if (value === null) return NULL_DISPLAY;
  const parsed = parseCanonicalDecimalString(value);
  if (!parsed) return INVALID_DECIMAL_DISPLAY;
  const fraction = parsed.fracPart ? `,${parsed.fracPart}` : '';
  return `${parsed.negative ? '-' : ''}${groupThousands(parsed.intPart)}${fraction}`;
};

/**
 * VOLUME, which is a measured quantity and therefore always reads with at
 * least two decimals: `24` is shown as `24,00`, never as a bare `24` that
 * could be mistaken for a count.
 *
 * Deliberately a sibling of formatExactQuantity rather than a change to it:
 * that function also renders AHSP COEFFICIENTS, whose presentation must not be
 * touched — padding `1` to `1,00` there would restate the analysis. Extra
 * precision is preserved exactly as sent (Decimal(18,6)); only a shorter
 * fraction is zero-padded, which is lossless.
 */
export const formatExactVolume = (value: string | null): string => {
  if (value === null) return NULL_DISPLAY;
  const parsed = parseCanonicalDecimalString(value);
  if (!parsed) return INVALID_DECIMAL_DISPLAY;
  const fraction = parsed.fracPart.padEnd(2, '0');
  return `${parsed.negative ? '-' : ''}${groupThousands(parsed.intPart)},${fraction}`;
};

export type PersistedPriceOrigin = 'MANUAL_CLIENT' | 'SERVER_COST_KERNEL' | null;

const PRICE_ORIGIN_BADGE: Record<'MANUAL_CLIENT' | 'SERVER_COST_KERNEL', string> = {
  SERVER_COST_KERNEL: SERVER_KERNEL_PERSISTED_BADGE,
  MANUAL_CLIENT: 'Harga manual',
};

export const getPriceOriginBadge = (priceOrigin: PersistedPriceOrigin): string =>
  priceOrigin === null ? 'Belum dihitung' : PRICE_ORIGIN_BADGE[priceOrigin];

/** GET /projects/:projectId/boq/draft — persisted BoqItem row, minimal typed contract. */
export interface PersistedBoqItem {
  id: string;
  /** Structural position — already sent by GET /boq/draft, now read. */
  parentId?: string | null;
  sortOrder?: number;
  /** Canonical AHSP identity, null when the row references no analysis. */
  ahsp?: AhspIdentityWire | null;
  wbsCode: string;
  name: string;
  itemType: 'FOLDER' | 'WORK_ITEM' | 'NOTE';
  quantity: string;
  unit: string;
  unitPrice: string | null;
  lineTotal: string | null;
  priceOrigin: PersistedPriceOrigin;
  /** RAB-TRUTH-CLOSEOUT-01 — whose data formed the price, as the server states it. */
  sourceAuthority?: PriceSourceAuthorityWire | null;
  calculationOccurrenceId: string | null;
  calculationAsOfDate: string | null;
  calculatedAt: string | null;
  calculationPolicyVersion: string | null;
}

export interface PersistedDraftRecap {
  pricingStatus: 'COMPLETE' | 'INCOMPLETE';
  subtotal: string | null;
  marginPercent: string | null;
  marginAmount: string | null;
  taxPercent: string | null;
  ppnPercent: string | null;
  taxAmount: string | null;
  grandTotal: string | null;
}

export interface PersistedRowProvenance {
  calculationPolicyVersion: string;
  calculationAsOfDate: string;
  calculatedAt: string;
  calculationOccurrenceId: string;
}

export interface PersistedRowDisplay {
  id: string;
  /** Official structural position, from the one numbering authority. */
  number: string;
  depth: number;
  ahsp: AhspIdentityView;
  /** Raw identity, so an evidence surface can present it without re-deriving. */
  ahspWire: AhspIdentityWire | null;
  code: string;
  description: string;
  itemType: 'FOLDER' | 'WORK_ITEM' | 'NOTE';
  unit: string;
  quantityDisplay: string;
  unitPriceDisplay: string;
  lineTotalDisplay: string;
  originBadge: string;
  /** Raw origin, exposed alongside originBadge so a caller can style the badge without string-matching the label text. */
  priceOrigin: PersistedPriceOrigin;
  sourceAuthority: PriceSourceAuthorityWire | null;
  /** Non-null only for a SERVER_COST_KERNEL row — the only origin with provenance to show. */
  provenance: PersistedRowProvenance | null;
}

/**
 * ROW DISPLAY AUTHORITY: reads item.quantity / item.unitPrice / item.lineTotal
 * directly. No quantity * unitPrice, no recomputation of any kind — the
 * persisted lineTotal always wins.
 */
export const toPersistedRowDisplay = (
  item: PersistedBoqItem,
  structural: { number: string; depth: number } = { number: '', depth: 0 },
): PersistedRowDisplay => {
  const isWorkItem = item.itemType === 'WORK_ITEM';
  return {
    id: item.id,
    number: structural.number,
    depth: structural.depth,
    ahsp: resolveAhspIdentity(isWorkItem ? item.ahsp : null),
    ahspWire: isWorkItem ? item.ahsp ?? null : null,
    code: item.wbsCode,
    description: item.name,
    itemType: item.itemType,
    unit: item.unit,
    quantityDisplay: isWorkItem ? formatExactVolume(item.quantity) : '',
    unitPriceDisplay: isWorkItem ? formatExactMoney(item.unitPrice) : '',
    lineTotalDisplay: isWorkItem ? formatExactMoney(item.lineTotal) : '',
    originBadge: isWorkItem ? getPriceOriginBadge(item.priceOrigin) : '',
    priceOrigin: isWorkItem ? item.priceOrigin : null,
    sourceAuthority: isWorkItem ? (item.sourceAuthority ?? null) : null,
    provenance:
      isWorkItem && item.priceOrigin === 'SERVER_COST_KERNEL'
        ? {
            calculationPolicyVersion: item.calculationPolicyVersion ?? NULL_DISPLAY,
            calculationAsOfDate: item.calculationAsOfDate ?? NULL_DISPLAY,
            calculatedAt: item.calculatedAt ?? NULL_DISPLAY,
            calculationOccurrenceId: item.calculationOccurrenceId ?? NULL_DISPLAY,
          }
        : null,
  };
};

export const INCOMPLETE_RECAP_LABEL = 'Harga belum lengkap';

export interface RecapDisplay {
  incomplete: boolean;
  incompleteLabel: string | null;
  subtotalDisplay: string;
  marginPercentDisplay: string;
  marginAmountDisplay: string;
  taxPercentDisplay: string;
  taxAmountDisplay: string;
  grandTotalDisplay: string;
}

/**
 * RECAP DISPLAY AUTHORITY: COMPLETE renders recap.subtotal/marginAmount/
 * taxAmount/grandTotal exactly as the server sent them — never a frontend
 * formula. INCOMPLETE never shows a partial total as if it were authoritative
 * (null stays "—", not Rp0).
 *
 * GATE2A-AB-RUNTIME-WIRE-TYPE-01: the authoritative branch requires an exact
 * `pricingStatus === 'COMPLETE'` match — never merely "not INCOMPLETE". The
 * static type says pricingStatus is 'COMPLETE' | 'INCOMPLETE', but that is a
 * compile-time promise only; an unknown, missing, or malformed runtime value
 * must fail closed into the same honest incomplete display, not be silently
 * treated as authoritative.
 */
export const toRecapDisplay = (recap: PersistedDraftRecap | null): RecapDisplay => {
  const taxPercentValue = recap ? (recap.ppnPercent ?? recap.taxPercent) : null;
  if (!recap || recap.pricingStatus !== 'COMPLETE') {
    return {
      incomplete: true,
      incompleteLabel: INCOMPLETE_RECAP_LABEL,
      subtotalDisplay: NULL_DISPLAY,
      marginPercentDisplay: recap ? formatExactPercent(recap.marginPercent) : NULL_DISPLAY,
      marginAmountDisplay: NULL_DISPLAY,
      taxPercentDisplay: recap ? formatExactPercent(taxPercentValue) : NULL_DISPLAY,
      taxAmountDisplay: NULL_DISPLAY,
      grandTotalDisplay: NULL_DISPLAY,
    };
  }
  return {
    incomplete: false,
    incompleteLabel: null,
    subtotalDisplay: formatExactMoney(recap.subtotal),
    marginPercentDisplay: formatExactPercent(recap.marginPercent),
    marginAmountDisplay: formatExactMoney(recap.marginAmount),
    taxPercentDisplay: formatExactPercent(taxPercentValue),
    taxAmountDisplay: formatExactMoney(recap.taxAmount),
    grandTotalDisplay: formatExactMoney(recap.grandTotal),
  };
};

/**
 * RAB-TRACE-01 — the viewer's rows, numbered by the same authority Ruang
 * Kerja uses. The viewer used to fall back to the row's position in the
 * response array, so the two rooms disagreed about which row is number 1 as
 * soon as a folder or a note existed.
 */
export const toPersistedRowDisplayList = (
  items: readonly PersistedBoqItem[],
): PersistedRowDisplay[] => {
  const numbered = assignStructuralNumbers(
    items.map((item, index) => ({
      id: item.id,
      parentId: item.parentId ?? null,
      sortOrder: item.sortOrder ?? index,
      isNote: item.itemType === 'NOTE',
      item,
    })),
  );

  return numbered.map((row) =>
    toPersistedRowDisplay(row.item, { number: row.number, depth: row.depth }),
  );
};
