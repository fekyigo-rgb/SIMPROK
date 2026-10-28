import type { BasicPriceImportRowSummary } from './basicPriceImportDisplay';

/**
 * Read-only explanation of contradictory visible source/canonical candidate
 * facts. NEVER decides identity, normalizes an imported row, or bypasses
 * Resource Identity admission. Unknown evidence is not evidence of equality.
 */
export interface SourceCatalogContradiction {
  candidateId: string;
  /** Source row evidence is local to this batch; catalog evidence is not authoritative equality. */
  evidenceOrigin: 'SOURCE_ROW' | 'CATALOG_CANDIDATE';
  otherSourceRowNumber?: number;
  candidateName: string;
  candidateCode: string | null;
  kind: 'SAME_CODE_DIFFERENT_NAME' | 'SAME_NAME_DIFFERENT_CODE';
  sourceDimensions: string | null;
  candidateDimensions: string | null;
  dimensionDifferent: boolean;
  conflictText: string;
}

const normalizedCode = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text.toLocaleUpperCase('id-ID') : null;
};

const normalizedName = (value: string): string =>
  value.toLocaleLowerCase('id-ID').replace(/\s+/gu, ' ').trim();

/** Literal three-part dimensions visible in BOTH names, without inventing units. */
export function threePartDimensions(name: string): string | null {
  const match = name.match(/\b(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)(?!\d)/iu);
  return match ? [match[1], match[2], match[3]].join(' × ') : null;
}

export function sourceCatalogContradictions(
  row: Pick<BasicPriceImportRowSummary, 'id' | 'sourceRowNumber' | 'status' | 'code' | 'name' | 'machineProposal'>,
  batchRows: ReadonlyArray<Pick<BasicPriceImportRowSummary, 'id' | 'sourceRowNumber' | 'code' | 'name'>> = [],
): SourceCatalogContradiction[] {
  if (row.status !== 'NEEDS_REVIEW' || row.machineProposal?.identityPairProven) return [];
  const sourceCode = normalizedCode(row.code);
  const sourceName = normalizedName(row.name);
  const sourceDimensions = threePartDimensions(row.name);
  const seen = new Set<string>();
  const conflicts: SourceCatalogContradiction[] = [];

  // The source document can contradict ITSELF, even when the catalog has
  // no candidate. Keep both original rows intact and tell the reviewer where.
  if (sourceCode) for (const other of batchRows) {
    if (other.id === row.id || normalizedCode(other.code) !== sourceCode) continue;
    const sameName = sourceName === normalizedName(other.name);
    const otherDimensions = threePartDimensions(other.name);
    const dimensionDifferent = sourceDimensions !== null && otherDimensions !== null &&
      sourceDimensions !== otherDimensions;
    if (sameName && !dimensionDifferent) continue;
    conflicts.push({
      candidateId: 'source-row:' + other.id,
      evidenceOrigin: 'SOURCE_ROW',
      otherSourceRowNumber: other.sourceRowNumber,
      candidateName: other.name,
      candidateCode: other.code,
      kind: 'SAME_CODE_DIFFERENT_NAME',
      sourceDimensions,
      candidateDimensions: otherDimensions,
      dimensionDifferent,
      conflictText: dimensionDifferent
        ? `Kode ${row.code?.trim()} digunakan lagi pada baris ${other.sourceRowNumber}, tetapi ukuran ${sourceDimensions} dan ${otherDimensions} berbeda. Perlu koreksi atau konfirmasi penyedia.`
        : `Kode ${row.code?.trim()} digunakan lagi pada baris ${other.sourceRowNumber}, tetapi uraian berbeda. Perlu konfirmasi penyedia.`,
    });
  }

  for (const candidate of row.machineProposal?.resource.candidates ?? []) {
    if (!candidate.resourceCatalogId || seen.has(candidate.resourceCatalogId)) continue;
    seen.add(candidate.resourceCatalogId);
    const candidateCode = normalizedCode(candidate.code);
    const nameIdentical = sourceName === normalizedName(candidate.name);
    const sameCode = sourceCode !== null && candidateCode === sourceCode;
    const differentCode = sourceCode !== null && candidateCode !== null && sourceCode !== candidateCode;
    const candidateDimensions = threePartDimensions(candidate.name);
    const dimensionDifferent = sourceDimensions !== null && candidateDimensions !== null &&
      sourceDimensions !== candidateDimensions;

    if (sameCode && (!nameIdentical || dimensionDifferent)) {
      conflicts.push({
        candidateId: candidate.resourceCatalogId,
        evidenceOrigin: 'CATALOG_CANDIDATE',
        candidateName: candidate.name,
        candidateCode: candidate.code,
        kind: 'SAME_CODE_DIFFERENT_NAME',
        sourceDimensions,
        candidateDimensions,
        dimensionDifferent,
        conflictText: dimensionDifferent
          ? `Kode ${row.code?.trim()} sama, tetapi ukuran sumber ${sourceDimensions} berbeda dari kandidat ${candidateDimensions}. Belum terbukti mana yang keliru.`
          : `Kode ${row.code?.trim()} sama, tetapi uraian sumber dan kandidat berbeda. Belum terbukti mana yang keliru.`,
      });
    } else if (differentCode && nameIdentical) {
      conflicts.push({
        candidateId: candidate.resourceCatalogId,
        evidenceOrigin: 'CATALOG_CANDIDATE',
        candidateName: candidate.name,
        candidateCode: candidate.code,
        kind: 'SAME_NAME_DIFFERENT_CODE',
        sourceDimensions,
        candidateDimensions,
        dimensionDifferent: false,
        conflictText: `Nama tertulis sama, tetapi kode sumber ${row.code?.trim()} berbeda dari kode kandidat ${candidate.code?.trim()}. Kode perlu dikonfirmasi; kecocokan identitas belum terbukti.`,
      });
    }
  }
  return conflicts;
}

export function supplierSourceClarification(
  row: Pick<BasicPriceImportRowSummary, 'sourceRowNumber' | 'code' | 'name' | 'unit'>,
  conflicts: SourceCatalogContradiction[],
): string {
  const comparisons = conflicts.map((finding, index) =>
    `${index + 1}. Kandidat yang perlu dibandingkan: ${finding.candidateName} (kode: ${finding.candidateCode ?? 'tidak tersedia'}). ${finding.conflictText}`
  ).join('\n');
  return [
    'PERMINTAAN KLARIFIKASI DATA ITEM KEPADA PENYEDIA',
    `Baris dokumen sumber: ${row.sourceRowNumber}`,
    `Kode tertulis: ${row.code ?? 'tidak tersedia'}`,
    `Uraian tertulis: ${row.name}`,
    `Satuan tertulis: ${row.unit ?? 'tidak tersedia'}`,
    '',
    'Temuan perbandingan (bukan kepastian kesalahan):',
    comparisons,
    '',
    'Mohon konfirmasi tertulis: (1) kode item yang benar, (2) uraian dan ukuran/spesifikasi yang benar,',
    '(3) apakah item tersebut sama atau berbeda, dan (4) apakah harga perlu dikoreksi.',
    'Apabila dokumen sumber keliru, mohon lampirkan revisi resmi dan penjelasan perubahan.',
    'Sebelum klarifikasi diterima, SIMPROK tidak akan mengubah data Excel asli atau',
    'menetapkan identitas berdasarkan dugaan.',
  ].join('\n');
}
