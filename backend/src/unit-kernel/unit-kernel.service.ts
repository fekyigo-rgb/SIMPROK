import { Injectable } from '@nestjs/common';
import { Prisma, UnitConversionRuleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUnitAlias } from './unit-normalization';
import { CanonicalUnitIdentity, UNIT_KERNEL_POLICY_VERSION, UNIT_PRICE_OPERATION, UNIT_REASON, UNIT_RESOLUTION_STATUS, UnitAliasContext, UnitReasonCode, UnitResolutionResult } from './unit-kernel.contracts';

/** Anything able to read unit aliases — the service's own client, or a caller's open transaction. */
type UnitAliasClient = Pick<Prisma.TransactionClient, 'unitAlias'>;

interface EligibleAliases<T> {
  rows: T[];
  contextScoped: boolean;
  contextRequired: boolean;
  ambiguousWithoutContext: boolean;
  /**
   * The spelling is catalogued, but only under contexts OTHER than the one the
   * caller supplied — and nothing context-free exists to fall back to.
   *
   * Recorded so the refusal can be reported for what it is. It changes no row
   * in `rows`: this set is empty either way, so eligibility is untouched.
   */
  foreignContext: boolean;
}

/**
 * THE alias eligibility law, extracted so it has exactly one definition.
 *
 * It was previously inlined in `aliases()`. It is lifted here — unchanged, and
 * still pure — only so the RM-03D2 canonical-identity lookup can apply the SAME
 * rule instead of restating it. Two statements of this rule could drift, and a
 * drift here would silently change which unit a resource is believed to be.
 */
function selectEligibleAliases<T extends { context: string | null }>(rows: T[], context?: UnitAliasContext): EligibleAliases<T> {
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
      foreignContext: false,
    };
  }

  const exact = rows.filter(a => a.context === context);
  if (exact.length > 0) {
    // Provenance is about WHICH alias answered, never about how much the set
    // shrank: a single contextual row is still a context-scoped resolution.
    return { rows: exact, contextScoped: true, contextRequired: false, ambiguousWithoutContext: false, foreignContext: false };
  }
  // Falling back to the context-free rows is the ELIGIBILITY law and it does not
  // move: a meaning catalogued for another context is never borrowed. The only
  // thing decided here is what to CALL the resulting emptiness — a spelling with
  // foreign-context meanings and no context-free one is known-but-inapplicable,
  // which is a different fact from never having heard of it.
  return {
    rows: contextFree,
    contextScoped: false,
    contextRequired: false,
    ambiguousWithoutContext: false,
    foreignContext: contextFree.length === 0 && contextual.length > 0,
  };
}

/**
 * Why a spelling produced no single canonical meaning — or null when it did.
 *
 * Also extracted rather than duplicated: an unheard-of spelling, a spelling
 * whose every meaning is context-scoped, a spelling whose meanings all belong to
 * another context, and a spelling with several meanings are four different facts
 * for the human who reads them, and both callers must name them the same way.
 *
 * Every branch below reports the SAME refusal. Only the wording differs, so this
 * function can make the trail more truthful and can never make a unit eligible.
 */
function aliasProblem(match: { rows: unknown[]; contextRequired: boolean; ambiguousWithoutContext: boolean; foreignContext: boolean }): UnitReasonCode | null {
  return match.rows.length === 0
    ? match.contextRequired
      ? UNIT_REASON.CONTEXT_REQUIRED_UNIT_ALIAS
      : match.ambiguousWithoutContext
        ? UNIT_REASON.AMBIGUOUS_UNIT_ALIAS
        : match.foreignContext
          ? UNIT_REASON.FOREIGN_CONTEXT_UNIT_ALIAS
          : UNIT_REASON.UNKNOWN_UNIT_ALIAS
    : match.rows.length > 1
      ? UNIT_REASON.AMBIGUOUS_UNIT_ALIAS
      : null;
}

/**
 * THE canonical GOVERNED BACKEND AUTHORITY for unit identity and resolution.
 *
 * REUSE IT — DO NOT REPLICATE THE DOMAIN LOGIC. Any NEW governed backend
 * resolution logic that must answer "what does this raw spelling mean?" calls
 * this service rather than growing a second alias table, a second normalizer, or
 * a second "m3 == meter kubik" list. Two unit laws can disagree, and nothing
 * would notice.
 *
 * WHAT THIS COMMENT DOES NOT CLAIM: that every workflow in the repository
 * already routes through here today. Known normalization debt exists outside
 * this authority — browser-side unit normalization in the frontend is the
 * documented example. INT-CONNECT-01 deliberately did NOT migrate or remove it,
 * and this comment neither ratifies that debt nor pretends it is gone. It is
 * recorded as architecture debt in
 * docs/architecture/SIMPROK-INTELLIGENCE-CAPABILITY-MAP.md (CAP-UNIT-01 and
 * Bagian B), awaiting its own gate.
 */
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
    return selectEligibleAliases(rows, context);
  }

  /**
   * RM-03D2 — resolve MANY raw spellings to their canonical unit identities in
   * ONE query, under the same alias eligibility law `resolve()` uses.
   *
   * Batched on purpose: the caller asks about a source unit plus the base units
   * of a handful of tied catalog candidates, and asking per candidate would be
   * an N+1 inside a transaction that may be holding a freeze lock. Distinct
   * spellings are queried once each however many candidates share them.
   *
   * NO CONVERSION RULE IS READ HERE, and that is the whole point of the method
   * existing separately from `resolve()`. The answer is "which unit is this?",
   * never "can this become that?", so no caller can turn convertibility — least
   * of all a rule scoped to one resource — into evidence about identity.
   *
   * `client` lets the caller keep this read inside its own transaction, so an
   * identity asserted during an occurrence and re-checked during a pre-lock
   * freeze cannot see two different alias tables.
   */
  async resolveCanonicalUnitIdentities(rawUnits: readonly string[], context?: UnitAliasContext, client?: UnitAliasClient): Promise<CanonicalUnitIdentity[]> {
    // Keep the caller's exact spellings as the answer keys, but ask the
    // database only once per NORMALIZED spelling: "m3" and "M3" are one query
    // and two facts.
    const distinct = [...new Set(rawUnits)];
    const normalizedOf = new Map(distinct.map(raw => [raw, normalizeUnitAlias(raw)]));
    const wanted = [...new Set(normalizedOf.values())];
    const rows = wanted.length === 0
      ? []
      : await (client ?? this.prisma).unitAlias.findMany({
          where: { normalizedAlias: { in: wanted }, isActive: true, unitDefinition: { is: { isActive: true } } },
          include: { unitDefinition: true },
        });

    const byNormalized = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = byNormalized.get(row.normalizedAlias) ?? [];
      bucket.push(row);
      byNormalized.set(row.normalizedAlias, bucket);
    }

    return distinct.map(rawUnit => {
      const match = selectEligibleAliases(byNormalized.get(normalizedOf.get(rawUnit)!) ?? [], context);
      const problem = aliasProblem(match);
      const base = {
        rawUnit,
        // SORTED, not database order. These ids are provenance the caller keeps,
        // and the same evidence set must serialize the same way however the rows
        // arrived. Alias identity is a set; its record must behave like one.
        matchedAliasIds: match.rows.map(a => a.id).sort(),
        contextScoped: match.contextScoped,
        // Stated only when a context-scoped alias actually carried the answer.
        // `selectEligibleAliases` reaches that branch exclusively via
        // `alias.context === context`, so this names a dependency that provably
        // existed rather than echoing whatever the caller happened to pass.
        resolvedContext: match.contextScoped ? context ?? null : null,
        policyVersion: UNIT_KERNEL_POLICY_VERSION,
      } as const;
      return problem
        ? { ...base, status: UNIT_RESOLUTION_STATUS.NEEDS_REVIEW, unitDefinition: null, reasonCode: problem }
        : { ...base, status: UNIT_RESOLUTION_STATUS.RESOLVED, unitDefinition: match.rows[0].unitDefinition, reasonCode: match.contextScoped ? UNIT_REASON.CONTEXT_SCOPED_UNIT_ALIAS : UNIT_REASON.EXACT_UNIT_IDENTITY };
    });
  }

  async resolve(rawSourceUnit: string, rawTargetUnit: string, resourceCatalogId?: string, resourceContext?: UnitAliasContext): Promise<UnitResolutionResult> {
    const [sourceMatch, targetMatch] = await Promise.all([this.aliases(rawSourceUnit, resourceContext), this.aliases(rawTargetUnit, resourceContext)]);
    const sourceAliases = sourceMatch.rows;
    const targetAliases = targetMatch.rows;
    const contextScoped = sourceMatch.contextScoped || targetMatch.contextScoped;
    const base = { rawSourceUnit, rawTargetUnit, matchedSourceAliasIds: sourceAliases.map(a => a.id), matchedTargetAliasIds: targetAliases.map(a => a.id), conversionRuleId: null, conversionRuleVersion: null, quantityFactor: null, conversionType: null, priceOperation: null, policyVersion: UNIT_KERNEL_POLICY_VERSION } as const;
    // A missing candidate is reported for the RIGHT reason (see `aliasProblem`):
    // an unheard-of spelling, a spelling whose every meaning is context-scoped,
    // and a spelling with several meanings are three different facts.
    const bad = aliasProblem(sourceMatch) ?? aliasProblem(targetMatch);
    const badExplanation = bad === UNIT_REASON.UNKNOWN_UNIT_ALIAS ? 'Satu atau lebih alias unit tidak dikenal.' : bad === UNIT_REASON.CONTEXT_REQUIRED_UNIT_ALIAS ? 'Alias unit dikenal tetapi seluruh pemetaannya terikat konteks; konteks tepercaya wajib diberikan.' : bad === UNIT_REASON.FOREIGN_CONTEXT_UNIT_ALIAS ? 'Alias unit dikenal, tetapi seluruh pemetaannya terikat pada konteks lain dan tidak berlaku untuk konteks yang diminta. Makna dari konteks lain tidak pernah dipinjam.' : 'Satu atau lebih alias unit memiliki lebih dari satu pemetaan aktif.';
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
