/**
 * ACG-01 OWNER BROWSER GAP — how an AHSP's identity columns are NAMED to a reader.
 *
 * `workType` is the column AHSP identity is keyed on. The document importer puts
 * the source's own item code there (its title cell's code, e.g. "1.7.7.1.1.b (a)"),
 * while "Buat AHSP milik saya" puts the Jenis pekerjaan a person typed. Since
 * ACG-01 CLOSURE 2 the importer ALSO records that code as `code`, so a row whose
 * recorded code equals its `workType` says, in its own data, "this value is the
 * code". Rendering it again under "Jenis Pekerjaan" would call a code a work type.
 *
 * ONLY RECORDED TRUTH (Owner ruling). A row whose `code` was never recorded is
 * shown exactly as stored: no shape rule, no guess about where it came from. The
 * source states no Jenis Pekerjaan for an imported item, so none is invented —
 * the column reads "—". Nothing here edits, re-keys or back-fills a row.
 */

export interface AhspIdentityWire {
  code?: string | null;
  workType?: string | null;
}

export interface AhspIdentityColumns {
  /** The code SIMPROK recorded, or null. */
  code: string | null;
  /** The Jenis Pekerjaan to show, or null when the stored value is really the code. */
  workType: string | null;
}

const present = (value: string | null | undefined): string | null =>
  value == null || value === '' ? null : value;

export const presentAhspIdentity = (row: AhspIdentityWire): AhspIdentityColumns => {
  const code = present(row.code);
  const workType = present(row.workType);
  // Byte-exact, like AHSP identity itself: the importer writes the same string
  // to both columns, and anything less exact would be a reinterpretation.
  return { code, workType: code !== null && workType === code ? null : workType };
};
