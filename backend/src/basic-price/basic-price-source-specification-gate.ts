import { foldHeader } from '../universal-intake/structure/header-vocabulary';

/**
 * PR205-SPEC-SAFETY: refuse false auto-certainty; NEVER infer identity.
 * Extra source cells retain their own words in rawSourceContext, which is
 * evidence only. Detecting a clearly labelled specification field only says
 * "a material qualifier EXISTS that the current identity question did not
 * examine". Neither key nor value is promoted into canonical identity here.
 *
 * 'Jenis' is deliberately omitted: it may denote a procurement category,
 * material family or other context and cannot be assumed to be a spec.
 */
const EXPLICIT_SPECIFICATION_HEADERS = new Set([
  'merek',
  'merk',
  'brand',
  'tipe',
  'type',
  'model',
  'ukuran',
  'dimensi',
  'diameter',
  'warna',
  'mutu',
  'standar',
  'standard',
  'spesifikasi',
  'specification',
]);

export const SOURCE_SPECIFICATION_UNVERIFIED =
  'SOURCE_SPECIFICATION_UNVERIFIED';

/**
 * Read-only projection of explicit source fields for Tinjau Hasil.
 * Values are not interpreted, verified, or promoted into ResourceCatalog.
 * An unrenderable structured value is reported as null, never stringified
 * into a supposed measurement or identity.
 */
export function sourceSpecificationEvidence(
  rawSourceContext: unknown,
): Array<{ label: string; value: string | null }> {
  if (
    rawSourceContext === null ||
    typeof rawSourceContext !== 'object' ||
    Array.isArray(rawSourceContext)
  ) {
    return [];
  }
  const facts: Array<{ label: string; value: string | null }> = [];
  for (const [header, raw] of Object.entries(rawSourceContext)) {
    if (!EXPLICIT_SPECIFICATION_HEADERS.has(foldHeader(header))) continue;
    if (typeof raw === 'string') {
      if (raw.trim()) facts.push({ label: header, value: raw.trim() });
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      facts.push({ label: header, value: String(raw) });
    } else if (
      raw !== null &&
      raw !== undefined &&
      typeof raw === 'object'
    ) {
      facts.push({ label: header, value: null });
    }
  }
  return facts;
}

export function hasExplicitUnverifiedSourceSpecification(
  rawSourceContext: unknown,
): boolean {
  if (
    rawSourceContext === null ||
    typeof rawSourceContext !== 'object' ||
    Array.isArray(rawSourceContext)
  ) {
    return false;
  }
  return Object.entries(rawSourceContext).some(([header, value]) => {
    const folded = foldHeader(header);
    if (!EXPLICIT_SPECIFICATION_HEADERS.has(folded)) return false;
    // Present-but-empty is not an identity claim. Never create a default.
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    // Structured/uncertain source evidence must not be silently discarded.
    if (typeof value === 'boolean') return false;
    return true;
  });
}
