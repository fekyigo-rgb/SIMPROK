/**
 * Baseline vocabulary options for the existing classification selector.
 * A vocab id is a selection, not a stored node. Opening the menu does not write.
 */

import { BIDANG, JENIS_PEKERJAAN, subkategoriForBidang } from '../constructionTaxonomy.ts';

export type VocabularyOption = {
  id: string;
  level: string;
  name: string;
  parentId: string | null;
  workspaceId: string | null;
};

const MARK = 'vocab||';

export function vocabularyOptionId(
  level: 'KATEGORI' | 'SUBKATEGORI' | 'JENIS_PEKERJAAN',
  parentId: string,
  name: string,
): string {
  return MARK + level + '||' + parentId + '||' + name;
}

export function isVocabularyOptionId(id: string): boolean {
  return id.startsWith(MARK);
}

function splitVocabularyOption(id: string): { parentId: string; name: string } | null {
  if (!isVocabularyOptionId(id)) return null;
  const body = id.slice(MARK.length);
  const levelSep = body.indexOf('||');
  if (levelSep < 0) return null;
  const rest = body.slice(levelSep + 2);
  const nameSep = rest.lastIndexOf('||');
  if (nameSep < 0) return null;
  const parentId = rest.slice(0, nameSep);
  const name = rest.slice(nameSep + 2);
  if (!parentId || !name) return null;
  return { parentId, name };
}

export function vocabularyOptionParent(id: string): string | null {
  return splitVocabularyOption(id)?.parentId ?? null;
}

export function vocabularyOptionName(id: string): string | null {
  return splitVocabularyOption(id)?.name ?? null;
}

function mergeLevel(input: {
  baseline: readonly string[];
  existing: readonly VocabularyOption[];
  parentId: string;
  level: 'KATEGORI' | 'SUBKATEGORI' | 'JENIS_PEKERJAAN';
}): VocabularyOption[] {
  const out: VocabularyOption[] = [];
  const used = new Set<string>();
  for (const name of input.baseline) {
    const found = input.existing.find(
      (node) =>
        node.level === input.level &&
        node.name === name &&
        node.parentId === input.parentId,
    );
    if (found) {
      out.push(found);
      used.add(found.id);
    } else {
      out.push({
        id: vocabularyOptionId(input.level, input.parentId, name),
        level: input.level,
        name,
        parentId: input.parentId,
        workspaceId: null,
      });
    }
  }
  for (const node of input.existing) {
    if (node.level !== input.level || used.has(node.id)) continue;
    if (input.baseline.includes(node.name)) continue;
    out.push(node);
  }
  return out;
}

export function baselineKategoriOptions(
  existing: readonly VocabularyOption[],
  rootId: string,
): VocabularyOption[] {
  return mergeLevel({
    baseline: BIDANG,
    existing,
    parentId: rootId,
    level: 'KATEGORI',
  });
}

export function baselineSubkategoriOptions(input: {
  kategoriName: string;
  kategoriOptionId: string;
  existing: readonly VocabularyOption[];
}): VocabularyOption[] {
  return mergeLevel({
    baseline: subkategoriForBidang(input.kategoriName),
    existing: input.existing,
    parentId: input.kategoriOptionId,
    level: 'SUBKATEGORI',
  });
}

export function baselineJenisPekerjaanOptions(input: {
  subOptionId: string;
  existing: readonly VocabularyOption[];
}): VocabularyOption[] {
  return mergeLevel({
    baseline: JENIS_PEKERJAAN,
    existing: input.existing,
    parentId: input.subOptionId,
    level: 'JENIS_PEKERJAAN',
  });
}

export function pendingPathFromSelection(input: {
  jenisId: string;
  nameOf: (id: string) => string | null;
  parentOf: (id: string) => string | null;
}): { kategori: string; subkategori: string; jenisPekerjaan: string } | null {
  if (!isVocabularyOptionId(input.jenisId)) return null;
  const jenisPekerjaan = vocabularyOptionName(input.jenisId);
  const subId = vocabularyOptionParent(input.jenisId);
  if (!jenisPekerjaan || !subId) return null;
  const subkategori = input.nameOf(subId);
  const kategoriId = input.parentOf(subId);
  if (!subkategori || !kategoriId) return null;
  const kategori = input.nameOf(kategoriId);
  if (!kategori) return null;
  return { kategori, subkategori, jenisPekerjaan };
}

/**
 * Complete paths only. A selected category or subcategory that has no leaf
 * is not crossed with the other selections.
 */
export function readableClassificationPaths(input: {
  rootName: string | null;
  pendingPaths: ReadonlyArray<{ kategori: string; subkategori: string; jenisPekerjaan: string }>;
  leafIds: ReadonlyArray<string>;
  nameOf: (id: string) => string | null;
  parentOf: (id: string) => string | null;
}): string[] {
  const lines: string[] = [];
  for (const pending of input.pendingPaths) {
    const parts = [input.rootName, pending.kategori, pending.subkategori, pending.jenisPekerjaan].filter(
      (part): part is string => typeof part === 'string' && part !== '',
    );
    if (parts.length > 0) lines.push(parts.join(' \u2192 '));
  }
  for (const leafId of input.leafIds) {
    const names: string[] = [];
    const seen = new Set<string>();
    let cursor: string | null = leafId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const name = input.nameOf(cursor);
      if (name) names.unshift(name);
      cursor = input.parentOf(cursor);
    }
    if (input.rootName) names.unshift(input.rootName);
    if (names.length > 1) lines.push(names.join(' \u2192 '));
  }
  return [...new Set(lines)];
}

export function optionLabel(node: VocabularyOption, baseline: readonly string[]): string {
  if (node.workspaceId && !baseline.includes(node.name)) return node.name + ' (lokal)';
  return node.name;
}
