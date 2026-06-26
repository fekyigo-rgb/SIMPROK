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
}
