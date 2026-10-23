type Row = Record<string, unknown>;
const record = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => v == null ? '' : String(v).trim();
const decimal = (v: unknown) => {
  const s = text(v);
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('INVALID_COEFFICIENT');
  const [whole, fraction = ''] = s.split('.');
  return whole.replace(/^0+(?=\d)/, '') + (fraction.replace(/0+$/, '') ? '.' + fraction.replace(/0+$/, '') : '');
};
function recipe(resources: unknown): string {
  if (!Array.isArray(resources)) throw new Error('INVALID_RESOURCES');
  return JSON.stringify(resources.map((r: unknown) => {
    if (!record(r) || !r.resourceId || !r.resourceType || !r.baseUnit) throw new Error('INVALID_RESOURCE');
    return [text(r.resourceId), text(r.resourceType), text(r.baseUnit), decimal(r.coefficient)];
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export function verifySavedVersion(detail: unknown, ahspId: string, versionId: string, expected: Row): boolean {
  try {
    if (!record(detail) || detail.id !== ahspId || !Array.isArray(detail.versions)) return false;
    const saved = detail.versions.find((v: unknown) => record(v) && v.id === versionId);
    if (!record(saved)) return false;
    for (const key of ['outputUnit', 'regulationReference', 'issuerInstitution']) {
      if (text(saved[key]) !== text(expected[key])) return false;
    }
    const date = (v: unknown) => text(v) ? new Date(text(v)).toISOString().slice(0, 10) : '';
    return date(saved.effectiveDate) === date(expected.effectiveDate) && recipe(saved.resources) === recipe(expected.resources);
  } catch { return false; }
}
