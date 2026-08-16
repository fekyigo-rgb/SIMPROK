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
 *   HIGH RECALL when FINDING candidates — source code, provenance sightings,
 *   reviewed decisions from other contexts, name tokens. Look everywhere.
 *   HIGH PRECISION when ASSERTING identity — ONLY an exact canonical match,
 *   and only when the row claims nothing the source did not. Everything else
 *   becomes a named candidate a human closes once.
 *
 * So a false positive is very hard to produce: exactness is currently the sole
 * road to RESOLVED, because it is the only evidence that binds to the fact
 * being resolved.
 *
 * Spelling-driven false negatives are REDUCED, not eliminated, and that
 * distinction is deliberate. Exact-name-only is no longer the sole DISCOVERY
 * path, so recall is materially better — but discovery is still heuristic, and
 * AHSPResource carries no source-code column, so "BjTP atau BjTS" against
 * "Baja tulangan" remains a known blind spot. This kernel does not claim
 * otherwise.
 *
 * Scope: PURE — no I/O, no database, no clock, no randomness. Every piece of
 * evidence is handed in already tenant-scoped by the caller. This kernel
 * decides; it does not fetch, and it never writes.
 *
 * NOT in this kernel, by design: unit law (UnitKernelService owns that
 * outright), Basic Price eligibility, price arithmetic, AHSP applicability.
 *
 * RM-03D2 does not change that. This kernel still holds no alias table, no unit
 * normalizer and no conversion knowledge. It receives canonical unit identities
 * the Unit authority already settled and compares them for equality, at ONE
 * branch only — the exact-name/type representation tie. A unit remains something
 * this kernel is TOLD, never something it works out.
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
  /**
   * The decision's own stable identity — the BasicPriceImportRowResourceMapping
   * row id.
   *
   * Carried for ONE purpose: to break a tie between two decisions bearing the
   * same `decidedAt` without falling back to the order the database returned
   * them in. It grants the mapping no authority it did not already have; it only
   * gives "which of these two" a deterministic answer. See `priorDecisionFor`.
   */
  readonly mappingId: string;
  readonly resourceCatalogId: string;
  readonly rawName: string;
  readonly rawCode: string | null;
  readonly resourceType: string;
  readonly reviewerAccountId: string;
  readonly decidedAt: string;
  readonly reason: string | null;
}

/**
 * RM-03D2 — which canonical unit ONE raw spelling denotes, already decided by
 * the Unit authority and handed in as a finished fact.
 *
 * The kernel does not, and must not, interpret unit text: it holds no alias
 * table, no normalizer, no dictionary. It only compares two already-canonical
 * identities for equality. That keeps unit semantics in UnitKernelService where
 * they are governed, and keeps this kernel pure.
 *
 * `rawUnit` is the caller's EXACT spelling, matched by exact string equality, so
 * a fact resolved for "m3" can never be silently read as the answer for "M3".
 * The caller resolves both spellings when both occur.
 *
 * A NEEDS_REVIEW fact means NOT PROVEN — never "proven different". §12.
 *
 * IT CARRIES ITS OWN PROVENANCE, and must. The decision this kernel reaches from
 * a fact is only as legitimate as the fact was, and "jam" resolving to a canonical
 * unit BECAUSE the resource is governed as LABOR is a materially weaker, narrower
 * statement than "jam" being globally unambiguous. A reader of the stored
 * resolution must be able to tell those two apart afterwards, so the authority
 * story travels WITH the fact instead of being reconstructed later from a context
 * nobody recorded.
 */
export interface CanonicalUnitIdentityFact {
  readonly rawUnit: string;
  readonly status: 'RESOLVED' | 'NEEDS_REVIEW';
  readonly unitDefinitionId: string | null;
  /**
   * The canonical unit's own code (e.g. "M3"), so the deciding unit is auditable
   * as a unit and not only as an opaque row id.
   */
  readonly unitCode: string | null;
  /** The Unit authority's own reason, carried verbatim into the explanation. */
  readonly reasonCode: string | null;
  /** True when a context-scoped alias carried the answer. */
  readonly contextScoped: boolean;
  /**
   * The governed class the meaning actually DEPENDED ON, or null when it did not
   * depend on one.
   *
   * Null whenever `contextScoped` is false, including when a context was
   * supplied and simply not needed — naming a context there would manufacture a
   * dependency that never existed and make a context-free proof look narrower
   * than it is. §6: when context did not matter, do not invent context provenance.
   */
  readonly trustedContext: string | null;
  /**
   * The alias rows that decided it, in the Unit authority's canonical order.
   *
   * Stable existing identities only, and never a positional or ordering-derived
   * fact — the same evidence set must yield the same list however the database
   * returned it.
   */
  readonly matchedAliasIds: ReadonlyArray<string>;
}

export interface ResourceIdentityResolutionInput {
  readonly reference: RawResourceReference;
  /** Already tenant-scoped by the caller. */
  readonly catalogCandidates: ReadonlyArray<IdentityCatalogCandidate>;
  readonly sourceSightings: ReadonlyArray<SourceSightingEvidence>;
  readonly reviewedMappings: ReadonlyArray<ReviewedMappingEvidence>;
  /**
   * RM-03D2 canonical unit facts, consulted at EXACTLY ONE branch: the
   * exact-name/type representation tie. Absent or empty behaves exactly as
   * before — the tie stays NEEDS_REVIEW — so every pre-existing caller is
   * unchanged.
   */
  readonly canonicalUnitIdentities?: ReadonlyArray<CanonicalUnitIdentityFact>;
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
   * RM-03D2. Several catalog rows matched the name and type exactly — they are
   * separate canonical REPRESENTATIONS of the same wording, deliberately kept
   * distinct — and the source's own stated unit resolved, through the Unit
   * authority, to the canonical unit of exactly one of them, every other tied
   * row having been proven to be a different canonical unit.
   *
   * It is emitted INSTEAD OF `EXACT_CANONICAL_MATCH`, never alongside it: a row
   * settled this way must not be readable as though only one exact candidate
   * had ever existed.
   */
  | 'EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT'
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
  | 'RESOURCE_NOT_FOUND'
  // ---- RM-03D2: exact-representation tie, decided or refused by unit context ----
  /** The tie was settled: source unit matched exactly one representation. */
  | 'EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT'
  /** The AHSP line states no unit at all, so nothing can discriminate. */
  | 'UNIT_CONTEXT_SOURCE_UNIT_UNSTATED'
  /** The stated unit is unknown, ambiguous, or context-scoped without context. */
  | 'UNIT_CONTEXT_SOURCE_UNIT_UNPROVED'
  /** A tied row's own base unit is unproved, so that row cannot be excluded. */
  | 'UNIT_CONTEXT_CANDIDATE_UNIT_UNPROVED'
  /** Every tied row proved to be a different canonical unit from the source. */
  | 'UNIT_CONTEXT_NO_MATCHING_REPRESENTATION'
  /** Several tied rows share the source's canonical unit — still ambiguous. */
  | 'UNIT_CONTEXT_MULTIPLE_MATCHING_REPRESENTATIONS';

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
  /** True when the catalog row claims anything the source did not state. */
  readonly specificationUnproved: boolean;
  /**
   * Exactly which claims are unsupported — a diameter, a grade, a finish the
   * source never mentioned. Named so the reviewer can settle the one open
   * question instead of re-deriving why the row was held back.
   */
  readonly unprovedSpecificationFacts: ReadonlyArray<string>;
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

/**
 * True when a verdict is a LEVEL-1 REPRESENTATION TIE and nothing else: several
 * rows matched the name and type exactly, and no other fact has separated them
 * yet.
 *
 * This is the ONLY condition under which RM-03D2 unit evidence is worth
 * gathering, so the I/O layer asks this rather than re-deriving the tie from the
 * reason codes. `HUMAN_REVIEW_REQUIRED` is emitted at exactly one place in this
 * file, which is what makes the test exact.
 *
 * Deliberately NOT true for a tie already refused on unit grounds with the
 * evidence in hand — the caller re-asks at most once, never in a loop.
 */
export function isExactRepresentationTie(
  result: ResourceIdentityResolution,
): boolean {
  return (
    result.status === 'NEEDS_REVIEW' &&
    result.authority === 'HUMAN_REVIEW_REQUIRED'
  );
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
 * A REAL specification contradiction, and the only kind this kernel will ever
 * claim: both NAMES state a designation and they share none. "Besi angker
 * diameter 8" against "Besi angker diameter 10" contradicts. "Baja tulangan"
 * against "BjTS 420B Ø13" does not — one side is simply silent, which is
 * unproven, not contradicted.
 *
 * Names are compared against names because that is like against like. The
 * structured `specifications` column is deliberately NOT consulted here: its
 * keys have no locked meaning in this repository, so a value of 16 sitting
 * next to a source that said 420B proves nothing about whether they describe
 * the same property. Calling that a conflict would be inventing the taxonomy
 * this kernel refuses to invent — so an unprovable structured fact is always
 * UNPROVED, never CONFLICT. Honest in both directions.
 */
function contradictsSpecification(
  rawName: string,
  candidate: IdentityCatalogCandidate,
): boolean {
  const rawDesignations = designationTokens(rawName);
  const candidateNameDesignations = designationTokens(candidate.name);
  if (rawDesignations.size === 0 || candidateNameDesignations.size === 0) {
    return false;
  }
  return isDisjoint(rawDesignations, candidateNameDesignations);
}

/**
 * Concrete facts a catalog row states in its structured `specifications` JSON.
 *
 * ResourceCatalog.specifications is opaque — the schema gives it no shape and
 * the repository locks no meaning to its keys. So this reads VALUES ONLY and
 * never key names: it never decides that a key called "diameter" means a
 * diameter, because nothing in the repository says so.
 *
 * A string or a number IS a stated fact ("Galvanis", 16, "BjTS 420B"). A
 * boolean is a flag with no value to compare and states nothing — which is
 * also why the one shape this repository provably treats as non-product
 * metadata, `{rm02bTestOnly: true}`, needs no ignore-list to stay harmless. No
 * key is ever special-cased here, and no vocabulary is introduced.
 */
function structuredSpecificationFacts(specifications: unknown): string[] {
  const facts: string[] = [];
  const walk = (value: unknown, depth: number): void => {
    if (depth > 4 || value === null || value === undefined) return;
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text.length > 0) facts.push(text);
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
    // Booleans state no value and are ignored.
  };
  walk(specifications, 0);
  return facts;
}

/**
 * Everything the candidate claims about itself that the source never said.
 *
 * This is the fail-closed guard, and it is deliberately blunt rather than
 * clever. The previous version compared digit tokens as SETS, so a catalog row
 * stating `{diameter: 16}` slipped through whenever the source happened to
 * share some other designation — "Baja tulangan 420B" and a row claiming both
 * 420B and 16 intersected on 420B and auto-resolved, silently adopting a
 * diameter the source never mentioned. It also discarded non-numeric facts
 * entirely, so `{finish: "Galvanis"}` vanished: "no digit" was being treated
 * as "not a specification", which is not true.
 *
 * The rule now: EVERY stated fact must be supported by the source, or the
 * identity is not asserted. A structured fact counts as supported only when
 * all of its tokens appear in the source text — deterministic evidence, never
 * guessed key semantics. Anything left over blocks the automatic assertion and
 * asks a human.
 */
function unprovedSpecificationFacts(
  rawName: string,
  candidate: IdentityCatalogCandidate,
): string[] {
  const sourceTokens = new Set(tokenize(rawName));
  const rawDesignations = designationTokens(rawName);
  const unproved: string[] = [];

  // Designations the catalog NAME states that the source does not.
  for (const designation of designationTokens(candidate.name)) {
    if (!rawDesignations.has(designation)) unproved.push(designation);
  }

  // Facts the structured column states that the source does not.
  for (const fact of structuredSpecificationFacts(candidate.specifications)) {
    const factTokens = tokenize(fact);
    const supported =
      factTokens.length > 0 &&
      factTokens.every((token) => sourceTokens.has(token));
    if (!supported) unproved.push(fact);
  }

  return unproved;
}

function specificationUnproved(
  rawName: string,
  candidate: IdentityCatalogCandidate,
): boolean {
  return unprovedSpecificationFacts(rawName, candidate).length > 0;
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
 *   1b. Several EXACT rows (a representation tie) whose canonical units the
 *      Unit authority separates, the source stating one of them, and the
 *      surviving row passing the same specification law         (RM-03D2)
 *                                                                     → RESOLVED
 *   2. Evidence-nominated candidates — source code, provenance sightings,
 *      reviewed human decisions from other contexts, name tokens      → NEEDS_REVIEW
 *   3. Several plausible candidates                                   → NEEDS_REVIEW
 *   4. Type or specification contradiction                            → UNRESOLVED
 *   5. Nothing defensible, after all of the above                     → UNRESOLVED
 *
 * AN EXACT NAME AND TYPE MATCH REMAINS THE ONLY ROAD TO RESOLVED. RM-03D2 did
 * not widen WHICH rows may be asserted — every candidate it can select already
 * matched the name and the class exactly. It only lets a fact the source itself
 * states settle WHICH of several equally exact representations was meant, and
 * only when the Unit authority proves that fact independently of the candidate
 * being tested. No heuristic gains assertion power: token containment, shared
 * stems, sightings and reviewed mappings all still stop at discovery.
 *
 * The one kind of recorded human decision this repository has is bound to a
 * Basic Price import row, which is a different fact from an AHSP reference —
 * so it enriches the evidence and never carries the assertion.
 */
export function resolveResourceIdentity(
  input: ResourceIdentityResolutionInput,
): ResourceIdentityResolution {
  const {
    reference,
    catalogCandidates,
    sourceSightings,
    reviewedMappings,
    canonicalUnitIdentities = [],
  } = input;
  const rawName = reference.rawName;
  const normalizedName = normalizeResourceName(rawName);
  const normalizedCode = normalizeResourceCode(reference.rawCode);
  const type = reference.resourceType;

  const usable = catalogCandidates.filter(isActive);
  const byId = new Map(usable.map((candidate) => [candidate.id, candidate]));

  /**
   * The most recent decision a human made about this catalog row, if any.
   *
   * "Most recent" alone is not a total order. Two reviewed mappings can carry
   * the exact same `decidedAt` — same batch, same second, and the column is a
   * plain timestamp — and a strict `>` comparison then keeps whichever the
   * database happened to return first. That made the reported reviewer, reason
   * and timestamp depend on row order, which breaks the one law that makes this
   * kernel checkable at all: THE SAME EVIDENCE MUST PRODUCE THE SAME OUTPUT.
   * The RAB pre-lock gate re-runs this resolution and compares it with the
   * frozen one, so an order-dependent field there could fail a lawful lock.
   *
   * So an equal timestamp is settled by the decision's own stable id — unique by
   * construction, so the order is total and no third rule is needed. It is
   * determinism machinery and nothing more: a reviewed mapping's authority is
   * untouched, and it remains candidate EVIDENCE that never asserts identity.
   */
  const priorDecisionFor = (catalogId: string): PriorHumanDecision | null => {
    const matching = reviewedMappings.filter(
      (mapping) => mapping.resourceCatalogId === catalogId,
    );
    if (matching.length === 0) return null;
    const latest = matching.reduce((newest, mapping) => {
      if (mapping.decidedAt !== newest.decidedAt) {
        return mapping.decidedAt > newest.decidedAt ? mapping : newest;
      }
      return mapping.mappingId < newest.mappingId ? mapping : newest;
    });
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
    unprovedSpecificationFacts: unprovedSpecificationFacts(rawName, candidate),
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
    // The names agree, but the catalog row claims something the source never
    // said — a diameter, a grade, a finish. An exact name is not licence to
    // assume the source meant it. Unknown is not agreement.
    const unproved = unprovedSpecificationFacts(rawName, only);
    if (unproved.length > 0) {
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
          `(${only.id}), tetapi entri katalog menyatakan hal yang tidak disebut ` +
          `oleh sumber AHSP: ${unproved.map((fact) => `"${fact}"`).join(', ')}. ` +
          `SIMPROK tidak menganggap sumber pasti memaksudkannya, dan juga tidak ` +
          `menyebutnya bertentangan — arti kunci spesifikasi belum dibakukan. ` +
          `Diperlukan penegasan manusia.`,
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

  // ---- LEVEL 1b: RM-03D2 — an exact-name/type REPRESENTATION tie ----
  //
  // Several catalog rows state the same name and the same class. They are not
  // duplicates to be merged: RM-02C1c deliberately keeps a same-name row with a
  // different unit as a SEPARATE resource. So the question is not "which of
  // these is right" but "which representation did this source line mean", and
  // the source usually says so itself, in its own unit column.
  //
  // The discrimination is CANONICAL UNIT IDENTITY EQUALITY, never
  // convertibility: "m3 can be converted to kg" says nothing about which row
  // was meant, and a rule scoped to one candidate would prove that candidate
  // with its own evidence. Neither is read here — the kernel only compares two
  // UnitDefinition ids the Unit authority already settled independently.
  //
  // Everything below fails closed to the pre-RM-03D2 verdict, and every refusal
  // says which of the six distinguishable things went wrong.
  if (exactRows.length > 1) {
    // Every statement this branch makes — which rows it lists, in which order,
    // and which it names as unprovable — is built from ONE deterministic
    // ordering, so the same tie described by the database in any row order
    // produces a byte-identical verdict. Ordering is presentation only; the
    // decision below is set-based and cannot be swayed by it.
    const tiedRows = [...exactRows].sort(
      (a, b) => a.baseUnit.localeCompare(b.baseUnit) || a.id.localeCompare(b.id),
    );

    const tieRefused = (
      reasonCode: ResourceIdentityReasonCode,
      detail: string,
    ): ResourceIdentityResolution => ({
      status: 'NEEDS_REVIEW',
      authority: 'HUMAN_REVIEW_REQUIRED',
      resolvedResourceCatalogId: null,
      candidates: tiedRows.map((candidate) => describeCandidate(candidate, [])),
      reasonCodes: ['MULTIPLE_CANDIDATES_NEEDS_REVIEW', reasonCode],
      explanation:
        `Ditemukan ${tiedRows.length} entri ResourceCatalog dengan nama persis ` +
        `"${rawName}" dan tipe ${type} ` +
        `(${tiedRows.map((row) => `"${row.name}" [${row.baseUnit}] (${row.id})`).join(', ')}). ` +
        `${detail} SIMPROK tidak memilih sendiri di antara kandidat yang sama kuat.`,
    });

    /** Exact-spelling lookup. No normalization here — unit text is not this kernel's law. */
    const unitFactFor = (spelling: string): CanonicalUnitIdentityFact | null =>
      canonicalUnitIdentities.find((fact) => fact.rawUnit === spelling) ?? null;

    const provenUnitId = (fact: CanonicalUnitIdentityFact | null): string | null =>
      fact !== null && fact.status === 'RESOLVED' ? fact.unitDefinitionId : null;

    /**
     * HOW a unit fact was proved, said out loud rather than assumed.
     *
     * The decision below is only as legitimate as the evidence under it, and
     * unit evidence is not all one strength: a context-free alias means the
     * spelling is unambiguous everywhere, while a context-scoped one means it is
     * unambiguous ONLY because this resource is governed as MATERIAL, LABOR or
     * EQUIPMENT. Both may lawfully settle a tie; they are not the same claim,
     * and a reviewer reading this row months later must be able to tell which
     * one carried it — which they cannot do if the record says only "unit
     * matched".
     *
     * Everything here comes from the fact the Unit authority handed in. Nothing
     * is inferred, and a context is named only where the authority itself said
     * the meaning depended on one.
     */
    const unitProvenance = (fact: CanonicalUnitIdentityFact | null): string => {
      if (fact === null) return 'BUKTI_UNIT_TIDAK_TERSEDIA';
      const parts: string[] = [fact.reasonCode ?? 'ALASAN_UNIT_TIDAK_DINYATAKAN'];
      if (fact.unitCode !== null) parts.push(`unit canonical ${fact.unitCode}`);
      if (fact.contextScoped) {
        parts.push(
          `berlaku hanya dalam konteks tepercaya ` +
            `${fact.trustedContext ?? 'KONTEKS_TIDAK_DINYATAKAN'}`,
        );
      }
      if (fact.matchedAliasIds.length > 0) {
        parts.push(`alias penentu: ${fact.matchedAliasIds.join(', ')}`);
      }
      return parts.join('; ');
    };

    const rawUnit = reference.rawUnit;
    if (rawUnit === null || rawUnit.trim() === '') {
      return tieRefused(
        'UNIT_CONTEXT_SOURCE_UNIT_UNSTATED',
        `Sumber AHSP tidak menyatakan unit apa pun, sehingga tidak ada fakta ` +
          `dari sumber yang dapat membedakan representasi mana yang dimaksud.`,
      );
    }

    const sourceFact = unitFactFor(rawUnit);
    const sourceUnitId = provenUnitId(sourceFact);
    if (sourceUnitId === null) {
      return tieRefused(
        'UNIT_CONTEXT_SOURCE_UNIT_UNPROVED',
        `Unit sumber "${rawUnit}" belum terbukti menunjuk tepat satu identitas ` +
          `unit canonical (${unitProvenance(sourceFact)}). ` +
          `Belum terbukti bukan berarti tidak sepadan.`,
      );
    }

    const weighed = tiedRows.map((candidate) => ({
      candidate,
      unitId: provenUnitId(unitFactFor(candidate.baseUnit)),
      fact: unitFactFor(candidate.baseUnit),
    }));

    // An unproved candidate unit cannot be EXCLUDED, and excluding it anyway
    // would be treating UNKNOWN as negative proof. One such row keeps the whole
    // tie open, even when another row matches perfectly.
    const unprovable = weighed.filter((row) => row.unitId === null);
    if (unprovable.length > 0) {
      return tieRefused(
        'UNIT_CONTEXT_CANDIDATE_UNIT_UNPROVED',
        `Unit dasar katalog ${unprovable
          .map((row) => `"${row.candidate.baseUnit}" (${row.candidate.id}: ${unitProvenance(row.fact)})`)
          .join(', ')} belum terbukti menunjuk tepat satu identitas unit ` +
          `canonical, sehingga kandidat tersebut tidak dapat disingkirkan secara sah.`,
      );
    }

    const matching = weighed.filter((row) => row.unitId === sourceUnitId);
    if (matching.length === 0) {
      return tieRefused(
        'UNIT_CONTEXT_NO_MATCHING_REPRESENTATION',
        `Tidak satu pun representasi katalog memakai identitas unit canonical ` +
          `yang sama dengan unit sumber "${rawUnit}". Kesepadanan lewat konversi ` +
          `tidak pernah menjadi bukti identitas.`,
      );
    }
    if (matching.length > 1) {
      return tieRefused(
        'UNIT_CONTEXT_MULTIPLE_MATCHING_REPRESENTATIONS',
        `${matching.length} representasi katalog memakai identitas unit ` +
          `canonical yang sama dengan unit sumber "${rawUnit}", sehingga unit ` +
          `tidak membedakan apa pun di sini.`,
      );
    }

    // Exactly one representation, every other tied row PROVEN to be a different
    // canonical unit. The existing specification law still has to pass — this
    // branch is a way through the cardinality gate, never around the
    // false-certainty guards.
    const only = matching[0].candidate;
    // The deciding unit evidence is NAMED, not just relied on, and BOTH sides of
    // it are named — what the source stated and what the surviving representation
    // states are two separate proofs that happened to agree, not one fact.
    //
    // The refusal paths already name their unit reason; the success path must not
    // be the quiet one. A record that says only "unit matched" cannot answer the
    // four questions a reviewer actually has: what did the source state, what
    // canonical unit was proved from it, which representation shared that unit,
    // and did a trusted context have to be assumed to read either one.
    const tiePreamble =
      `Ditemukan ${tiedRows.length} representasi ResourceCatalog dengan nama ` +
      `persis "${rawName}" dan tipe ${type} ` +
      `(${tiedRows.map((row) => `"${row.name}" [${row.baseUnit}] (${row.id})`).join(', ')}), ` +
      `sehingga nama saja tidak menetapkan identitas. Unit yang dinyatakan ` +
      `sumber, "${rawUnit}", terbukti menunjuk tepat satu identitas unit ` +
      `canonical (${unitProvenance(sourceFact)}), dan tepat satu representasi ` +
      `memakai identitas unit canonical yang sama: "${only.name}" ` +
      `[${only.baseUnit}] (${only.id}) (${unitProvenance(matching[0].fact)}). `;

    if (contradictsSpecification(rawName, only)) {
      return {
        status: 'UNRESOLVED',
        authority: null,
        resolvedResourceCatalogId: null,
        candidates: [describeCandidate(only, [])],
        reasonCodes: ['SPECIFICATION_CONFLICT'],
        explanation:
          tiePreamble +
          `Namun spesifikasi yang dinyatakan kedua belah pihak bertentangan. ` +
          `Identitas tidak ditetapkan.`,
      };
    }

    const tieUnproved = unprovedSpecificationFacts(rawName, only);
    if (tieUnproved.length > 0) {
      return {
        status: 'NEEDS_REVIEW',
        authority: 'EVIDENCE_CANDIDATE',
        resolvedResourceCatalogId: null,
        candidates: [describeCandidate(only, [])],
        reasonCodes: ['STRONG_CANDIDATE_NEEDS_REVIEW', 'SPECIFICATION_UNPROVED'],
        explanation:
          tiePreamble +
          `Namun entri katalog menyatakan hal yang tidak disebut oleh sumber ` +
          `AHSP: ${tieUnproved.map((fact) => `"${fact}"`).join(', ')}. ` +
          `Diperlukan penegasan manusia.`,
      };
    }

    return {
      status: 'RESOLVED',
      authority: 'EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT',
      resolvedResourceCatalogId: only.id,
      candidates: [describeCandidate(only, [])],
      reasonCodes: ['EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT'],
      explanation:
        tiePreamble +
        `Representasi lain terbukti memakai identitas unit canonical yang ` +
        `berbeda, bukan sekadar belum terbukti; kesepadanan lewat konversi tidak ` +
        `pernah dipakai sebagai bukti identitas. Pemeriksaan spesifikasi lolos: ` +
        `entri katalog tidak menyatakan hal yang tidak disebut sumber. Identitas ` +
        `ditetapkan tanpa memerlukan keputusan manusia.`,
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
