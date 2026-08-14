import { BadRequestException, ConflictException } from '@nestjs/common';
import { SERVER_ROW_PROTECTION_REASON } from './rab-kernel-persistence.contracts';

/**
 * RAB-FOCUS-01 §4–§7 — the server's own structural authority.
 *
 * saveDraftBoq resolved `parentTempId` against a map it filled WHILE inserting,
 * so a parent that had not been reached yet — or did not exist at all — quietly
 * became `null` and the row was persisted at the root. That turned malformed
 * structural truth into a DIFFERENT, plausible-looking structural truth, which
 * is the one outcome a persistence boundary must never produce.
 *
 * Two responsibilities that were previously entangled are separated here (§22):
 *
 *   VALIDATION  understands the WHOLE incoming graph before anything is written,
 *               so a child listed before its parent is perfectly legal;
 *   ORDERING    then emits that same graph parent-first, because the insert loop
 *               genuinely needs a parent row to exist before its children.
 *
 * The frontend's `orderRowsForPersistence` remains a courtesy that keeps ordinary
 * payloads tidy. It is NOT the integrity boundary: everything below assumes the
 * client may be stale, buggy, or bypassed entirely.
 *
 * Nothing here reads or writes the database. It is called before the first
 * destructive statement, so a rejection costs the RAB nothing.
 */

export const RAB_STRUCTURE_REASON = {
  /** A `parentTempId` naming a row that is not in this payload. */
  PARENT_NOT_FOUND: 'RAB_STRUCTURE_PARENT_NOT_FOUND',
  /** A row naming itself as its own parent. */
  SELF_PARENT: 'RAB_STRUCTURE_SELF_PARENT',
  /** A parent chain that never reaches a root. */
  CYCLE: 'RAB_STRUCTURE_CYCLE',
  /** A parent that canonical RAB law does not allow to own children. */
  INVALID_PARENT_TYPE: 'RAB_STRUCTURE_INVALID_PARENT_TYPE',
  /** Two siblings both explicitly claiming the same position. */
  AMBIGUOUS_ORDER: 'RAB_STRUCTURE_AMBIGUOUS_ORDER',
  /** A row identity that is blank or whitespace, and so cannot be referred to. */
  BLANK_TEMP_ID: 'RAB_STRUCTURE_BLANK_TEMP_ID',
} as const;

/**
 * Canonical RAB law, audited from the product rather than invented here: only a
 * Sub Judul owns children. `indentRow` refuses any other parent and the insert
 * menu offers "inside" only for a folder, so a WORK_ITEM parent cannot be
 * produced by lawful editing — and no persisted row has one (audited: 0).
 */
const PARENT_CAPABLE_ITEM_TYPES = new Set(['FOLDER']);

export interface StructuralRow {
  tempId: string;
  parentTempId?: string | null;
  itemType: string;
  sortOrder?: number;
}

/**
 * A validated row, carrying the position it held in the original payload and —
 * decisively — the ONE order value that must reach the database.
 *
 * `effectiveSortOrder` exists so that validation and persistence cannot drift
 * apart. The save path used to re-derive `row.sortOrder ?? index` after the
 * check had already run, which meant S7 was inspecting a different number from
 * the one being written: a row that omitted `sortOrder` was never compared
 * against a sibling that explicitly claimed the index it would fall back to.
 *
 * Whatever this field holds is what `BoqItem.sortOrder` receives.
 */
export type OrderedStructuralRow<T> = {
  row: T;
  payloadIndex: number;
  effectiveSortOrder: number;
};

/**
 * The order a row will actually be persisted with.
 *
 * This is the EXISTING contract, read from the save path rather than invented
 * here: an explicit `sortOrder` wins, and an omitted one falls back to the
 * row's position in the incoming payload. Clients that leave `sortOrder` out
 * keep working exactly as before; nothing is densified, and nothing new is
 * required of them.
 */
const resolveEffectiveSortOrder = (
  row: StructuralRow,
  payloadIndex: number,
): number =>
  row.sortOrder === undefined || row.sortOrder === null
    ? payloadIndex
    : row.sortOrder;

/**
 * Validates the whole incoming structure, then returns it parent-first.
 *
 * Throws before returning if the structure is unsound; the caller has not
 * written anything at that point, so rejection is inherently zero-mutation.
 */
export const validateAndOrderRabStructure = <T extends StructuralRow>(
  rows: readonly T[],
): Array<OrderedStructuralRow<T>> => {
  // Resolved ONCE, here, and never recomputed downstream.
  const indexed: Array<OrderedStructuralRow<T>> = rows.map((row, payloadIndex) => ({
    row,
    payloadIndex,
    effectiveSortOrder: resolveEffectiveSortOrder(row, payloadIndex),
  }));

  // ── S1: identity. Also enforced by saveDraftBoq's own §4.1 guard; repeated
  // here so this validator is independently sound wherever it is called, and
  // raising the identical reason so the wire contract is unchanged.
  const byTempId = new Map<string, OrderedStructuralRow<T>>();
  for (const entry of indexed) {
    // An identity that is blank, or only whitespace, cannot be referred to
    // meaningfully. Accepting it would let a `parentTempId` of "" mean either
    // "this row" or "no parent" depending on which branch saw it first —
    // exactly the silent reinterpretation this validator exists to prevent.
    if (
      typeof entry.row.tempId !== 'string' ||
      entry.row.tempId.trim() === ''
    ) {
      throw new BadRequestException(RAB_STRUCTURE_REASON.BLANK_TEMP_ID);
    }
    if (byTempId.has(entry.row.tempId)) {
      throw new ConflictException(SERVER_ROW_PROTECTION_REASON.DUPLICATE_TEMP_ID);
    }
    byTempId.set(entry.row.tempId, entry);
  }

  /**
   * "This row has no parent" is `null`/`undefined` and nothing else.
   *
   * A blank string is not a way of saying "root" — no row may carry a blank
   * identity, so a blank reference can never resolve, and it is reported as
   * the missing parent it is rather than quietly promoting the row to the top
   * of the document.
   */
  const parentReferenceOf = (row: StructuralRow): string | null =>
    row.parentTempId === null || row.parentTempId === undefined
      ? null
      : row.parentTempId;

  for (const { row } of indexed) {
    const parentTempId = parentReferenceOf(row);
    if (parentTempId === null) continue;

    // ── S3: a row cannot be its own parent.
    if (parentTempId === row.tempId) {
      throw new BadRequestException(RAB_STRUCTURE_REASON.SELF_PARENT);
    }

    // ── S2 + S5: the parent must exist IN THIS PAYLOAD. Because the only
    // candidates are this document's own rows, a parent belonging to another
    // project, workspace or BOQ structure is unreachable by construction —
    // there is no id space in which to name it.
    const parent = byTempId.get(parentTempId);
    if (!parent) {
      throw new BadRequestException(RAB_STRUCTURE_REASON.PARENT_NOT_FOUND);
    }

    // ── S6: only a Sub Judul may own children.
    if (!PARENT_CAPABLE_ITEM_TYPES.has(parent.row.itemType)) {
      throw new BadRequestException(RAB_STRUCTURE_REASON.INVALID_PARENT_TYPE);
    }
  }

  // ── S4: every parent chain must reach a root. Iterative three-colour walk —
  // each row is entered once, so a deep RAB cannot exhaust the stack and a
  // cycle is found without re-walking the tree per row.
  const UNVISITED = 0, ON_PATH = 1, SETTLED = 2;
  const state = new Map<string, number>();
  for (const { row } of indexed) {
    if (state.get(row.tempId) === SETTLED) continue;

    const path: string[] = [];
    let cursor: string | undefined = row.tempId;
    while (cursor !== undefined) {
      const seen = state.get(cursor) ?? UNVISITED;
      if (seen === SETTLED) break;
      if (seen === ON_PATH) {
        throw new BadRequestException(RAB_STRUCTURE_REASON.CYCLE);
      }
      state.set(cursor, ON_PATH);
      path.push(cursor);
      cursor = parentReferenceOf(byTempId.get(cursor)!.row) ?? undefined;
    }
    for (const id of path) state.set(id, SETTLED);
  }

  // ── S7: no two siblings may LAND ON the same position.
  //
  // The test is the EFFECTIVE order — the number that will actually be written
  // — not merely the number a row stated. Checking only explicit claims left a
  // gap: a row that omits `sortOrder` still resolves to one, and if that
  // resolved value equals a sibling's explicit claim, two rows are persisted
  // into a single slot and the visible order becomes a matter of luck.
  //
  // The check is per SIBLING GROUP, never global: two rows under different
  // parents may hold the same position, because position means "where among my
  // own siblings".
  /**
   * Sibling groups keyed by parent, where `null` — and only `null` — is the
   * root group.
   *
   * The key space here belongs to the CLIENT, so it must never be borrowed for
   * an internal marker. A string sentinel such as "ROOT" is indistinguishable
   * from a row a client legitimately named "ROOT": that row would be handed
   * the document's own root rows as its children, and the walk below would
   * revisit them. `null` cannot be a `tempId`, so the internal bucket and real
   * identity can never collide.
   */
  const groups = new Map<string | null, OrderedStructuralRow<T>[]>();
  for (const entry of indexed) {
    const key = parentReferenceOf(entry.row);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  for (const siblings of groups.values()) {
    const taken = new Set<number>();
    for (const { effectiveSortOrder } of siblings) {
      if (taken.has(effectiveSortOrder)) {
        throw new BadRequestException(RAB_STRUCTURE_REASON.AMBIGUOUS_ORDER);
      }
      taken.add(effectiveSortOrder);
    }
  }

  // ── Ordering. Sound graph, so a depth-first walk from the roots emits every
  // parent before its children whatever order the payload arrived in. Siblings
  // are ranked by the same effective order S7 just proved unique, so the walk
  // reads the RAB in exactly the sequence it will be stored in. The payload
  // index remains a total-order tiebreak; after S7 it can never be reached
  // within a group, and it keeps the sort deterministic regardless.
  for (const siblings of groups.values()) {
    siblings.sort((a, b) =>
      a.effectiveSortOrder === b.effectiveSortOrder
        ? a.payloadIndex - b.payloadIndex
        : a.effectiveSortOrder - b.effectiveSortOrder,
    );
  }

  const ordered: Array<OrderedStructuralRow<T>> = [];
  const stack = [...(groups.get(null) ?? [])].reverse();
  while (stack.length > 0) {
    const entry = stack.pop()!;
    ordered.push(entry);
    const children = groups.get(entry.row.tempId);
    if (children) {
      for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
    }
  }

  // A validated forest reaches every row from a root; this is a belt on that
  // brace, so a future change can never silently drop rows from the payload.
  if (ordered.length !== indexed.length) {
    throw new BadRequestException(RAB_STRUCTURE_REASON.CYCLE);
  }

  return ordered;
};
