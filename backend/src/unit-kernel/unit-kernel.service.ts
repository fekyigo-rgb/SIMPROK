import { Injectable } from '@nestjs/common';
import { Prisma, UnitConversionRuleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUnitAlias } from './unit-normalization';
import { UNIT_KERNEL_POLICY_VERSION, UNIT_PRICE_OPERATION, UNIT_REASON, UNIT_RESOLUTION_STATUS, UnitResolutionResult } from './unit-kernel.contracts';

@Injectable()
export class UnitKernelService {
  constructor(private readonly prisma: PrismaService) {}

  private async aliases(raw: string) {
    return this.prisma.unitAlias.findMany({
      where: { normalizedAlias: normalizeUnitAlias(raw), isActive: true, unitDefinition: { is: { isActive: true } } },
      include: { unitDefinition: true },
    });
  }

  async resolve(rawSourceUnit: string, rawTargetUnit: string, resourceCatalogId?: string): Promise<UnitResolutionResult> {
    const [sourceAliases, targetAliases] = await Promise.all([this.aliases(rawSourceUnit), this.aliases(rawTargetUnit)]);
    const base = { rawSourceUnit, rawTargetUnit, matchedSourceAliasIds: sourceAliases.map(a => a.id), matchedTargetAliasIds: targetAliases.map(a => a.id), conversionRuleId: null, conversionRuleVersion: null, quantityFactor: null, conversionType: null, priceOperation: null, policyVersion: UNIT_KERNEL_POLICY_VERSION } as const;
    const bad = sourceAliases.length === 0 ? UNIT_REASON.UNKNOWN_UNIT_ALIAS : targetAliases.length === 0 ? UNIT_REASON.UNKNOWN_UNIT_ALIAS : sourceAliases.length > 1 || targetAliases.length > 1 ? UNIT_REASON.AMBIGUOUS_UNIT_ALIAS : null;
    if (bad) return { ...base, status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW, sourceUnitDefinition: sourceAliases.length === 1 ? sourceAliases[0].unitDefinition : null, targetUnitDefinition: targetAliases.length === 1 ? targetAliases[0].unitDefinition : null, reasonCodes: [bad], explanation: bad === UNIT_REASON.UNKNOWN_UNIT_ALIAS ? 'Satu atau lebih alias unit tidak dikenal.' : 'Satu atau lebih alias unit memiliki lebih dari satu pemetaan aktif.' };
    const source = sourceAliases[0].unitDefinition;
    const target = targetAliases[0].unitDefinition;
    if (source.id === target.id) return { ...base, status: UNIT_RESOLUTION_STATUS.RESOLVED, sourceUnitDefinition: source, targetUnitDefinition: target, quantityFactor: '1', priceOperation: UNIT_PRICE_OPERATION.IDENTITY, reasonCodes: [UNIT_REASON.EXACT_UNIT_ALIAS_EQUIVALENCE, UNIT_REASON.EXACT_UNIT_IDENTITY], explanation: 'Kedua alias menunjuk identitas unit canonical yang sama.' };
    const rules = await this.prisma.unitConversionRule.findMany({
      where: { sourceUnitId: source.id, targetUnitId: target.id, status: UnitConversionRuleStatus.ACTIVE, OR: [{ resourceCatalogId: null }, ...(resourceCatalogId ? [{ resourceCatalogId }] : [])] },
    });
    if (rules.length > 1) return { ...base, status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW, sourceUnitDefinition: source, targetUnitDefinition: target, reasonCodes: [UNIT_REASON.AMBIGUOUS_CONVERSION_RULE], explanation: 'Lebih dari satu aturan konversi aktif memenuhi bukti.' };
    if (rules.length === 0) return { ...base, status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW, sourceUnitDefinition: source, targetUnitDefinition: target, reasonCodes: [UNIT_REASON.CONVERSION_RULE_NOT_FOUND], explanation: 'Aturan konversi directional yang memenuhi bukti tidak ditemukan.' };
    const rule = rules[0];
    const factor = new Prisma.Decimal(rule.quantityFactor);
    if (!factor.greaterThan(0)) return { ...base, status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW, sourceUnitDefinition: source, targetUnitDefinition: target, reasonCodes: [UNIT_REASON.INVALID_QUANTITY_FACTOR], explanation: 'quantityFactor harus lebih besar dari nol.' };
    if ((rule.conversionType === 'PACKAGE_CONTENT' || rule.conversionType === 'RESOURCE_SPECIFIC') && !rule.evidenceReference && !rule.evidenceHash && rule.evidencePayload == null) return { ...base, status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW, sourceUnitDefinition: source, targetUnitDefinition: target, reasonCodes: [UNIT_REASON.PACKAGE_EVIDENCE_REQUIRED], explanation: 'Aturan package/resource-specific membutuhkan evidence.' };
    if (rule.conversionType === 'NOT_CONVERTIBLE') return { ...base, status: UNIT_RESOLUTION_STATUS.NOT_CONVERTIBLE, sourceUnitDefinition: source, targetUnitDefinition: target, conversionRuleId: rule.id, conversionRuleVersion: rule.version, conversionType: rule.conversionType, reasonCodes: [UNIT_REASON.NOT_CONVERTIBLE], explanation: 'Evidence menyatakan pasangan unit tidak dapat dikonversi.' };
    return { ...base, status: UNIT_RESOLUTION_STATUS.RESOLVED, sourceUnitDefinition: source, targetUnitDefinition: target, conversionRuleId: rule.id, conversionRuleVersion: rule.version, quantityFactor: factor.toString(), conversionType: rule.conversionType, priceOperation: UNIT_PRICE_OPERATION.DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR, reasonCodes: [UNIT_REASON.UNIQUE_EVIDENCE_BOUND_RULE], explanation: 'Tepat satu aturan directional aktif dan berbukti ditemukan.' };
  }
}
