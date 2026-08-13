import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ProjectAhspResolutionMethod,
  ProjectAhspResolutionStatus,
  ProjectAhspSelectionMode,
} from '@prisma/client';
import { resolveAhspResourcePrice } from '../ahsp/price-resolution/ahsp-resource-price-resolution.kernel';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';

export const E1A_RESOLUTION_POLICY_VERSION = 'E1A_CONTEXTUAL_EXACT_REGION_V1';

export type ResolutionCreate =
  Prisma.ProjectAhspResourceResolutionUncheckedCreateWithoutOccurrenceInput;

export interface ResolveVersionResourcesInput {
  workspaceId: string;
  projectId: string;
  referenceRegionId: string;
  /** The business pricing date this resolution answers for. Never "today". */
  asOf: Date;
  version: { id: string; resources: readonly any[] };
}

/**
 * THE Golden Thread resource-price decision, in one place.
 *
 * This is a verbatim extraction of the loop that used to live inside
 * ProjectAhspService.selectForBoqItem. It was extracted for one reason: the
 * RAB pre-lock gate has to be able to ask the SAME question the occurrence
 * path asks — "given everything SIMPROK lawfully knows now, for this exact
 * date, which Basic Price would be selected?" — and asking it from a second
 * implementation would mean two authorities that can disagree. A pre-lock
 * check that disagrees with the resolver is worse than no check at all: it
 * would either block lawful locks or bless drifted ones.
 *
 * Nothing about the decision changed in the move. Identity is still settled
 * first by its own authority, the eligible candidate set is still built from
 * BasicPriceEligibilityPolicy's one predicate, cardinality is still decided by
 * the scope-blind resolveAhspResourcePrice kernel, and the selected row is
 * still re-read through the identical predicate so the re-verification can
 * never accept a row the offer could not have contained.
 *
 * Every query runs on the caller's transaction client, so the pre-lock gate
 * can run this inside the same FOR UPDATE window that performs the freeze.
 */
@Injectable()
export class AhspResourceResolutionOrchestrator {
  constructor(
    private readonly eligibility: BasicPriceEligibilityPolicy,
    private readonly units: UnitKernelService,
    private readonly identity: ResourceIdentityResolutionService,
  ) {}

  async resolveVersionResources(
    tx: any,
    input: ResolveVersionResourcesInput,
  ): Promise<ResolutionCreate[]> {
    const { asOf, version } = input;

    const identityEvidence = await this.identity.loadEvidence(tx, input.workspaceId);

const priceRows = await tx.basicPrice.findMany({
  where: {
    ...this.eligibility.usableWhere(input.workspaceId),
    regionId: input.referenceRegionId,
    effectiveDate: { lte: asOf },
    AND: [
      { OR: [{ validUntil: null }, { validUntil: { gte: asOf } }] },
    ],
  },
  include: { resource: true },
});

const resolutions: ResolutionCreate[] = [];
for (const resource of version.resources) {
  // RM-03D1: identity is decided FIRST, by its own authority, and the
  // raw AHSP reference is passed through untouched so the audit trail
  // keeps saying what the source said. AHSPResource has no source-code
  // column today, so the code channel is genuinely empty here rather
  // than back-filled from the catalog — which would make the evidence
  // agree with itself by construction.
  const identity = this.identity.resolve(identityEvidence, {
    rawName: resource.resourceId,
    rawCode: null,
    rawUnit: resource.baseUnit,
    resourceType: resource.resourceType,
  });

  const identifiedCatalog =
    identity.status === 'RESOLVED' && identity.resolvedResourceCatalogId
      ? identityEvidence.catalogCandidates.find(
          (candidate) =>
            candidate.id === identity.resolvedResourceCatalogId,
        ) ?? null
      : null;

  // Identity unproven → the row records exactly that, with the candidates
  // and evidence the kernel found. It is NOT pushed through the price
  // path only to come back as a name-match failure, because "we found two
  // plausible cements" and "no such resource" are different facts and the
  // audit trail must not blur them.
  if (identifiedCatalog === null) {
    resolutions.push({
      ahspResourceId: resource.id,
      rawAhspResourceRef: resource.resourceId,
      rawAhspResourceType: resource.resourceType,
      ahspCoefficient: resource.coefficient,
      ahspUnit: resource.baseUnit,
      status:
        identity.status === 'NEEDS_REVIEW'
          ? ProjectAhspResolutionStatus.NEEDS_REVIEW
          : ProjectAhspResolutionStatus.UNRESOLVED,
      selectionMode: null,
      resourceCatalogId: null,
      selectedBasicPriceId: null,
      canonicalUnit: null,
      sourcePriceValue: null,
      sourceUnit: null,
      adaptedPriceValue: null,
      conversionFactor: null,
      sourceUnitDefinitionId: null,
      targetUnitDefinitionId: null,
      unitConversionRuleId: null,
      unitConversionRuleVersion: null,
      quantityFactor: null,
      selectedSourceOrigin: null,
      selectedFreshnessStatus: null,
      selectedEffectiveDate: null,
      resolutionMethod:
        ProjectAhspResolutionMethod.DETERMINISTIC_ATTEMPTED,
      reasonCodes: [...identity.reasonCodes],
      explanation: identity.explanation,
      policyVersion: E1A_RESOLUTION_POLICY_VERSION,
    });
    continue;
  }

  // The one catalog row identity settled on, in the price kernel's shape.
  // `type` is narrowed rather than re-validated: it comes straight from
  // the ResourceType database enum, which admits no other value.
  const matches = [
    {
      id: identifiedCatalog.id,
      code: identifiedCatalog.code,
      name: identifiedCatalog.name,
      type: identifiedCatalog.type as 'MATERIAL' | 'LABOR' | 'EQUIPMENT',
      baseUnit: identifiedCatalog.baseUnit,
    },
  ];
  // THE TRUSTED UNIT CONTEXT for every unit question asked about this
  // resource — see UNIT_ALIAS_CONTEXT: "context must come from a governed
  // classification the system already holds about the resource, never from
  // reading a resource NAME. ResourceCatalog.type is a fact."
  //
  // Without it, a source that writes one machine-hour or one labour-hour as
  // "jam" is unanswerable: the alias is catalogued in BOTH the LABOR and the
  // EQUIPMENT context, so the kernel correctly refuses with
  // AMBIGUOUS_UNIT_ALIAS and the resource ends UNRESOLVED — not because
  // SIMPROK cannot read the document, but because this call never told it
  // which hour it was looking at. Basic Price row resolution already passes
  // its own trusted context (`row.sourceSection`); the occurrence path was
  // simply not passing the one it holds.
  //
  // It is the CATALOG's class, not the AHSP line's text, and the two are
  // already proven equal: identity resolution admits a candidate only when
  // `typeMatches(candidate.type, resource.resourceType)`. Nothing is guessed,
  // nothing is widened, and passing no context stays fail-closed as before.
  const trustedUnitContext = matches[0].type;
  const unitResolution = await this.units.resolve(
    resource.baseUnit,
    identifiedCatalog.baseUnit,
    identifiedCatalog.id,
    trustedUnitContext,
  );
  const candidates = await Promise.all(
    priceRows.map(async (price) => {
      const resolved =
        price.resourceId === identifiedCatalog.id
          ? await this.units.resolve(
              price.resource.baseUnit,
              identifiedCatalog.baseUnit,
              identifiedCatalog.id,
              trustedUnitContext,
            )
          : null;
      return {
        id: price.id,
        resourceId: price.resourceId,
        value: price.value.toString(),
        sourceOrigin: price.sourceOrigin,
        unit: price.resource.baseUnit,
        freshnessStatus: price.freshnessStatus,
        unitResolution: {
          status: resolved?.status ?? 'NEEDS_REVIEW',
          canonicalUnitCode: resolved?.targetUnitDefinition?.code ?? null,
          quantityFactor: resolved?.quantityFactor ?? null,
          priceOperation: resolved?.priceOperation ?? null,
          rawSourceUnit: resolved?.rawSourceUnit ?? '',
          rawTargetUnit: resolved?.rawTargetUnit ?? '',
        },
      } as const;
    }),
  );
  const result = resolveAhspResourcePrice({
    projectId: input.projectId,
    ahspVersionId: version.id,
    ahspResourceId: resource.id,
    rawResourceRef: resource.resourceId,
    resourceType: resource.resourceType,
    ahspUnit: resource.baseUnit,
    resourceCatalogCandidates: matches,
    eligibleBasicPriceCandidates: candidates,
    // Identity already settled above, by its own authority. The price
    // kernel consumes that verdict exactly as it consumes the UnitKernel's
    // instead of re-deriving it from the name — which is the only way a
    // human-verified mapping between two DIFFERENT spellings can survive
    // this far without being rejected as a name mismatch.
    resolvedIdentity: {
      catalog: matches[0],
      identityReason:
        identity.authority === 'VERIFIED_MAPPING_REUSED'
          ? 'VERIFIED_MAPPING_REUSED'
          : 'EXACT_RESOURCE_NAME_MATCH',
    },
    validatedUnitResolution: {
      status: unitResolution?.status ?? 'NEEDS_REVIEW',
      canonicalUnitCode:
        unitResolution?.targetUnitDefinition?.code ?? null,
      quantityFactor: unitResolution?.quantityFactor ?? null,
      rawSourceUnit: unitResolution?.rawSourceUnit ?? '',
      rawTargetUnit: unitResolution?.rawTargetUnit ?? '',
    },
  });
  const selectedCandidate =
    result.status === 'RESOLVED'
      ? priceRows.find((row) => row.id === result.selectedBasicPriceId)
      : undefined;
  const selected = selectedCandidate
    ? await tx.basicPrice.findFirst({
        where: {
          id: selectedCandidate.id,
          // Same predicate the candidate query used, from the same
          // builder — the re-read must never accept a row the offer
          // could not have contained, nor reject one it did.
          ...this.eligibility.usableWhere(input.workspaceId),
          regionId: input.referenceRegionId,
          effectiveDate: { lte: asOf },
          AND: [
            {
              OR: [
                { validUntil: null },
                { validUntil: { gte: asOf } },
              ],
            },
          ],
        },
        include: { resource: true },
      })
    : null;
  const resolved =
    result.status === 'RESOLVED' &&
    selected !== null &&
    selected.resourceId === result.resolvedResourceCatalogId &&
    selected.value.toString() === result.sourcePriceValue;
  resolutions.push({
    ahspResourceId: resource.id,
    rawAhspResourceRef: resource.resourceId,
    rawAhspResourceType: resource.resourceType,
    ahspCoefficient: resource.coefficient,
    ahspUnit: resource.baseUnit,
    status: resolved
      ? ProjectAhspResolutionStatus.RESOLVED
      : result.status === 'NEEDS_REVIEW'
        ? ProjectAhspResolutionStatus.NEEDS_REVIEW
        : ProjectAhspResolutionStatus.UNRESOLVED,
    selectionMode: resolved ? ProjectAhspSelectionMode.AUTO_SELECTED : null,
    resourceCatalogId: resolved ? result.resolvedResourceCatalogId : null,
    selectedBasicPriceId: resolved ? result.selectedBasicPriceId : null,
    canonicalUnit: resolved ? result.canonicalUnit : null,
    sourcePriceValue: resolved ? result.sourcePriceValue : null,
    sourceUnit: resolved ? selected.resource.baseUnit : null,
    adaptedPriceValue: resolved ? result.adaptedPriceValue : null,
    conversionFactor: null,
    sourceUnitDefinitionId:
      unitResolution?.sourceUnitDefinition?.id ?? null,
    targetUnitDefinitionId:
      unitResolution?.targetUnitDefinition?.id ?? null,
    unitConversionRuleId: unitResolution?.conversionRuleId ?? null,
    unitConversionRuleVersion:
      unitResolution?.conversionRuleVersion ?? null,
    quantityFactor: unitResolution?.quantityFactor ?? null,
    selectedSourceOrigin: resolved ? selected.sourceOrigin : null,
    selectedFreshnessStatus: resolved ? selected.freshnessStatus : null,
    selectedEffectiveDate: resolved ? selected.effectiveDate : null,
    resolutionMethod: resolved
      ? ProjectAhspResolutionMethod.EXACT_DETERMINISTIC
      : ProjectAhspResolutionMethod.DETERMINISTIC_ATTEMPTED,
    reasonCodes: [...result.reasonCodes],
    explanation: result.explanation,
    policyVersion: E1A_RESOLUTION_POLICY_VERSION,
  });
}


    return resolutions;
  }
}
