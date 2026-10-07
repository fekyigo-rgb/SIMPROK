/**
 * Jenis Pekerjaan menu interaction only.
 * Checking an existing option keeps every prior id and asks the current menu to close.
 * Unchecking does not close the menu and does not drop the other ids.
 */

export function nextJenisSelection(
  selected: ReadonlySet<string>,
  id: string,
): { ids: Set<string>; closeMenu: boolean } {
  const ids = new Set(selected);
  const already = ids.has(id);
  if (already) ids.delete(id);
  else ids.add(id);
  return { ids, closeMenu: !already };
}
