import { createHash } from 'node:crypto';

import { normalizeResourceName } from './resource-identity-resolution.kernel';

/**
 * GHX-01 — the CANDIDATE CONTEXT DIGEST.
 *
 * WHAT THIS IS, AND EMPHATICALLY WHAT IT IS NOT
 *
 * It answers exactly one question: "is the set of candidates a human was judging
 * still the set of candidates in front of us now?" It is APPLICABILITY EVIDENCE.
 * It never proves identity, never widens or narrows the candidate set, never
 * overrides machine evidence, and the Resource Identity kernel never reads it.
 *
 * The specification LAW stays where it already lives —
 * `contradictsSpecification()` and `unprovedSpecificationFacts()` in the kernel,
 * which deliberately read VALUES and never key names because this repository
 * locks no meaning to specification keys. Nothing here changes that, and nothing
 * here is consulted when deciding whether an identity may be asserted.
 *
 * WHY THIS IS A SEPARATE FUNCTION FROM THE KERNEL'S OWN EXTRACTOR
 *
 * The kernel's `structuredSpecificationFacts()` flattens a specification into a
 * bag of values, which is right for its job and wrong for this one:
 *
 *   {diameter: 16, grade: 420}   and   {diameter: 420, grade: 16}
 *
 * both flatten to {"16","420"} — identical. A candidate whose meaning changed
 * completely would look untouched, and a stale human decision would be reused
 * against a context the human never saw. So this canonicalization PRESERVES KEY
 * PATHS AND STRUCTURE. Two functions, two jobs, neither borrowing the other's
 * authority.
 *
 * The one thing it does borrow is the existing NON-MATERIALITY law, rather than
 * inventing a second one: booleans are ignored here because the kernel already
 * establishes that "booleans state no value", which is exactly why a marker like
 * {rm02bTestOnly: true} is provably harmless and needs no ignore-list. No new
 * specification ontology is introduced, and no key is ever special-cased.
 */

/**
 * ENCODING IS PART OF THE PROOF, NOT A PRESENTATION DETAIL.
 *
 * The first version of this file joined canonical parts with ":" and "," and was
 * WRONG, provably:
 *
 *   {a: "b,c:d"}   →  {a:b,c:d}
 *   {a: "b", c: "d"} →  {a:b,c:d}
 *
 * Identical snapshots for two materially different specifications — a value
 * containing the delimiters impersonated a different structure, and a stale human
 * decision would have been reused against a context the human never saw. Any
 * delimiter-joined encoding has this flaw for some input; escaping one character
 * only moves it.
 *
 * So nothing is joined. Canonicalization builds a TREE of tagged tuples and
 * serializes it exactly once with `JSON.stringify`, which frames every string
 * unambiguously. A value can no longer masquerade as structure, because structure
 * is carried by the tuple shape rather than by characters inside a string.
 */

/** Same depth cap the kernel's specification walk already uses. */
const MAX_DEPTH = 4;

/** A leaf that states nothing, and is therefore omitted rather than encoded. */
const OMITTED = null;

/**
 * LOCALE-INDEPENDENT ORDERING.
 *
 * `String.prototype.localeCompare` consults the runtime's collation, so the same
 * evidence could order differently on two machines — and a digest that depends on
 * the host's locale is not a digest of the evidence. Ordering here is a plain
 * code-unit comparison: total, deterministic, and identical everywhere.
 */
function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Tags make a scalar, a list and a map structurally distinguishable. */
const SCALAR = 'S';
const LIST = 'L';
const MAP = 'M';

/** A JSON-serializable canonical tree. */
type CanonicalNode = [typeof SCALAR, string] | [typeof LIST, CanonicalNode[]] | [typeof MAP, Array<[string, CanonicalNode]>];

/**
 * Canonical, structure-preserving serialization of one specification value.
 *
 * Objects keep their keys and are ordered deterministically. Arrays canonicalize
 * each element AS A WHOLE before sorting, so a structured member's own key/value
 * association survives — flattening `[{d:16,g:420},{d:420,g:16}]` into shared
 * leaves would make it indistinguishable from `[{d:16,g:16},{d:420,g:420}]`.
 *
 * Array ORDER is deliberately not material: nothing in this repository locks
 * meaning to the position of a specification array member, so treating a
 * reordering as a change would invalidate decisions for no reason. Element
 * COMPOSITION remains fully material.
 */
function canonicalize(value: unknown, depth: number): CanonicalNode | typeof OMITTED {
  if (depth > MAX_DEPTH) return OMITTED;
  if (value === null || value === undefined) return OMITTED;
  // Booleans state no value — the kernel's own law, reused rather than restated.
  if (typeof value === 'boolean') return OMITTED;

  if (typeof value === 'string' || typeof value === 'number') {
    const text = normalizeResourceName(String(value));
    return text.length === 0 ? OMITTED : [SCALAR, text];
  }

  if (Array.isArray(value)) {
    const nodes = value
      .map((entry) => canonicalize(entry, depth + 1))
      .filter((node): node is CanonicalNode => node !== OMITTED)
      // Sorted by each element's OWN complete serialization, so ordering is
      // decided by the whole element rather than by a shared prefix.
      .sort((left, right) => byCodeUnit(JSON.stringify(left), JSON.stringify(right)));
    return nodes.length === 0 ? OMITTED : [LIST, nodes];
  }

  if (typeof value === 'object') {
    const entries: Array<[string, CanonicalNode]> = [];
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const node = canonicalize(entry, depth + 1);
      if (node === OMITTED) continue;
      entries.push([normalizeResourceName(key), node]);
    }
    if (entries.length === 0) return OMITTED;
    entries.sort((left, right) => byCodeUnit(left[0], right[0]));
    return [MAP, entries];
  }

  return OMITTED;
}

/** Exposed for tests and for the digest below; never for identity decisions. */
export function canonicalSpecificationSnapshot(specifications: unknown): string {
  const node = canonicalize(specifications, 0);
  return node === OMITTED ? '' : JSON.stringify(node);
}

/**
 * The facts about one candidate that materially shaped the human's choice.
 *
 * `status`/visibility are deliberately absent: they change SET MEMBERSHIP, which
 * the digest already captures, and they are re-validated live at reuse. `code` is
 * absent too — an internal label whose reassignment would spuriously invalidate a
 * decision without changing what the resource is.
 */
export interface GhxCandidateContextEntry {
  readonly resourceCatalogId: string;
  readonly name: string;
  readonly type: string;
  readonly baseUnit: string;
  readonly specifications: unknown;
}

/**
 * A deterministic digest of the bounded candidate set.
 *
 * Candidates are ordered by their own stable ids before hashing, so the same
 * evidence produces the same digest whatever order the database returned it in.
 */
export function candidateContextDigest(
  candidates: ReadonlyArray<GhxCandidateContextEntry>,
): string {
  // TUPLES, NEVER JOINED STRINGS — the same law as the specification tree
  // above. A catalog id, name or unit containing the separator must not be able
  // to impersonate a different field boundary, and joining candidates end-to-end
  // would let one candidate's tail merge into the next one's head.
  const encoded = [...candidates]
    .map((candidate) => [
      candidate.resourceCatalogId,
      normalizeResourceName(candidate.name),
      candidate.type.trim().toUpperCase(),
      normalizeResourceName(candidate.baseUnit),
      canonicalSpecificationSnapshot(candidate.specifications),
    ])
    .sort((left, right) =>
      byCodeUnit(JSON.stringify(left), JSON.stringify(right)),
    );

  return createHash('sha256').update(JSON.stringify(encoded), 'utf8').digest('hex');
}
