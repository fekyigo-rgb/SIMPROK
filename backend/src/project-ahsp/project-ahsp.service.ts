import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AhspVersionStatus,
  Prisma,
  ProjectAhspResolutionMethod,
  ProjectAhspResolutionStatus,
  ProjectAhspSelectionMode,
  ProjectStatus,
} from '@prisma/client';
import { createHash } from 'crypto';
import {
  buildEligibleAhspVersionWhere,
  classifyAhspOrigin,
} from './ahsp-eligibility.policy';
import { resolveAhspResourcePrice } from '../ahsp/price-resolution/ahsp-resource-price-resolution.kernel';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { parseDateOnlyUtc } from '../common/date-only.util';
import { PrismaService } from '../prisma/prisma.service';
import { RabLifecyclePolicyService, WORKING_DRAFT_STRUCTURE_NAME } from '../project/rab-lifecycle-policy.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';

export const E1A_RESOLUTION_POLICY_VERSION = 'E1A_CONTEXTUAL_EXACT_REGION_V1';
const includeOccurrence = { resourceResolutions: true } as const;

export interface SelectAhspForBoqItemInput {
  projectId: string;
  workspaceId: string;
  accountId: string;
  boqItemId: string;
  ahspVersionId: string;
  businessPricingAsOfDate: string;
  referenceRegionId: string;
  idempotencyKey: string;
}

type ResolutionCreate =
  Prisma.ProjectAhspResourceResolutionUncheckedCreateWithoutOccurrenceInput;

const sha256 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

@Injectable()
export class ProjectAhspService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: BasicPriceEligibilityPolicy,
    private readonly units: UnitKernelService,
    private readonly lifecycle: RabLifecyclePolicyService,
    private readonly identity: ResourceIdentityResolutionService,
  ) {}

  async listEligibleVersions(workspaceId: string, asOfRaw: string) {
    const asOf = parseDateOnlyUtc(asOfRaw, 'businessPricingAsOfDate');
    const versions = await this.prisma.aHSPVersion.findMany({
      where: buildEligibleAhspVersionWhere(workspaceId, asOf),
      select: {
        id: true,
        versionNumber: true,
        status: true,
        outputUnit: true,
        effectiveDate: true,
        expiredDate: true,
        ahsp: {
          select: {
            id: true,
            workType: true,
            methodName: true,
            workspaceId: true,
            ownershipType: true,
          },
        },
        _count: { select: { resources: true } },
      },
      orderBy: [
        { ahsp: { workType: 'asc' } },
        { ahsp: { methodName: 'asc' } },
        { versionNumber: 'desc' },
      ],
    });

    // RM-03B: every row carries its own origin so the picker can tell a user
    // "this is your own AHSP" vs "this is the SIMPROK catalog" without the
    // frontend having to re-derive tenancy rules it should not own.
    return versions.map(({ ahsp, ...version }) => ({
      ...version,
      origin: classifyAhspOrigin({ status: version.status, ahsp }, workspaceId),
      ahsp: {
        id: ahsp.id,
        workType: ahsp.workType,
        methodName: ahsp.methodName,
      },
    }));
  }

  listActiveRegions() {
    return this.prisma.region.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: 'asc' }],
    });
  }

  async selectForBoqItem(input: SelectAhspForBoqItemInput) {
    if (input.boqItemId.startsWith('local-')) {
      throw new ConflictException('UNPERSISTED_BOQ_ITEM_NOT_SELECTABLE');
    }
    const asOf = parseDateOnlyUtc(
      input.businessPricingAsOfDate,
      'businessPricingAsOfDate',
    );
    const requestPayloadHash = sha256({
      boqItemId: input.boqItemId,
      ahspVersionId: input.ahspVersionId,
      businessPricingAsOfDate: input.businessPricingAsOfDate,
      referenceRegionId: input.referenceRegionId,
      resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
    });

    try {
      return await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string; workspaceId: string | null }>
      >(Prisma.sql`SELECT "id", "status", "workspaceId" FROM "projects" WHERE "id" = ${input.projectId}::uuid FOR UPDATE`);
      const project = locked[0];
      if (!project || project.workspaceId !== input.workspaceId) {
        throw new NotFoundException('PROJECT_NOT_FOUND');
      }

      const replay = await tx.projectAhspOccurrence.findFirst({
        where: {
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey,
        },
        include: includeOccurrence,
      });
      if (replay) {
        if (replay.requestPayloadHash !== requestPayloadHash) {
          throw new ConflictException('IDEMPOTENCY_PAYLOAD_CONFLICT');
        }
        return replay;
      }

      const capability = await this.lifecycle.evaluateInTransaction(
        tx,
        input.projectId,
        project.status as ProjectStatus,
      );
      if (!capability.canEditDraft) {
        throw new ConflictException(capability.reasonCode);
      }

      const structure = await tx.boqStructure.findFirst({
        where: {
          projectId: input.projectId,
          name: WORKING_DRAFT_STRUCTURE_NAME,
          status: 'DRAFT',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!structure) throw new NotFoundException('WORKING_DRAFT_NOT_FOUND');

      const item = await tx.boqItem.findFirst({
        where: { id: input.boqItemId, boqStructureId: structure.id },
      });
      if (!item) throw new NotFoundException('BOQ_ITEM_NOT_FOUND');
      if (item.itemType !== 'WORK_ITEM') {
        throw new ConflictException('BOQ_ITEM_NOT_WORK_ITEM');
      }

      const region = await tx.region.findFirst({
        where: { id: input.referenceRegionId, isActive: true },
      });
      if (!region) throw new NotFoundException('REFERENCE_REGION_NOT_FOUND');

      // RM-03B: the SAME predicate the picker used. Building both from one
      // function is the security property, not a tidiness one — if the list
      // could offer a version this revalidation would not accept (or worse,
      // vice versa), the gap between them would be the privilege escalation.
      const version = await tx.aHSPVersion.findFirst({
        where: {
          ...buildEligibleAhspVersionWhere(input.workspaceId, asOf),
          id: input.ahspVersionId,
        },
        include: { resources: { orderBy: { id: 'asc' } } },
      });
      if (!version || version.resources.length === 0) {
        throw new NotFoundException('ELIGIBLE_AHSP_VERSION_NOT_FOUND');
      }

      // RM-03D1 identity slice: the catalog rows, this workspace's source
      // sightings, and the human decisions it has already recorded — loaded
      // ONCE for the whole AHSP version rather than per resource, and tenant-
      // scoped inside the loader so this orchestrator never widens it.
      const identityEvidence = await this.identity.loadEvidence(
        tx,
        input.workspaceId,
      );
      // RM-03C: the eligible candidate set now legally includes this
      // workspace's OWN private prices, alongside publicly published catalog
      // prices — one predicate, built from the shared policy so the candidate
      // set here and the re-verification below can never drift.
      //
      // The technical applicability conditions (region, effective date,
      // validity window) are asserted OUTSIDE the branch OR, so they apply
      // identically to both asset families: there is no private shortcut past
      // them. Nothing here ranks the two families against each other —
      // cardinality is still decided downstream by resolveAhspResourcePrice,
      // which remains scope-blind.
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
        const unitResolution = await this.units.resolve(
          resource.baseUnit,
          identifiedCatalog.baseUnit,
          identifiedCatalog.id,
        );
        const candidates = await Promise.all(
          priceRows.map(async (price) => {
            const resolved =
              price.resourceId === identifiedCatalog.id
                ? await this.units.resolve(
                    price.resource.baseUnit,
                    identifiedCatalog.baseUnit,
                    identifiedCatalog.id,
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

      const resourceIds = new Set(version.resources.map((row) => row.id));
      const resolutionIds = new Set(resolutions.map((row) => row.ahspResourceId));
      if (
        resolutions.length !== version.resources.length ||
        resourceIds.size !== resolutionIds.size ||
        [...resourceIds].some((id) => !resolutionIds.has(id))
      ) {
        throw new ConflictException('WHOLE_VERSION_RESOURCE_SET_MISMATCH');
      }

      const previous = await tx.projectAhspOccurrence.findFirst({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          ahspVersionId: input.ahspVersionId,
          businessPricingAsOfDate: asOf,
          referenceRegionId: input.referenceRegionId,
          resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
        },
        orderBy: { generation: 'desc' },
      });
      const resolutionEvaluatedAt = new Date();
      const fingerprint = sha256(
        resolutions.map((row) => ({
          ahspResourceId: row.ahspResourceId,
          status: row.status,
          resourceCatalogId: row.resourceCatalogId,
          selectedBasicPriceId: row.selectedBasicPriceId,
          sourcePriceValue: row.sourcePriceValue,
          adaptedPriceValue: row.adaptedPriceValue,
          reasonCodes: row.reasonCodes,
        })),
      );
      const occurrence = await tx.projectAhspOccurrence.create({
        data: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          ahspVersionId: input.ahspVersionId,
          idempotencyKey: input.idempotencyKey,
          createdByAccountId: input.accountId,
          businessPricingAsOfDate: asOf,
          referenceRegionId: input.referenceRegionId,
          resolutionPolicyVersion: E1A_RESOLUTION_POLICY_VERSION,
          requestPayloadHash,
          generation: (previous?.generation ?? 0) + 1,
          previousOccurrenceId: previous?.id ?? null,
          resolutionContentFingerprint: fingerprint,
          resolutionEvaluatedAt,
          contextCapturedByAccountId: input.accountId,
          resourceResolutions: { create: resolutions },
        },
        include: includeOccurrence,
      });
      await tx.boqItem.update({
        where: { id: item.id },
        data: {
          ahspVersionId: version.id,
          workingOccurrenceId: occurrence.id,
        },
      });
        return occurrence;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.projectAhspOccurrence.findFirst({
          where: {
            projectId: input.projectId,
            idempotencyKey: input.idempotencyKey,
          },
          include: includeOccurrence,
        });
        if (winner) {
          if (winner.requestPayloadHash !== requestPayloadHash) {
            throw new ConflictException('IDEMPOTENCY_PAYLOAD_CONFLICT');
          }
          return winner;
        }
      }
      throw error;
    }
  }

  async findOne(occurrenceId: string, projectId: string, workspaceId: string) {
    const occurrence = await this.prisma.projectAhspOccurrence.findFirst({
      where: { id: occurrenceId, projectId, workspaceId },
      include: includeOccurrence,
    });
    if (!occurrence) throw new NotFoundException('Project AHSP occurrence not found');
    return occurrence;
  }
}
