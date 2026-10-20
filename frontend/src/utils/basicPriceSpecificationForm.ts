export const SPEC_FIELDS = [
  { key: 'merek', label: 'Merek' },
  { key: 'tipe', label: 'Tipe / Model' },
  { key: 'ukuran', label: 'Ukuran' },
  { key: 'dimensi', label: 'Dimensi' },
  { key: 'diameter', label: 'Diameter' },
  { key: 'kapasitas', label: 'Kapasitas' },
  { key: 'mutu', label: 'Mutu' },
  { key: 'standar', label: 'Standar' },
  { key: 'warna', label: 'Warna' },
] as const;

export type SpecFieldKey = typeof SPEC_FIELDS[number]['key'];
export type SpecFields = Partial<Record<SpecFieldKey, string>>;
export type SpecDecisionKind = 'SUPPLEMENT' | 'CORRECT';
export type SourceSpecFact = { label: string; value: string | null };
export type StoredSpecDecision = { facts: Record<string, string>; decisionKind: string; resultingVersion: number };

const aliases: Record<string, SpecFieldKey> = {
  merek: 'merek', merk: 'merek', brand: 'merek',
  tipe: 'tipe', type: 'tipe', model: 'tipe',
  ukuran: 'ukuran', dimensi: 'dimensi', diameter: 'diameter',
  kapasitas: 'kapasitas', mutu: 'mutu', standar: 'standar', standard: 'standar', warna: 'warna',
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