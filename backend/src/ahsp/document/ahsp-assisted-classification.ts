/**
 * Product Law v1.4 — assisted Import classification context.
 * Lives on AHSPImportJob before AHSP id exists; applied via AssignmentService after.
 * UX maps FROM_SOURCE → "Dari file", FROM_USER → "Ditambahkan pengguna".
 */

export type AssistedPathProvenanceHint = 'FROM_SOURCE' | 'FROM_USER';

/** One lawful path tip = Jenis Pekerjaan leaf. Ancestors derived via lineage. */
export type AssistedClassificationPathDeclaration = {
  leafNodeId: string;
  provenanceHint: AssistedPathProvenanceHint;
  /** Preserve source wording/code if understood — never erase. */
  sourceEvidence?: {
    label?: string | null;
    code?: string | null;
    raw?: string | null;
  } | null;
};

/**
 * Job-level assisted context. Jenis Pengadaan is single-valued for now.
 * Paths may be many. Dasar ≠ Penerbit ≠ Sumber Data.
 */
export type AssistedClassificationContext = {
  jenisPengadaanRootId: string | null;
  paths: AssistedClassificationPathDeclaration[];
  /** Maps to AHSPVersion.regulationReference (Dasar / Acuan). */
  dasarAcuan: string | null;
  /** Maps to AHSPVersion.issuerInstitution (Penerbit / Instansi Sumber). */
  penerbit: string | null;
};

export function emptyAssistedClassificationContext(): AssistedClassificationContext {
  return {
    jenisPengadaanRootId: null,
    paths: [],
    dasarAcuan: null,
    penerbit: null,
  };
}

export function parseAssistedClassificationContext(
  raw: unknown,
): AssistedClassificationContext | null {
  if (raw == null || raw === '') return null;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const pathsRaw = obj.paths;
  const paths: AssistedClassificationPathDeclaration[] = [];
  if (Array.isArray(pathsRaw)) {
    for (const p of pathsRaw) {
      if (typeof p !== 'object' || p === null) continue;
      const row = p as Record<string, unknown>;
      const leafNodeId =
        typeof row.leafNodeId === 'string' ? row.leafNodeId.trim() : '';
      if (!leafNodeId) continue;
      const hint = row.provenanceHint;
      const provenanceHint: AssistedPathProvenanceHint =
        hint === 'FROM_SOURCE' ? 'FROM_SOURCE' : 'FROM_USER';
      const evidence =
        row.sourceEvidence &&
        typeof row.sourceEvidence === 'object' &&
        !Array.isArray(row.sourceEvidence)
          ? (row.sourceEvidence as AssistedClassificationPathDeclaration['sourceEvidence'])
          : null;
      paths.push({ leafNodeId, provenanceHint, sourceEvidence: evidence });
    }
  }
  return {
    jenisPengadaanRootId:
      typeof obj.jenisPengadaanRootId === 'string' &&
      obj.jenisPengadaanRootId.trim() !== ''
        ? obj.jenisPengadaanRootId.trim()
        : null,
    paths,
    dasarAcuan:
      typeof obj.dasarAcuan === 'string' && obj.dasarAcuan.trim() !== ''
        ? obj.dasarAcuan.trim()
        : null,
    penerbit:
      typeof obj.penerbit === 'string' && obj.penerbit.trim() !== ''
        ? obj.penerbit.trim()
        : null,
  };
}
