export function unitSuggestionLabels(unit: {
  displayName?: string | null;
  symbol?: string | null;
  code?: string | null;
}): { primary: string; secondary: string } {
  const displayName = unit.displayName?.trim() ?? '';
  const symbol = unit.symbol?.trim() ?? '';
  const code = unit.code?.trim() ?? '';
  const primary = displayName || symbol || code;
  const secondary = [symbol, code].filter((part) => part !== '' && part !== primary).join(' · ');
  return { primary, secondary };
}

/**
 * AHSP output presentation, not unit identity resolution.
 * Only an explicitly VERIFIED canonical definition code may choose a compact
 * typographic symbol. Never infer an identity from raw source spelling.
 * The existing Unit Kernel remains the only resolver; persistence is unchanged.
 */
export function presentedAhspOutputUnitSymbol(unit: {
  stored?: string | null;
  displayName?: string | null;
  symbol?: string | null;
  code?: string | null;
}): string {
  switch ((unit.code ?? '').trim().toUpperCase()) {
    case 'M1': return 'm';
    case 'M2': return 'm²';
    case 'M3': return 'm³';
    default: return presentedUnitLabel(unit);
  }
}

/** Stored code remains when the catalog sent no presentation metadata. */
export function presentedUnitLabel(unit: {
  stored?: string | null;
  displayName?: string | null;
  symbol?: string | null;
  code?: string | null;
}): string {
  const stored = (unit.stored ?? '').trim();
  const displayName = (unit.displayName ?? '').trim();
  const symbol = (unit.symbol ?? '').trim();
  const code = (unit.code ?? '').trim();
  if (displayName === '' && symbol === '' && code === '') return stored;
  return unitSuggestionLabels({ displayName, symbol, code }).primary || stored;
}
