import type { IntakeQuestionModel } from './IntakeQuestion';

export interface KdnMappingCandidate {
  columnNumber: number;
  headerText: string;
}

export interface KdnMappingProjection {
  status: string;
  confirmedColumn?: number | null;
  candidates?: KdnMappingCandidate[];
}

/**
 * BP-KDN-01 — a NON-BLOCKING question. The price import already succeeded.
 * SIMPROK will not guess that LOCAL is KDN; a person may confirm, or leave
 * KDN unknown.
 */
export function kdnMappingQuestionOf(
  mapping: KdnMappingProjection | null | undefined,
): IntakeQuestionModel | null {
  if (!mapping || mapping.status !== 'NEEDS_REVIEW') return null;
  const candidates = mapping.candidates ?? [];
  if (candidates.length === 0) return null;
  const first = candidates[0]?.headerText ?? 'ini';
  return {
    prompt:
      candidates.length === 1
        ? `Apakah kolom '${first}' ini merupakan nilai KDN (%)?`
        : 'Beberapa kolom tampak seperti KDN. Kolom mana yang merupakan nilai KDN (%)? SIMPROK tidak menebak.',
    answerKey: 'selectedKdnColumn',
    options: [
      ...candidates.map((candidate) => ({
        value: String(candidate.columnNumber),
        label: `Ya — kolom ${candidate.columnNumber} (${candidate.headerText})`,
      })),
      { value: 'none', label: 'Bukan kolom KDN' },
    ],
  };
}
