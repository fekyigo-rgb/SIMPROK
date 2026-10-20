/**
 * PR205 — optional confirmed identity specifications.
 * This is a typed evidence vocabulary, NOT an alternative identity engine.
 * No dimension conversion, no guessed brand aliases beyond exact header names.
 * The identity kernel is the one consumer of this comparison.
 */
const SPEC_KEYS: Record<string, string> = {
  merek: 'merek', merk: 'merek', brand: 'merek',
  tipe: 'tipe', type: 'tipe', model: 'tipe',
  ukuran: 'ukuran', dimensi: 'dimensi', diameter: 'diameter',
  warna: 'warna', mutu: 'mutu', standar: 'standar', standard: 'standar',
  kapasitas: 'kapasitas',
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
  const known = confirmedSpecifications(candidate);
  if (!known) return 'UNKNOWN';
  for (const [key, value] of Object.entries(source)) {
    if (!Object.hasOwn(known, key) || known[key].toLocaleLowerCase('id-ID') === value.toLocaleLowerCase('id-ID')) continue;
    // A size in cm and one in mm MAY be equivalent. A dash can be a range.
    // Only same-unit, unambiguous numerical dimensions establish difference.
    if (key === 'ukuran' || key === 'dimensi') {
      const pattern = /^(\d+(?:[.,]\d+)?)\s*[/x×]\s*(\d+(?:[.,]\d+)?)\s*(mm|cm|m)$/iu;
      const a = pattern.exec(value);
      const b = pattern.exec(known[key]);
      if (!a || !b || a[3].toLowerCase() !== b[3].toLowerCase()) return 'UNKNOWN';
      if (Number(a[1].replace(',', '.')) !== Number(b[1].replace(',', '.')) ||
          Number(a[2].replace(',', '.')) !== Number(b[2].replace(',', '.'))) return 'CONFLICT';
      return 'UNKNOWN';
    }
    if (key === 'diameter' || key === 'kapasitas') return 'UNKNOWN';
    return 'CONFLICT';
  }
  if (Object.keys(source).length === Object.keys(known).length &&
    Object.keys(source).every(key => Object.hasOwn(known, key) &&
      known[key].toLocaleLowerCase('id-ID') === source[key].toLocaleLowerCase('id-ID'))) return 'MATCH';
  return 'UNKNOWN';
}
