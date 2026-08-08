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
 * looked at a raw row and chose a canonical resource for it.
 *
 * SCOPE MATTERS AND IS NOT NEGOTIABLE. The model binds one decision to one
 * import row. It is NOT a global alias table, and this kernel must not turn it
 * into one. Reuse is therefore allowed only for the IDENTICAL fact — the same
 * normalized raw name, the same resource type, the same workspace — which is
 * not an extension of the human's decision but a restatement of it. Asking the
 * same person the same question twice is the thing Issue #71 forbids; asking
 * them a DIFFERENT question and pretending they already answered it would be
 * far worse.
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
  | 'NAME_TOKEN_CONTAINMENT'
  | 'NAME_TOKEN_STEM_SHARED';

export interface ResourceIdentityCandidate {
  readonly resourceCatalogId: string;
  readonly name: string;
  readonly code: string | null;
  readonly type: string;
  readonly baseUnit: string;
  readonly evidence: ReadonlyArray<CandidateEvidenceKind>;
  /** True when the catalog row carries a designation the raw reference does not. */
  readonly specificationUnproved: boolean;
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
 * A real specification contradiction: BOTH sides state a designation and they
 * share none. "Besi angker diameter 8" against "Besi angker diameter 10" is a
 * contradiction. "Baja tulangan" against "BjTS 420B Ø13" is NOT — one side
 * simply says nothing, which is unproven, not contradicted.
 */
function contradictsSpecification(rawName: string, candidateName: string): boolean {
  const rawDesignations = designationTokens(rawName);
  const candidateDesignations = designationTokens(candidateName);
  if (rawDesignations.size === 0 || candidateDesignations.size === 0) return false;
  return isDisjoint(rawDesignations, candidateDesignations);
}

/** The candidate states a designation the raw reference never made. */
function specificationUnproved(rawName: string, candidateName: string): boolean {
  return (
    designationTokens(rawName).size === 0 &&
    designationTokens(candidateName).size > 0
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
 *   1. Exact canonical match, one row, no specification contradiction → RESOLVED
 *   2. A reviewed human decision for the identical raw fact           → RESOLVED
 *   3. Evidence-nominated candidates (code, provenance, tokens)       → NEEDS_REVIEW
 *   4. Several plausible candidates                                   → NEEDS_REVIEW
 *   5. Type or specification contradiction                            → UNRESOLVED
 *   6. Nothing defensible, after all of the above                     → UNRESOLVED
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
    specificationUnproved: specificationUnproved(rawName, candidate.name),
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
    if (contradictsSpecification(rawName, only.name)) {
      return {
        status: 'UNRESOLVED',
        authority: null,
        resolvedResourceCatalogId: null,
        candidates: [describeCandidate(only, [])],
        reasonCodes: ['SPECIFICATION_CONFLICT'],
        explanation:
          `Nama "${rawName}" cocok persis dengan katalog "${only.name}", tetapi ` +
          `spesifikasi yang tertulis pada keduanya bertentangan. Identitas tidak ` +
          `ditetapkan.`,
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

  // ---- LEVEL 2: a reviewed human decision for the IDENTICAL raw fact ----
  const reusableMappings = reviewedMappings.filter(
    (mapping) =>
      normalizeResourceName(mapping.rawName) === normalizedName &&
      typeMatches(mapping.resourceType, type) &&
      byId.has(mapping.resourceCatalogId),
  );
  const reusableTargets = new Set(
    reusableMappings.map((mapping) => mapping.resourceCatalogId),
  );

  if (reusableTargets.size === 1) {
    const targetId = [...reusableTargets][0];
    const target = byId.get(targetId)!;
    const decision = reusableMappings[0];
    if (!typeMatches(target.type, type)) {
      // The recorded decision points at a row of the wrong class — never reuse.
      return {
        status: 'UNRESOLVED',
        authority: null,
        resolvedResourceCatalogId: null,
        candidates: [describeCandidate(target, [])],
        reasonCodes: ['RESOURCE_TYPE_MISMATCH'],
        explanation:
          `Keputusan manusia yang tercatat untuk "${rawName}" menunjuk katalog ` +
          `"${target.name}" bertipe ${target.type}, sedangkan AHSP meminta ${type}.`,
      };
    }
    if (contradictsSpecification(rawName, target.name)) {
      return {
        status: 'UNRESOLVED',
        authority: null,
        resolvedResourceCatalogId: null,
        candidates: [describeCandidate(target, [])],
        reasonCodes: ['SPECIFICATION_CONFLICT'],
        explanation:
          `Keputusan manusia yang tercatat menunjuk "${target.name}", tetapi ` +
          `spesifikasinya bertentangan dengan "${rawName}".`,
      };
    }
    return {
      status: 'RESOLVED',
      authority: 'VERIFIED_MAPPING_REUSED',
      resolvedResourceCatalogId: target.id,
      candidates: [describeCandidate(target, [])],
      reasonCodes: ['VERIFIED_MAPPING_REUSED'],
      explanation:
        `Identitas "${rawName}" (${type}) sudah pernah ditetapkan oleh manusia di ` +
        `workspace ini ke ResourceCatalog "${target.name}" (${target.id}) pada ` +
        `${decision.decidedAt}. Fakta yang sama tidak ditanyakan ulang.`,
    };
  }

  if (reusableTargets.size > 1) {
    return {
      status: 'NEEDS_REVIEW',
      authority: 'HUMAN_REVIEW_REQUIRED',
      resolvedResourceCatalogId: null,
      candidates: [...reusableTargets].map((id) =>
        describeCandidate(byId.get(id)!, ['REVIEWED_MAPPING_CODE_MATCH']),
      ),
      reasonCodes: ['REVIEWED_MAPPING_CONFLICT'],
      explanation:
        `Terdapat keputusan manusia yang saling bertentangan untuk "${rawName}": ` +
        `${reusableTargets.size} katalog berbeda pernah dipilih. Diperlukan ` +
        `penegasan ulang.`,
    };
  }

  // ---- LEVEL 3: evidence-driven candidate discovery ----
  const evidenceById = new Map<string, Set<CandidateEvidenceKind>>();
  const note = (catalogId: string, kind: CandidateEvidenceKind) => {
    const candidate = byId.get(catalogId);
    if (!candidate || !typeMatches(candidate.type, type)) return;
    if (contradictsSpecification(rawName, candidate.name)) return;
    const existing = evidenceById.get(catalogId) ?? new Set<CandidateEvidenceKind>();
    existing.add(kind);
    evidenceById.set(catalogId, existing);
  };

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
          (kinds.has('SOURCE_CODE_MATCH') ? 4 : 0) +
          (kinds.has('REVIEWED_MAPPING_CODE_MATCH') ? 3 : 0) +
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
        `Kesetaraan belum terbukti, jadi identitas belum ditetapkan — ini bukan ` +
        `"tidak ditemukan", melainkan satu keputusan manusia yang masih terbuka.`,
    };
  }

  // ---- LEVEL 5: name matched but the class is wrong ----
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

  // ---- LEVEL 6: genuinely nothing, and only now may we say so ----
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
