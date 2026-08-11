/**
 * RAB-TRACE-01 — the RAB's structural numbering, in one place.
 *
 * `NO` is the row's official position in the RAB hierarchy: `1`, `1.1`, `1.2`,
 * `2`. The same row must carry the same number wherever the same structure is
 * shown — Ruang Kerja RAB, Ruang Hidup RAB, and any lawful view added later.
 *
 * Ruang Kerja already computed this correctly and Ruang Hidup fell back to the
 * row's position in the response array, so the two rooms could disagree about
 * which row is number 1 the moment a folder or note appeared. Rather than
 * teach the viewer the same rules a second time, the rule moved here and both
 * rooms ask it. There is no second algorithm to keep in step.
 *
 * The shape is deliberately minimal: anything with an id, a parent, a sort
 * order and a note flag can be numbered, so neither room has to convert its
 * rows into the other's model to get an answer.
 */

export interface NumberableRow {
  id: string;
  parentId: string | null;
  sortOrder: number;
  /** Notes are annotations, not numbered positions in the hierarchy. */
  isNote: boolean;
}

export interface StructuralNumber {
  /** '' for a note — it holds no official position. */
  number: string;
  /** Nesting level, 0 for a root row. */
  depth: number;
}

/**
 * Numbers rows depth-first in sortOrder, exactly as Ruang Kerja always has.
 *
 * A note keeps its place in the walk — so it can still be nested and still
 * pushes nothing out of order — but takes no number of its own. Rows whose
 * parent is missing from the input are treated as roots rather than dropped:
 * a row nobody can see is worse than a row numbered conservatively.
 */
export const assignStructuralNumbers = <T extends NumberableRow>(
  rows: readonly T[],
): Array<T & StructuralNumber> => {
  const sorted = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const present = new Set(sorted.map((row) => row.id));

  const childrenByParent = sorted.reduce<Record<string, T[]>>((acc, row) => {
    const key = row.parentId && present.has(row.parentId) ? row.parentId : 'root';
    acc[key] = [...(acc[key] || []), row];
    return acc;
  }, {});

  const result: Array<T & StructuralNumber> = [];
  const visited = new Set<string>();

  const visit = (parentId: string | null, prefix: number[], depth: number) => {
    const children = childrenByParent[parentId || 'root'] || [];
    children.forEach((row, index) => {
      // A parent cycle would otherwise recurse forever; the row is still shown.
      if (visited.has(row.id)) return;
      visited.add(row.id);

      const numberParts = [...prefix, index + 1];
      result.push({
        ...row,
        number: row.isNote ? '' : numberParts.join('.'),
        depth,
      });
      visit(row.id, numberParts, depth + 1);
    });
  };

  visit(null, [], 0);
  return result;
};
