import { Injectable } from '@nestjs/common';
import { UnitKernelService } from './unit-kernel.service';
import { UNIT_REASON, UNIT_RESOLUTION_STATUS } from './unit-kernel.contracts';

export const BOQ_UNIT_COMPATIBILITY = { COMPATIBLE_EXACT: 'COMPATIBLE_EXACT', COMPATIBLE_CONVERTIBLE: 'COMPATIBLE_CONVERTIBLE', NEEDS_REVIEW: 'NEEDS_REVIEW', NOT_CONVERTIBLE: 'NOT_CONVERTIBLE' } as const;

@Injectable()
export class BoqUnitCompatibilityService {
  constructor(private readonly units: UnitKernelService) {}
  async evaluate(ahspOutputUnit: string | null, boqUnit: string) {
    if (!ahspOutputUnit) return { status: BOQ_UNIT_COMPATIBILITY.NEEDS_REVIEW, reasonCodes: [UNIT_REASON.AHSP_OUTPUT_UNIT_UNRESOLVED] };
    const result = await this.units.resolve(boqUnit, ahspOutputUnit);
    const { status: _unitStatus, ...evidence } = result;
    if (result.status === UNIT_RESOLUTION_STATUS.NOT_CONVERTIBLE) return { ...evidence, status: BOQ_UNIT_COMPATIBILITY.NOT_CONVERTIBLE };
    if (result.status !== UNIT_RESOLUTION_STATUS.RESOLVED) return { ...evidence, status: BOQ_UNIT_COMPATIBILITY.NEEDS_REVIEW };
    return { ...evidence, status: result.quantityFactor === '1' && result.conversionRuleId === null ? BOQ_UNIT_COMPATIBILITY.COMPATIBLE_EXACT : BOQ_UNIT_COMPATIBILITY.COMPATIBLE_CONVERTIBLE };
  }
}
