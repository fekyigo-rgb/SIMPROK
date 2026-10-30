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

export type RabAutoDraftCandidatePreview = Readonly<{
  ahspVersionId: string;
  code: string | null;
  workType: string;
  methodName: string;
  outputUnit: string | null;
  bindingAuthorized: false;
}>;

export type RabAutoDraftLine = Readonly<{
  boqItemId: string;
  kind: string;
  mutationPerformed: false;
  candidatePreview?: RabAutoDraftCandidatePreview | null;
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
  if (!v.results.every((line) => {
    if (!Object.prototype.hasOwnProperty.call(line, 'candidatePreview')) return true;
    const candidate = line.candidatePreview;
    if (candidate === null) return true;
    if (!candidate || line.kind !== 'CANDIDATE_REQUIRES_IDENTITY_PROOF' ||
      typeof candidate.ahspVersionId !== 'string' || !candidate.ahspVersionId ||
      !(candidate.code === null || typeof candidate.code === 'string') ||
      typeof candidate.workType !== 'string' ||
      typeof candidate.methodName !== 'string' ||
      !(candidate.outputUnit === null || typeof candidate.outputUnit === 'string') ||
      candidate.bindingAuthorized !== false) return false;
    return true;
  })) return null;
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
    label: `Pemeriksaan AHSP otomatis: ${lines.length} item diperiksa · ${linked} tautan kerja AHSP aktif · ${persisted} harga Cost Kernel tersimpan (jejak perlu pembuktian ulang) · ${manual} harga manual dipertahankan · ${noAhsp} belum ada AHSP eligible · ${needsProof} perlu bukti kecocokan${other > 0 ? ` · ${other} memerlukan pemeriksaan lain` : ''}. Harga tersimpan tidak dihitung sebagai tautan kerja aktif dan tidak dihitung ulang otomatis. Harga tidak ditentukan dari rekomendasi.`,
  };
}

/**
 * One-to-one display of canonical RAB readiness. No new matcher and no
 * authority to bind or price is created by a UI description.
 */
export function describeRabAutoItemReadiness(
  line: RabAutoDraftLine | null | undefined,
): string | null {
  if (!line) return null;
  const known: Record<string, string> = {
    ALREADY_LINKED: 'AHSP sudah terhubung. Gunakan bukti occurrence yang tersimpan.',
    PERSISTED_CALCULATION_REPROOF_REQUIRED:
      'Harga Cost Kernel telah tersimpan. Baca ulang bukti harga, jangan mengikat ulang.',
    MANUAL_PRICE_PRESERVED: 'Harga manual tetap dipertahankan; tidak ditimpa otomatis.',
    INCONSISTENT_PERSISTENCE_REQUIRES_REVIEW:
      'Bukti harga tersimpan belum konsisten. Perlu pemeriksaan.',
    INCOMPLETE_LINK_REQUIRES_REVIEW:
      'Hubungan AHSP/occurrence belum lengkap. Periksa keputusan tersimpan.',
    NO_ELIGIBLE_AHSP:
      'Belum ada AHSP yang memenuhi kelayakan untuk pekerjaan ini.',
    CANDIDATE_UNIVERSE_INCOMPLETE:
      'Daftar kandidat AHSP belum lengkap. Pencarian perlu dipersempit.',
    NO_PROVEN_MATCH:
      'AHSP tersedia, tetapi kecocokan dengan uraian dan satuan belum terbukti.',
    MULTIPLE_RECOMMENDATIONS:
      'Ada lebih dari satu rekomendasi AHSP. Pengguna perlu menetapkan pilihan.',
    CANDIDATE_REQUIRES_IDENTITY_PROOF:
      'Ada satu kandidat yang direkomendasikan. Tinjau kode, uraian, satuan, dan wilayah harga sebelum menghubungkan.',
    READINESS_UNAVAILABLE_REQUIRES_REVIEW:
      'Kesiapan otomatis belum dapat diperiksa. Tidak ada perubahan RAB.',
  };
  return known[line.kind] ?? null;
}
