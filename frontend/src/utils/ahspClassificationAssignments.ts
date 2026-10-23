/** Strict read-back validation for the existing classification-assignments API.
 * Extracted from the UI component for React Fast Refresh compliance, unchanged semantics.
 * No persistence and no new taxonomy or writer.
 */
export type ClassificationAssignment = {
  id: string;
  ahspId: string;
  leafNodeId: string;
  provenance: 'SOURCE_DERIVED' | 'HUMAN_ADDED';
  isActive: boolean;
  path: Array<{ id: string; level: string; name: string }>;
  jenisPengadaanRootId: string;
};

export function validatedAssignments(payload: unknown, ahspId: string): ClassificationAssignment[] {
  const levels = ['JENIS_PENGADAAN', 'KATEGORI', 'SUBKATEGORI', 'JENIS_PEKERJAAN'];
  if (!Array.isArray(payload) || payload.some((row) =>
    !row || typeof row.id !== 'string' || !row.id || row.ahspId !== ahspId ||
    row.isActive !== true || !['SOURCE_DERIVED', 'HUMAN_ADDED'].includes(row.provenance) ||
    typeof row.leafNodeId !== 'string' || typeof row.jenisPengadaanRootId !== 'string' ||
    !Array.isArray(row.path) || row.path.length !== 4 ||
    row.path.some((node: { id?: unknown; level?: unknown; name?: unknown }, i: number) =>
      !node || typeof node.id !== 'string' || !node.id ||
      node.level !== levels[i] || typeof node.name !== 'string' || !node.name.trim()) ||
    row.path[0].id !== row.jenisPengadaanRootId || row.path[3].id !== row.leafNodeId ||
    new Set(row.path.map((node: { id: string }) => node.id)).size !== 4
  ) || new Set(payload.map((row) => row.id)).size !== payload.length ||
    new Set(payload.map((row) => row.jenisPengadaanRootId)).size > 1) {
    throw new Error('CLASSIFICATION_READBACK_INVALID');
  }
  return payload as ClassificationAssignment[];
}
