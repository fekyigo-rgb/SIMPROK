/**
 * RAB-FOCUS-01 — moving rows that already exist under a parent the user chose.
 *
 * `rabStructuralInsert` answers where a NEW row goes. This module answers the
 * other half of editing a document: an existing Sub Judul was written after the
 * items it should own, and those items must now become its children without
 * being retyped.
 *
 * It computes no numbers. `assignStructuralNumbers` remains the single
 * numbering authority and derives `1.3.1` from exactly the `parentId` +
 * `sortOrder` facts written here — there is no second tree and no second
 * algorithm to keep in step.
 *
 * THE HUMAN CHOOSES, SIMPROK CARRIES IT OUT. Nothing here runs on its own: a
 * new Sub Judul never swallows the rows below it. `contiguousFollowingSiblings`
 * exists only so the UI can OFFER a likely selection, which a human then
 * confirms or edits. Suggesting is not deciding.
 *
 * SUBTREES MOVE AS ONE. Re-parenting a row rewrites that row's `parentId` and
 * nothing else, so its descendants travel with it by construction — they still
 * point at their own parent. A descendant explicitly named alongside its own
 * ancestor is dropped from the move rather than detached from it, because
 * moving both would mean lifting a child out of the parent that is itself
 * moving.
 */

export interface ReparentableRow {
  id: string;
  parentId: string | null;
  sortOrder: number;
}

/**
 * The one index a structural operation needs, built once.
 *
 * The first version rebuilt the whole child map inside a descendant walk, and
 * then ran that walk once per selected row AND once per selected pair — so
 * adopting k rows out of n cost roughly O(k² × n) and a large RAB got slower
 * the more the Owner selected. Everything below shares this single pass.
 */
const parentIndexOf = (rows: readonly ReparentableRow[]): Map<string, string | null> =>
  new Map(rows.map((row) => [row.id, row.parentId]));

/**
 * `id` walking upwards: its parent, grandparent, and so on to the root.
 *
 * Guarded against a malformed cycle so a corrupt input cannot hang the UI —
 * lawful editing cannot produce one, and the backend now refuses to persist
 * one, but a hang would be a worse answer than a bounded walk.
 */
const ancestorsOf = (
  parentIndex: Map<string, string | null>,
  id: string,
): Set<string> => {
  const chain = new Set<string>();
  let cursor = parentIndex.get(id) ?? null;
  while (cursor !== null && cursor !== undefined && !chain.has(cursor)) {
    chain.add(cursor);
    cursor = parentIndex.get(cursor) ?? null;
  }
  return chain;
};

/**
 * Is `candidateParentId` inside the subtree of `rowId` (or the row itself)?
 *
 * This is the cycle question. A row cannot become its own parent, and an
 * ancestor cannot become the child of its own descendant — either would
 * detach that whole branch from the root, and `assignStructuralNumbers` would
 * have to rescue it as a pseudo-root. Refusing the move is honest; producing
 * an unreachable branch is not.
 *
 * Asked the cheap way round: instead of expanding `rowId`'s whole subtree to
 * look for the candidate, walk the CANDIDATE up to the root once. The two
 * questions are the same question — `candidate` is inside `rowId` exactly when
 * `rowId` is an ancestor of, or is, the candidate — but this direction is the
 * depth of one chain rather than the size of a subtree.
 */
export const wouldCreateCycle = (
  rows: readonly ReparentableRow[],
  rowId: string,
  candidateParentId: string | null,
): boolean => {
  if (candidateParentId === null) return false;
  if (candidateParentId === rowId) return true;
  return ancestorsOf(parentIndexOf(rows), candidateParentId).has(rowId);
};

export interface ReparentResult<T> {
  rows: T[];
  /** Ids actually moved, after cycles and redundant descendants were removed. */
  movedIds: string[];
  /** Ids the caller named that were refused, with the reason. */
  rejected: Array<{ id: string; reason: 'CYCLE' | 'ALREADY_CHILD_OF_MOVED' }>;
}

/**
 * Makes `rowIds` children of `newParentId`, appended in the order given.
 *
 * The moved rows land at the END of the new parent's existing children, which
 * is where a human who just wrote a Sub Judul expects the adopted lines to
 * appear. Every touched sibling group is renumbered densely from 0, so two
 * siblings can never share a `sortOrder` — an ambiguity that would make the
 * visible order depend on array luck.
 *
 * Rows in untouched groups are returned by identity, so React re-renders only
 * what actually moved.
 */
export const reparentRows = <T extends ReparentableRow>(
  rows: readonly T[],
  rowIds: readonly string[],
  newParentId: string | null,
): ReparentResult<T> => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const requested = rowIds.filter((id) => byId.has(id));

  // ONE index, ONE ancestry walk, for the whole operation.
  const parentIndex = parentIndexOf(rows);
  const destinationAncestry =
    newParentId === null ? new Set<string>() : ancestorsOf(parentIndex, newParentId);

  const rejected: ReparentResult<T>['rejected'] = [];
  const cycleFree = requested.filter((id) => {
    // Moving `id` would put the destination inside `id` exactly when `id` is
    // the destination or one of its ancestors — an O(1) lookup now.
    if (id === newParentId || destinationAncestry.has(id)) {
      rejected.push({ id, reason: 'CYCLE' });
      return false;
    }
    return true;
  });

  /**
   * A row already travelling inside another moved row must not be named again:
   * re-parenting it would lift it OUT of the ancestor that is itself moving.
   *
   * Asked upwards rather than downwards. The old form expanded every moved
   * row's subtree and tested every PAIR; this walks each candidate's own
   * ancestor chain once, memoising the verdict as it climbs, so the cost is
   * the tree's depth rather than the square of the selection.
   */
  const movingSet = new Set(cycleFree);
  const insideMoved = new Map<string, boolean>();
  const isInsideMovedRow = (id: string): boolean => {
    const chain: string[] = [];
    let cursor = parentIndex.get(id) ?? null;
    let verdict = false;
    while (cursor !== null && cursor !== undefined) {
      const memo = insideMoved.get(cursor);
      if (memo !== undefined) {
        verdict = memo || movingSet.has(cursor);
        break;
      }
      if (movingSet.has(cursor)) {
        verdict = true;
        break;
      }
      chain.push(cursor);
      cursor = parentIndex.get(cursor) ?? null;
    }
    for (const step of chain) insideMoved.set(step, verdict);
    insideMoved.set(id, verdict);
    return verdict;
  };

  const moved = cycleFree.filter((id) => {
    if (isInsideMovedRow(id)) {
      rejected.push({ id, reason: 'ALREADY_CHILD_OF_MOVED' });
      return false;
    }
    return true;
  });

  if (moved.length === 0) return { rows: [...rows], movedIds: [], rejected };

  const movedOrder = new Map(moved.map((id, index) => [id, index]));
  const movedFrom = new Set(moved.map((id) => byId.get(id)!.parentId));

  /**
   * Sibling groups, in ONE pass over the document.
   *
   * Each affected group used to be found with its own `rows.filter(...)`, so a
   * selection drawn from ten different sections walked the whole RAB eleven
   * times. Grouping once costs a single pass and every group below is then a
   * map lookup — the cost tracks the document, not how many sections the Owner
   * happened to select from.
   */
  const siblingsByParent = new Map<string | null, T[]>();
  for (const row of rows) {
    const group = siblingsByParent.get(row.parentId);
    if (group) group.push(row);
    else siblingsByParent.set(row.parentId, [row]);
  }
  const stayingSiblingsOf = (parentId: string | null): T[] =>
    (siblingsByParent.get(parentId) ?? [])
      .filter((row) => !movedOrder.has(row.id))
      .sort((a, b) => a.sortOrder - b.sortOrder);

  // Destination: existing children keep their relative order, adopted rows are
  // appended in the order the user named them.
  const destination = [
    ...stayingSiblingsOf(newParentId).map((row) => row.id),
    ...[...moved].sort((a, b) => movedOrder.get(a)! - movedOrder.get(b)!),
  ];

  const nextSortOrder = new Map<string, number>();
  destination.forEach((id, index) => nextSortOrder.set(id, index));

  // Each source group closes the gaps the departures left behind, so numbering
  // never shows a stale hole.
  for (const sourceParentId of movedFrom) {
    if (sourceParentId === newParentId) continue;
    stayingSiblingsOf(sourceParentId).forEach((row, index) =>
      nextSortOrder.set(row.id, index),
    );
  }

  return {
    rows: rows.map((row) => {
      const isMoved = movedOrder.has(row.id);
      const nextOrder = nextSortOrder.get(row.id);
      if (!isMoved && nextOrder === undefined) return row;
      if (!isMoved && nextOrder === row.sortOrder) return row;
      return {
        ...row,
        ...(isMoved ? { parentId: newParentId } : {}),
        ...(nextOrder === undefined ? {} : { sortOrder: nextOrder }),
      };
    }),
    movedIds: moved,
    rejected,
  };
};

/**
 * The rows immediately after `afterRowId` that share its parent, UP TO the next
 * section at that level — SIMPROK's SUGGESTION for "the items this new Sub
 * Judul was written for".
 *
 * The stop condition is the important half. Offering every following sibling
 * to the end of the document was too greedy: a Sub Judul written half way down
 * a RAB would pre-tick rows that plainly belong to the NEXT Sub Judul, and a
 * suggestion that broad invites an Owner to confirm something they did not
 * read. A section boundary is where one group of work visibly ends, so that is
 * where the proposal ends:
 *
 *     NEW SUB JUDUL
 *     Item A        ← suggested
 *     Item B        ← suggested
 *     NEXT SUB JUDUL   ← stop, not suggested
 *     Item C        ← not suggested
 *
 * A suggested row brings its own descendants with it (they follow their
 * parent), so they are never listed separately.
 *
 * `isSection` is supplied by the caller rather than inferred here: which row
 * types may own children is canonical RAB law, and this module must not hold a
 * second copy of it.
 *
 * This function only proposes. It mutates nothing, and §16 keeps the decision
 * with the human.
 */
export const contiguousFollowingSiblings = <T extends ReparentableRow>(
  rows: readonly T[],
  afterRowId: string,
  isSection: (row: T) => boolean,
): string[] => {
  const anchor = rows.find((row) => row.id === afterRowId);
  if (!anchor) return [];
  const siblings = rows
    .filter((row) => row.parentId === anchor.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const at = siblings.findIndex((row) => row.id === afterRowId);
  if (at < 0) return [];

  const suggested: string[] = [];
  for (const row of siblings.slice(at + 1)) {
    if (isSection(row)) break;
    suggested.push(row.id);
  }
  return suggested;
};

/**
 * Rows ordered so that every parent appears before its own children.
 *
 * `saveDraftBoq` resolves `parentTempId` against a map it fills WHILE walking
 * the incoming array, so a child that arrives before its parent resolves to
 * `null` and is silently re-rooted. The page used to send rows in raw array
 * order, which held only because rows happened to be appended in creation
 * order — re-parenting breaks that assumption, and the corruption is silent.
 *
 * Emitting a depth-first walk makes the payload order a property of the tree
 * instead of a lucky accident. Anything unreachable (a cycle no lawful edit can
 * produce) is appended afterwards rather than dropped: a row saved at the root
 * is recoverable, a row never sent is gone.
 */
export const orderRowsForPersistence = <T extends ReparentableRow>(
  rows: readonly T[],
): T[] => {
  const childrenByParent = new Map<string | null, T[]>();
  const present = new Set(rows.map((row) => row.id));
  for (const row of rows) {
    const key = row.parentId && present.has(row.parentId) ? row.parentId : null;
    childrenByParent.set(key, [...(childrenByParent.get(key) ?? []), row]);
  }
  for (const group of childrenByParent.values()) {
    group.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const ordered: T[] = [];
  const emitted = new Set<string>();
  const walk = (parentId: string | null) => {
    for (const row of childrenByParent.get(parentId) ?? []) {
      if (emitted.has(row.id)) continue;
      emitted.add(row.id);
      ordered.push(row);
      walk(row.id);
    }
  };
  walk(null);

  for (const row of rows) {
    if (!emitted.has(row.id)) ordered.push(row);
  }
  return ordered;
};
