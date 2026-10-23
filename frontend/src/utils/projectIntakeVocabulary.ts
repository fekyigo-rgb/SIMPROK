import {
  baselineKategoriOptions,
  baselineSubkategoriOptions,
  isVocabularyOptionId,
  type VocabularyOption,
} from './ahspBaselineVocabulary.ts';
import {
  type IntakeClassificationSelection,
  type IntakeClassificationPick,
  type ProjectClassificationNode,
} from './projectIntakeSelection.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Stable round-trip for mixed persisted UUIDs and vocabulary-only IDs
// (which themselves contain ||). Never split these IDs on punctuation.
export function projectKategoriSelectionKey(picks: readonly { id: string; level: string }[]): string {
  return JSON.stringify(picks.filter((pick) => pick.level === 'KATEGORI').map((pick) => pick.id));
}

export function projectKategoriIdsFromKey(key: string): string[] {
  return JSON.parse(key) as string[];
}

export type ProjectVocabularyPath = {
  kategori: string;
  subkategori?: string;
};

function asVocabulary(nodes: readonly ProjectClassificationNode[]): VocabularyOption[] {
  return nodes.map((node) => ({ ...node, workspaceId: null }));
}

function asProject(nodes: readonly VocabularyOption[]): ProjectClassificationNode[] {
  return nodes.map(({ id, name, parentId, level }) => ({
    id, name, parentId, level,
  }));
}

// The AHSP picker owns this already-proven vocabulary merge. RAB reuses it;
// synthetic option ids are ONLY display choices, never persisted as node IDs.
export function projectKategoriOptions(
  stored: readonly ProjectClassificationNode[],
  rootId: string,
): ProjectClassificationNode[] {
  return asProject(baselineKategoriOptions(asVocabulary(stored), rootId));
}

export function projectSubkategoriOptions(
  stored: readonly ProjectClassificationNode[],
  kategori: ProjectClassificationNode,
): ProjectClassificationNode[] {
  return asProject(baselineSubkategoriOptions({
    kategoriName: kategori.name,
    kategoriOptionId: kategori.id,
    existing: asVocabulary(stored),
  }));
}

export function toggleProjectClassification(
  selection: IntakeClassificationSelection,
  pick: IntakeClassificationPick,
): IntakeClassificationSelection {
  // One mixed selection must preserve both already-persisted UUID nodes
  // and vocabulary-only choices. The old UUID-only toggle discards virtual
  // neighbours during pruning, so all choices share this bounded toggle.
  const isChoiceId = (id: string) => UUID.test(id) || isVocabularyOptionId(id);
  if (!isChoiceId(pick.id) || !isChoiceId(pick.parentId)) return selection;
  const rootId = selection.root?.id;
  if (!rootId || !UUID.test(rootId)) return selection;
  const parents = selection.picks.filter((item) => item.level === 'KATEGORI');
  if (pick.level === 'KATEGORI' && pick.parentId !== rootId) return selection;
  if (pick.level === 'SUBKATEGORI' && !parents.some((item) => item.id === pick.parentId)) {
    return selection;
  }
  const exists = selection.picks.some((item) => item.id === pick.id);
  const next = selection.picks.filter(
    (item) => item.id !== pick.id && !(exists && pick.level === 'KATEGORI' && item.parentId === pick.id),
  );
  if (!exists) next.push(pick);
  return { root: selection.root, picks: next };
}

export function projectClassificationCreateSelection(
  selection: IntakeClassificationSelection,
  children: Readonly<Record<string, { loaded: boolean; nodes: ProjectClassificationNode[] }>>,
): {
  classificationNodeIds: string[] | null;
  classificationVocabularyPaths: ProjectVocabularyPath[];
  waitingForChildren: boolean;
} {
  if (!selection.root || !UUID.test(selection.root.id)) {
    return { classificationNodeIds: null, classificationVocabularyPaths: [], waitingForChildren: false };
  }
  const categories = selection.picks.filter(
    (pick) => pick.level === 'KATEGORI' && pick.parentId === selection.root?.id,
  );
  if (categories.length === 0) {
    return { classificationNodeIds: null, classificationVocabularyPaths: [], waitingForChildren: false };
  }
  const waiting = categories.some((cat) => !children[cat.id]?.loaded);
  const ids = [selection.root.id];
  const paths: ProjectVocabularyPath[] = [];
  for (const category of categories) {
    if (UUID.test(category.id)) ids.push(category.id);
    const selectedSubs = selection.picks.filter(
      (pick) => pick.level === 'SUBKATEGORI' && pick.parentId === category.id &&
        children[category.id]?.nodes.some((child) => child.id === pick.id),
    );
    for (const sub of selectedSubs) {
      if (UUID.test(sub.id)) ids.push(sub.id);
      else if (isVocabularyOptionId(sub.id)) paths.push({
        kategori: category.name,
        subkategori: sub.name,
      });
    }
    if (isVocabularyOptionId(category.id) && selectedSubs.length === 0) {
      paths.push({ kategori: category.name });
    }
  }
  return {
    classificationNodeIds: [...new Set(ids)],
    classificationVocabularyPaths: paths,
    waitingForChildren: waiting,
  };
}
