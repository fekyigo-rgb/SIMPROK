import { Injectable } from '@nestjs/common';
import {
  Prisma,
  ProjectAhspPriceMode,
  ProjectAhspResolutionMethod,
  ProjectAhspResolutionStatus,
  ProjectAhspSelectionMode,
} from '@prisma/client';
import { resolveAhspResourcePrice } from '../ahsp/price-resolution/ahsp-resource-price-resolution.kernel';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { BasicPriceService } from '../basic-price/basic-price.service';
import { promotionLineagePrecedenceWhere } from '../basic-price/basic-price-promotion-precedence';
import { basicPriceRegionApplicabilityWhere } from '../basic-price/basic-price-region-applicability';
import {
  basicPriceCurrentnessWhere,
  mergeCurrentnessAnd,
} from '../basic-price/basic-price-currentness';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { isResourceCatalogIdShape } from '../resource-catalog/resource-identity-resolution.kernel';
import { identicalQuestionKey } from '../resource-catalog/identical-question-key';
import { sumResolvedResourceCosts } from '../project/cost-kernel.kernel';
import {
  normalizedAuxiliaryName,
  selectAuxiliaryEstimatePolicy,
} from './auxiliary-equipment-estimate.policy';

/**
 * RM-03D2 advanced this from V1.
 *
 * The version labels the LAW a stored resolution was decided under, and that law
 * changed: under V1 an exact-name/type tie could only ever be NEEDS_REVIEW,
 * while under V2 it may be RESOLVED when the source's own stated unit identifies
 * exactly one representation. A V1 row and a V2 row carrying the same status
 * were therefore not produced by the same rules, and leaving both labelled V1
 * would make the audit trail claim they were.
 *
 * No schema change: this is the same String column it has always been.
 */
export const E1A_RESOLUTION_POLICY_VERSION = 'E1A_CONTEXTUAL_EXACT_REGION_V3_ABLS01';

export type ResolutionCreate =
  Prisma.ProjectAhspResourceResolutionUncheckedCreateWithoutOccurrenceInput;

export interface ResolveVersionResourcesInput {
  workspaceId: string;
  projectId: string;
  referenceRegionId: string;
  /** The business pricing date this resolution answers for. Never "today". */
  asOf: Date;
  version: {
    id: string;
    resources: readonly any[];
    ahsp?: { workType?: string | null; methodName?: string | null } | null;
  };
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

  private holdEstimate(resolution: ResolutionCreate, code: string, explanation: string): void {
    resolution.status = ProjectAhspResolutionStatus.NEEDS_REVIEW;
    resolution.reasonCodes = [
      ...(Array.isArray(resolution.reasonCodes) ? resolution.reasonCodes : []),
      code,
    ];
    resolution.explanation = `${resolution.explanation} ${explanation}`;
  }

  /**
   * ACG-01 CLOSURE 1 — THE SOURCE FACTS THIS LINE CARRIES, DERIVED ONCE.
   *
   * The identity question and the IQL-01 exact-question key MUST be built from
   * the same values or the ledger is consulted with a question nobody asked.
   * So they are derived here, once, and both callers read this.
   *
   * `resourceId` is one column holding two kinds of fact: a hand-built recipe
   * keeps the source's own words there, a document-canonicalised row holds the
   * catalog id the import proved. Since CLOSURE 1 the document row also carries
   * its real spelling, code and unit, so the raw channel no longer has to be
   * emptied to keep the id channel honest — each fact travels its own way.
   *
   * Nothing is back-filled: a line with no stored source facts (every row
   * written before the migration, and every hand-built recipe) behaves exactly
   * as it did before.
   */
  private sourceFacts(resource: any): {
    rawName: string;
    rawCode: string | null;
    rawUnit: string | null;
    resourceType: string;
    resourceCatalogId: string | null;
  } {
    const canonicalCatalogId = isResourceCatalogIdShape(resource.resourceId)
      ? resource.resourceId
      : null;
    return {
      rawName:
        resource.rawName ??
        (canonicalCatalogId === null ? resource.resourceId : ''),
      rawCode: resource.rawCode ?? null,
      rawUnit: resource.rawUnit ?? resource.baseUnit,
      resourceType: resource.resourceType,
      resourceCatalogId: canonicalCatalogId,
    };
  }

  async resolveVersionResources(
    tx: any,
    input: ResolveVersionResourcesInput,
  ): Promise<ResolutionCreate[]> {
    const { asOf, version } = input;
    // The AHSP parent already owns its work description. Reuse that source
    // context to explain a held candidate without treating an application
    // (e.g. mortar) as proof that two catalog resource identities are equal.
    // Missing context remains missing; no heuristic or brand is invented.
    const workDescription = version.ahsp?.methodName?.replace(/\s+/g, ' ').trim() ?? '';
    const workCode = version.ahsp?.workType?.replace(/\s+/g, ' ').trim() ?? '';
    // A code without a work description is NOT evidence of material function.
    const workContextNote = workDescription.length > 0
      ? ` Konteks pekerjaan AHSP: ${JSON.stringify(
          [workCode, workDescription].filter(Boolean).join(' — ').slice(0, 240),
        )}. Gunakan sebagai petunjuk kecocokan fungsi saat meninjau kandidat; konteks bukan bukti kesamaan identitas ResourceCatalog.`
      : '';

    // GHX-01: the version's AHSP source facts are known up front, so governed
    // human decisions for all of them are preloaded in ONE bounded query here
    // rather than one query per ambiguous row inside the loop below.
    // IQL-01: the exact questions this version is about to ask, so an answer a
    // human already gave and a second holder already APPROVED is consulted here
    // instead of being asked again. The keys are built from the SAME facts the
    // kernel is handed below (sourceFacts), because an exact-question ledger
    // consulted with a different question is worse than not consulting it.
    //
    // Until CLOSURE 1 this could not work at all: the occurrence question always
    // carried rawCode null while the import-side question carried the document's
    // code, so the two keys could not be equal for any row that stated one.
    const identicalQuestionKeys = version.resources.map((resource: any) => {
      const facts = this.sourceFacts(resource);
      return identicalQuestionKey({
        workspaceId: input.workspaceId,
        resourceType: facts.resourceType,
        rawName: facts.rawName,
        rawCode: facts.rawCode,
        rawUnit: facts.rawUnit,
      });
    });
    const identityEvidence = await this.identity.loadEvidence(
      tx,
      input.workspaceId,
      version.resources.map((resource: any) => resource.id),
      { identicalQuestionKeys },
    );

    // BP-ONE-TRUTH-01: same exact-link offer policy used by Explorer and
    // /basic-prices/resource. The caller's tx is retained for one snapshot;
    // a new observation never rewrites a previously decided RAB resolution.
    const precedence = promotionLineagePrecedenceWhere(input.workspaceId);
    // This orchestrator predates a typed transaction seam (`tx: any`).
    // Narrow only the proven Prisma price-read surface, without changing its
    // existing transaction, identity resolver or Cost Kernel contracts.
    const offerReadClient = tx as Pick<
      Prisma.TransactionClient,
      '$queryRaw' | 'basicPrice'
    >;
    const olderOffers =
      await BasicPriceService.olderSameSourceObservationOfferIds(
        offerReadClient,
        this.eligibility,
        input.workspaceId,
        asOf,
        precedence,
      );
    const priceRows = await tx.basicPrice.findMany({
      where: {
        ...this.eligibility.usableWhere(input.workspaceId),
        ...(olderOffers.length > 0 ? { id: { notIn: olderOffers } } : {}),
        // BP-CAT-01E — this is the CANDIDATE offer, so the one-logical-truth rule
        // applies: a workspace must not be offered its own price twice, once as
        // the origin it owns and again as the descendant it donated, and then be
        // told the ambiguity NEEDS_REVIEW. The re-read below stays raw-lawful on
        // purpose — it is already bound to a row this offer contained.
        ...precedence,
        // BP-CORR-01 — a price a published correction has REPLACED is still lawful
        // and still readable, but it is no longer what this resource costs. Offering
        // it here would put the old money back into a new calculation, and offering
        // it ALONGSIDE its successor would make the resolver report NEEDS_REVIEW for
        // an ambiguity SIMPROK had already resolved.
        //
        // The re-read below deliberately does NOT compose this, and that is what
        // preserves historical calculations: a resolution persisted against a price
        // that has since been superseded still re-reads that exact row and still
        // proves its provenance. Selection changed; history did not.
        ...mergeCurrentnessAnd(basicPriceCurrentnessWhere({ asOf }), [
          { OR: [{ validUntil: null }, { validUntil: { gte: asOf } }] },
          basicPriceRegionApplicabilityWhere(input.referenceRegionId),
        ]),
        effectiveDate: { lte: asOf },
      },
      include: { resource: true },
    });

const resolutions: ResolutionCreate[] = [];
const auxiliaryCandidates: Array<{
  index: number;
  resource: any;
  catalog: any;
}> = [];
for (const resource of version.resources) {
  // RM-03D1: identity is decided FIRST, by its own authority, and the
  // raw AHSP reference is passed through untouched so the audit trail
  // keeps saying what the source said. AHSPResource has no source-code
  // column today, so the code channel is genuinely empty here rather
  // than back-filled from the catalog — which would make the evidence
  // agree with itself by construction.
  // RM-03D2: the caller's transaction is handed down so the canonical-unit
  // evidence a representation tie is settled with is read inside the SAME
  // consistency window as the rest of this resolution — including the FOR
  // UPDATE window the RAB pre-lock gate runs in.
  // GHX-01: the decision SUBJECT is derived server-side from the occurrence's
  // own truth — the workspace this resolution runs in and the immutable AHSP
  // source fact being resolved. Never from client input, and never from the
  // resource's spelling: a different AHSPResource that happens to read the same
  // cannot borrow this one's governed decision.
  //
  // Shape only. Whether that id actually exists, is ACTIVE, is reachable from
  // this workspace and states the right class is the identity authority's
  // question, and it is asked — and refused — there, never here.
  const facts = this.sourceFacts(resource);
  const canonicalCatalogId = facts.resourceCatalogId;
  const identity = await this.identity.resolve(
    {
      ...identityEvidence,
      ghxSubject: {
        workspaceId: input.workspaceId,
        ahspResourceId: resource.id,
        resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
      },
    },
    {
      // Each fact travels its own channel: the catalog id the import proved
      // goes through `resourceCatalogId`, and what the DOCUMENT said goes
      // through the raw channels. Sending the id through `rawName` used to ask
      // the catalog for a resource literally NAMED "cb50aeab-…", which is why
      // an identity SIMPROK had already established came back
      // RESOURCE_NOT_FOUND.
      //
      // ACG-01 CLOSURE 1 — the code channel is no longer forced empty. It is
      // the code the SOURCE stated, read back from the row, and it is evidence
      // only: the kernel compares it against codes it has SEEN BEFORE in
      // sightings and reviewed mappings, never against ResourceCatalog.code,
      // and every such nomination still passes the type and specification
      // guards in note(). A shared code therefore cannot outrank a stated
      // specification, and code equality never becomes identity.
      ...facts,
    },
    tx,
  );

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
      explanation: identity.explanation + workContextNote,
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
      // Reported as it happened. A representation tie settled by the source's
      // own unit is NOT the same fact as a lone exact name match, and the
      // persisted reasonCodes must not say it was.
      identityReason:
        identity.authority === 'CATALOG_ID_REFERENCE_VALIDATED'
          ? // An identifier was validated; no name was read. Reporting this as
            // a name match would put a comparison that never happened into the
            // persisted reasonCodes.
            'RESOURCE_CATALOG_ID_ACTIVE_AND_SCOPED'
          : identity.authority === 'VERIFIED_MAPPING_REUSED'
            ? 'VERIFIED_MAPPING_REUSED'
            : identity.authority === 'EXACT_CANONICAL_MATCH_WITH_UNIT_CONTEXT'
              ? 'EXACT_RESOURCE_NAME_MATCH_WITH_UNIT_CONTEXT'
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
          effectiveDate: { lte: asOf },
          AND: [
            {
              OR: [
                { validUntil: null },
                { validUntil: { gte: asOf } },
              ],
            },
            basicPriceRegionApplicabilityWhere(input.referenceRegionId),
          ],
        },
        include: { resource: true },
      })
    : null;
  // IDENTITY TRUTH AND PRICE TRUTH ARE TWO FACTS, AND THE ROW KEEPS BOTH.
  //
  // The price kernel answers a strictly later question — "can this ALREADY
  // PROVEN resource receive a trusted price?" — so its explanation begins from
  // an identity it was handed and never re-derived. Persisting only that answer
  // erased how the identity had been established: which representations existed,
  // which unit authority chose between them, on what trusted context, and that
  // the specification check passed. It erased it in both directions, too. A
  // price that could not be proved replaced a proven identity with a sentence
  // about units, so the row read as though nothing about the resource had been
  // settled; and a price that succeeded replaced it with a simpler story than
  // the one that actually happened.
  //
  // They are therefore COMPOSED, never substituted, in the order they occurred:
  // identity first, by its own authority, then pricing. Neither kernel gains the
  // other's job — the price kernel still knows nothing about representation
  // ties, and the identity kernel still knows nothing about money.
  const explanation = `${identity.explanation} ${result.explanation}` +
    (result.status === 'RESOLVED' ? '' : workContextNote);
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
    canonicalUnit: unitResolution?.status === 'RESOLVED'
      ? unitResolution.targetUnitDefinition?.code ?? null
      : null,
    sourcePriceValue: resolved ? result.sourcePriceValue : null,
    sourceUnit: resolved ? selected.resource.baseUnit : null,
    adaptedPriceValue: resolved ? result.adaptedPriceValue : null,
    priceMode: resolved ? ProjectAhspPriceMode.BASIC_PRICE : null,
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
    explanation,
    policyVersion: E1A_RESOLUTION_POLICY_VERSION,
  });
  const sourceName = normalizedAuxiliaryName(facts.rawName);
  const isVerifiedGenericAuxiliary =
    normalizedAuxiliaryName(identifiedCatalog.name) === 'alat bantu' &&
    identifiedCatalog.type === 'EQUIPMENT' &&
    resource.resourceType === 'EQUIPMENT' &&
    (sourceName === '' || sourceName === 'alat bantu') &&
    unitResolution?.status === 'RESOLVED' &&
    unitResolution.targetUnitDefinition?.code === 'LS' &&
    new Prisma.Decimal(unitResolution.quantityFactor ?? 0).equals(1);
  if (!resolved && result.reasonCodes.includes('NO_BASIC_PRICE_CANDIDATE') && isVerifiedGenericAuxiliary) {
    auxiliaryCandidates.push({ index: resolutions.length - 1, resource, catalog: identifiedCatalog });
    if (!new Prisma.Decimal(resource.coefficient).equals(1)) {
      this.holdEstimate(resolutions[resolutions.length - 1],
        'AUXILIARY_ESTIMATE_COEFFICIENT_NOT_ONE',
        'Estimasi sementara ditahan karena koefisien Alat Bantu bukan satu.');
    }
  }
}

    if (auxiliaryCandidates.length > 1) {
      for (const candidate of auxiliaryCandidates) {
        this.holdEstimate(resolutions[candidate.index], 'AUXILIARY_ESTIMATE_MULTIPLE_ROWS',
          'Estimasi sementara ditahan karena AHSP memiliki lebih dari satu baris Alat Bantu generik.');
      }
      return resolutions;
    }
    const auxiliary = auxiliaryCandidates[0];
    if (!auxiliary) return resolutions;
    const target = resolutions[auxiliary.index];
    if (!new Prisma.Decimal(auxiliary.resource.coefficient).equals(1)) return resolutions;

    const selection = await selectAuxiliaryEstimatePolicy(tx, {
      workspaceId: input.workspaceId,
      ahspVersionId: version.id,
      asOf,
    });
    if (selection.status !== 'SELECTED') {
      this.holdEstimate(target, selection.reasonCode,
        'Estimasi sementara ditahan: tidak ada kebijakan terpilih yang sah dan tidak berkonflik.');
      return resolutions;
    }
    const policy = selection.policy;

    const basis = sumResolvedResourceCosts(version.id, resolutions
      .map((resolution, index) => ({ resolution, index }))
      .filter(({ index }) => index !== auxiliary.index)
      .map(({ resolution }) => ({
        ahspResourceId: String(resolution.ahspResourceId),
        resolutionId: `prospective:${String(resolution.ahspResourceId)}`,
        status: String(resolution.status),
        ahspVersionId: version.id,
        coefficient: new Prisma.Decimal(String(resolution.ahspCoefficient)).toString(),
        adaptedPriceValue: resolution.adaptedPriceValue === null || resolution.adaptedPriceValue === undefined
          ? null : new Prisma.Decimal(String(resolution.adaptedPriceValue)).toString(),
      })));
    if (!basis.ok || !basis.total.greaterThan(0)) {
      this.holdEstimate(target, 'AUXILIARY_ESTIMATE_BASIS_UNRESOLVED',
        'Estimasi sementara ditahan: seluruh sumber daya lain harus RESOLVED dan basis harus lebih besar dari nol.');
      return resolutions;
    }

    const percent = new Prisma.Decimal(policy.percent);
    const exactDerived = basis.total.mul(percent).div(100);
    const adapted = exactDerived.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    target.status = ProjectAhspResolutionStatus.RESOLVED;
    target.selectionMode = ProjectAhspSelectionMode.AUTO_SELECTED;
    target.priceMode = ProjectAhspPriceMode.TEMPORARY_ESTIMATE;
    target.resourceCatalogId = auxiliary.catalog.id;
    target.selectedBasicPriceId = null;
    target.sourcePriceValue = null;
    target.sourceUnit = null;
    target.adaptedPriceValue = adapted;
    target.estimatePolicyId = policy.id;
    target.estimatePolicyVersion = policy.version;
    target.estimatePercent = percent;
    target.estimateBasisAmount = basis.total;
    target.estimateDerivedAmount = exactDerived;
    target.estimateApprovalReference = policy.approvalReference;
    target.estimateApprovedByAccountId = policy.approvedByAccountId;
    target.estimateApprovedByPositionId = policy.approvedByPositionId;
    target.estimateAuthorityCode = policy.approvalAuthorityCode;
    target.estimateApprovedAt = policy.approvedAt;
    target.resolutionMethod = ProjectAhspResolutionMethod.EXACT_DETERMINISTIC;
    target.reasonCodes = [
      ...(Array.isArray(target.reasonCodes) ? target.reasonCodes : []),
      'AUXILIARY_TEMPORARY_ESTIMATE_APPROVED',
    ];
    target.explanation = `${target.explanation} Estimasi sementara Alat Bantu memakai seluruh biaya non-auxiliary yang RESOLVED dan kebijakan ${policy.id} versi ${policy.version}; bukan harga katalog SIMPROK.`;

    return resolutions;
  }
}
