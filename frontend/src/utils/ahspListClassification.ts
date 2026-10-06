/**
 * List classification meaning.
 * A stored assignment path is current. Legacy text is readable only when no path exists.
 */

export type ListClassificationPath = {
  jenisPengadaan: string;
  kategori: string;
  subkategori: string;
  jenisPekerjaan: string;
};

export type ListClassificationRow = {
  classification?: string | null;
  fieldCategory?: string | null;
  subCategory?: string | null;
  workType?: string | null;
  classificationPaths?: readonly ListClassificationPath[] | null;
};

export function canonicalPaths(
  row: ListClassificationRow,
): readonly ListClassificationPath[] {
  return Array.isArray(row.classificationPaths) ? row.classificationPaths : [];
}

export function rowHasCanonicalPath(row: ListClassificationRow): boolean {
  return canonicalPaths(row).length > 0;
}

export function rowMatchesClassificationFilter(
  row: ListClassificationRow,
  filter: {
    jenisPengadaan?: string;
    kategori?: string;
    subkategori?: string;
    jenisPekerjaan?: string;
    legacyWorkType?: string | null;
  },
): boolean {
  const paths = canonicalPaths(row);
  if (paths.length > 0) {
    return paths.some((path) => {
      if (filter.jenisPengadaan && path.jenisPengadaan !== filter.jenisPengadaan) return false;
      if (filter.kategori && path.kategori !== filter.kategori) return false;
      if (filter.subkategori && path.subkategori !== filter.subkategori) return false;
      if (filter.jenisPekerjaan && path.jenisPekerjaan !== filter.jenisPekerjaan) return false;
      return true;
    });
  }
  if (filter.jenisPengadaan) {
    const cls = (row.classification ?? '').trim();
    if (cls !== '' && cls !== filter.jenisPengadaan) return false;
  }
  if (filter.kategori && (row.fieldCategory ?? '') !== filter.kategori) return false;
  if (filter.subkategori && (row.subCategory ?? '') !== filter.subkategori) return false;
  if (filter.jenisPekerjaan && (filter.legacyWorkType ?? '') !== filter.jenisPekerjaan) return false;
  return true;
}
