import { Injectable } from '@nestjs/common';
import { Prisma, UnitConversionRuleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUnitAlias } from './unit-normalization';
import { UNIT_KERNEL_POLICY_VERSION, UNIT_PRICE_OPERATION, UNIT_REASON, UNIT_RESOLUTION_STATUS, UnitAliasContext, UnitResolutionResult } from './unit-kernel.contracts';

@Injectable()
export class UnitKernelService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One raw spelling may legitimately denote more than one canonical unit —
   * "jam" is a labour hour on a LABOR row and an equipment hour on an EQUIPMENT
   * row, and those are different dimensions, not a formatting difference.
   *
   * THE LAW IS ABOUT THE ALIAS, NOT ABOUT HOW MANY ROWS HAPPEN TO EXIST.
   * A context-scoped alias asserts a meaning that holds only inside its own
   * context, so without trusted context it is never eligible — not even when it
   * is the ONLY row present. Counting rows would make safety accidental: it
   * would hold for "jam" today merely because two contexts happen to be
   * catalogued, and silently fail for the first alias catalogued in one context.
   *
   * With a context, only an EXACT context match is eligible; if there is none,
   * only context-free aliases remain. A foreign-context alias can therefore
   * never become the last row standing.
   *
   * Nothing here reads the raw text to guess a context.
   */
  private async aliases(raw: string, context?: UnitAliasContext) {
    const rows = await this.prisma.unitAlias.findMany({
      where: { normalizedAlias: normalizeUnitAlias(raw), isActive: true, unitDefinition: { is: { isActive: true } } },
      include: { unitDefinition: true },
    });
    const contextFree = rows.filter(a => a.context === null);
    const contextual = rows.filter(a => a.context !== null);

    if (!context) {
      return {
        rows: contextFree,
        contextScoped: false,
        // Only meaningful when nothing context-free survived: they explain WHY
        // the known spelling still did not resolve.
        contextRequired: contextFree.length === 0 && contextual.length === 1,
        ambiguousWithoutContext: contextFree.length === 0 && contextual.length > 1,
      };
    }

    const exact = rows.filter(a => a.context === context);
    if (exact.length > 0) {
      // Provenance is about WHICH alias answered, never about how much the set
      // shrank: a single contextual row is still a context-scoped resolution.
      return { rows: exact, contextScoped: true, contextRequired: false, ambiguousWithoutContext: false };
    }
    return { rows: contextFree, contextScoped: false, contextRequired: false, ambiguousWithoutContext: false };
  }

  async resolve(rawSourceUnit: string, rawTargetUnit: string, resourceCatalogId?: string, resourceContext?: UnitAliasContext): Promise<UnitResolutionResult> {
    const [sourceMatch, targetMatch] = await Promise.all([this.aliases(rawSourceUnit, resourceContext), this.aliases(rawTargetUnit, resourceContext)]);
    const sourceAliases = sourceMatch.rows;
    const targetAliases = targetMatch.rows;
    const contextScoped = sourceMatch.contextScoped || targetMatch.contextScoped;
    const base = { rawSourceUnit, rawTargetUnit, matchedSourceAliasIds: sourceAliases.map(a => a.id), matchedTargetAliasIds: targetAliases.map(a => a.id), conversionRuleId: null, conversionRuleVersion: null, quantityFactor: null, conversionType: null, priceOperation: null, policyVersion: UNIT_KERNEL_POLICY_VERSION } as const;
    // A missing candidate is reported for the RIGHT reason: an unheard-of
    // spelling, a spelling whose every meaning is context-scoped, and a spelling
    // with several meanings are three different facts for the human who reads it.
    const aliasProblem = (match: { rows: unknown[]; contextRequired: boolean; ambiguousWithoutContext: boolean }) =>
      match.rows.length === 0
        ? match.contextRequired
          ? UNIT_REASON.CONTEXT_REQUIRED_UNIT_ALIAS
          : match.ambiguousWithoutContext
            ? UNIT_REASON.AMBIGUOUS_UNIT_ALIAS
            : UNIT_REASON.UNKNOWN_UNIT_ALIAS
        : match.rows.length > 1
          ? UNIT_REASON.AMBIGUOUS_UNIT_ALIAS
          : null;
    const bad = aliasProblem(sourceMatch) ?? aliasProblem(targetMatch);
    const badExplanation = bad === UNIT_REASON.UNKNOWN_UNIT_ALIAS ? 'Satu atau lebih alias unit tidak dikenal.' : bad === UNIT_REASON.CONTEXT_REQUIRED_UNIT_ALIAS ? 'Alias unit dikenal tetapi seluruh pemetaannya terikat konteks; konteks tepercaya wajib diberikan.' : 'Satu atau lebih alias unit memiliki lebih dari satu pemetaan aktif.';
    if (bad) return { ...base, status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW, sourceUnitDefinition: sourceAliases.length === 1 ? sourceAliases[0].unitDefinition : null, targetUnitDefinition: targetAliases.length === 1 ? targetAliases[0].unitDefinition : null, reasonCodes: [bad], explanation: badExplanation };
    const source = sourceAliases[0].unitDefinition;
    const target = targetAliases[0].unitDefinition;
    if (source.id === target.id) return { ...base, status: UNIT_RESOLUTION_STATUS.RESOLVED, sourceUnitDefinition: source, targetUnitDefinition: target, quantityFactor: '1', priceOperation: UNIT_PRICE_OPERATION.IDENTITY, reasonCodes: contextScoped ? [UNIT_REASON.CONTEXT_SCOPED_UNIT_ALIAS, UNIT_REASON.EXACT_UNIT_ALIAS_EQUIVALENCE, UNIT_REASON.EXACT_UNIT_IDENTITY] : [UNIT_REASON.EXACT_UNIT_ALIAS_EQUIVALENCE, UNIT_REASON.EXACT_UNIT_IDENTITY], explanation: 'Kedua alias menunjuk identitas unit canonical yang sama.' };
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
    return { ...base, status: UNIT_RESOLUTION_STATUS.RESOLVED, sourceUnitDefinition: source, targetUnitDefinition: target, conversionRuleId: rule.id, conversionRuleVersion: rule.version, quantityFactor: factor.toString(), conversionType: rule.conversionType, priceOperation: UNIT_PRICE_OPERATION.DIVIDE_SOURCE_UNIT_PRICE_BY_QUANTITY_FACTOR, reasonCodes: contextScoped ? [UNIT_REASON.CONTEXT_SCOPED_UNIT_ALIAS, UNIT_REASON.UNIQUE_EVIDENCE_BOUND_RULE] : [UNIT_REASON.UNIQUE_EVIDENCE_BOUND_RULE], explanation: 'Tepat satu aturan directional aktif dan berbukti ditemukan.' };
  }
}
