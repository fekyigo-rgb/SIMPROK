/**
 * SIMPROK — AHSP Resource Price Resolution Kernel
 * BP-AHSP-PHASE-1: Deterministic Resource Price Resolution Proof
 *
 * Locked laws applied:
 * - AHSP adalah otoritas. Basic Price menyesuaikan.
 * - SIMPROK menghitung, manusia memutuskan.
 * - No warning merely because a price is high or low.
 * - Unsupported or ambiguous resolution must fail closed.
 * - Raw AHSP resource evidence must not be overwritten.
 *
 * Scope: Pure kernel — no I/O, no database, no side effects.
 * Receives already-tenant-visible and already-eligible candidates as input.
 * Does NOT define publication or tenant eligibility.
 *
 * Phase 1 bounded scope:
 * - Proves one deterministic chain: Pekerja / LABOR / OH → Pekerja / LABOR / Org/Hari → BasicPrice
 * - Does NOT persist an occurrence, create a snapshot, calculate resource cost,
 *   calculate AHSP unit price, or update RAB.
 * - Does NOT contain a universal unit engine.
 */

// ============================================================
// INPUT TYPES
// ============================================================

export interface ResourceCatalogCandidate {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: 'MATERIAL' | 'LABOR' | 'EQUIPMENT';
  readonly baseUnit: string;
}

export interface BasicPriceCandidate {
  readonly id: string;
  /** Must equal the ResourceCatalog.id of the resolved catalog entry. */
  readonly resourceId: string;
  /**
   * Decimal string. Must be returned exactly without conversion through
   * a JavaScript number to avoid floating-point loss.
   */
  readonly value: string;
  readonly sourceOrigin: string;
  readonly unit: string;
  /**
   * BP-AHSP-PHASE-2 Option C (bounded, additive): caller-supplied freshness
   * classification. The kernel consumes this value as given — it does not
   * compute freshness from a date and has no current-time dependency.
   * Missing freshnessStatus preserves Phase 1 behavior and is treated as
   * active/selectable for backward compatibility.
   */
  readonly freshnessStatus?: 'CURRENT' | 'EXPIRING' | 'EXPIRED';
}

export interface AhspResourceResolutionInput {
  readonly projectId: string;
  readonly ahspVersionId: string;
  readonly ahspResourceId: string;
  readonly rawResourceRef: string;
  readonly resourceType: string;
  readonly ahspUnit: string;
  readonly resourceCatalogCandidates: ReadonlyArray<ResourceCatalogCandidate>;
  readonly eligibleBasicPriceCandidates: ReadonlyArray<BasicPriceCandidate>;
}

// ============================================================
// OUTPUT TYPES
// ============================================================

export type ResolutionStatus =
  | 'RESOLVED'
  | 'UNRESOLVED'
  | 'NEEDS_REVIEW';

export type ReasonCode =
  | 'EXACT_RESOURCE_NAME_MATCH'
  | 'RESOURCE_TYPE_MATCH'
  | 'LABOR_DAY_UNIT_EQUIVALENT'
  | 'SINGLE_ELIGIBLE_BASIC_PRICE'
  | 'NO_CATALOG_CANDIDATE'
  | 'MULTIPLE_CATALOG_CANDIDATES'
  | 'RESOURCE_TYPE_MISMATCH'
  | 'UNIT_NOT_SUPPORTED'
  | 'NO_BASIC_PRICE_CANDIDATE'
  | 'BASIC_PRICE_UNIT_NOT_SUPPORTED'
  | 'MULTIPLE_BASIC_PRICE_CANDIDATES'
  | 'ONLY_EXPIRED_BASIC_PRICE_CANDIDATES';

export interface ResolvedResolution {
  readonly status: 'RESOLVED';
  readonly projectId: string;
  readonly ahspVersionId: string;
  readonly ahspResourceId: string;
  readonly rawResourceRef: string;
  readonly resolvedResourceCatalogId: string;
  readonly selectedBasicPriceId: string;
  readonly sourceOrigin: string;
  /** Exact decimal string — not converted through JavaScript number. */
  readonly sourcePriceValue: string;
  readonly sourceUnit: string;
  readonly ahspUnit: string;
  readonly canonicalUnit: 'PERSON_DAY';
  /** Exact string "1" for labor-day equivalence. */
  readonly conversionFactor: '1';
  /** Same exact decimal string as sourcePriceValue — factor 1 means no numeric change. */
  readonly adaptedPriceValue: string;
  readonly selectionStatus: 'AUTO_SELECTED';
  readonly reasonCodes: ReadonlyArray<ReasonCode>;
  /** Human-readable Indonesian explanation for product-facing trace. */
  readonly explanation: string;
}

export interface UnresolvedResolution {
  readonly status: 'UNRESOLVED';
  readonly projectId: string;
  readonly ahspVersionId: string;
  readonly ahspResourceId: string;
  readonly rawResourceRef: string;
  readonly reasonCodes: ReadonlyArray<ReasonCode>;
  readonly explanation: string;
}

export interface NeedsReviewResolution {
  readonly status: 'NEEDS_REVIEW';
  readonly projectId: string;
  readonly ahspVersionId: string;
  readonly ahspResourceId: string;
  readonly rawResourceRef: string;
  readonly reasonCodes: ReadonlyArray<ReasonCode>;
  readonly explanation: string;
}

export type AhspResourceResolutionResult =
  | ResolvedResolution
  | UnresolvedResolution
  | NeedsReviewResolution;

// ============================================================
// NORMALIZATION — PHASE 1 BOUNDED SCOPE
// ============================================================

/**
 * Normalize a resource name for exact matching.
 * Phase 1 scope: trim, lowercase, collapse repeated whitespace only.
 * No fuzzy matching. No semantic similarity. No aliases.
 */
function normalizeResourceName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Canonical labor-day unit set.
 *
 * NOTE: This equivalence list is DELIBERATELY BOUNDED to labor-day units only.
 * It is NOT a universal unit dictionary. Do not add material, equipment,
 * package, weight, volume, or time conversions here.
 * Future unit classes (Class B package conversion, Class C contextual) require
 * a separate authorized gate before addition.
 *
 * Supported canonical equivalence (case-insensitive, trimmed):
 *   OH == Org/Hari == Orang/Hari == PERSON_DAY
 */
const LABOR_DAY_UNIT_CANONICAL = 'PERSON_DAY';
const LABOR_DAY_UNIT_ALIASES: ReadonlySet<string> = new Set([
  'oh',
  'org/hari',
  'orang/hari',
  'person_day',
]);

function normalizeLaborUnit(raw: string): string {
  return raw.trim().toLowerCase();
}

function isLaborDayUnit(raw: string): boolean {
  return LABOR_DAY_UNIT_ALIASES.has(normalizeLaborUnit(raw));
}

// ============================================================
// KERNEL ENTRY POINT
// ============================================================

/**
 * Resolve one AHSP resource to a ResourceCatalog and a Basic Price.
 *
 * Pure function: no I/O, no current-time dependency, no random IDs,
 * no global mutable state.
 *
 * Does not throw for ordinary domain outcomes (unresolved/ambiguous).
 * Throws only for malformed programmer input (null/undefined context fields).
 *
 * Phase 1 scope limitations:
 * - Only LABOR resource type supported with labor-day unit equivalence.
 * - MATERIAL and EQUIPMENT may match catalog by name/type but unit equivalence
 *   for those classes is not yet supported (returns UNRESOLVED on unit check).
 * - Multi-price ranking is not implemented; multiple candidates → NEEDS_REVIEW.
 */
export function resolveAhspResourcePrice(
  input: AhspResourceResolutionInput,
): AhspResourceResolutionResult {
  const {
    projectId,
    ahspVersionId,
    ahspResourceId,
    rawResourceRef,
    resourceType,
    ahspUnit,
    resourceCatalogCandidates,
    eligibleBasicPriceCandidates,
  } = input;

  // Shared context for all result variants
  const baseContext = { projectId, ahspVersionId, ahspResourceId, rawResourceRef };

  // ---- Step 1: Resource catalog identity match ----
  const normalizedRef = normalizeResourceName(rawResourceRef);

  const exactCatalogMatches = resourceCatalogCandidates.filter((candidate) => {
    const nameMatch =
      normalizeResourceName(candidate.name) === normalizedRef;
    const typeMatch =
      candidate.type.toUpperCase() === resourceType.toUpperCase();
    return nameMatch && typeMatch;
  });

  if (exactCatalogMatches.length === 0) {
    // Distinguish type mismatch from name mismatch for reason code accuracy
    const nameOnlyMatches = resourceCatalogCandidates.filter(
      (c) => normalizeResourceName(c.name) === normalizedRef,
    );
    if (nameOnlyMatches.length > 0) {
      return {
        ...baseContext,
        status: 'UNRESOLVED',
        reasonCodes: ['RESOURCE_TYPE_MISMATCH'],
        explanation:
          `Nama sumber daya "${rawResourceRef}" ditemukan di katalog, ` +
          `tetapi tipe tidak cocok (AHSP: ${resourceType}). ` +
          `Tidak dapat melanjutkan resolusi.`,
      };
    }
    return {
      ...baseContext,
      status: 'UNRESOLVED',
      reasonCodes: ['NO_CATALOG_CANDIDATE'],
      explanation:
        `Tidak ditemukan entri ResourceCatalog yang cocok untuk ` +
        `"${rawResourceRef}" dengan tipe ${resourceType}.`,
    };
  }

  if (exactCatalogMatches.length > 1) {
    return {
      ...baseContext,
      status: 'NEEDS_REVIEW',
      reasonCodes: ['MULTIPLE_CATALOG_CANDIDATES'],
      explanation:
        `Ditemukan ${exactCatalogMatches.length} entri ResourceCatalog yang cocok ` +
        `untuk "${rawResourceRef}" dengan tipe ${resourceType}. ` +
        `Diperlukan tinjauan manual untuk memilih satu kandidat yang tepat.`,
    };
  }

  const resolvedCatalog = exactCatalogMatches[0];

  // ---- Step 2: Unit equivalence check ----
  const ahspUnitIsLaborDay = isLaborDayUnit(ahspUnit);
  const catalogUnitIsLaborDay = isLaborDayUnit(resolvedCatalog.baseUnit);

  if (!ahspUnitIsLaborDay || !catalogUnitIsLaborDay) {
    return {
      ...baseContext,
      status: 'UNRESOLVED',
      reasonCodes: ['UNIT_NOT_SUPPORTED'],
      explanation:
        `Unit AHSP "${ahspUnit}" atau unit katalog "${resolvedCatalog.baseUnit}" ` +
        `tidak termasuk dalam equivalensi labor-day yang didukung di Phase 1 ` +
        `(OH / Org/Hari / Orang/Hari). ` +
        `Konversi unit lain belum diizinkan pada tahap ini.`,
    };
  }

  // ---- Step 3: Basic Price candidate filtering ----
  // 3a. Filter by resourceId (catalog identity match).
  const resourceMatchingPrices = eligibleBasicPriceCandidates.filter(
    (price) => price.resourceId === resolvedCatalog.id,
  );

  if (resourceMatchingPrices.length === 0) {
    return {
      ...baseContext,
      status: 'UNRESOLVED',
      reasonCodes: [
        'EXACT_RESOURCE_NAME_MATCH',
        'RESOURCE_TYPE_MATCH',
        'LABOR_DAY_UNIT_EQUIVALENT',
        'NO_BASIC_PRICE_CANDIDATE',
      ],
      explanation:
        `Identitas sumber daya "${rawResourceRef}" berhasil dipetakan ke katalog ` +
        `"${resolvedCatalog.name}" (${resolvedCatalog.id}), ` +
        `dan unit AHSP "${ahspUnit}" setara dengan "${resolvedCatalog.baseUnit}". ` +
        `Namun tidak ada Basic Price yang tersedia untuk katalog ini. ` +
        `Resolusi tidak dapat diselesaikan.`,
    };
  }

  // 3b. Among resource-matching prices, retain only those whose unit is
  //     a supported labor-day equivalent. Other units (e.g. Jam) are not
  //     candidates for Phase 1 and must not resolve with factor 1.
  //     No hour-to-day or other conversion is added here.
  const compatiblePrices = resourceMatchingPrices.filter(
    (price) => isLaborDayUnit(price.unit),
  );

  if (compatiblePrices.length === 0) {
    return {
      ...baseContext,
      status: 'UNRESOLVED',
      reasonCodes: [
        'EXACT_RESOURCE_NAME_MATCH',
        'RESOURCE_TYPE_MATCH',
        'LABOR_DAY_UNIT_EQUIVALENT',
        'BASIC_PRICE_UNIT_NOT_SUPPORTED',
      ],
      explanation:
        `Identitas sumber daya "${rawResourceRef}" berhasil dipetakan ke katalog ` +
        `"${resolvedCatalog.name}" (${resolvedCatalog.id}), ` +
        `tetapi tidak ada Basic Price dengan unit labor-day yang didukung ` +
        `(OH / Org/Hari / Orang/Hari). ` +
        `Basic Price yang tersedia memiliki unit tidak kompatibel dan tidak dapat ` +
        `digunakan tanpa konversi yang belum diizinkan di Phase 1.`,
    };
  }

  // ---- Step 3c: Freshness classification (BP-AHSP-PHASE-2 Option C) ----
  // Bounded and additive. Only applied to candidates that already passed
  // resourceId and unit-compatibility filtering above. Missing
  // freshnessStatus is active/selectable (Phase 1 backward compatibility).
  // EXPIRED is inactive and is never automatically selected.
  const activeCompatiblePrices = compatiblePrices.filter(
    (price) => price.freshnessStatus !== 'EXPIRED',
  );

  if (activeCompatiblePrices.length === 0) {
    // compatiblePrices.length > 0 here (checked above), so every
    // unit-compatible candidate is EXPIRED.
    return {
      ...baseContext,
      status: 'NEEDS_REVIEW',
      reasonCodes: [
        'EXACT_RESOURCE_NAME_MATCH',
        'RESOURCE_TYPE_MATCH',
        'LABOR_DAY_UNIT_EQUIVALENT',
        'ONLY_EXPIRED_BASIC_PRICE_CANDIDATES',
      ],
      explanation:
        `Identitas sumber daya "${rawResourceRef}" berhasil dipetakan ke katalog ` +
        `"${resolvedCatalog.name}" (${resolvedCatalog.id}), dan ditemukan ` +
        `${compatiblePrices.length} Basic Price dengan unit labor-day yang kompatibel. ` +
        `Namun seluruh kandidat tersebut berstatus EXPIRED (kedaluwarsa). ` +
        `SIMPROK tidak memilih Basic Price yang kedaluwarsa secara otomatis. ` +
        `Diperlukan tinjauan manusia untuk memastikan kondisi harga terkini sebelum digunakan.`,
    };
  }

  if (activeCompatiblePrices.length > 1) {
    return {
      ...baseContext,
      status: 'NEEDS_REVIEW',
      reasonCodes: [
        'EXACT_RESOURCE_NAME_MATCH',
        'RESOURCE_TYPE_MATCH',
        'LABOR_DAY_UNIT_EQUIVALENT',
        'MULTIPLE_BASIC_PRICE_CANDIDATES',
      ],
      explanation:
        `Identitas sumber daya berhasil dipetakan dan unit labor-day cocok, ` +
        `tetapi ditemukan ${activeCompatiblePrices.length} Basic Price yang kompatibel ` +
        `untuk katalog "${resolvedCatalog.name}" (${resolvedCatalog.id}). ` +
        `Pemilihan otomatis multi-harga belum didukung di Phase 1. ` +
        `Diperlukan tinjauan manual.`,
    };
  }

  const selectedPrice = activeCompatiblePrices[0];

  // ---- Step 4: RESOLVED — factor 1, price string returned exactly ----
  return {
    ...baseContext,
    status: 'RESOLVED',
    resolvedResourceCatalogId: resolvedCatalog.id,
    selectedBasicPriceId: selectedPrice.id,
    sourceOrigin: selectedPrice.sourceOrigin,
    sourcePriceValue: selectedPrice.value,
    sourceUnit: selectedPrice.unit,
    ahspUnit,
    canonicalUnit: LABOR_DAY_UNIT_CANONICAL,
    conversionFactor: '1',
    // Factor 1 → adapted price equals source price exactly (same string, no arithmetic).
    adaptedPriceValue: selectedPrice.value,
    selectionStatus: 'AUTO_SELECTED',
    reasonCodes: [
      'EXACT_RESOURCE_NAME_MATCH',
      'RESOURCE_TYPE_MATCH',
      'LABOR_DAY_UNIT_EQUIVALENT',
      'SINGLE_ELIGIBLE_BASIC_PRICE',
    ],
    explanation:
      `Sumber daya AHSP "${rawResourceRef}" (${resourceType}, unit: ${ahspUnit}) ` +
      `berhasil dipetakan ke ResourceCatalog "${resolvedCatalog.name}" ` +
      `(${resolvedCatalog.id}, baseUnit: ${resolvedCatalog.baseUnit}) ` +
      `melalui kecocokan nama tepat dan equivalensi unit labor-day (OH = Org/Hari, faktor: 1). ` +
      `Basic Price dipilih otomatis: ${selectedPrice.value} per ${selectedPrice.unit} ` +
      `dari sumber ${selectedPrice.sourceOrigin} (ID: ${selectedPrice.id}). ` +
      `Harga yang diadaptasi ke unit AHSP: ${selectedPrice.value} per ${ahspUnit}. ` +
      `SIMPROK menghitung, manusia memutuskan.`,
  };
}
