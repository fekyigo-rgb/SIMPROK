/**
 * GATE 1 — read-only view of an existing, human-reviewed specification decision.
 * The append-only specification decision remains the ONE source of truth.
 * This is NOT a second unit/identity kernel and does not assert productivity,
 * performance equivalence or authorization for AHSP/RAB calculations.
 */
export type ReviewedCapacityFact = {
  kind: string;
  value: string; // Source decimal spelling; never an invented converted value.
  unit: string;
};

export type ReviewedCapacityProjection = {
  status: 'ABSENT' | 'STRUCTURED' | 'UNPARSED';
  facts: ReviewedCapacityFact[];
};

// This is the reader for the EXISTING append-only reviewed specification
// decision. Same bounded typed vocabulary as the Format A editor. It does
// not convert units or infer equipment productivity from a stated capacity.
const CAPACITY_UNITS = [
  'm³/jam', 'ton/jam', 'unit/jam', 'liter/jam',
  'm³', 'liter', 'ton', 'kg', 'cc', 'kW', 'HP', 'W',
  'rpm', 'r/min', 'Hz', 'tumbukan/menit', 'pukulan/menit',
  's', 'ms', 'm/s', 'm/menit', 'm/jam', 'km/jam', 'm/s²', 'm/s2',
  'J', 'kJ', 'N', 'kN', 'mm', 'Pa', 'kPa', 'MPa', 'bar', 'atm', 'A', 'V',
] as const;
const escapeUnit = (unit: string) => unit.replace(/[.*+?^{}()|[\]\\]/gu, '\\$&');
const CAPACITY_ROW = new RegExp(
  '^([^:;]{1,60}):\\s*(\\d+(?:[.,]\\d+)?)\\s*(' +
  [...CAPACITY_UNITS].sort((a, b) => b.length - a.length)
    .map(escapeUnit).join('|') + ')$', 'u',
);
const PRESET_UNITS: Readonly<Record<string, readonly string[]>> = {
  'Kapasitas bak': ['m³', 'liter'],
  'Daya angkut': ['ton', 'kg'],
  'Kapasitas mesin': ['cc', 'liter'],
  'Kapasitas produksi': ['m³/jam', 'ton/jam', 'unit/jam', 'liter/jam'],
  'Daya mesin': ['kW', 'HP', 'W'],
  'Kapasitas bucket': ['m³', 'liter'],
  'Kapasitas muatan (volume)': ['m³', 'liter'],
  'Putaran mesin': ['rpm', 'r/min'],
  'Frekuensi getaran': ['Hz'],
  'Frekuensi tumbukan': ['Hz', 'tumbukan/menit', 'pukulan/menit'],
  'Periode siklus': ['s', 'ms'],
  'Kecepatan': ['m/s', 'm/menit', 'm/jam', 'km/jam'],
  'Percepatan': ['m/s²', 'm/s2'],
  'Energi tumbukan': ['J', 'kJ'],
  'Gaya tumbukan': ['N', 'kN'],
  'Amplitudo getaran': ['mm'],
  'Tekanan': ['Pa', 'kPa', 'MPa', 'bar', 'atm'],
  'Arus listrik': ['A'],
  'Tegangan listrik': ['V'],
};
const EMPTY: ReviewedCapacityProjection = { status: 'ABSENT', facts: [] };
const UNPARSED: ReviewedCapacityProjection = { status: 'UNPARSED', facts: [] };

/** Input must be the source-hash/version-validated decision from getBatch.
 * A source Excel value on its own MUST NOT be passed to this function.
 */
export function projectReviewedCapacity(
  reviewedSpecifications: Readonly<Record<string, string>> | null | undefined,
): ReviewedCapacityProjection {
  const raw = reviewedSpecifications?.kapasitas;
  if (!raw) return EMPTY;
  if (raw.length > 240) return UNPARSED;
  const parts = raw.split(';').map(part => part.trim());
  if (parts.length === 0 || parts.length > 6 || parts.some(part => !part)) return UNPARSED;
  const facts: ReviewedCapacityFact[] = [];
  const usedKinds = new Set<string>();
  for (const part of parts) {
    const match = CAPACITY_ROW.exec(part);
    if (!match) return UNPARSED;
    const [, kind, value, unit] = match;
    // A dot/comma before exactly three digits can be a thousands separator.
    // Leave the original evidence untouched rather than invent a number.
    if (/[.,]\d{3}$/u.test(value)) return UNPARSED;
    if (!CAPACITY_UNITS.includes(unit as typeof CAPACITY_UNITS[number])) return UNPARSED;
    const preset = PRESET_UNITS[kind];
    if (preset && !preset.includes(unit)) return UNPARSED;
    const normalizedKind = kind.trim().toLocaleLowerCase('id-ID');
    if (usedKinds.has(normalizedKind)) return UNPARSED;
    usedKinds.add(normalizedKind);
    facts.push({ kind: kind.trim(), value, unit });
  }
  return { status: 'STRUCTURED', facts };
}
