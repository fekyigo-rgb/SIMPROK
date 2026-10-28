/**
 * RAB-AUTO-02: client projection over the SAME canonical backend readiness
 * result. It makes NO candidate selection, identity decision, or price claim.
 */
const KNOWN_REASONS = new Set([
  'ALREADY_LINKED',
  'PERSISTED_CALCULATION_REPROOF_REQUIRED',
  'INCONSISTENT_PERSISTENCE_REQUIRES_REVIEW',
  'MANUAL_PRICE_PRESERVED',
  'INCOMPLETE_LINK_REQUIRES_REVIEW',
  'NO_ELIGIBLE_AHSP',
  'CANDIDATE_UNIVERSE_INCOMPLETE',
  'NO_PROVEN_MATCH',
  'MULTIPLE_RECOMMENDATIONS',
  'CANDIDATE_REQUIRES_IDENTITY_PROOF',
  'READINESS_UNAVAILABLE_REQUIRES_REVIEW',
]);

export type RabAutoDraftLine = Readonly<{
  boqItemId: string;
  kind: string;
  mutationPerformed: false;
}>;

export type RabAutoDraftPage = Readonly<{
  projectId: string;
  page: number;
  limit: number;
  hasNext: boolean;
  results: readonly RabAutoDraftLine[];
  mutationPerformed: false;
  automaticBindingPerformed: false;
}>;

export function parseRabAutoDraftPage(
  raw: unknown,
  projectId: string,
  expectedPage: number,
): RabAutoDraftPage | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<RabAutoDraftPage>;
  if (v.projectId !== projectId || v.page !== expectedPage ||
    !Number.isInteger(v.limit) || (v.limit ?? 0) < 1 || (v.limit ?? 0) > 25 ||
    typeof v.hasNext !== 'boolean' || v.mutationPerformed !== false ||
    v.automaticBindingPerformed !== false || !Array.isArray(v.results) ||
    v.results.length > (v.limit ?? 0)) return null;
  if (!v.results.every((line: RabAutoDraftLine) =>
    Boolean(line) && typeof line.boqItemId === 'string' &&
    line.boqItemId.length > 0 && typeof line.kind === 'string' &&
    KNOWN_REASONS.has(line.kind) && line.mutationPerformed === false)) return null;
  if (new Set(v.results.map((line) => line.boqItemId)).size !== v.results.length) return null;
  return v as RabAutoDraftPage;
}

export function summarizeRabAutoDraft(lines: readonly RabAutoDraftLine[]) {
  const count = (kind: string): number => lines.filter((line) => line.kind === kind).length;
  const linked = count('ALREADY_LINKED');
  const persisted = count('PERSISTED_CALCULATION_REPROOF_REQUIRED');
  const manual = count('MANUAL_PRICE_PRESERVED');
  const unpriced = lines.length - linked - persisted - manual;
  const noAhsp = count('NO_ELIGIBLE_AHSP');
  const needsProof = count('CANDIDATE_REQUIRES_IDENTITY_PROOF') +
    count('NO_PROVEN_MATCH') + count('MULTIPLE_RECOMMENDATIONS') +
    count('CANDIDATE_UNIVERSE_INCOMPLETE');
  const other = unpriced - noAhsp - needsProof;
  return {
    checked: lines.length,
    linked,
    persisted,
    manual,
    noAhsp,
    needsProof,
    other,
    label: `Pemeriksaan AHSP otomatis: ${lines.length} item diperiksa · ${linked} AHSP terhubung · ${persisted} harga tersimpan menunggu pembuktian ulang · ${manual} harga manual dipertahankan · ${noAhsp} belum ada AHSP eligible · ${needsProof} perlu bukti kecocokan${other > 0 ? ` · ${other} memerlukan pemeriksaan lain` : ''}. Harga tidak ditentukan dari rekomendasi.`,
  };
}
