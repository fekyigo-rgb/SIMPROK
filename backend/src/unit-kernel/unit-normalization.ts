export function normalizeUnitAlias(raw: string): string {
  return raw.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ');
}
