export type E1aResolutionStatus = 'RESOLVED' | 'UNRESOLVED' | 'NEEDS_REVIEW';

export interface E1aOccurrenceResponse {
  id: string;
  generation: number;
  resourceResolutions: Array<{ status: E1aResolutionStatus }>;
}

export const describeE1aOccurrence = (
  occurrence: E1aOccurrenceResponse,
): { label: string; canCalculate: boolean } => {
  if (occurrence.resourceResolutions.some((row) => row.status === 'NEEDS_REVIEW')) {
    return { label: 'Perlu ditinjau', canCalculate: false };
  }
  if (occurrence.resourceResolutions.some((row) => row.status === 'UNRESOLVED')) {
    return { label: 'Belum terselesaikan', canCalculate: false };
  }
  if (occurrence.resourceResolutions.length === 0) {
    return { label: 'Belum terselesaikan', canCalculate: false };
  }
  return { label: 'Terhitung  Belum Dibekukan', canCalculate: true };
};

export const buildE1aIdempotencyKey = (boqItemId: string): string =>
  `e1a-${boqItemId}-${crypto.randomUUID()}`;
