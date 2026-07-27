export const buildLookupPath = (
  route: 'resources' | 'units',
  query: object,
) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query as Record<string, string | number | undefined>)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const suffix = params.toString();
  return `/basic-price-import-lookups/${route}${suffix ? `?${suffix}` : ''}`;
};

export function createLatestRequestGate() {
  let sequence = 0;
  return {
    begin: () => ++sequence,
    isLatest: (requestSequence: number) => requestSequence === sequence,
    invalidate: () => {
      sequence += 1;
    },
  };
}
