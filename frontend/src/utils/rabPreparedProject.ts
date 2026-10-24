import type { ProjectVocabularyPath } from './projectIntakeVocabulary';

export type RabPreparedProject = {
  name: string;
  code: string;
  description: string;
  workspaceId: string;
  classificationNodeIds: string[];
  classificationVocabularyPaths: ProjectVocabularyPath[];
  locationRegionIds: string[];
  budgetBaseline?: string;
  mainMaterialSpec?: string;
};

/** React history state is provisional UX context, never canonical truth. */
export function readRabPreparedProject(state: unknown): RabPreparedProject | null {
  if (!state || typeof state !== 'object' || !('preparedProject' in state)) return null;
  const p = state.preparedProject;
  if (!p || typeof p !== 'object') return null;
  const q = p as Record<string, unknown>;
  if (typeof q.name !== 'string' || !q.name.trim() ||
      typeof q.code !== 'string' || !q.code.trim() ||
      typeof q.description !== 'string' ||
      typeof q.workspaceId !== 'string' || !q.workspaceId.trim()) return null;
  const isIds = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every((x) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));
  if (!isIds(q.classificationNodeIds) || q.classificationNodeIds.length === 0 ||
      !isIds(q.locationRegionIds) || q.locationRegionIds.length === 0 ||
      !Array.isArray(q.classificationVocabularyPaths) ||
      q.classificationVocabularyPaths.some((v: unknown) =>
        !v || typeof v !== 'object' || typeof (v as { kategori?: unknown }).kategori !== 'string')) return null;
  if (q.budgetBaseline !== undefined && typeof q.budgetBaseline !== 'string') return null;
  if (q.mainMaterialSpec !== undefined && typeof q.mainMaterialSpec !== 'string') return null;
  return q as RabPreparedProject;
}
