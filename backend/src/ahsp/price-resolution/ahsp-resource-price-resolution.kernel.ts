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
 * RM-03D1 — the resource CLASS no longer decides whether a unit may resolve.
 * LABOR, MATERIAL and EQUIPMENT are treated identically at the level of
 * resolution law; what differs is only the evidence each one happens to carry.
 * The kernel does not know any unit names: it consumes a verdict the
 * UnitKernel already produced (see UnitKernelService, the single unit
 * authority) and never re-derives, widens or second-guesses it.
 *
 * Bounded scope — still true after RM-03D1:
 * - Does NOT persist an occurrence, create a snapshot, calculate resource cost,
 *   calculate AHSP unit price, or update RAB.
 * - Does NOT contain a unit engine, a unit dictionary, or any unit alias.
 * - Applies ONLY the price adaptation the UnitKernel itself proved for the
 *   direction actually needed. It never inverts a factor, never multiplies by
 *   one it was not given, and never invents a rounding policy for a quotient.
 */

// ============================================================
// INPUT TYPES
// ============================================================

export interface ResourceCatalogCandidate {
  readonly id: string;
  readonly code: string | null;
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
  readonly unitResolution: ValidatedBasicPriceUnitResolution;
}

export interface ValidatedBasicPriceUnitResolution {
  readonly status: 'RESOLVED' | 'NEEDS_REVIEW' | 'NOT_CONVERTIBLE';
  readonly canonicalUnitCode: string | null;
  readonly quantityFactor: string | null;
  readonly priceOperation:
    | 'IDENTITY'
    | 'DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR'
    | null;
  readonly rawSourceUnit: string;
  readonly rawTargetUnit: string;
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
  readonly validatedUnitResolution: {
    readonly status: 'RESOLVED' | 'NEEDS_REVIEW' | 'NOT_CONVERTIBLE';
    readonly canonicalUnitCode: string | null;
    readonly quantityFactor: string | null;
    readonly rawSourceUnit: string;
    readonly rawTargetUnit: string;
  };
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
  /**
   * Preserved verbatim, and still emitted for exactly the case it has always
   * described: a LABOR resource whose canonical unit is the labor day. It is
   * never reused for MATERIAL or EQUIPMENT — a material priced per kilogram
   * has nothing to do with labor-day equivalence, and saying so would be a
   * lie in the audit trail.
   */
  | 'LABOR_DAY_UNIT_EQUIVALENT'
  /**
   * RM-03D1, additive. The UnitKernel proved both sides denote the SAME
   * canonical unit, so the price needs no arithmetic at all. This is the
   * generic sibling of LABOR_DAY_UNIT_EQUIVALENT for every non-labor class.
   */
  | 'EXACT_UNIT_IDENTITY'
  /**
   * RM-03D1, additive. Units are commensurable and the UnitKernel said so,
   * but reaching the unit this resolution actually needs would require a
   * conversion this kernel was not handed for that direction. Inverting the
   * factor it DOES have would be inventing conversion law, so the resolution
   * stops and asks for a human instead of guessing.
   */
  | 'UNIT_CONVERSION_UNPROVED'
  | 'SINGLE_ELIGIBLE_BASIC_PRICE'
  | 'NO_CATALOG_CANDIDATE'
  | 'MULTIPLE_CATALOG_CANDIDATES'
  | 'RESOURCE_TYPE_MISMATCH'
  | 'UNIT_NOT_SUPPORTED'
  | 'NO_BASIC_PRICE_CANDIDATE'
  | 'BASIC_PRICE_UNIT_NOT_SUPPORTED'
  | 'ONLY_EXPIRED_BASIC_PRICE_CANDIDATES'
  | 'MULTIPLE_BASIC_PRICE_CANDIDATES';

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
  /**
   * The canonical unit code the UnitKernel actually proved — reported as
   * evidence, not asserted as a constant. Before RM-03D1 this was hardcoded
   * to 'PERSON_DAY', which made the field a restatement of the restriction
   * rather than a fact about this resource.
   */
  readonly canonicalUnit: string;
  /**
   * The quantity factor the UnitKernel proved. Always "1" today, because a
   * RESOLVED result is only ever produced for exact unit identity — but it is
   * echoed from the verdict rather than written as a literal, so it can never
   * claim a factor the evidence did not contain.
   */
  readonly conversionFactor: string;
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
 * There is deliberately NO unit list, unit alias, or unit dictionary in this
 * file — and adding one would be a defect, not a feature.
 *
 * Unit truth has exactly one authority: UnitKernelService. It owns alias
 * equivalence, canonical identity, ambiguity detection, unknown-alias
 * detection, evidence-bound directional rules, quantityFactor and
 * priceOperation. This kernel's whole job is to consume that verdict and
 * decide whether the resource may proceed — never to re-decide the unit.
 *
 * The one rule this kernel adds on top of the verdict is a NON-INVERSION
 * guard: it will only ever apply a price adaptation the UnitKernel proved for
 * the direction being asked for. Concretely, both certified legs are proven
 * against ResourceCatalog.baseUnit as the pivot, so the price can only be
 * carried to the AHSP unit without inventing law when the AHSP unit and the
 * catalog unit are the SAME canonical unit (quantityFactor "1"). Anything
 * else would mean multiplying by the inverse of a factor that was only proved
 * one way round — so it returns UNIT_CONVERSION_UNPROVED and stops.
 */
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
 * Scope limitations that remain after RM-03D1:
 * - Resource identity is still exact normalized name + type. Evidence-backed
 *   equivalence (a differently-spelled source name proven by an existing
 *   ResourceSourceIdentity or a reviewed import mapping) is NOT decided here
 *   and is deliberately out of this slice.
 * - Only a proven exact unit identity reaches RESOLVED. A commensurable pair
 *   needing a real conversion returns UNIT_CONVERSION_UNPROVED rather than
 *   inverting a one-way factor.
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
    validatedUnitResolution,
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
  //
  // RM-03D1: the resource CLASS is not consulted here at all. What decides is
  // the UnitKernel verdict, and only that. The raw pair is still re-bound to
  // this exact resolution so a verdict certified for some other unit pair can
  // never be replayed into this one.
  const ahspUnitCanonicalCode = validatedUnitResolution.canonicalUnitCode;
  const ahspUnitQuantityFactor = validatedUnitResolution.quantityFactor;

  if (
    validatedUnitResolution.status !== 'RESOLVED' ||
    validatedUnitResolution.rawSourceUnit !== ahspUnit ||
    validatedUnitResolution.rawTargetUnit !== resolvedCatalog.baseUnit ||
    ahspUnitCanonicalCode === null
  ) {
    return {
      ...baseContext,
      status: 'UNRESOLVED',
      reasonCodes: ['UNIT_NOT_SUPPORTED'],
      explanation:
        `Unit AHSP "${ahspUnit}" terhadap unit katalog "${resolvedCatalog.baseUnit}" ` +
        `belum dapat dibuktikan oleh Kamus Unit: alias tidak dikenal, ambigu, ` +
        `atau bukti untuk pasangan unit ini tidak berlaku bagi resolusi ini. ` +
        `Resolusi dihentikan tanpa menebak.`,
    };
  }

  // The UnitKernel understood both sides, but they are not the SAME canonical
  // unit — carrying the price across would need the inverse of a factor that
  // was only proved one way round. Inventing that inverse is exactly what this
  // kernel must never do, so it hands the decision to a human instead.
  if (ahspUnitQuantityFactor !== '1') {
    return {
      ...baseContext,
      status: 'NEEDS_REVIEW',
      reasonCodes: ['UNIT_CONVERSION_UNPROVED'],
      explanation:
        `Unit AHSP "${ahspUnit}" dan unit katalog "${resolvedCatalog.baseUnit}" ` +
        `terbukti sepadan, tetapi memerlukan konversi (faktor ` +
        `${ahspUnitQuantityFactor ?? 'tidak tersedia'}) yang belum ` +
        `dibuktikan untuk arah yang dibutuhkan resolusi ini. ` +
        `SIMPROK tidak membalik faktor konversi. Diperlukan tinjauan manusia.`,
    };
  }

  // From here on the AHSP unit and the catalog unit ARE the same canonical
  // unit, so "price per catalog unit" and "price per AHSP unit" are the same
  // quantity and the price leg below needs no inversion either.
  const unitReason: ReasonCode =
    resourceType.toUpperCase() === 'LABOR' &&
    ahspUnitCanonicalCode === 'PERSON_DAY'
      ? 'LABOR_DAY_UNIT_EQUIVALENT'
      : 'EXACT_UNIT_IDENTITY';

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
        unitReason,
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

  // 3b. Among resource-matching prices, keep only those whose own unit the
  //     UnitKernel proved against this same catalog unit. Class is irrelevant
  //     here too — a price in an alias of the catalog unit qualifies whether
  //     the resource is labor, material or equipment; a price in a genuinely
  //     different unit (e.g. Jam against Org/Hari) does not.
  const unitProvedPrices = resourceMatchingPrices.filter(
    (price) =>
      price.unitResolution.status === 'RESOLVED' &&
      price.unitResolution.rawSourceUnit === price.unit &&
      price.unitResolution.rawTargetUnit === resolvedCatalog.baseUnit &&
      price.unitResolution.canonicalUnitCode !== null,
  );

  // Of those, only an IDENTITY operation can be applied without inventing
  // arithmetic: the adapted price is the source price, unchanged, exact.
  const compatiblePrices = unitProvedPrices.filter(
    (price) =>
      price.unitResolution.quantityFactor === '1' &&
      price.unitResolution.priceOperation === 'IDENTITY',
  );

  if (compatiblePrices.length === 0) {
    // A price whose unit WAS proved but needs a real conversion is a different
    // fact from a price whose unit could not be proved at all, and the audit
    // trail must not blur the two.
    if (unitProvedPrices.length > 0) {
      return {
        ...baseContext,
        status: 'NEEDS_REVIEW',
        reasonCodes: [
          'EXACT_RESOURCE_NAME_MATCH',
          'RESOURCE_TYPE_MATCH',
          unitReason,
          'UNIT_CONVERSION_UNPROVED',
        ],
        explanation:
          `Identitas sumber daya "${rawResourceRef}" berhasil dipetakan ke katalog ` +
          `"${resolvedCatalog.name}" (${resolvedCatalog.id}), dan unit Basic Price ` +
          `terbukti sepadan, tetapi mengadaptasi harganya ke unit AHSP "${ahspUnit}" ` +
          `memerlukan konversi yang belum dibuktikan untuk arah tersebut. ` +
          `SIMPROK tidak mengarang faktor konversi. Diperlukan tinjauan manusia.`,
      };
    }
    return {
      ...baseContext,
      status: 'UNRESOLVED',
      reasonCodes: [
        'EXACT_RESOURCE_NAME_MATCH',
        'RESOURCE_TYPE_MATCH',
        unitReason,
        'BASIC_PRICE_UNIT_NOT_SUPPORTED',
      ],
      explanation:
        `Identitas sumber daya "${rawResourceRef}" berhasil dipetakan ke katalog ` +
        `"${resolvedCatalog.name}" (${resolvedCatalog.id}), ` +
        `tetapi tidak ada Basic Price yang unitnya terbukti sepadan dengan ` +
        `"${resolvedCatalog.baseUnit}" menurut Kamus Unit. ` +
        `Harga yang tersedia memiliki unit yang belum dapat dibuktikan dan ` +
        `tidak digunakan.`,
    };
  }

  const allCompatiblePricesAreExpired = compatiblePrices.every(
    (price) => price.freshnessStatus === 'EXPIRED',
  );

  if (allCompatiblePricesAreExpired) {
    return {
      ...baseContext,
      status: 'NEEDS_REVIEW',
      reasonCodes: [
        'EXACT_RESOURCE_NAME_MATCH',
        'RESOURCE_TYPE_MATCH',
        unitReason,
        'ONLY_EXPIRED_BASIC_PRICE_CANDIDATES',
      ],
      explanation:
        `Identitas sumber daya berhasil dipetakan dan unit terbukti sepadan, ` +
        `tetapi seluruh ${compatiblePrices.length} Basic Price yang kompatibel ` +
        `untuk katalog "${resolvedCatalog.name}" (${resolvedCatalog.id}) ` +
        `memiliki freshness EXPIRED. Pemilihan otomatis ditahan dan ` +
        `diperlukan tinjauan manual.`,
    };
  }

  // Freshness is evidence only. Cardinality is evaluated over every
  // resource/unit-compatible candidate, without filtering or ranking by
  // CURRENT / EXPIRING / EXPIRED / missing freshness evidence.
  if (compatiblePrices.length > 1) {
    return {
      ...baseContext,
      status: 'NEEDS_REVIEW',
      reasonCodes: [
        'EXACT_RESOURCE_NAME_MATCH',
        'RESOURCE_TYPE_MATCH',
        unitReason,
        'MULTIPLE_BASIC_PRICE_CANDIDATES',
      ],
      explanation:
        `Identitas sumber daya berhasil dipetakan dan unit terbukti sepadan, ` +
        `tetapi ditemukan ${compatiblePrices.length} Basic Price yang kompatibel ` +
        `untuk katalog "${resolvedCatalog.name}" (${resolvedCatalog.id}). ` +
        `Pemilihan otomatis multi-harga belum didukung di Phase 1. ` +
        `Diperlukan tinjauan manual.`,
    };
  }

  const selectedPrice = compatiblePrices[0];

  // ---- Step 4: RESOLVED — proven identity, price string returned exactly ----
  return {
    ...baseContext,
    status: 'RESOLVED',
    resolvedResourceCatalogId: resolvedCatalog.id,
    selectedBasicPriceId: selectedPrice.id,
    sourceOrigin: selectedPrice.sourceOrigin,
    sourcePriceValue: selectedPrice.value,
    sourceUnit: selectedPrice.unit,
    ahspUnit,
    // Echoed from the UnitKernel verdict, never asserted as a constant.
    canonicalUnit: ahspUnitCanonicalCode,
    conversionFactor: ahspUnitQuantityFactor,
    // IDENTITY → the adapted price IS the source price: the same string is
    // handed back, so no arithmetic and no rounding can touch the money here.
    adaptedPriceValue: selectedPrice.value,
    selectionStatus: 'AUTO_SELECTED',
    reasonCodes: [
      'EXACT_RESOURCE_NAME_MATCH',
      'RESOURCE_TYPE_MATCH',
      unitReason,
      'SINGLE_ELIGIBLE_BASIC_PRICE',
    ],
    explanation:
      `Sumber daya AHSP "${rawResourceRef}" (${resourceType}, unit: ${ahspUnit}) ` +
      `berhasil dipetakan ke ResourceCatalog "${resolvedCatalog.name}" ` +
      `(${resolvedCatalog.id}, baseUnit: ${resolvedCatalog.baseUnit}) ` +
      `melalui kecocokan nama tepat, dan Kamus Unit membuktikan kedua unit ` +
      `menunjuk identitas canonical yang sama (${ahspUnitCanonicalCode}, faktor: ` +
      `${ahspUnitQuantityFactor}). ` +
      `Basic Price dipilih otomatis: ${selectedPrice.value} per ${selectedPrice.unit} ` +
      `dari sumber ${selectedPrice.sourceOrigin} (ID: ${selectedPrice.id}). ` +
      `Harga yang diadaptasi ke unit AHSP: ${selectedPrice.value} per ${ahspUnit}. ` +
      `SIMPROK menghitung, manusia memutuskan.`,
  };
}
