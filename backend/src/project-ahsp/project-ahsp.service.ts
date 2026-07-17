import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProjectAhspResolutionMethod,
  ProjectAhspResolutionStatus,
  ProjectAhspSelectionMode,
} from '@prisma/client';
import { BasicPriceService } from '../basic-price/basic-price.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AhspResourceResolutionResult,
  resolveAhspResourcePrice,
} from '../ahsp/price-resolution/ahsp-resource-price-resolution.kernel';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';

const POLICY_VERSION = 'BP_AHSP_PHASE2_NAME_EXACT_OPTION_C_V1';
const includeResolutions = { resourceResolutions: true } as const;

export interface CreateProjectAhspInput {
  projectId: string;
  workspaceId: string;
  createdByAccountId: string;
  ahspVersionId: string;
  ahspResourceId: string;
  idempotencyKey: string;
}

type ResolutionCreateData =
  Prisma.ProjectAhspResourceResolutionUncheckedCreateWithoutOccurrenceInput;

@Injectable()
export class ProjectAhspService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly basicPrices: BasicPriceService,
    private readonly units: UnitKernelService,
  ) {}

  private findExisting(
    input: Pick<
      CreateProjectAhspInput,
      'projectId' | 'workspaceId' | 'idempotencyKey'
    >,
  ) {
    return this.prisma.projectAhspOccurrence.findFirst({
      where: {
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        idempotencyKey: input.idempotencyKey,
      },
      include: includeResolutions,
    });
  }

  private acceptExisting(
    existing: Awaited<ReturnType<ProjectAhspService['findExisting']>>,
    input: CreateProjectAhspInput,
  ) {
    if (!existing) return null;
    const resolution = existing.resourceResolutions[0];
    if (
      existing.ahspVersionId !== input.ahspVersionId ||
      !resolution ||
      resolution.ahspResourceId !== input.ahspResourceId
    ) {
      throw new ConflictException(
        'Idempotency key already belongs to a different payload',
      );
    }
    return existing;
  }

  private async validateResource(input: CreateProjectAhspInput) {
    const version = await this.prisma.aHSPVersion.findFirst({
      where: {
        id: input.ahspVersionId,
        OR: [{ workspaceId: input.workspaceId }, { workspaceId: null }],
        ahsp: {
          is: {
            deletedAt: null,
            OR: [{ workspaceId: input.workspaceId }, { workspaceId: null }],
          },
        },
      },
    });
    if (!version) throw new NotFoundException('AHSP version not found');

    const resource = await this.prisma.aHSPResource.findUnique({
      where: { id: input.ahspResourceId },
    });
    if (!resource || resource.ahspVersionId !== input.ahspVersionId) {
      throw new NotFoundException('AHSP resource not found for version');
    }
    return resource;
  }

  private emptyOutcome(
    status: ProjectAhspResolutionStatus,
    result: AhspResourceResolutionResult,
  ): Omit<
    ResolutionCreateData,
    | 'ahspResourceId'
    | 'rawAhspResourceRef'
    | 'rawAhspResourceType'
    | 'ahspCoefficient'
    | 'ahspUnit'
  > {
    return {
      status,
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
      resolutionMethod: ProjectAhspResolutionMethod.DETERMINISTIC_ATTEMPTED,
      reasonCodes: [...result.reasonCodes],
      explanation: result.explanation,
      policyVersion: POLICY_VERSION,
    };
  }

  private noLongerEligible(): Omit<
    ResolutionCreateData,
    | 'ahspResourceId'
    | 'rawAhspResourceRef'
    | 'rawAhspResourceType'
    | 'ahspCoefficient'
    | 'ahspUnit'
  > {
    return {
      status: ProjectAhspResolutionStatus.UNRESOLVED,
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
      resolutionMethod: ProjectAhspResolutionMethod.DETERMINISTIC_ATTEMPTED,
      reasonCodes: ['SELECTED_BASIC_PRICE_NO_LONGER_ELIGIBLE'],
      explanation:
        'Basic Price terpilih tidak lagi memenuhi bukti kelayakan yang sama saat diperiksa kembali.',
      policyVersion: POLICY_VERSION,
    };
  }

  private async mapOutcome(
    result: AhspResourceResolutionResult,
    workspaceId: string,
    candidateById: Map<
      string,
      {
        value: string;
        sourceOrigin: string;
        unit: string;
        freshnessStatus?: string;
      }
    >,
  ) {
    if (result.status !== 'RESOLVED') {
      return this.emptyOutcome(
        result.status === 'UNRESOLVED'
          ? ProjectAhspResolutionStatus.UNRESOLVED
          : ProjectAhspResolutionStatus.NEEDS_REVIEW,
        result,
      );
    }

    const selected = candidateById.get(result.selectedBasicPriceId);
    try {
      const price = await this.basicPrices.findOneForWorkspace(
        result.selectedBasicPriceId,
        workspaceId,
      );
      const currentValue = price.value.toString();
      if (
        !selected ||
        price.id !== result.selectedBasicPriceId ||
        price.resourceId !== result.resolvedResourceCatalogId ||
        currentValue !== result.sourcePriceValue ||
        price.sourceOrigin !== result.sourceOrigin ||
        price.resource.baseUnit !== result.sourceUnit ||
        price.freshnessStatus !== selected.freshnessStatus ||
        price.freshnessStatus === 'EXPIRED'
      )
        return this.noLongerEligible();

      return {
        status: ProjectAhspResolutionStatus.RESOLVED,
        selectionMode: ProjectAhspSelectionMode.AUTO_SELECTED,
        resourceCatalogId: result.resolvedResourceCatalogId,
        selectedBasicPriceId: result.selectedBasicPriceId,
        canonicalUnit: result.canonicalUnit,
        sourcePriceValue: result.sourcePriceValue,
        sourceUnit: price.resource.baseUnit,
        adaptedPriceValue: result.adaptedPriceValue,
        conversionFactor: null,
        selectedSourceOrigin: price.sourceOrigin,
        selectedFreshnessStatus: price.freshnessStatus,
        selectedEffectiveDate: price.effectiveDate,
        resolutionMethod: ProjectAhspResolutionMethod.EXACT_DETERMINISTIC,
        reasonCodes: [...result.reasonCodes],
        explanation: result.explanation,
        policyVersion: POLICY_VERSION,
      } satisfies Omit<
        ResolutionCreateData,
        | 'ahspResourceId'
        | 'rawAhspResourceRef'
        | 'rawAhspResourceType'
        | 'ahspCoefficient'
        | 'ahspUnit'
      >;
    } catch (error) {
      if (error instanceof NotFoundException) return this.noLongerEligible();
      throw error;
    }
  }

  async create(input: CreateProjectAhspInput) {
    const replay = this.acceptExisting(await this.findExisting(input), input);
    if (replay) return replay;

    const resource = await this.validateResource(input);
    const catalogs = await this.prisma.resourceCatalog.findMany({
      where: {
        OR: [{ workspaceId: input.workspaceId }, { workspaceId: null }],
      },
      select: { id: true, code: true, name: true, type: true, baseUnit: true },
    });
    const priceRows = (
      await Promise.all(
        catalogs.map((catalog) =>
          this.basicPrices.findByResource(catalog.id, input.workspaceId),
        ),
      )
    ).flat();
    const rawPrices = priceRows.map((price) => ({
      id: price.id,
      resourceId: price.resourceId,
      value: price.value.toString(),
      sourceOrigin: price.sourceOrigin,
      unit: price.resource.baseUnit,
      freshnessStatus: price.freshnessStatus,
    }));
    const catalogMatches = catalogs.filter(
      (catalog) =>
        catalog.name.trim().toLowerCase().replace(/\s+/g, ' ') ===
          resource.resourceId.trim().toLowerCase().replace(/\s+/g, ' ') &&
        catalog.type === resource.resourceType,
    );
    const unitResolution =
      catalogMatches.length === 1
        ? await this.units.resolve(
            resource.baseUnit,
            catalogMatches[0].baseUnit,
            catalogMatches[0].id,
          )
        : null;
    const prices = await Promise.all(
      rawPrices.map(async (price) => {
        const priceUnitResolution =
          catalogMatches.length === 1 &&
          price.resourceId === catalogMatches[0].id
            ? await this.units.resolve(
                price.unit,
                catalogMatches[0].baseUnit,
                catalogMatches[0].id,
              )
            : null;
        return {
          ...price,
          unitResolution: {
            status: priceUnitResolution?.status ?? 'NEEDS_REVIEW',
            canonicalUnitCode:
              priceUnitResolution?.targetUnitDefinition?.code ?? null,
            quantityFactor: priceUnitResolution?.quantityFactor ?? null,
            priceOperation: priceUnitResolution?.priceOperation ?? null,
            rawSourceUnit: priceUnitResolution?.rawSourceUnit ?? '',
            rawTargetUnit: priceUnitResolution?.rawTargetUnit ?? '',
          },
        } as const;
      }),
    );
    const candidateById = new Map(prices.map((price) => [price.id, price]));
    const result = resolveAhspResourcePrice({
      projectId: input.projectId,
      ahspVersionId: input.ahspVersionId,
      ahspResourceId: input.ahspResourceId,
      rawResourceRef: resource.resourceId,
      resourceType: resource.resourceType,
      ahspUnit: resource.baseUnit,
      resourceCatalogCandidates: catalogs,
      eligibleBasicPriceCandidates: prices,
      validatedUnitResolution: {
        status: unitResolution?.status ?? 'NEEDS_REVIEW',
        canonicalUnitCode:
          unitResolution?.targetUnitDefinition?.code ?? null,
        quantityFactor: unitResolution?.quantityFactor ?? null,
        rawSourceUnit: unitResolution?.rawSourceUnit ?? '',
        rawTargetUnit: unitResolution?.rawTargetUnit ?? '',
      },
    });
    const outcome = await this.mapOutcome(
      result,
      input.workspaceId,
      candidateById,
    );
    const resolution: ResolutionCreateData = {
      ahspResourceId: resource.id,
      rawAhspResourceRef: resource.resourceId,
      rawAhspResourceType: resource.resourceType,
      ahspCoefficient: resource.coefficient,
      ahspUnit: resource.baseUnit,
      ...outcome,
      sourceUnitDefinitionId:
        unitResolution?.sourceUnitDefinition?.id ?? null,
      targetUnitDefinitionId:
        unitResolution?.targetUnitDefinition?.id ?? null,
      unitConversionRuleId: unitResolution?.conversionRuleId ?? null,
      unitConversionRuleVersion:
        unitResolution?.conversionRuleVersion ?? null,
      quantityFactor: unitResolution?.quantityFactor ?? null,
    };

    try {
      return await this.prisma.$transaction((tx) =>
        tx.projectAhspOccurrence.create({
          data: {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            ahspVersionId: input.ahspVersionId,
            idempotencyKey: input.idempotencyKey,
            createdByAccountId: input.createdByAccountId,
            resourceResolutions: { create: resolution },
          },
          include: includeResolutions,
        }),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = this.acceptExisting(
          await this.findExisting(input),
          input,
        );
        if (winner) return winner;
      }
      throw error;
    }
  }

  async findOne(occurrenceId: string, projectId: string, workspaceId: string) {
    const occurrence = await this.prisma.projectAhspOccurrence.findFirst({
      where: { id: occurrenceId, projectId, workspaceId },
      include: includeResolutions,
    });
    if (!occurrence)
      throw new NotFoundException('Project AHSP occurrence not found');
    return occurrence;
  }
}
