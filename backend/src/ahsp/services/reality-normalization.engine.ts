import { Injectable } from '@nestjs/common';

@Injectable()
export class RealityNormalizationEngine {
  
  normalizeUnit(rawUnit: string): string {
    if (!rawUnit) return '';
    const lower = rawUnit.toLowerCase().trim();
    if (['m^3', 'm3', 'meter kubik'].includes(lower)) return 'm3';
    if (['oh', 'o.h', 'orang hari', 'manday'].includes(lower)) return 'oh';
    return lower;
  }

  normalizeNumber(rawNumber: string | number): number {
    if (typeof rawNumber === 'number') return rawNumber;
    if (!rawNumber) return 0;
    const cleanStr = rawNumber.replace(/[^0-9,-]+/g, '').replace(',', '.');
    const parsed = parseFloat(cleanStr);
    return isNaN(parsed) ? 0 : parsed;
  }

  normalizeCode(rawCode: string): string {
    if (!rawCode) return '';
    return rawCode.trim().toUpperCase();
  }

  /**
   * Deterministic, CONSERVATIVE work-name normalization for AHSP identity
   * COMPARISON only (it is evidence, never truth). It folds ONLY case and
   * whitespace — the harmless textual differences that never change the meaning
   * of a construction work. It does NOT strip words, expand abbreviations, or
   * touch digits, so meaning-bearing differences stay distinguishable:
   * "galian manual" vs "galian mekanis", "beton bertulang" vs "beton", and
   * "10 cm" vs "20 cm" all normalize to distinct strings. Byte-exact identity
   * (the @@unique key) is unchanged; this only powers the POSSIBLY signal.
   */
  normalizeName(rawName: string): string {
    if (!rawName) return '';
    return rawName.trim().replace(/\s+/g, ' ').toLowerCase();
  }
}
