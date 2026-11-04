export const SPEC_FIELDS = [
  { key: 'merek', label: 'Merek' },
  { key: 'tipe', label: 'Tipe / Model' },
  { key: 'fungsi', label: 'Jenis / Kegunaan' },
  { key: 'warna', label: 'Warna' },
  { key: 'mutu', label: 'Mutu' },
  { key: 'standar', label: 'Standar' },
  { key: 'spesifikasi', label: 'Spesifikasi Tambahan' },
  // Legacy values remain in the round-trip contract, but not as duplicate UI inputs.
  { key: 'ukuran', label: 'Ukuran (legacy)' },
  { key: 'dimensi', label: 'Dimensi (legacy)' },
  { key: 'panjang', label: 'Panjang' },
  { key: 'lebar', label: 'Lebar' },
  { key: 'tinggi', label: 'Tinggi' },
  { key: 'diameter', label: 'Diameter' },
  { key: 'volume', label: 'Volume' },
  { key: 'berat', label: 'Berat' },
  { key: 'kapasitas', label: 'Kapasitas' },
] as const;

export const SPEC_IDENTITY_FIELDS = SPEC_FIELDS.filter((field) =>
  ['merek', 'tipe', 'fungsi', 'warna'].includes(field.key));
export const SPEC_TECHNICAL_FIELDS = SPEC_FIELDS.filter((field) =>
  ['mutu', 'standar'].includes(field.key));
export const SPEC_DIMENSION_FIELDS = SPEC_FIELDS.filter((field) =>
  ['panjang', 'lebar', 'tinggi', 'diameter', 'volume', 'berat'].includes(field.key));
export const SPEC_LEGACY_FIELDS = SPEC_FIELDS.filter((field) =>
  ['ukuran', 'dimensi'].includes(field.key));

export type SpecFieldKey = typeof SPEC_FIELDS[number]['key'];
export type SpecFields = Partial<Record<SpecFieldKey, string>>;
export type SpecDecisionKind = 'SUPPLEMENT' | 'CORRECT';
export type SourceSpecFact = { label: string; value: string | null };
export type StoredSpecDecision = { facts: Record<string, string>; decisionKind: string; resultingVersion: number };

/** Owner-approved 'Kapasitas' is a REPEATABLE (kind, value, unit) fact.
 * Keep ONE persisted canonical specification key (kapasitas) and the EXISTING
 * decision writer. Rows here are only a reversible UI presentation, not a
 * second resource/measurement kernel.
 */
// Same audited (kind,value,unit) specification decision. The groups are UI
// presentation, NOT a new capacity engine or an asserted unit conversion.
// Existing presets are retained first to protect old saved decisions.
export const SPEC_CAPACITY_TYPES = [
  { kind: 'Kapasitas bak', group: 'CAPACITY', units: ['m³', 'liter'] },
  { kind: 'Daya angkut', group: 'CAPACITY', units: ['ton', 'kg'] },
  { kind: 'Kapasitas mesin', group: 'CAPACITY', units: ['cc', 'liter'] },
  { kind: 'Kapasitas produksi', group: 'CAPACITY', units: ['m³/jam', 'ton/jam', 'unit/jam', 'liter/jam'] },
  { kind: 'Daya mesin', group: 'CAPACITY', units: ['kW', 'HP', 'W'] },
  { kind: 'Kapasitas bucket', group: 'CAPACITY', units: ['m³', 'liter'] },
  { kind: 'Kapasitas muatan (volume)', group: 'CAPACITY', units: ['m³', 'liter'] },
  { kind: 'Putaran mesin', group: 'DYNAMICS', units: ['rpm', 'r/min'] },
  { kind: 'Frekuensi getaran', group: 'DYNAMICS', units: ['Hz'] },
  { kind: 'Frekuensi tumbukan', group: 'DYNAMICS', units: ['Hz', 'tumbukan/menit', 'pukulan/menit'] },
  { kind: 'Periode siklus', group: 'DYNAMICS', units: ['s', 'ms'] },
  { kind: 'Kecepatan', group: 'DYNAMICS', units: ['m/s', 'm/menit', 'm/jam', 'km/jam'] },
  { kind: 'Percepatan', group: 'DYNAMICS', units: ['m/s²', 'm/s2'] },
  { kind: 'Energi tumbukan', group: 'DYNAMICS', units: ['J', 'kJ'] },
  { kind: 'Gaya tumbukan', group: 'DYNAMICS', units: ['N', 'kN'] },
  { kind: 'Amplitudo getaran', group: 'DYNAMICS', units: ['mm'] },
  { kind: 'Tekanan', group: 'ELECTRICAL', units: ['Pa', 'kPa', 'MPa', 'bar', 'atm'] },
  { kind: 'Arus listrik', group: 'ELECTRICAL', units: ['A'] },
  { kind: 'Tegangan listrik', group: 'ELECTRICAL', units: ['V'] },
] as const;
export const SPEC_CAPACITY_GROUPS = [
  { key: 'CAPACITY', label: 'Kapasitas dan Daya' },
  { key: 'DYNAMICS', label: 'Dinamika dan Performa Mesin' },
  { key: 'ELECTRICAL', label: 'Tekanan dan Kelistrikan' },
] as const;
export const SPEC_CAPACITY_ALL_UNITS = [
  'm³', 'liter', 'ton', 'kg', 'cc', 'm³/jam', 'ton/jam',
  'unit/jam', 'liter/jam', 'kW', 'HP', 'W', 'rpm', 'r/min',
  'Hz', 'tumbukan/menit', 'pukulan/menit', 's', 'ms',
  'm/s', 'm/menit', 'm/jam', 'km/jam', 'm/s²', 'm/s2',
  'J', 'kJ', 'N', 'kN', 'mm', 'Pa', 'kPa', 'MPa', 'bar', 'atm', 'A', 'V',
] as const;
export type CapacityRow = { kind: string; value: string; unit: string };

/** Reuse the existing capacity vocabulary when adding a row; never silently
 * reuse an occupied type or erase source/legacy facts. The last slot stays
 * available for an explicitly named custom capacity type.
 */
export function nextUnusedCapacityRow(rows: readonly CapacityRow[]): CapacityRow {
  const occupied = new Set(rows.map(row => row.kind.trim().toLocaleLowerCase('id-ID')));
  const next = SPEC_CAPACITY_TYPES.find(type =>
    !occupied.has(type.kind.toLocaleLowerCase('id-ID')));
  return next
    ? { kind: next.kind, value: '', unit: next.units[0] }
    : { kind: '', value: '', unit: SPEC_CAPACITY_ALL_UNITS[0] };
}

// Build the parser from the SAME allowed vocabulary used by the existing UI.
// Longer compound labels must win over prefixes (m/jam versus m/s).
const escapeUnit = (unit: string) => unit.replace(/[.*+?^{}()|[\]\\]/gu, '\\$&');
const CAPACITY_ROW_RE = new RegExp(
  '^([^:;]{1,60}):\\s*(\\d+(?:[.,]\\d+)?)\\s*(' +
  [...SPEC_CAPACITY_ALL_UNITS].sort((a, b) => b.length - a.length)
    .map(escapeUnit).join('|') + ')$', 'u',
);

export function readCapacitySpecification(raw: string | undefined): {
  rows: CapacityRow[];
  legacy: string[];
} {
  const rows: CapacityRow[] = [];
  const legacy: string[] = [];
  for (const part of (raw ?? '').split(';').map(x => x.trim()).filter(Boolean)) {
    const match = CAPACITY_ROW_RE.exec(part);
    if (match) rows.push({ kind: match[1], value: match[2], unit: match[3] });
    else legacy.push(part); // NEVER drop an old or unknown machine specification
  }
  return { rows, legacy };
}

export function writeCapacitySpecification(
  rows: readonly CapacityRow[],
  legacy: readonly string[],
): { text: string; error?: string } {
  if (rows.length > 6) return { text: '', error: 'Maksimal enam jenis kapasitas per item.' };
  const parts = [...legacy];
  const seen = new Set<string>();
  for (const row of rows) {
    const kind = row.kind.trim();
    const value = row.value.trim();
    const unit = row.unit.trim();
    if (!kind || kind.length > 60 || /[:;]/u.test(kind) ||
      !/^\d+(?:[.,]\d+)?$/u.test(value) ||
      !(SPEC_CAPACITY_ALL_UNITS as readonly string[]).includes(unit)) {
      return { text: '', error: 'Lengkapi jenis kapasitas, angka, dan satuan yang sah pada setiap baris.' };
    }
    const prescribed = SPEC_CAPACITY_TYPES.find(x => x.kind === kind);
    if (prescribed && !(prescribed.units as readonly string[]).includes(unit)) {
      return { text: '', error: 'Satuan harus sesuai dengan jenis kapasitas ' + kind + '.' };
    }
    if (seen.has(kind.toLocaleLowerCase('id-ID'))) {
      return { text: '', error: 'Jenis kapasitas yang sama tidak boleh dicatat dua kali.' };
    }
    seen.add(kind.toLocaleLowerCase('id-ID'));
    parts.push(kind + ': ' + value + ' ' + unit);
  }
  const text = parts.join('; ');
  if (text.length > 240) return { text: '', error: 'Total kapasitas maksimal 240 karakter. Perjelas hanya rincian yang diperlukan.' };
  return { text };
}

const aliases: Record<string, SpecFieldKey> = {
  merek: 'merek', merk: 'merek', brand: 'merek',
  tipe: 'tipe', 'tipe/model': 'tipe', 'tipe model': 'tipe', type: 'tipe', model: 'tipe',
  ukuran: 'ukuran', dimensi: 'dimensi', diameter: 'diameter',
  panjang: 'panjang', lebar: 'lebar', tinggi: 'tinggi',
  volume: 'volume', berat: 'berat', kapasitas: 'kapasitas',
  fungsi: 'fungsi', penggunaan: 'fungsi', kegunaan: 'fungsi',
  mutu: 'mutu', standar: 'standar', standard: 'standar', warna: 'warna',
  spesifikasi: 'spesifikasi', 'spesifikasi tambahan': 'spesifikasi',
};

export function specificationInitialFields(
  source: SourceSpecFact[] | undefined,
  decision: StoredSpecDecision | null | undefined,
): SpecFields {
  const fields: SpecFields = {};
  for (const fact of source ?? []) {
    const key = aliases[fact.label.trim().toLocaleLowerCase('id-ID')];
    if (key && fact.value?.trim()) fields[key] = fact.value.trim();
  }
  for (const [rawKey, rawValue] of Object.entries(decision?.facts ?? {})) {
    const key = aliases[rawKey.trim().toLocaleLowerCase('id-ID')];
    if (key && typeof rawValue === 'string' && rawValue.trim()) fields[key] = rawValue.trim();
  }
  return fields;
}

export function specificationFormDecision(
  fields: SpecFields,
  source: SourceSpecFact[] | undefined,
  previous: StoredSpecDecision | null | undefined,
  decisionKind: SpecDecisionKind,
  reason: string,
): { ok: true; confirmedSpecifications: Record<string, string>; reason?: string } | { ok: false; message: string } {
  const confirmed: Record<string, string> = {};
  for (const field of SPEC_FIELDS) {
    const text = fields[field.key]?.trim().replace(/\s+/gu, ' ') ?? '';
    if (text.length > 240) return { ok: false, message: field.label + ' maksimal 240 karakter.' };
    if (text) confirmed[field.key] = text;
  }
  // Source-only supplier descriptions are carried in the SAME reviewed
  // decision so the canonical backend can compare source evidence exactly.
  // They are NOT automatically converted into certified mutu or fungsi.
  const sourceOnlyHeaders: Record<string, string> = {
    'mutu dan standar': 'mutu_dan_standar_sumber',
    'jenis/kegunaan': 'jenis_kegunaan_sumber',
  };
  for (const fact of source ?? []) {
    const target = sourceOnlyHeaders[fact.label.trim().toLocaleLowerCase('id-ID')];
    if (target && fact.value?.trim()) confirmed[target] = fact.value.trim().replace(/\s+/gu, ' ');
  }
  // Preserve historical supplier evidence if the current source projection is
  // absent; SUPPLEMENT must not erase prior checked facts.
  for (const key of Object.values(sourceOnlyHeaders)) {
    if (!confirmed[key] && previous?.facts?.[key]) confirmed[key] = previous.facts[key];
  }
  if (!Object.keys(confirmed).length) return { ok: false, message: 'Isi sedikitnya satu spesifikasi yang benar-benar diperiksa.' };
  if (decisionKind === 'SUPPLEMENT') {
    if ((source ?? []).some((fact) => fact.value === null))
      return { ok: false, message: 'Ada nilai spesifikasi sumber yang belum terbaca; gunakan Koreksi dengan alasan.' };
    for (const fact of source ?? []) {
      const key = aliases[fact.label.trim().toLocaleLowerCase('id-ID')];
      if (key && fact.value && confirmed[key]?.toLocaleLowerCase('id-ID') !== fact.value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('id-ID'))
        return { ok: false, message: 'Spesifikasi sumber tidak boleh diubah melalui Tambahkan. Gunakan Koreksi dengan alasan.' };
    }
    for (const [key, value] of Object.entries(previous?.facts ?? {})) {
      if (confirmed[key]?.toLocaleLowerCase('id-ID') !== value.toLocaleLowerCase('id-ID'))
        return { ok: false, message: 'Spesifikasi keputusan sebelumnya tidak boleh diubah tanpa Koreksi dengan alasan.' };
    }
  }
  if (decisionKind === 'CORRECT' && !reason.trim())
    return { ok: false, message: 'Koreksi spesifikasi wajib disertai alasan yang dapat diaudit.' };
  if (reason.trim().length > 1000)
    return { ok: false, message: 'Alasan maksimal 1.000 karakter.' };
  return { ok: true, confirmedSpecifications: confirmed, ...(reason.trim() ? { reason: reason.trim() } : {}) };
}