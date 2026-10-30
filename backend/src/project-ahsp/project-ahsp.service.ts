import {
  BadRequestException,
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
  pickCurrentApplicableAhspVersions,
} from './ahsp-eligibility.policy';
import { resolveAhspResourcePrice } from '../ahsp/price-resolution/ahsp-resource-price-resolution.kernel';
import { BasicPriceEligibilityPolicy } from '../basic-price/basic-price-eligibility.policy';
import { parseDateOnlyUtc } from '../common/date-only.util';
import { PrismaService } from '../prisma/prisma.service';
import { monetaryUnitIdentity } from '../project/monetary-unit-identity';
import { RabLifecyclePolicyService, WORKING_DRAFT_STRUCTURE_NAME } from '../project/rab-lifecycle-policy.service';
import {
  BOQ_UNIT_COMPATIBILITY,
  BoqUnitCompatibilityService,
} from '../unit-kernel/boq-unit-compatibility.service';
import { UNIT_REASON } from '../unit-kernel/unit-kernel.contracts';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service';
import { sameProvenBoqSourceFact } from './rab-auto-source-proof';
import { explicitAhspSourceProof } from './rab-auto-first-source-reference';
import {
  AhspResourceResolutionOrchestrator,
  E1A_RESOLUTION_POLICY_VERSION,
} from './ahsp-resource-resolution.orchestrator';
import {
  classificationPathsFromLeaves,
  rankAhspPreference,
  type AhspPreference,
  type ClassificationNodeLink,
} from './ahsp-preference';

/** Re-exported from the resolution orchestrator, its single definition. */
export { E1A_RESOLUTION_POLICY_VERSION };
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
  /** RAB-AUTO-04: strictly proven same-project source row; absent for manual selection. */
  reuseSourceBoqItemId?: string;
  /** Exact, approved BOQ document's source AHSP code (not WBS). */
  firstSourceAhspCode?: string;
}

type ResolutionCreate =
  Prisma.ProjectAhspResourceResolutionUncheckedCreateWithoutOccurrenceInput;

const sha256 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const classificationNodeSelect = {
  id: true,
  name: true,
  level: true,
  parent: {
    select: {
      id: true,
      name: true,
      level: true,
      parent: {
        select: {
          id: true,
          name: true,
          level: true,
          parent: { select: { id: true, name: true, level: true } },
        },
      },
    },
  },
} as const;

@Injectable()
export class ProjectAhspService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: BasicPriceEligibilityPolicy,
    private readonly units: UnitKernelService,
    private readonly lifecycle: RabLifecyclePolicyService,
    private readonly identity: ResourceIdentityResolutionService,
    private readonly resolution: AhspResourceResolutionOrchestrator,
    private readonly unitCompatibility: BoqUnitCompatibilityService,
  ) {}

  async listEligibleVersions(
    workspaceId: string,
    asOfRaw: string,
    context?: { projectId: string; boqItemId?: string },
  ) {
    const asOf = parseDateOnlyUtc(asOfRaw, 'businessPricingAsOfDate');
    const boqItemId = context?.boqItemId?.trim();
    const preferenceItem = boqItemId
      ? await this.loadPreferenceBoqItem(workspaceId, context?.projectId ?? '', boqItemId)
      : null;
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
    //
    // Current-applicable projection: several PUBLISHED (or private) snapshots
    // of one parent may still be lawful formulas, but new use is offered only
    // the current one. The WHERE above is unchanged so RAB lock can still
    // recognise a historical binding as a lawful formula.
    const listed = pickCurrentApplicableAhspVersions(versions).map(({ ahsp, ...version }) => ({
      ...version,
      origin: classifyAhspOrigin({ status: version.status, ahsp }, workspaceId),
      ahsp: {
        id: ahsp.id,
        workType: ahsp.workType,
        methodName: ahsp.methodName,
      },
    }));
    if (!preferenceItem || !context?.projectId) return listed;
    return this.attachProjectPreference(context.projectId, preferenceItem, listed);
  }

  /**
   * RI-01K search-only view of the SAME eligibility/currentness and preference
   * kernels. One AHSP parent per result; DB returns only a bounded parent page
   * with the highest eligible version as-of. Never hydrate every version when
   * the workspace eventually has thousands of AHSP.
   */
  async searchEligibleVersions(
    workspaceId: string,
    asOfRaw: string,
    context: { projectId: string; boqItemId?: string },
    search: { q?: string; page?: string; limit?: string },
  ) {
    const asOf = parseDateOnlyUtc(asOfRaw, 'businessPricingAsOfDate');
    const q = (search.q ?? '').trim();
    const page = search.page === undefined ? 1 : Number(search.page);
    const limit = search.limit === undefined ? 25 : Number(search.limit);
    if ((q.length > 0 && q.length < 2) || q.length > 120 ||
      !Number.isInteger(page) || page < 1 || page > 10000 ||
      !Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new BadRequestException('AHSP_SEARCH_QUERY_INVALID');
    }
    const preferenceItem = context.boqItemId?.trim()
      ? await this.loadPreferenceBoqItem(workspaceId, context.projectId, context.boqItemId.trim())
      : null;
    const eligibility = buildEligibleAhspVersionWhere(workspaceId, asOf);
    const parents = await this.prisma.aHSP.findMany({
      where: {
        versions: { some: eligibility },
        ...(q ? {
          OR: [
            { code: { contains: q, mode: 'insensitive' } },
            { workType: { contains: q, mode: 'insensitive' } },
            { methodName: { contains: q, mode: 'insensitive' } },
          ],
        } : {}),
      },
      select: {
        id: true,
        code: true,
        workType: true,
        methodName: true,
        workspaceId: true,
        ownershipType: true,
        versions: {
          where: eligibility,
          orderBy: [{ versionNumber: 'desc' }, { id: 'asc' }],
          take: 1,
          select: {
            id: true,
            versionNumber: true,
            status: true,
            outputUnit: true,
            effectiveDate: true,
            expiredDate: true,
            _count: { select: { resources: true } },
          },
        },
      },
      orderBy: [{ workType: 'asc' }, { methodName: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit + 1,
    });
    const hasNext = parents.length > limit;
    const items = parents.slice(0, limit).flatMap(({ versions, ...ahsp }) => {
      const version = versions[0];
      if (!version) return [];
      return [{
        ...version,
        origin: classifyAhspOrigin({ status: version.status, ahsp }, workspaceId),
        ahsp: {
          id: ahsp.id, code: ahsp.code,
          workType: ahsp.workType, methodName: ahsp.methodName,
        },
      }];
    });
    const ranked = preferenceItem
      ? await this.attachProjectPreference(context.projectId, preferenceItem, items)
      : items;
    return { items: ranked, page, limit, hasNext, query: q };
  }

  private async loadPreferenceBoqItem(
    workspaceId: string,
    projectId: string,
    boqItemId: string,
  ) {
    if (!CANONICAL_UUID.test(boqItemId) || !CANONICAL_UUID.test(projectId)) {
      throw new BadRequestException('BOQ_ITEM_ID_INVALID');
    }
    const item = await this.prisma.boqItem.findFirst({
      where: {
        id: boqItemId,
        itemType: 'WORK_ITEM',
        boqStructure: {
          projectId,
          name: WORKING_DRAFT_STRUCTURE_NAME,
          status: 'DRAFT',
          project: { workspaceId },
        },
      },
      select: { id: true, name: true, unit: true },
    });
    if (!item) throw new NotFoundException('BOQ_ITEM_NOT_FOUND');
    return item;
  }

  /**
   * Orders the eligible list for one BOQ item. The stored project
   * classification is read and never rewritten. Versions that failed the
   * eligibility query are not added here.
   */
  private async attachProjectPreference<T extends {
    outputUnit: string | null;
    ahsp: { id: string; workType: string; methodName: string };
  }>(
    projectId: string,
    item: { name: string; unit: string },
    listed: T[],
  ): Promise<Array<T & { preference: AhspPreference }>> {
    const selections = await this.prisma.projectClassificationSelection.findMany({
      where: { projectId },
      select: {
        classificationNode: { select: { id: true, level: true, parentId: true } },
      },
    });
    const selectedKategoriIds = selections
      .filter((row) => row.classificationNode.level === 'KATEGORI')
      .map((row) => row.classificationNode.id);
    const kategoriIds = new Set(selectedKategoriIds);
    const selectedSubkategoriIds = selections
      .filter(
        (row) =>
          row.classificationNode.level === 'SUBKATEGORI' &&
          row.classificationNode.parentId != null &&
          kategoriIds.has(row.classificationNode.parentId),
      )
      .map((row) => row.classificationNode.id);
    const assignments =
      listed.length === 0
        ? []
        : await this.prisma.ahspClassificationAssignment.findMany({
            where: {
              ahspId: { in: listed.map((version) => version.ahsp.id) },
              isActive: true,
            },
            select: { ahspId: true, leafNode: { select: classificationNodeSelect } },
          });
    const leavesByAhsp = new Map<string, ClassificationNodeLink[]>();
    for (const assignment of assignments) {
      const leaves = leavesByAhsp.get(assignment.ahspId) ?? [];
      if (assignment.leafNode) leaves.push(assignment.leafNode);
      leavesByAhsp.set(assignment.ahspId, leaves);
    }
    const annotated = await Promise.all(
      listed.map(async (version) => {
        const compatibility = await this.unitCompatibility.evaluate(
          version.outputUnit,
          item.unit,
        );
        const monetary = monetaryUnitIdentity(item.unit, version.outputUnit);
        return {
          ...version,
          sourceVersion: version,
          workType: version.ahsp.workType,
          methodName: version.ahsp.methodName,
          unitCompatible:
            compatibility.status === BOQ_UNIT_COMPATIBILITY.COMPATIBLE_EXACT &&
            monetary.admissible,
          paths: classificationPathsFromLeaves(leavesByAhsp.get(version.ahsp.id) ?? []),
        };
      }),
    );
    return rankAhspPreference(annotated, {
      selectedKategoriIds,
      selectedSubkategoriIds,
      boqName: item.name,
    }).map(({ sourceVersion, preference }) => ({ ...sourceVersion, preference }));
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
      ...(input.reuseSourceBoqItemId ? { reuseSourceBoqItemId: input.reuseSourceBoqItemId } : {}),
      ...(input.firstSourceAhspCode ? { firstSourceAhspCode: input.firstSourceAhspCode } : {}),
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

      // RAB-AUTO-04: a prior human-governed decision can be inherited only
          // for the same canonical BOQ source fact, re-proven AFTER the project
          // lock. Manual selection has no reuseSourceBoqItemId and is unchanged.
          if (input.reuseSourceBoqItemId) {
            if (
              item.ahspVersionId ||
              item.workingOccurrenceId ||
              item.calculationOccurrenceId ||
              item.priceOrigin
            ) {
              throw new ConflictException('RAB_AUTO_TARGET_ALREADY_DECIDED');
            }
            const source = await tx.boqItem.findFirst({
              where: {
                id: input.reuseSourceBoqItemId,
                boqStructureId: structure.id,
                itemType: 'WORK_ITEM',
              },
              include: {
                workingOccurrence: true,
                calculationOccurrence: true,
              },
            });
            if (
              !source ||
              source.id === item.id ||
              !sameProvenBoqSourceFact(source, item) ||
              source.ahspVersionId !== input.ahspVersionId ||
              source.priceOrigin === 'MANUAL_CLIENT'
            ) {
              throw new ConflictException('RAB_AUTO_SOURCE_FACT_NOT_PROVEN');
            }
            const provenOccurrence =
              source.workingOccurrence ?? source.calculationOccurrence;
            if (
              !provenOccurrence ||
              provenOccurrence.projectId !== input.projectId ||
              provenOccurrence.workspaceId !== input.workspaceId ||
              provenOccurrence.createdByAccountId == null ||
              provenOccurrence.idempotencyKey.startsWith('rab-auto-04-') ||
              provenOccurrence.ahspVersionId !== input.ahspVersionId ||
              provenOccurrence.referenceRegionId !== input.referenceRegionId ||
              provenOccurrence.businessPricingAsOfDate?.getTime() !==
                asOf.getTime()
            ) {
              throw new ConflictException('RAB_AUTO_SOURCE_CONTEXT_NOT_PROVEN');
            }
            // Project's own selected region, not geolocation or AI inference.
            const regionSelection = await tx.projectRegionSelection.findFirst({
              where: {
                projectId: input.projectId,
                regionId: input.referenceRegionId,
              },
              select: { id: true },
            });
            if (!regionSelection) {
              throw new ConflictException('RAB_AUTO_REGION_NOT_AUTHORIZED');
            }
          }

      // RAB-AUTO-05 — first-time binding: independent explicit BOQ evidence
      // is rechecked under the existing project lock/transaction. A
      // recommendation alone cannot authorize the binding.
      if (input.firstSourceAhspCode) {
        if (item.ahspVersionId || item.workingOccurrenceId ||
            item.calculationOccurrenceId || item.priceOrigin ||
            item.sourceAhspCode !== input.firstSourceAhspCode) {
          throw new ConflictException('FIRST_ASSOCIATION_SOURCE_NOT_CURRENT');
        }
        const approvedSource = await tx.boqBusinessUseEvent.findFirst({
          where: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            boqStructureId: structure.id,
          },
          orderBy: { usedAt: 'desc' },
          select: { usedAt: true },
        });
        if (!approvedSource || item.updatedAt > approvedSource.usedAt) {
          throw new ConflictException('FIRST_ASSOCIATION_SOURCE_NOT_APPROVED');
        }
        const chosenRegions = await tx.projectRegionSelection.findMany({
          where: { projectId: input.projectId },
          select: { regionId: true },
          take: 2,
        });
        if (chosenRegions.length !== 1 ||
            chosenRegions[0].regionId !== input.referenceRegionId) {
          throw new ConflictException('FIRST_ASSOCIATION_REGION_NOT_UNIQUE');
        }
      }

          const region = await tx.region.findFirst({
        where: { id: input.referenceRegionId, isActive: true },
      });
      if (!region) throw new NotFoundException('REFERENCE_REGION_NOT_FOUND');

      // RM-03B: the SAME lawful-formula predicate the picker queried. New-use
      // currentness is re-checked below (no newer eligible sibling), matching
      // pickCurrentApplicableAhspVersions on the list path.
      const version = await tx.aHSPVersion.findFirst({
        where: {
          ...buildEligibleAhspVersionWhere(input.workspaceId, asOf),
          id: input.ahspVersionId,
        },
        include: {
          resources: { orderBy: { id: 'asc' } },
          // RAB-TRUTH-01H — the ownership as it stands right now, read on the
          // same transaction that freezes this calculation context, so the
          // occurrence records the authority that actually formed it.
          ahsp: {
            select: { ownershipType: true, workType: true, methodName: true, code: true },
          },
        },
      });
      if (!version || version.resources.length === 0) {
        throw new NotFoundException('ELIGIBLE_AHSP_VERSION_NOT_FOUND');
      }
      if (input.firstSourceAhspCode && !explicitAhspSourceProof(
        { sourceAhspCode: item.sourceAhspCode, name: item.name },
        { code: version.ahsp.code, workType: version.ahsp.workType,
          methodName: version.ahsp.methodName },
      )) {
        throw new ConflictException('FIRST_ASSOCIATION_REFERENCE_MISMATCH');
      }

      const newerApplicable = await tx.aHSPVersion.findFirst({
        where: {
          ...buildEligibleAhspVersionWhere(input.workspaceId, asOf),
          ahspId: version.ahspId,
          versionNumber: { gt: version.versionNumber },
        },
        select: { id: true },
      });
      if (newerApplicable) {
        throw new NotFoundException('ELIGIBLE_AHSP_VERSION_NOT_FOUND');
      }

      // KAMUS_UNIT_KERNEL_01A — the bind-time unit gate, and the ONE place a
      // unit question is asked on this path. THE existing
      // BoqUnitCompatibilityService answers the Unit Kernel half; this call
      // site does not read the alias table, does not compare unit strings, and
      // does not re-derive any part of that verdict. Unit Kernel stays the sole
      // unit authority and that service stays its only BOQ/AHSP compatibility
      // projection.
      //
      // It runs HERE for two reasons. Both units are known by this line and
      // both were read on the transaction that locked the project, so the
      // verdict is about the exact facts the binding would be made from. And it
      // precedes resolveVersionResources, so a refused selection never reaches
      // Resource Identity, never reads a Basic Price, and never creates an
      // occurrence — the throw leaves nothing to undo rather than something to
      // roll back.
      const compatibility = await this.unitCompatibility.evaluate(
        version.outputUnit,
        item.unit,
      );
      // ONE accepted status, named rather than excluded: a verdict this code
      // has never heard of must fail closed, not slip through an exclusion list
      // nobody updated. COMPATIBLE_CONVERTIBLE is refused with NEEDS_REVIEW and
      // NOT_CONVERTIBLE because SIMPROK has no conversion arithmetic to price
      // it — unit_conversion_rules is empty, and a bind whose money can never
      // be computed is a false door, not a feature.
      if (compatibility.status !== BOQ_UNIT_COMPATIBILITY.COMPATIBLE_EXACT) {
        // The reason code the Unit Kernel contract already ships for exactly
        // this fact, raised through the same ConflictException(<CODE>) shape
        // every other refusal on this command already uses. No second error
        // vocabulary is minted here.
        throw new ConflictException(UNIT_REASON.BOQ_UNIT_INCOMPATIBLE);
      }
      // AND the monetary half, which COMPATIBLE_EXACT does not imply. That
      // status means the two spellings resolve to one canonical unit
      // definition; the calculation chain instead requires one normalized
      // STRING. The seeded dictionary holds 26 alias pairs where those two
      // facts disagree — "OH" vs "Orang/Hari", "M" vs "M1" — and binding on
      // any of them would persist a relationship that can never produce money.
      // This is THE same function the Cost Kernel itself asks, so what binds
      // here is exactly what calculates there.
      const monetaryIdentity = monetaryUnitIdentity(
        item.unit,
        version.outputUnit,
      );
      if (!monetaryIdentity.admissible) {
        throw new ConflictException(monetaryIdentity.refusal);
      }

      // THE shared Golden Thread resolution authority. The occurrence path and
      // the RAB pre-lock gate call this same method on the same transaction,
      // so the price decision a lock is validated against can never disagree
      // with the decision that produced the occurrence in the first place.
      const resolutions = await this.resolution.resolveVersionResources(tx, {
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        referenceRegionId: input.referenceRegionId,
        asOf,
        version,
      });

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
          priceMode: row.priceMode,
          sourcePriceValue: row.sourcePriceValue,
          adaptedPriceValue: row.adaptedPriceValue,
          estimatePolicyId: row.estimatePolicyId,
          estimatePolicyVersion: row.estimatePolicyVersion,
          estimatePercent: row.estimatePercent,
          estimateBasisAmount: row.estimateBasisAmount,
          estimateDerivedAmount: row.estimateDerivedAmount,
          estimateApprovalReference: row.estimateApprovalReference,
          estimateApprovedByAccountId: row.estimateApprovedByAccountId,
          estimateApprovedByPositionId: row.estimateApprovedByPositionId,
          estimateAuthorityCode: row.estimateAuthorityCode,
          estimateApprovedAt: row.estimateApprovedAt,
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
          // Frozen with the rest of the calculation context, and never updated
          // again: a later ownership transfer changes what the AHSP IS, not
          // what this calculation was formed from.
          ahspOwnershipAtCalculation: version.ahsp?.ownershipType ?? null,
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
      },
      // An AHSP selection resolves EVERY resource of the analysis inside one
      // transaction, and a real analysis is not small: the Bina Marga drainage
      // section runs to 22 resources on B11/B12, each needing its own identity,
      // unit and Basic Price decision. That work is bounded and legitimate, but
      // Prisma's default interactive-transaction budget is 5s, which was never
      // chosen for it — a selection was intermittently dying mid-resolution
      // with P2028 and surfacing to the user as a missing AHSP version.
      //
      // This is one call site with an explicit, bounded budget, matching the
      // precedent the resource-catalog provisioners already set. It is NOT a
      // global timeout change, and it makes nothing wait longer than it must:
      // the transaction still ends the moment the work does.
      { timeout: 30_000, maxWait: 10_000 });
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
