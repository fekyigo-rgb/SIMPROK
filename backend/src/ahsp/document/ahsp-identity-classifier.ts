/**
 * AHSP-WHOLE IDENTITY CLASSIFIER — a pure, deterministic function that answers
 * ONE question: is an AHSP about to be admitted the SAME as, POSSIBLY the same
 * as, or DISTINCT from the AHSPs SIMPROK already holds?
 *
 * This is AHSP identity, NOT resource identity. It never touches ResourceCatalog
 * / ResourceIdentityResolutionService / ObservedResource — those answer "is this
 * ONE resource line the same resource?" and stay the one authority for that.
 * This function has ZERO imports from resource-catalog by construction.
 *
 * IT IS A FUNCTION, NOT AN ENGINE. No @Injectable, no DI, no database, no clock,
 * no randomness. The caller loads the existing rows once and passes the ONE
 * normalization home's methods (RealityNormalizationEngine.normalizeName/
 * normalizeCode) as `normalize`. Because it is pure and order-independent
 * (candidates are sorted by ahspId), the same input always yields the same
 * verdict — which is what makes every duplicate-intelligence case unit-testable
 * without a TestingModule, and what makes a repeated import deterministic.
 *
 * LAW: similarity is EVIDENCE, never truth. Only a byte-exact collision on the
 * effective @@unique key (workspaceId + workType + methodName; methodType and
 * locationType are the OTHER filler) is called IDENTICAL. Everything softer is
 * at most POSSIBLY_IDENTICAL, which a human decides. DISTINCT means "no strong
 * indication of sameness was found", never "proven different".
 */

export type AhspIdentityVerdict =
  | 'IDENTICAL'
  | 'POSSIBLY_IDENTICAL'
  | 'DISTINCT';

/**
 * Canonical facts the EXISTING AHSP version/resource/classification schema already
 * owns. They are inputs to the same classifier, not a second identity store.
 */
export interface AhspIdentityResourceFact {
  readonly resourceId: string;
  readonly resourceType: string;
  readonly baseUnit: string;
  readonly coefficient: string | number;
}

export interface AhspIdentityContextFact {
  /** Stable path tips. Ancestors are derived by the existing classification service. */
  readonly classificationLeafNodeIds: readonly string[];
  /** Canonical UnitDefinition.code when known. */
  readonly outputUnitCode: string;
  readonly resources: readonly AhspIdentityResourceFact[];
  /** Current version identity, used only by callers that need to route a revision. */
  readonly versionId?: string | null;
}

/** One stored AHSP as the classifier sees it. deletedAt is NOT filtered by the loader — a soft-deleted twin still occupies the unique index and must be seen. */
export interface AhspIdentityRow {
  readonly ahspId: string;
  readonly workspaceId: string | null;
  readonly workType: string;
  readonly methodName: string;
  readonly code: string | null;
  readonly deletedAt: Date | null;
  /** Present when the existing read surface can prove the current recipe/context. */
  readonly context?: AhspIdentityContextFact | null;
}

/** The AHSP about to be admitted. code is optional — the document importer does not extract an AHSP code today, so the code signal is simply inert there. */
export interface AhspIdentityCandidate {
  readonly workspaceId: string | null;
  readonly workType: string;
  readonly methodName: string;
  readonly code?: string | null;
  /** Optional so legacy/read-only callers keep their previous semantics. */
  readonly context?: AhspIdentityContextFact | null;
}

export type AhspIdentitySignal =
  | 'EXACT'
  | 'EXACT_PARENT'
  | 'NORMALIZED_NAME'
  | 'CODE';

export interface AhspIdentityMatch {
  readonly ahspId: string;
  readonly workType: string;
  readonly methodName: string;
  readonly code: string | null;
  /** True when the matched AHSP was soft-deleted — surfaced so a human is told, never silently revived. */
  readonly deleted: boolean;
  readonly signal: AhspIdentitySignal;
  /** Defined only when both sides supplied canonical recipe/context facts. */
  readonly formulaSame?: boolean;
  readonly classificationSame?: boolean;
  readonly currentVersionId?: string | null;
}

export interface AhspIdentityClassification {
  readonly verdict: AhspIdentityVerdict;
  /** Present only for IDENTICAL: the exact-key twin (may be soft-deleted). */
  readonly exactMatch: AhspIdentityMatch | null;
  /** Present only for POSSIBLY_IDENTICAL: the live candidate(s) that resemble it, as evidence. */
  readonly possibleMatches: readonly AhspIdentityMatch[];
}

/** The one normalization home, passed in so this stays pure and the engine stays the single source of truth. */
export interface AhspIdentityNormalizers {
  readonly name: (raw: string) => string;
  readonly code: (raw: string) => string;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function canonicalCoefficient(value: string | number): string {
  const raw = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return raw;
  const sign = match[1] === '-' ? '-' : '';
  const integer = match[2].replace(/^0+(?=\d)/, '') || '0';
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  return `${sign}${integer}${fraction ? `.${fraction}` : ''}`;
}

function canonicalResourceFact(fact: AhspIdentityResourceFact): string {
  return [
    fact.resourceId.trim(),
    fact.resourceType.trim().toUpperCase(),
    fact.baseUnit.trim().toUpperCase(),
    canonicalCoefficient(fact.coefficient),
  ].join('\u001f');
}

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  const left = sortedUnique(a);
  const right = sortedUnique(b);
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameFormula(
  a: AhspIdentityContextFact,
  b: AhspIdentityContextFact,
): boolean {
  if (
    a.outputUnitCode.trim().toUpperCase() !==
    b.outputUnitCode.trim().toUpperCase()
  ) {
    return false;
  }
  const left = a.resources.map(canonicalResourceFact).sort();
  const right = b.resources.map(canonicalResourceFact).sort();
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Classify a candidate against the existing rows. Pure and deterministic.
 *
 * IDENTICAL — a row with the SAME workspaceId AND byte-exact workType AND
 *   byte-exact methodName. This is exactly the effective @@unique key and
 *   exactly the create() pre-check, promoted from "throw" to "surface". A
 *   soft-deleted twin still counts (it holds the unique index): it is reported
 *   IDENTICAL with deleted=true so the human is told, not silently blocked.
 *   An OFFICIAL (workspaceId null) row that merely shares the names is a
 *   DIFFERENT unique key and is therefore NEVER IDENTICAL — at most POSSIBLY.
 *
 * POSSIBLY_IDENTICAL — no exact match, but a LIVE row where BOTH normalized
 *   names match (case/whitespace-only difference), OR the normalized codes
 *   match (both non-empty). Both are evidence surfaced as candidates; a shared
 *   code alone never promotes to IDENTICAL. Soft-deleted rows are not offered
 *   as candidates (nothing to keep-separate against, nothing to adopt here).
 *
 * DISTINCT — otherwise.
 */
export function classifyAhspIdentity(
  candidate: AhspIdentityCandidate,
  existing: readonly AhspIdentityRow[],
  normalize: AhspIdentityNormalizers,
): AhspIdentityClassification {
  // Byte-exact on the EFFECTIVE @@unique key. The DB key is five columns
  // [workspaceId, workType, methodType, locationType, methodName], but the ONLY
  // AHSP writer (AhspService.create) forces methodType=locationType=OTHER, so
  // within a workspace every row is OTHER/OTHER and the key reduces to
  // (workspaceId, workType, methodName). An Official (null-workspace) row has a
  // different workspaceId and is excluded here (it can only be POSSIBLY). The
  // caller orders the surface by id, so this find is deterministic. INVARIANT:
  // if a non-OTHER same-workspace AHSP writer is ever added, this predicate MUST
  // grow methodType/locationType, or two genuinely different works could be
  // called IDENTICAL — the one outcome the law forbids above all.
  const exact = existing.find(
    (row) =>
      row.workspaceId === candidate.workspaceId &&
      row.workType === candidate.workType &&
      row.methodName === candidate.methodName,
  );
  if (exact) {
    const deleted = exact.deletedAt !== null;
    const bothContextual = Boolean(candidate.context && exact.context);
    const formulaSame =
      bothContextual && candidate.context && exact.context
        ? sameFormula(candidate.context, exact.context)
        : undefined;
    const classificationSame =
      bothContextual && candidate.context && exact.context
        ? sameStringSet(
            candidate.context.classificationLeafNodeIds,
            exact.context.classificationLeafNodeIds,
          )
        : undefined;
    const match: AhspIdentityMatch = {
      ahspId: exact.ahspId,
      workType: exact.workType,
      methodName: exact.methodName,
      code: exact.code,
      deleted,
      signal:
        bothContextual && !deleted && (!formulaSame || !classificationSame)
          ? 'EXACT_PARENT'
          : 'EXACT',
      ...(formulaSame !== undefined ? { formulaSame } : {}),
      ...(classificationSame !== undefined ? { classificationSame } : {}),
      ...(exact.context?.versionId !== undefined
        ? { currentVersionId: exact.context.versionId }
        : {}),
    };

    // A soft-deleted exact parent still occupies the unique key and can never be
    // silently recreated. With no canonical content facts, preserve the legacy
    // exact-parent verdict. When BOTH sides do carry those facts, only the same
    // classification context AND same canonical formula is an exact duplicate.
    if (
      !deleted &&
      bothContextual &&
      (formulaSame === false || classificationSame === false)
    ) {
      return {
        verdict: 'POSSIBLY_IDENTICAL',
        exactMatch: null,
        possibleMatches: [match],
      };
    }

    return {
      verdict: 'IDENTICAL',
      exactMatch: match,
      possibleMatches: [],
    };
  }

  const candidateWorkType = normalize.name(candidate.workType);
  const candidateMethodName = normalize.name(candidate.methodName);
  const candidateCode = normalize.code(candidate.code ?? '');
  const matches: AhspIdentityMatch[] = [];
  for (const row of existing) {
    if (row.deletedAt !== null) continue; // possible-match candidates are LIVE only
    let signal: AhspIdentitySignal | null = null;
    // BOTH normalized names must match FIELD BY FIELD (workType vs workType,
    // methodName vs methodName), never a single joined string, so a different
    // (workType, methodName) split can never collide into a false POSSIBLY.
    if (
      normalize.name(row.workType) === candidateWorkType &&
      normalize.name(row.methodName) === candidateMethodName
    ) {
      signal = 'NORMALIZED_NAME';
    } else if (
      candidateCode !== '' &&
      normalize.code(row.code ?? '') === candidateCode
    ) {
      signal = 'CODE';
    }
    if (signal) {
      matches.push({
        ahspId: row.ahspId,
        workType: row.workType,
        methodName: row.methodName,
        code: row.code,
        deleted: false,
        signal,
      });
    }
  }

  if (matches.length > 0) {
    // Order-independent: sort by ahspId so DB row order can never change the result.
    matches.sort((a, b) =>
      a.ahspId < b.ahspId ? -1 : a.ahspId > b.ahspId ? 1 : 0,
    );
    return {
      verdict: 'POSSIBLY_IDENTICAL',
      exactMatch: null,
      possibleMatches: matches,
    };
  }

  return { verdict: 'DISTINCT', exactMatch: null, possibleMatches: [] };
}
