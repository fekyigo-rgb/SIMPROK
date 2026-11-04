/**
 * PR205 — optional confirmed identity specifications.
 * This is a typed evidence vocabulary, NOT an alternative identity engine.
 * No dimension conversion, no guessed brand aliases beyond exact header names.
 * The identity kernel is the one consumer of this comparison.
 */
const SPEC_KEYS: Record<string, string> = {
  merek: 'merek', merk: 'merek', brand: 'merek',
  tipe: 'tipe', 'tipe/model': 'tipe', 'tipe model': 'tipe', type: 'tipe', model: 'tipe',
  ukuran: 'ukuran', dimensi: 'dimensi', diameter: 'diameter',
  panjang: 'panjang', lebar: 'lebar', tinggi: 'tinggi',
  volume: 'volume', berat: 'berat',
  warna: 'warna', mutu: 'mutu', standar: 'standar', standard: 'standar',
  kapasitas: 'kapasitas',
  // Open-ended supplier details are evidence, not proof of technical identity.
  spesifikasi: 'spesifikasi', 'spesifikasi tambahan': 'spesifikasi',
  // Verbatim supplier headings, NOT verified quality standards or product identity.
  'mutu dan standar': 'mutu_dan_standar_sumber',
  mutu_dan_standar_sumber: 'mutu_dan_standar_sumber',
  'jenis/kegunaan': 'jenis_kegunaan_sumber',
  jenis_kegunaan_sumber: 'jenis_kegunaan_sumber',
  // Confirmed, explicit use/function context. These remain qualitative facts;
  // unlike definitive types/brands, different wording alone cannot prove
  // a technical conflict or permit silent re-identification.
  lingkungan: 'lingkungan', kondisi: 'kondisi',
  penggunaan: 'penggunaan', peruntukan: 'peruntukan',
  fungsi: 'fungsi', metode: 'metode', kompetensi: 'kompetensi',
  penempatan: 'penempatan', ketahanan: 'ketahanan',
};

export type ConfirmedResourceSpecifications = Record<string, string>;

export function confirmedSpecifications(input: unknown): ConfirmedResourceSpecifications | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const fields: ConfirmedResourceSpecifications = {};
  const raw = Object.entries(input);
  if (raw.length === 0 || raw.length > 20) return null;
  for (const [key, value] of raw) {
    const canonical = SPEC_KEYS[key.trim().toLocaleLowerCase('id-ID')];
    if (!canonical || typeof value !== 'string' || !value.trim() || value.trim().length > 240) return null;
    const text = value.trim().replace(/\s+/gu, ' ');
    if (Object.hasOwn(fields, canonical) && fields[canonical].toLocaleLowerCase('id-ID') !== text.toLocaleLowerCase('id-ID')) return null;
    fields[canonical] = text;
  }
  return Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Conflict requires TWO positive, different statements about the same
 * known technical attribute; missing data is never proof of difference.
 * Exact match requires identical named keys AND values. "5/7" and
 * "50x70 mm" are UNKNOWN, never automatically treated as equivalents.
 */
export function compareConfirmedSpecifications(
  source: ConfirmedResourceSpecifications,
  candidate: unknown,
): 'MATCH' | 'CONFLICT' | 'UNKNOWN' {
  const knownRaw = confirmedSpecifications(candidate);
  if (!knownRaw) return 'UNKNOWN';
  // Format A supplies literal "semua merk" for generic resources such as
  // Dump Truck. This means ANY brand is allowed, not that "semua merk" is
  // itself a manufacturer's brand. Preserve the exact source/audit facts and
  // omit ONLY this non-specific brand from identity comparison. In particular
  // a known Mitsubishi brand is NOT a conflict with "semua merk"; nor may
  // two generic brand placeholders prove that two resources are identical.
  const isAnyBrandScope = (value: string) =>
    /^semua\s+mer(?:e)?k$/iu.test(value.trim());
  const withoutGenericBrandScope = (facts: ConfirmedResourceSpecifications) =>
    Object.fromEntries(Object.entries(facts).filter(([key, value]) =>
      key !== 'merek' || !isAnyBrandScope(value)));
  const reviewed = withoutGenericBrandScope(source);
  const known = withoutGenericBrandScope(knownRaw);
  if (Object.keys(reviewed).length === 0) return 'UNKNOWN';
  // UNKNOWN is not a terminal verdict: another reviewed typed fact may still
  // prove a definite CONFLICT. Visit every fact before granting equivalence.
  let hasUncertainty = false;
  for (const [key, value] of Object.entries(reviewed)) {
    if (!Object.hasOwn(known, key)) { hasUncertainty = true; continue; }
    if (known[key].toLocaleLowerCase('id-ID') === value.toLocaleLowerCase('id-ID')) continue;
    // A size in cm and one in mm MAY be equivalent. A dash can be a range.
    // Only same-unit, unambiguous numerical dimensions establish difference.
    if (key === 'ukuran' || key === 'dimensi') {
      const pattern = /^(\d+(?:[.,]\d+)?)\s*[/x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)$/iu;
      const a = pattern.exec(value);
      const b = pattern.exec(known[key]);
      if (!a || !b || a[3].toLowerCase() !== b[3].toLowerCase()) {
        hasUncertainty = true;
        continue;
      }
      if (Number(a[1].replace(',', '.')) !== Number(b[1].replace(',', '.')) ||
          Number(a[2].replace(',', '.')) !== Number(b[2].replace(',', '.'))) return 'CONFLICT';
      hasUncertainty = true;
      continue;
    }
    // Two REVIEWED physical measurements with the same literal unit
    // cannot describe an identical product variant when their values differ.
    // This is a conflict test, NOT a quantity converter. Unknown units,
    // compound descriptions, different units or ambiguous number formats
    // remain UNKNOWN; the canonical Unit Kernel owns conversions.
    if (key === 'diameter' || key === 'panjang' || key === 'lebar' ||
        key === 'tinggi' || key === 'volume' || key === 'berat') {
      const measure = /^(\d+(?:[.,]\d+)?)\s*(mm|cm|m|m2|m3|kg|g|ton|t|liter|l|ml|cc)$/iu;
      const a = measure.exec(value);
      const b = measure.exec(known[key]);
      if (!a || !b || a[2].toLowerCase() !== b[2].toLowerCase()) {
        hasUncertainty = true;
        continue;
      }
      // A period/comma followed by three digits may be a thousands separator
      // in supplier data, so never interpret that spelling as a decimal here.
      if ([a[1], b[1]].some(number => /[.,]\d{3}$/u.test(number))) {
        hasUncertainty = true;
        continue;
      }
      const first = Number(a[1].replace(',', '.'));
      const second = Number(b[1].replace(',', '.'));
      if (first !== second) return 'CONFLICT';
      hasUncertainty = true;
      continue;
    }
    if (key === 'spesifikasi' || key === 'mutu_dan_standar_sumber' ||
        key === 'jenis_kegunaan_sumber' || key === 'kapasitas' ||
        key === 'lingkungan' || key === 'kondisi' ||
        key === 'penggunaan' || key === 'peruntukan' ||
        key === 'fungsi' || key === 'metode' || key === 'kompetensi' ||
        key === 'penempatan' || key === 'ketahanan') {
      hasUncertainty = true;
      continue;
    }
    return 'CONFLICT';
  }
  // No unresolved detail may be promoted into a canonical MATCH.
  if (hasUncertainty) return 'UNKNOWN';
  // Source-only supplier attributes are unverified evidence, not certified
  // grades. Missing such evidence on EITHER side cannot prove equivalence;
  // different wording remains UNKNOWN, while typed conflicts still win above.
  const isSupplierOnly = (key: string) => key === 'spesifikasi' ||
    key === 'mutu_dan_standar_sumber' || key === 'jenis_kegunaan_sumber';
  if (['spesifikasi', 'mutu_dan_standar_sumber', 'jenis_kegunaan_sumber'].some(
    key => Object.hasOwn(reviewed, key) !== Object.hasOwn(known, key))) return 'UNKNOWN';
  const identityKeys = Object.keys(reviewed).filter(key => !isSupplierOnly(key));
  const knownIdentityKeys = Object.keys(known).filter(key => !isSupplierOnly(key));
  // Equal capacity alone is not a sufficient identity proof for equipment:
  // other technical variants may still differ. Keep the source as a candidate.
  if (identityKeys.length === 1 && identityKeys[0] === 'kapasitas') return 'UNKNOWN';
  if (identityKeys.length > 0 && identityKeys.length === knownIdentityKeys.length &&
    identityKeys.every(key => Object.hasOwn(known, key) &&
      known[key].toLocaleLowerCase('id-ID') === reviewed[key].toLocaleLowerCase('id-ID'))) return 'MATCH';
  return 'UNKNOWN';
}


/**
 * Guard a human-entered source qualifier without inventing new specifications.
 * This is only positive literal document evidence; the shared identity kernel
 * decides whether it proves a distinct resource against the live candidates.
 */
export function sourceStatedSpecifications(
  originalDesignation: string,
  supplied: unknown,
  reason?: string | null,
): ConfirmedResourceSpecifications | null {
  if (!reason?.trim() || reason.length > 500) return null;
  const specs = confirmedSpecifications(supplied);
  if (!specs) return null;
  const visible = originalDesignation.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('id-ID');
  if (!Object.values(specs).every((value) =>
    visible.includes(value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('id-ID')))) {
    return null;
  }
  return specs;
}
