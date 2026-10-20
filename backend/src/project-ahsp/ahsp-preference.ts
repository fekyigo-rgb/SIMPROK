/**
 * RI-01K — preference order on candidates that are already eligible.
 *
 * This is not a matcher and not a score. Eligibility, ownership, publication,
 * pricing date, and unit compatibility stay where they already live. Here a
 * lawful candidate is only placed into an honest band:
 * selected Subkategori, selected Kategori, another canonical category, or
 * missing classification evidence. A category match without a fitting uraian
 * is not a recommendation.
 */

export const AHSP_PREFERENCE_BAND = {
  PREFERRED_SUBKATEGORI: 'PREFERRED_SUBKATEGORI',
  PREFERRED_KATEGORI: 'PREFERRED_KATEGORI',
  CROSS_CATEGORY_FALLBACK: 'CROSS_CATEGORY_FALLBACK',
  INSUFFICIENT_CLASSIFICATION: 'INSUFFICIENT_CLASSIFICATION',
  NOT_RECOMMENDED: 'NOT_RECOMMENDED',
} as const;

export type AhspPreferenceBand =
  (typeof AHSP_PREFERENCE_BAND)[keyof typeof AHSP_PREFERENCE_BAND];

export interface AhspClassificationPathEvidence {
  kategoriId: string | null;
  subkategoriId: string | null;
  jenisPekerjaan: string;
  label: string;
}

export interface AhspPreferenceCandidate {
  workType: string;
  methodName: string;
  unitCompatible: boolean;
  paths: readonly AhspClassificationPathEvidence[];
}

export interface ProjectAhspPreferenceContext {
  selectedKategoriIds: readonly string[];
  selectedSubkategoriIds: readonly string[];
  boqName: string;
}

export interface AhspPreference {
  band: AhspPreferenceBand;
  recommended: boolean;
  reason: string;
  classificationPath: string | null;
}

export type ClassificationNodeLink = {
  id: string;
  name: string;
  level: string;
  parent?: ClassificationNodeLink | null;
};

const TOKEN_STOP = new Set([
  'dan',
  'dari',
  'untuk',
  'dengan',
  'pekerjaan',
  'pada',
  'yang',
  'atau',
  'the',
  'and',
]);

function evidenceTokens(value: string): Set<string> {
  const found = value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
  return new Set(found.filter((token) => !TOKEN_STOP.has(token)));
}

/**
 * Coverage of the BOQ uraian's own words. Not a similarity score.
 *
 * Resource Identity already compares names by token containment and shared
 * stems, and that kernel says those signals may only nominate a row for a
 * person to review. They must not assert an identity. Using them here to
 * mark an AHSP recommended would cross that line, and no other description
 * matcher exists on the RAB path. The gate stays local and conservative:
 * every significant word of the BOQ uraian has to be present in the AHSP
 * work type, method, or Jenis Pekerjaan. One shared word is not a match.
 */
function uraianFits(boqName: string, evidence: string): boolean {
  const wanted = evidenceTokens(boqName);
  if (wanted.size === 0) return false;
  const offered = evidenceTokens(evidence);
  for (const token of wanted) {
    if (!offered.has(token)) return false;
  }
  return true;
}

type PathRelation = 'SUB' | 'KAT' | 'OTHER' | 'NONE';

function pathRelation(
  paths: readonly AhspClassificationPathEvidence[],
  kategoriIds: ReadonlySet<string>,
  subkategoriIds: ReadonlySet<string>,
): PathRelation {
  if (paths.length === 0) return 'NONE';
  if (paths.some((path) => path.subkategoriId && subkategoriIds.has(path.subkategoriId))) {
    return 'SUB';
  }
  if (paths.some((path) => path.kategoriId && kategoriIds.has(path.kategoriId))) {
    return 'KAT';
  }
  return 'OTHER';
}

function governingPath(
  paths: readonly AhspClassificationPathEvidence[],
  relation: PathRelation,
  kategoriIds: ReadonlySet<string>,
  subkategoriIds: ReadonlySet<string>,
): AhspClassificationPathEvidence | null {
  if (relation === 'SUB') {
    return (
      paths.find((path) => path.subkategoriId && subkategoriIds.has(path.subkategoriId)) ??
      null
    );
  }
  if (relation === 'KAT') {
    return paths.find((path) => path.kategoriId && kategoriIds.has(path.kategoriId)) ?? null;
  }
  return paths[0] ?? null;
}

/**
 * Names and ids already stored on the canonical parent chain. A leaf that is
 * not Jenis Pekerjaan contributes nothing — the missing level is not filled in.
 */
export function classificationPathsFromLeaves(
  leaves: ReadonlyArray<ClassificationNodeLink | null | undefined>,
): AhspClassificationPathEvidence[] {
  const paths: AhspClassificationPathEvidence[] = [];
  for (const leaf of leaves) {
    const byLevel: Record<string, { id: string; name: string }> = {};
    let cursor = leaf;
    while (cursor) {
      byLevel[cursor.level] = { id: cursor.id, name: cursor.name };
      cursor = cursor.parent ?? null;
    }
    const jenisPekerjaan = byLevel.JENIS_PEKERJAAN;
    if (!jenisPekerjaan?.name) continue;
    const kategori = byLevel.KATEGORI;
    const subkategori = byLevel.SUBKATEGORI;
    const jenisPengadaan = byLevel.JENIS_PENGADAAN;
    paths.push({
      kategoriId: kategori?.id ?? null,
      subkategoriId: subkategori?.id ?? null,
      jenisPekerjaan: jenisPekerjaan.name,
      label: [jenisPengadaan?.name, kategori?.name, subkategori?.name, jenisPekerjaan.name]
        .filter((part) => Boolean(part))
        .join(' · '),
    });
  }
  return paths;
}

export function rankAhspPreference<T extends AhspPreferenceCandidate>(
  items: readonly T[],
  context: ProjectAhspPreferenceContext,
): Array<T & { preference: AhspPreference }> {
  const kategoriIds = new Set(context.selectedKategoriIds);
  const subkategoriIds = new Set(context.selectedSubkategoriIds);
  const hasProjectPreference = kategoriIds.size > 0;
  const assessed = items.map((item, index) => {
    const relation = pathRelation(item.paths, kategoriIds, subkategoriIds);
    const path = governingPath(item.paths, relation, kategoriIds, subkategoriIds);
    const evidence = [
      item.workType,
      item.methodName,
      ...item.paths.map((entry) => entry.jenisPekerjaan),
    ].join(' ');
    const suitable = item.unitCompatible && uraianFits(context.boqName, evidence);
    return { item, index, relation, path, suitable };
  });
  const preferredAvailable = assessed.some(
    (row) => row.suitable && (row.relation === 'SUB' || row.relation === 'KAT'),
  );
  const placed = assessed.map(({ item, index, relation, path, suitable }) => {
    let band: AhspPreferenceBand = AHSP_PREFERENCE_BAND.NOT_RECOMMENDED;
    let recommended = false;
    let reason = 'Uraian belum cocok. Kategori yang sama tidak cukup untuk rekomendasi.';
    let order = 4;
    if (!item.unitCompatible) {
      reason = 'Satuan keluaran tidak kompatibel. Tidak direkomendasikan.';
    } else if (!suitable) {
      reason = 'Uraian belum cocok. Kategori yang sama tidak cukup untuk rekomendasi.';
    } else if (relation === 'SUB') {
      band = AHSP_PREFERENCE_BAND.PREFERRED_SUBKATEGORI;
      recommended = true;
      reason = 'Sesuai subkategori pilihan dan uraian pekerjaan.';
      order = 0;
    } else if (relation === 'KAT') {
      band = AHSP_PREFERENCE_BAND.PREFERRED_KATEGORI;
      recommended = true;
      reason = 'Sesuai kategori pilihan dan uraian pekerjaan.';
      order = 1;
    } else if (relation === 'OTHER' && hasProjectPreference) {
      band = AHSP_PREFERENCE_BAND.CROSS_CATEGORY_FALLBACK;
      recommended = true;
      reason = preferredAvailable
        ? 'Ada kandidat pada kategori pilihan. Ini alternatif dari kategori lain yang sesuai uraian.'
        : 'Tidak ada kecocokan pada kategori pilihan. Kandidat dari kategori lain yang sesuai uraian.';
      order = 2;
    } else if (relation === 'NONE') {
      band = AHSP_PREFERENCE_BAND.INSUFFICIENT_CLASSIFICATION;
      recommended = false;
      reason =
        'Klasifikasi kanonis AHSP belum tersedia. Kecocokan uraian tidak dijadikan identitas kategori.';
      order = 3;
    } else {
      band = AHSP_PREFERENCE_BAND.INSUFFICIENT_CLASSIFICATION;
      recommended = false;
      reason =
        'Konteks klasifikasi proyek belum dipilih. Jalur AHSP ditampilkan tanpa prioritas kategori.';
      order = 3;
    }
    return {
      item,
      index,
      order,
      preference: {
        band,
        recommended,
        reason,
        classificationPath: path?.label ?? null,
      },
    };
  });
  placed.sort((left, right) => left.order - right.order || left.index - right.index);
  return placed.map(({ item, preference }) => ({ ...item, preference }));
}
