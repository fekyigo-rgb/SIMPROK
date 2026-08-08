/**
 * SIMPROK — Resource Identity Resolution Kernel (RM-03D1)
 *
 * Owner Product Law (Issue #71, LOCKED):
 *   Automation by default. Exception by evidence. Approval at RAB level.
 *   Traceability always. False certainty never.
 *
 * THE LAW THIS FILE EXISTS TO ENFORCE:
 *
 *   RESOURCE NAME != RESOURCE IDENTITY.
 *
 * A different name does not prove a different resource, and a similar name
 * does not prove the same one. Before this kernel, resolution matched on
 * exact normalized name alone, so the Owner's real AHSP line "Portland
 * Cement" came back RESOURCE_NOT_FOUND even though the catalog holds "Semen
 * Portlan" and the source workbook gives both the code M.23. Answering "not
 * found" when the system can in fact see two plausible candidates is a false
 * statement, and it is the one this kernel removes.
 *
 * The correction is deliberately asymmetric:
 *   HIGH RECALL when FINDING candidates — code, provenance, tokens, reviewed
 *   decisions, prefix overlap. Look everywhere.
 *   HIGH PRECISION when ASSERTING identity — only an exact canonical match or
 *   a human's own reviewed decision may auto-resolve. Everything else becomes
 *   a named candidate a human closes once.
 *
 * So a false positive is very hard to produce (nothing but exactness or a
 * recorded human decision can assert), while a false negative caused merely by
 * spelling is impossible (discovery keeps looking after exact match fails).
 *
 * Scope: PURE — no I/O, no database, no clock, no randomness. Every piece of
 * evidence is handed in already tenant-scoped by the caller. This kernel
 * decides; it does not fetch, and it never writes.
 *
 * NOT in this kernel, by design: unit law (UnitKernelService owns that
 * outright), Basic Price eligibility, price arithmetic, AHSP applicability.
 */

// ============================================================
// INPUT TYPES
// ============================================================

/** What the AHSP line actually says, kept verbatim from the source. */
export interface RawResourceReference {
  readonly rawName: string;
  /** Source code as written (e.g. "M.60.a"), when the source carries one. */
  readonly rawCode: string | null;
  readonly rawUnit: string | null;
  readonly resourceType: string;
}

export interface IdentityCatalogCandidate {
  readonly id: string;
  readonly code: string | null;
  readonly name: string;
  readonly type: string;
  readonly baseUnit: string;
  readonly status?: string;
  /**
   * ResourceCatalog.specifications — opaque JSON. The repository defines no
   * identity contract for its keys today (the only key any shipped code ever
   * writes is a test-only marker), so this kernel reads VALUES and never key
   * names, and never asserts that a key means anything. See
   * `specificationDesignationTokens` for exactly how little is inferred.
   */
  readonly specifications?: unknown;
}

/**
 * A ResourceSourceIdentity sighting: "this raw text was seen at this row of
 * this workbook and a provisioning step bound it to this catalog row".
 *
 * Provenance ONLY. The model's own contract says a sighting is never a
 * canonical identity by itself, so this kernel treats it strictly as material
 * for discovery — it can nominate a candidate, it can never assert one.
 */
export interface SourceSightingEvidence {
  readonly resourceCatalogId: string;
  readonly rawName: string;
  readonly rawCode: string | null;
  readonly rawUnit: string | null;
  readonly sourceSection: string;
  readonly sourceSha256: string;
  readonly sheetName: string;
  readonly sourceRowNumber: number;
}

/**
 * A BasicPriceImportRowResourceMapping: a human, in this workspace, already
 * looked at ONE Basic Price import row and chose a canonical resource for it.
 *
 * SCOPE MATTERS AND IS NOT NEGOTIABLE, AND IT IS NARROWER THAN IT LOOKS.
 *
 * The model binds the decision to a `rowId` — one row, of one batch, of one
 * workbook. What the human actually settled was "THIS import row means that
 * catalog entry". They were never asked, and never answered, "every future
 * AHSP line that happens to be spelled the same means it too".
 *
 * Treating a same-name match as authority would silently widen a row-scoped
 * decision into a workspace-wide alias table, which is exactly the global
 * alias this project forbids. Two independent sources can spell two different
 * things identically; "Pasir" in a supplier's price list and "Pasir" in an
 * AHSP are not guaranteed to be the same material, and no record here says
 * they are.
 *
 * So a reviewed mapping is STRONG CANDIDATE EVIDENCE and never an assertion.
 * It keeps SIMPROK's memory — the human's work still surfaces the right row
 * instead of being forgotten — while leaving the one question they were never
 * asked to them.
 */
export interface ReviewedMappingEvidence {
  readonly resourceCatalogId: string;
  readonly rawName: string;
  readonly rawCode: string | null;
  readonly resourceType: string;
  readonly reviewerAccountId: string;
  readonly decidedAt: string;
  readonly reason: string | null;
}

export interface ResourceIdentityResolutionInput {
  readonly reference: RawResourceReference;
  /** Already tenant-scoped by the caller. */
  readonly catalogCandidates: ReadonlyArray<IdentityCatalogCandidate>;
  readonly sourceSightings: ReadonlyArray<SourceSightingEvidence>;
  readonly reviewedMappings: ReadonlyArray<ReviewedMappingEvidence>;
}

// ============================================================
// OUTPUT TYPES
// ============================================================

export type ResourceIdentityStatus = 'RESOLVED' | 'NEEDS_REVIEW' | 'UNRESOLVED';

/**
 * Which authority actually settled the identity. Only the first two may ever
 * accompany RESOLVED — that is the whole precision guarantee.
 */
export type ResourceIdentityAuthority =
  | 'EXACT_CANONICAL_MATCH'
  /**
   * Reserved, and deliberately NOT reachable from any production path today.
   *
   * It describes reusing a human decision that is genuinely bound to the same
   * AHSP fact being resolved. No model in this repository records such a
   * decision yet — the only reviewed mapping that exists is scoped to a Basic
   * Price import row — so emitting it would be claiming an authority nobody
   * ever granted. The name stays in the contract so the concept has somewhere
   * to land when a properly-scoped record exists; until then, nothing produces
   * it, and a test proves that.
   */
  | 'VERIFIED_MAPPING_REUSED'
  | 'EVIDENCE_CANDIDATE'
  | 'HUMAN_REVIEW_REQUIRED';

export type ResourceIdentityReasonCode =
  | 'EXACT_CANONICAL_MATCH'
  | 'VERIFIED_MAPPING_REUSED'
  | 'STRONG_CANDIDATE_NEEDS_REVIEW'
  | 'MULTIPLE_CANDIDATES_NEEDS_REVIEW'
  | 'REVIEWED_MAPPING_CONFLICT'
  | 'RESOURCE_TYPE_MISMATCH'
  | 'SPECIFICATION_UNPROVED'
  | 'SPECIFICATION_CONFLICT'
  | 'RESOURCE_NOT_FOUND';

/** Why a particular catalog row was nominated. Shown to humans verbatim. */
export type CandidateEvidenceKind =
  | 'SOURCE_CODE_MATCH'
  | 'SOURCE_SIGHTING_NAME_MATCH'
  | 'REVIEWED_MAPPING_CODE_MATCH'
  | 'REVIEWED_MAPPING_NAME_MATCH'
  | 'NAME_TOKEN_CONTAINMENT'
  | 'NAME_TOKEN_STEM_SHARED';

/**
 * A human's earlier decision, carried so the reviewer closing this exception
 * can see it was already settled once — for a different fact — and by whom.
 */
export interface PriorHumanDecision {
  readonly reviewerAccountId: string;
  readonly decidedAt: string;
  readonly reason: string | null;
}

export interface ResourceIdentityCandidate {
  readonly resourceCatalogId: string;
  readonly name: string;
  readonly code: string | null;
  readonly type: string;
  readonly baseUnit: string;
  readonly evidence: ReadonlyArray<CandidateEvidenceKind>;
  /** True when the catalog row states a designation the raw reference does not. */
  readonly specificationUnproved: boolean;
  /**
   * Surfaced, never interpreted. The reviewer sees exactly what the catalog
   * row claims about itself; this kernel reads only its values, never its keys.
   */
  readonly specifications: unknown;
  readonly priorHumanDecision: PriorHumanDecision | null;
}

export interface ResourceIdentityResolution {
  readonly status: ResourceIdentityStatus;
  readonly authority: ResourceIdentityAuthority | null;
  readonly resolvedResourceCatalogId: string | null;
  readonly candidates: ReadonlyArray<ResourceIdentityCandidate>;
  readonly reasonCodes: ReadonlyArray<ResourceIdentityReasonCode>;
  readonly explanation: string;
}

// ============================================================
// DETERMINISTIC NORMALIZATION — no dictionary, no thresholds
// ============================================================

/**
 * Behaviourally identical to the normalizers already used by the Basic Price
 * import candidate lookup and the AHSP price resolver: trim, collapse runs of
 * whitespace, lowercase. Kept local rather than imported across a domain
 * boundary; consolidating all three is a separate, safe cleanup.
 */
export function normalizeResourceName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Source codes vary only by case and padding in practice (e.g. "M.60.a "). */
function normalizeResourceCode(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

function tokenize(name: string): string[] {
  return normalizeResourceName(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/**
 * A designation token is one that carries a number: a diameter, a grade, a
 * class, a dimension, a capacity. "420b", "13", "pc200", "5", "m6" all qualify;
 * "baja", "tulangan", "semen" do not.
 *
 * This is the whole of the specification test, and it is deliberately this
 * small. SIMPROK must not invent a specification requirement the source never
 * stated (§10), so a designation is only ever read where one is literally
 * written down.
 */
function designationTokens(name: string): Set<string> {
  return new Set(tokenize(name).filter((token) => /\p{N}/u.test(token)));
}

function isDisjoint(a: Set<string>, b: Set<string>): boolean {
  for (const value of a) if (b.has(value)) return false;
  return true;
}

/**
 * Designations a catalog row states in its structured `specifications` JSON.
 *
 * ResourceCatalog.specifications is opaque: the schema gives it no shape and
 * the repository defines no identity contract for its keys. So this reads
 * VALUES ONLY and never key names — it never decides that a key called
 * "diameter" means a diameter, because nothing in the repository says so.
 *
 * The same digit-bearing test used on names applies here, which is what keeps
 * non-identity metadata harmless: `{rm02bTestOnly: true}` is a boolean and
 * contributes nothing, `{keepMe: 'unrelated-value'}` carries no digits and
 * contributes nothing, while `{grade: 'BjTS 420B', diameter: 13}` contributes
 * exactly the designations a human would read off it.
 *
 * Ignoring this field entirely — as this kernel did before — meant a catalog
 * row could state a grade and a diameter and still be auto-resolved against a
 * source that stated neither. That is a false certainty, so the field is now
 * read. It is still never invented: no values, no designations, no effect.
 */
function specificationDesignationTokens(specifications: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (value: unknown, depth: number): void => {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number') {
      for (const token of tokenize(String(value))) {
        if (/\p{N}/u.test(token)) found.add(token);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const entry of Object.values(value as Record<string, unknown>)) {
        walk(entry, depth + 1);
      }
    }
    // Booleans and anything else state no designation and are ignored.
  };
  walk(specifications, 0);
  return found;
}

/** Everything the catalog row states about itself, name and structured spec alike. */
function candidateDesignations(candidate: IdentityCatalogCandidate): Set<string> {
  const combined = designationTokens(candidate.name);
  for (const token of specificationDesignationTokens(candidate.specifications)) {
    combined.add(token);
  }
  return combined;
}

/**
 * A real specification contradiction: BOTH sides state a designation and they
 * share none. "Besi angker diameter 8" against "Besi angker diameter 10" is a
 * contradiction. "Baja tulangan" against "BjTS 420B Ø13" is NOT — one side
 * simply says nothing, which is unproven, not contradicted.
 */
function contradictsSpecification(
  rawName: string,
  candidate: IdentityCatalogCandidate,
): boolean {
  const rawDesignations = designationTokens(rawName);
  const stated = candidateDesignations(candidate);
  if (rawDesignations.size === 0 || stated.size === 0) return false;
  return isDisjoint(rawDesignations, stated);
}

/**
 * The candidate states a designation the raw reference never made — a grade, a
 * diameter, a class the source is simply silent about.
 *
 * That is UNPROVEN, not contradicted, and the difference matters: unknown must
 * never be treated as wrong. It blocks the automatic assertion and asks a
 * human, rather than either inventing agreement or declaring a conflict.
 */
function specificationUnproved(
  rawName: string,
  candidate: IdentityCatalogCandidate,
): boolean {
  return (
    designationTokens(rawName).size === 0 &&
    candidateDesignations(candidate).size > 0
  );
}

/** Every token of the shorter name appears in the longer one. */
function tokensContained(a: string, b: string): boolean {
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.length === 0 || right.length === 0) return false;
  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  const longerSet = new Set(longer);
  if (!shorter.every((token) => longerSet.has(token))) return false;
  // At least one shared token must be substantial, so that two names sharing
  // only a stop-word-length fragment are not nominated.
  return shorter.some((token) => token.length >= 4);
}

/**
 * Two names share a substantial stem: either the identical token, or one token
 * that is a prefix of the other. This is what connects "Portland Cement" to
 * BOTH "Semen Portland / Tonasa" (identical stem) and "Semen Portlan" (a
 * truncated source spelling) — and finding both is the point, because the
 * Owner must see that two plausible cements exist rather than be handed one.
 *
 * Length 5 keeps short words from colliding; there is no similarity score
 * anywhere in this file and no threshold to tune.
 *
 * DISCOVERY ONLY. Like every signal below the reviewed-mapping line, this can
 * nominate a candidate and can never assert one, so a generous match here
 * costs a review row and never a wrong price.
 */
function tokensShareSubstantialStem(a: string, b: string): boolean {
  const left = tokenize(a);
  const right = tokenize(b);
  return left.some((l) =>
    right.some(
      (r) =>
        Math.min(l.length, r.length) >= 5 &&
        (l === r || l.startsWith(r) || r.startsWith(l)),
    ),
  );
}

function typeMatches(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function isActive(candidate: IdentityCatalogCandidate): boolean {
  return candidate.status === undefined || candidate.status === 'ACTIVE';
}

// ============================================================
// KERNEL
// ============================================================

/**
 * Resolve one raw resource reference to a canonical ResourceCatalog identity.
 *
 * Authority hierarchy, first decisive level wins:
 *   1. Exact canonical match, one row, specification neither contradicted
 *      nor left unproven                                              → RESOLVED
 *   2. Evidence-nominated candidates — source code, provenance sightings,
 *      reviewed human decisions from other contexts, name tokens      → NEEDS_REVIEW
 *   3. Several plausible candidates                                   → NEEDS_REVIEW
 *   4. Type or specification contradiction                            → UNRESOLVED
 *   5. Nothing defensible, after all of the above                     → UNRESOLVED
 *
 * EXACT MATCH IS CURRENTLY THE ONLY ROAD TO RESOLVED, and that is deliberate.
 * The one kind of recorded human decision this repository has is bound to a
 * Basic Price import row, which is a different fact from an AHSP reference —
 * so it enriches the evidence and never carries the assertion.
 */
export function resolveResourceIdentity(
  input: ResourceIdentityResolutionInput,
): ResourceIdentityResolution {
  const { reference, catalogCandidates, sourceSightings, reviewedMappings } = input;
  const rawName = reference.rawName;
  const normalizedName = normalizeResourceName(rawName);
  const normalizedCode = normalizeResourceCode(reference.rawCode);
  const type = reference.resourceType;

  const usable = catalogCandidates.filter(isActive);
  const byId = new Map(usable.map((candidate) => [candidate.id, candidate]));

  /** The most recent decision a human made about this catalog row, if any. */
  const priorDecisionFor = (catalogId: string): PriorHumanDecision | null => {
    const matching = reviewedMappings.filter(
      (mapping) => mapping.resourceCatalogId === catalogId,
    );
    if (matching.length === 0) return null;
    const latest = matching.reduce((newest, mapping) =>
      mapping.decidedAt > newest.decidedAt ? mapping : newest,
    );
    return {
      reviewerAccountId: latest.reviewerAccountId,
      decidedAt: latest.decidedAt,
      reason: latest.reason,
    };
  };

  const describeCandidate = (
    candidate: IdentityCatalogCandidate,
    evidence: ReadonlyArray<CandidateEvidenceKind>,
  ): ResourceIdentityCandidate => ({
    resourceCatalogId: candidate.id,
    name: candidate.name,
    code: candidate.code,
    type: candidate.type,
    baseUnit: candidate.baseUnit,
    evidence,
    specificationUnproved: specificationUnproved(rawName, candidate),
    specifications: candidate.specifications ?? null,
    priorHumanDecision: priorDecisionFor(candidate.id),
  });

  // ---- LEVEL 1: exact canonical match ----
  const exactNameRows = usable.filter(
    (candidate) => normalizeResourceName(candidate.name) === normalizedName,
  );
  const exactRows = exactNameRows.filter((candidate) =>
    typeMatches(candidate.type, type),
  );

  if (exactRows.length === 1) {
    const only = exactRows[0];
    if (contradictsSpecification(rawName, only)) {
      return {
        status: 'UNRESOLVED',
        authority: null,
        resolvedResourceCatalogId: null,
        candidates: [describeCandidate(only, [])],
        reasonCodes: ['SPECIFICATION_CONFLICT'],
        explanation:
          `Nama "${rawName}" cocok persis dengan katalog "${only.name}", tetapi ` +
          `spesifikasi yang dinyatakan kedua belah pihak bertentangan. Identitas ` +
          `tidak ditetapkan.`,
      };
    }
    // The names agree, but the catalog row states a grade/diameter/class the
    // source never mentioned. An exact name is not licence to assume the
    // source meant that specification — unknown is not agreement.
    if (specificationUnproved(rawName, only)) {
      return {
        status: 'NEEDS_REVIEW',
        authority: 'EVIDENCE_CANDIDATE',
        resolvedResourceCatalogId: null,
        candidates: [describeCandidate(only, [])],
        reasonCodes: [
          'STRONG_CANDIDATE_NEEDS_REVIEW',
          'SPECIFICATION_UNPROVED',
        ],
        explanation:
          `Nama "${rawName}" cocok persis dengan katalog "${only.name}" ` +
          `(${only.id}), tetapi entri katalog menyatakan spesifikasi yang tidak ` +
          `disebut oleh sumber AHSP. SIMPROK tidak menganggap sumber pasti ` +
          `memaksudkan spesifikasi tersebut. Diperlukan penegasan manusia.`,
      };
    }
    return {
      status: 'RESOLVED',
      authority: 'EXACT_CANONICAL_MATCH',
      resolvedResourceCatalogId: only.id,
      candidates: [describeCandidate(only, [])],
      reasonCodes: ['EXACT_CANONICAL_MATCH'],
      explanation:
        `Nama sumber daya "${rawName}" (${type}) cocok persis dengan satu entri ` +
        `ResourceCatalog: "${only.name}" (${only.id}). Identitas ditetapkan tanpa ` +
        `memerlukan keputusan manusia.`,
    };
  }

  if (exactRows.length > 1) {
    return {
      status: 'NEEDS_REVIEW',
      authority: 'HUMAN_REVIEW_REQUIRED',
      resolvedResourceCatalogId: null,
      candidates: exactRows.map((candidate) => describeCandidate(candidate, [])),
      reasonCodes: ['MULTIPLE_CANDIDATES_NEEDS_REVIEW'],
      explanation:
        `Ditemukan ${exactRows.length} entri ResourceCatalog dengan nama persis ` +
        `"${rawName}" dan tipe ${type}. SIMPROK tidak memilih sendiri di antara ` +
        `kandidat yang sama kuat.`,
    };
  }

  // ---- LEVEL 2: evidence-driven candidate discovery ----
  //
  // Reviewed human decisions participate HERE, as evidence, and not above as
  // authority. See ReviewedMappingEvidence: the decision is bound to a Basic
  // Price import row, so it proves what that row meant and nothing about what
  // an AHSP line means. Same spelling is not the same fact.
  const evidenceById = new Map<string, Set<CandidateEvidenceKind>>();
  /**
   * Rows the evidence DID nominate but a stated specification ruled out.
   *
   * Kept separately so the refusal can be reported as what it is. Letting these
   * fall through to "no defensible candidate" would report a specification
   * mismatch as a name mismatch — two different facts, and the audit trail must
   * not blur them.
   */
  const specificationConflicted = new Set<string>();
  const note = (catalogId: string, kind: CandidateEvidenceKind) => {
    const candidate = byId.get(catalogId);
    if (!candidate || !typeMatches(candidate.type, type)) return;
    if (contradictsSpecification(rawName, candidate)) {
      specificationConflicted.add(catalogId);
      return;
    }
    const existing = evidenceById.get(catalogId) ?? new Set<CandidateEvidenceKind>();
    existing.add(kind);
    evidenceById.set(catalogId, existing);
  };

  // A human already chose this catalog row for a row spelled the same way.
  // Strong evidence, worth surfacing first — never a verdict.
  const sameNameMappings = reviewedMappings.filter(
    (mapping) =>
      normalizeResourceName(mapping.rawName) === normalizedName &&
      typeMatches(mapping.resourceType, type),
  );
  for (const mapping of sameNameMappings) {
    note(mapping.resourceCatalogId, 'REVIEWED_MAPPING_NAME_MATCH');
  }
  const conflictingPriorDecisions =
    new Set(sameNameMappings.map((mapping) => mapping.resourceCatalogId)).size > 1;

  if (normalizedCode !== null) {
    for (const sighting of sourceSightings) {
      if (
        normalizeResourceCode(sighting.rawCode) === normalizedCode &&
        typeMatches(sighting.sourceSection, type)
      ) {
        note(sighting.resourceCatalogId, 'SOURCE_CODE_MATCH');
      }
    }
    for (const mapping of reviewedMappings) {
      if (
        normalizeResourceCode(mapping.rawCode) === normalizedCode &&
        typeMatches(mapping.resourceType, type)
      ) {
        note(mapping.resourceCatalogId, 'REVIEWED_MAPPING_CODE_MATCH');
      }
    }
  }

  for (const sighting of sourceSightings) {
    if (
      normalizeResourceName(sighting.rawName) === normalizedName &&
      typeMatches(sighting.sourceSection, type)
    ) {
      note(sighting.resourceCatalogId, 'SOURCE_SIGHTING_NAME_MATCH');
    }
  }

  for (const candidate of usable) {
    if (!typeMatches(candidate.type, type)) continue;
    if (tokensContained(rawName, candidate.name)) {
      note(candidate.id, 'NAME_TOKEN_CONTAINMENT');
    }
    if (tokensShareSubstantialStem(rawName, candidate.name)) {
      note(candidate.id, 'NAME_TOKEN_STEM_SHARED');
    }
  }

  if (evidenceById.size > 0) {
    // Ordering is presentation only — strongest evidence first, then a stable
    // tie-break. Nothing here selects; the human still does.
    const candidates = [...evidenceById.entries()]
      .map(([id, kinds]) => ({ id, kinds }))
      .sort((a, b) => {
        const strength = (kinds: Set<CandidateEvidenceKind>) =>
          (kinds.has('SOURCE_CODE_MATCH') ? 8 : 0) +
          (kinds.has('REVIEWED_MAPPING_CODE_MATCH') ? 4 : 0) +
          (kinds.has('REVIEWED_MAPPING_NAME_MATCH') ? 3 : 0) +
          (kinds.has('SOURCE_SIGHTING_NAME_MATCH') ? 2 : 0) +
          (kinds.has('NAME_TOKEN_CONTAINMENT') ? 1 : 0);
        const delta = strength(b.kinds) - strength(a.kinds);
        if (delta !== 0) return delta;
        const nameDelta = byId
          .get(a.id)!
          .name.localeCompare(byId.get(b.id)!.name);
        return nameDelta !== 0 ? nameDelta : a.id.localeCompare(b.id);
      })
      .map(({ id, kinds }) => describeCandidate(byId.get(id)!, [...kinds]));

    const multiple = candidates.length > 1;
    const anyUnproved = candidates.some(
      (candidate) => candidate.specificationUnproved,
    );
    const reasonCodes: ResourceIdentityReasonCode[] = [
      multiple
        ? 'MULTIPLE_CANDIDATES_NEEDS_REVIEW'
        : 'STRONG_CANDIDATE_NEEDS_REVIEW',
    ];
    if (anyUnproved) reasonCodes.push('SPECIFICATION_UNPROVED');
    // Two humans (or one human twice) pointed the same spelling at different
    // catalog rows. That is itself worth saying out loud.
    if (conflictingPriorDecisions) reasonCodes.push('REVIEWED_MAPPING_CONFLICT');

    const priorDecisionCount = candidates.filter(
      (candidate) => candidate.priorHumanDecision !== null,
    ).length;

    return {
      status: 'NEEDS_REVIEW',
      authority: 'EVIDENCE_CANDIDATE',
      resolvedResourceCatalogId: null,
      candidates,
      reasonCodes,
      explanation:
        `Nama "${rawName}" tidak cocok persis dengan entri ResourceCatalog mana pun, ` +
        `tetapi SIMPROK menemukan ${candidates.length} kandidat dari bukti nyata ` +
        `(${[...new Set(candidates.flatMap((c) => c.evidence))].join(', ')}): ` +
        `${candidates.map((c) => `"${c.name}" (${c.resourceCatalogId})`).join(', ')}. ` +
        (priorDecisionCount > 0
          ? `${priorDecisionCount} di antaranya pernah dipilih manusia untuk baris ` +
            `impor Basic Price — bukti kuat, tetapi keputusan itu terikat pada baris ` +
            `tersebut, bukan pada baris AHSP ini. `
          : '') +
        `Kesetaraan belum terbukti, jadi identitas belum ditetapkan — ini bukan ` +
        `"tidak ditemukan", melainkan satu keputusan manusia yang masih terbuka.`,
    };
  }

  // ---- LEVEL 4a: rows were found, but a stated specification ruled them out ----
  if (specificationConflicted.size > 0) {
    return {
      status: 'UNRESOLVED',
      authority: null,
      resolvedResourceCatalogId: null,
      candidates: [...specificationConflicted].map((id) =>
        describeCandidate(byId.get(id)!, []),
      ),
      reasonCodes: ['SPECIFICATION_CONFLICT'],
      explanation:
        `SIMPROK menemukan ${specificationConflicted.size} entri ResourceCatalog ` +
        `yang namanya berdekatan dengan "${rawName}", tetapi spesifikasi yang ` +
        `dinyatakan masing-masing bertentangan dengan yang dinyatakan sumber. ` +
        `Ini bukan "tidak ditemukan" — ini ketidakcocokan spesifikasi.`,
    };
  }

  // ---- LEVEL 4b: name matched but the class is wrong ----
  if (exactNameRows.length > 0) {
    return {
      status: 'UNRESOLVED',
      authority: null,
      resolvedResourceCatalogId: null,
      candidates: exactNameRows.map((candidate) => describeCandidate(candidate, [])),
      reasonCodes: ['RESOURCE_TYPE_MISMATCH'],
      explanation:
        `Nama "${rawName}" ditemukan di katalog, tetapi tipenya ` +
        `(${exactNameRows.map((row) => row.type).join(', ')}) tidak cocok dengan ` +
        `tipe yang diminta AHSP (${type}).`,
    };
  }

  // ---- LEVEL 5: genuinely nothing, and only now may we say so ----
  return {
    status: 'UNRESOLVED',
    authority: null,
    resolvedResourceCatalogId: null,
    candidates: [],
    reasonCodes: ['RESOURCE_NOT_FOUND'],
    explanation:
      `Tidak ada entri ResourceCatalog bertipe ${type} yang dapat dipertahankan ` +
      `sebagai kandidat untuk "${rawName}"` +
      (normalizedCode !== null ? ` (kode sumber: ${reference.rawCode})` : '') +
      `. Pencarian nama persis, keputusan manusia tercatat, kode sumber, ` +
      `provenance, dan kemiripan token semuanya sudah ditelusuri.`,
  };
}
