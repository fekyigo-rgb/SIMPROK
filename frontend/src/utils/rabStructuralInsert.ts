/**
 * RAB-TABLE-UX-01R-FINAL — inserting a row where the Owner chose, not at the end.
 *
 * A RAB is a TREE. `addChild` could only append to the very end of the draft,
 * which is fine for building a list and wrong for editing a document: a new
 * item belonged above row 7, or inside Sub Judul 2, not after row 12.
 *
 * This module answers only one question — which PARENT and which position
 * among that parent's SIBLINGS a new row takes — and then hands the result
 * back to the same rows state everything else already uses. It computes no
 * numbers: `assignStructuralNumbers` remains the single numbering authority,
 * and it derives `1`, `2.3` and so on from exactly the `parentId` + `sortOrder`
 * facts written here.
 *
 * POSITION IS NOT IDENTITY. Re-ordering rewrites `sortOrder`, which is a
 * position, and never an `id`. Every existing row keeps the identity it had, so
 * a row whose visible NO changed from 7 to 8 is still the same BOQ item to the
 * server.
 *
 * SUBTREES MOVE AS ONE. Placement is decided among siblings, never by index in
 * the flattened display list, so inserting "below" a Sub Judul lands after that
 * whole Sub Judul — its children travel with it — instead of being dropped
 * inside somebody else's section.
 */

export type StructuralInsertPosition = 'above' | 'below' | 'inside';

export interface InsertableRow {
  id: string;
  parentId: string | null;
  sortOrder: number;
}

/**
 * Which placements are lawful for a given target row.
 *
 * `inside` is offered only by a row that can actually hold children, so the
 * popup never shows an option that would be refused — an impossible choice is
 * a false door.
 */
export const availableInsertPositions = (
  canHoldChildren: boolean,
): StructuralInsertPosition[] =>
  canHoldChildren ? ['above', 'below', 'inside'] : ['above', 'below'];

/**
 * Places `newRow` relative to `targetId` and returns the complete row set.
 *
 * Only the affected sibling group is renumbered, and it is renumbered densely
 * from 0 so two siblings can never share a `sortOrder` — an ambiguity that
 * would make the visible order depend on array luck. Rows in other groups are
 * returned untouched, object identity and all.
 */
export const insertRowRelativeTo = <T extends InsertableRow>(
  rows: readonly T[],
  targetId: string,
  position: StructuralInsertPosition,
  newRow: T,
): T[] => {
  const target = rows.find((row) => row.id === targetId);
  // Nothing to be relative to: append at root rather than lose the row.
  if (!target) {
    const maxRoot = rows
      .filter((row) => row.parentId === null)
      .reduce((max, row) => Math.max(max, row.sortOrder), -1);
    return [...rows, { ...newRow, parentId: null, sortOrder: maxRoot + 1 }];
  }

  const parentId = position === 'inside' ? target.id : target.parentId;

  const siblings = rows
    .filter((row) => row.parentId === parentId && row.id !== newRow.id)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  let index: number;
  if (position === 'inside') {
    // A new child joins at the end of the section it was added to, which is
    // where a human writing a RAB expects the next line to appear.
    index = siblings.length;
  } else {
    const at = siblings.findIndex((row) => row.id === targetId);
    index = position === 'above' ? at : at + 1;
  }

  const ordered = [...siblings];
  ordered.splice(index, 0, { ...newRow, parentId });

  const sortOrderById = new Map(ordered.map((row, i) => [row.id, i]));
  const placed = { ...newRow, parentId, sortOrder: sortOrderById.get(newRow.id)! };

  return [
    ...rows.map((row) =>
      sortOrderById.has(row.id)
        ? { ...row, sortOrder: sortOrderById.get(row.id)! }
        : row,
    ),
    placed,
  ];
};

/** Every descendant of `rowId`, transitively. Used to describe a delete. */
export const descendantIdsOf = (
  rows: readonly InsertableRow[],
  rowId: string,
): string[] => {
  const found = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (row.id === rowId || found.has(row.id)) continue;
      if (row.parentId === rowId || (row.parentId && found.has(row.parentId))) {
        found.add(row.id);
        changed = true;
      }
    }
  }
  return [...found];
};
