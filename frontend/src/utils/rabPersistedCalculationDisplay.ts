import { groupThousands, parseCanonicalDecimalString } from './rabCostDisplay.ts';
import type { PriceSourceAuthorityWire } from './rabTraceDisplay.ts';
import {
  INVALID_DECIMAL_DISPLAY,
  NULL_DISPLAY,
  formatExactMoney,
  formatExactQuantity,
  formatExactVolume,
} from './rabPersistedDraftDisplay.ts';

/**
 * RM-03 — display adapter for the read-only re-proof of a persisted RAB line
 * (GET /projects/:projectId/boq/items/:boqItemId/persisted-calculation).
 *
 * This module never computes money. It formats what the server recomputed and
 * states plainly whether that recomputation agreed with what is stored. A
 * disagreement is shown as a disagreement — it is never hidden, softened, or
 * resolved in favour of either number, because deciding which one is right is
 * a human's job, not this adapter's.
 */

export const PERSISTED_CALCULATION_STATUS = {
  VERIFIED: 'VERIFIED',
  MISMATCH: 'MISMATCH',
  FAIL_CLOSED: 'FAIL_CLOSED',
} as const;

export interface PersistedCalculationResourceWire {
  resolutionId: string;
  ahspResourceId: string;
  rawAhspResourceRef: string;
  rawAhspResourceType: string;
  resourceCatalogId: string | null;
  resourceCatalogName: string | null;
  coefficient: string;
  ahspUnit: string;
  selectedBasicPriceId: string | null;
  sourcePriceValue: string | null;
  sourceUnit: string | null;
  adaptedPriceValue: string | null;
  canonicalUnit: string | null;
  quantityFactor: string | null;
  selectedSourceOrigin: string | null;
  selectedFreshnessStatus: string | null;
  selectedEffectiveDate: string | null;
  status: string;
  resolutionMethod: string;
  reasonCodes: string[];
  explanation: string;
  policyVersion: string;
  resourceCost: string;
}

export interface PersistedCalculationWire {
  status: string;
  boqItemId: string;
  priceOrigin?: 'SERVER_COST_KERNEL';
  /** RAB-TRUTH-CLOSEOUT-01 — whose data formed this price, as the server states it. */
  sourceAuthority?: PriceSourceAuthorityWire | null;
  reason?: string;
  kernelReason?: string;
  stored?: {
    volume: string;
    unit: string;
    unitPrice: string;
    lineTotal: string;
  };
  recomputed?: { unitPrice: string; lineTotal: string };
  integrity?: {
    unitPriceMatches: boolean;
    lineTotalMatches: boolean;
    allResourceCostsReproduced: boolean;
  };
  provenance?: {
    calculationOccurrenceId: string;
    ahspVersionId: string;
    ahspOutputUnit: string;
    calculationAsOfDate: string;
    calculatedAt: string;
    calculationPolicyVersion: string;
    resolutionPolicyVersion: string | null;
    referenceRegionId: string | null;
    referenceRegionName: string | null;
    occurrenceGeneration: number;
  };
  resources?: PersistedCalculationResourceWire[];
}

/**
 * A resource cost is coefficient(scale 6) x adapted price(scale 2), so it can
 * legitimately carry up to eight fraction digits. It is shown at full
 * precision rather than pushed through the scale-2 money formatter: rounding
 * each component to two places and letting a human add them up would not
 * reproduce the line's unit price, and a breakdown that does not add up reads
 * as an error in the engine. Rounding happens once, at the line, on the
 * server — this column shows the exact contributions behind that one rounding.
 */
export const formatExactResourceCost = (value: string | null): string => {
  if (value === null) return NULL_DISPLAY;
  const parsed = parseCanonicalDecimalString(value);
  if (!parsed) return INVALID_DECIMAL_DISPLAY;
  const fraction = parsed.fracPart ? `,${parsed.fracPart}` : '';
  return `Rp ${parsed.negative ? '-' : ''}${groupThousands(parsed.intPart)}${fraction}`;
};

/**
 * Honest, human-readable reasons. Each says what is true about the row rather
 * than implying a fault: an unpriced or manually-priced line is a legitimate
 * state, not a failure.
 */
const REASON_LABEL: Record<string, string> = {
  BOQ_ITEM_NOT_FOUND: 'Baris tidak ditemukan pada proyek ini.',
  NOT_CALCULATED: 'Baris ini belum pernah dihitung SIMPROK.',
  MANUAL_PRICE_NOT_REPROVABLE:
    'Harga baris ini diisi manual — tidak ada perhitungan SIMPROK untuk ditelusuri.',
  CALCULATION_OCCURRENCE_MISSING:
    'Jejak perhitungan baris ini tidak dapat dijangkau. Laporkan ke administrator.',
  STORED_MONEY_MISSING:
    'Nilai tersimpan tidak lengkap. Laporkan ke administrator.',
  RECOMPUTATION_FAIL_CLOSED:
    'Perhitungan ulang tidak dapat diselesaikan atas dasar yang tersimpan.',
};

const KERNEL_REASON_LABEL: Record<string, string> = {
  UNRESOLVED_RESOURCE: 'Ada komponen yang belum punya Basic Price sah.',
  MISSING_ADAPTED_PRICE: 'Ada komponen tanpa harga yang tersesuaikan.',
  EMPTY_RESOURCES: 'Analisa harga ini tidak memiliki komponen.',
  BOQ_AHSP_UNIT_MISMATCH: 'Satuan pekerjaan dan satuan AHSP tidak sama.',
  OCCURRENCE_NOT_FOUND: 'Jejak perhitungan tidak ditemukan.',
  INVALID_COEFFICIENT: 'Ada koefisien yang tidak sah.',
  INVALID_VOLUME: 'Volume baris tidak sah.',
};

export const describeReason = (
  reason: string | undefined,
  kernelReason?: string,
): string => {
  const base = reason ? (REASON_LABEL[reason] ?? reason) : NULL_DISPLAY;
  const detail = kernelReason
    ? (KERNEL_REASON_LABEL[kernelReason] ?? kernelReason)
    : null;
  return detail ? `${base} ${detail}` : base;
};

export interface PersistedCalculationResourceDisplay {
  resolutionId: string;
  name: string;
  type: string;
  coefficientDisplay: string;
  ahspUnit: string;
  sourcePriceDisplay: string;
  adaptedPriceDisplay: string;
  resourceCostDisplay: string;
  basicPriceId: string | null;
  effectiveDate: string;
  sourceOrigin: string;
  freshness: string;
  status: string;
  reasonCodes: string[];
}

export interface PersistedCalculationDisplay {
  kind: 'verified' | 'mismatch' | 'unavailable';
  /** Short authority label for the header badge. */
  badge: string;
  /** One honest sentence describing the verdict. */
  message: string;
  storedUnitPriceDisplay: string;
  storedLineTotalDisplay: string;
  recomputedUnitPriceDisplay: string;
  recomputedLineTotalDisplay: string;
  volumeDisplay: string;
  unit: string;
  /** Whose data formed the price — decides Auto SIMPROK vs Data Pengguna. */
  sourceAuthority: PriceSourceAuthorityWire | null;
  /** True only when the server proved recomputed === stored on every field. */
  reproduced: boolean;
  provenance: {
    asOfDate: string;
    calculatedAt: string;
    policyVersion: string;
    resolutionPolicyVersion: string;
    occurrenceId: string;
    ahspVersionId: string;
    ahspOutputUnit: string;
    regionName: string;
    generation: string;
  } | null;
  resources: PersistedCalculationResourceDisplay[];
}

const UNAVAILABLE = (message: string): PersistedCalculationDisplay => ({
  kind: 'unavailable',
  badge: 'Belum dapat ditelusuri',
  message,
  storedUnitPriceDisplay: NULL_DISPLAY,
  storedLineTotalDisplay: NULL_DISPLAY,
  recomputedUnitPriceDisplay: NULL_DISPLAY,
  recomputedLineTotalDisplay: NULL_DISPLAY,
  volumeDisplay: NULL_DISPLAY,
  unit: '',
  sourceAuthority: null,
  reproduced: false,
  provenance: null,
  resources: [],
});

/**
 * Fails closed on anything that is not an explicit, complete success payload.
 * The wire types promise `stored`/`recomputed`/`provenance` are present
 * whenever status is VERIFIED or MISMATCH, but that is a compile-time promise:
 * a malformed runtime payload must land in the honest "cannot be traced yet"
 * state rather than render half a proof as though it were whole.
 */
export const toPersistedCalculationDisplay = (
  wire: PersistedCalculationWire | null,
): PersistedCalculationDisplay => {
  if (!wire) return UNAVAILABLE('Penelusuran belum dimuat.');

  if (wire.status === PERSISTED_CALCULATION_STATUS.FAIL_CLOSED) {
    return UNAVAILABLE(describeReason(wire.reason, wire.kernelReason));
  }

  const isVerified = wire.status === PERSISTED_CALCULATION_STATUS.VERIFIED;
  const isMismatch = wire.status === PERSISTED_CALCULATION_STATUS.MISMATCH;
  if (!isVerified && !isMismatch) {
    return UNAVAILABLE('Penelusuran belum tersedia untuk baris ini.');
  }
  if (!wire.stored || !wire.recomputed || !wire.provenance) {
    return UNAVAILABLE('Penelusuran belum tersedia untuk baris ini.');
  }

  const resources = (wire.resources ?? []).map((resource) => ({
    resolutionId: resource.resolutionId,
    name: resource.resourceCatalogName ?? resource.rawAhspResourceRef,
    type: resource.rawAhspResourceType,
    coefficientDisplay: formatExactQuantity(resource.coefficient),
    ahspUnit: resource.ahspUnit,
    sourcePriceDisplay: formatExactMoney(resource.sourcePriceValue),
    adaptedPriceDisplay: formatExactMoney(resource.adaptedPriceValue),
    resourceCostDisplay: formatExactResourceCost(resource.resourceCost),
    basicPriceId: resource.selectedBasicPriceId,
    effectiveDate: resource.selectedEffectiveDate ?? NULL_DISPLAY,
    sourceOrigin: resource.selectedSourceOrigin ?? NULL_DISPLAY,
    freshness: resource.selectedFreshnessStatus ?? NULL_DISPLAY,
    status: resource.status,
    reasonCodes: resource.reasonCodes,
  }));

  return {
    kind: isVerified ? 'verified' : 'mismatch',
    badge: isVerified ? 'Terbukti ulang' : 'Nilai tidak cocok',
    message: isVerified
      ? 'Dihitung ulang dari sumbernya: hasilnya sama persis dengan nilai yang tersimpan.'
      : 'Hasil hitung ulang berbeda dari nilai yang tersimpan. Nilai tersimpan tidak diubah — perlu diperiksa manusia.',
    storedUnitPriceDisplay: formatExactMoney(wire.stored.unitPrice),
    storedLineTotalDisplay: formatExactMoney(wire.stored.lineTotal),
    recomputedUnitPriceDisplay: formatExactMoney(wire.recomputed.unitPrice),
    recomputedLineTotalDisplay: formatExactMoney(wire.recomputed.lineTotal),
    volumeDisplay: formatExactVolume(wire.stored.volume),
    unit: wire.stored.unit,
    sourceAuthority: wire.sourceAuthority ?? null,
    reproduced: isVerified,
    provenance: {
      asOfDate: wire.provenance.calculationAsOfDate,
      calculatedAt: wire.provenance.calculatedAt,
      policyVersion: wire.provenance.calculationPolicyVersion,
      resolutionPolicyVersion:
        wire.provenance.resolutionPolicyVersion ?? NULL_DISPLAY,
      occurrenceId: wire.provenance.calculationOccurrenceId,
      ahspVersionId: wire.provenance.ahspVersionId,
      ahspOutputUnit: wire.provenance.ahspOutputUnit,
      regionName: wire.provenance.referenceRegionName ?? NULL_DISPLAY,
      generation: String(wire.provenance.occurrenceGeneration),
    },
    resources,
  };
};
