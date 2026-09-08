import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ObservedResourceStatus, Prisma, ResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { UNIT_RESOLUTION_STATUS } from '../unit-kernel/unit-kernel.contracts';
import {
  AdmitObservedResourceInput,
  ResourceAdmissionNotExhaustedError,
  ResourceAdmissionProvenanceIncompleteError,
  ResourceAdmissionService,
  ResourceProvenanceAlreadyBoundError,
} from './resource-admission.service';
import { ResourceIdentityResolutionService } from './resource-identity-resolution.service';

/**
 * THE shared, domain-neutral lifecycle for a resource an import SAW but could
 * not yet prove: OBSERVED → (human) → RESOLVED_EXISTING | ADMITTED_NEW.
 *
 * AHSP, Basic Price and BOQ all persist observations through `observeMany` and
 * curate through the same two commands here. Nothing is auto-promoted: a
 * candidate stays a candidate until a human decides, and a genuinely-new
 * resource is minted only through the ONE admission authority
 * (ResourceAdmissionService), which writes ResourceCatalog + ResourceSourceIdentity.
 * `origin` is a provenance tag, never a behavioural branch.
 */

export interface ObserveResourceProvenance {
  sourceSha256?: string | null;
  sourceFileName?: string | null;
  parserContractVersion?: string | null;
  sheetName?: string | null;
  sourceRowNumber?: number | null;
  sourceNameCellAddress?: string | null;
  sourceCodeCellAddress?: string | null;
  sourceUnitCellAddress?: string | null;
}

export interface ObserveResourceInput {
  workspaceId: string;
  origin: string;
  rawName: string;
  rawCode?: string | null;
  rawUnit?: string | null;
  resourceType: ResourceType;
  candidates?: readonly string[];
  provenance?: ObserveResourceProvenance;
}

@Injectable()
export class ResourceObservationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admission: ResourceAdmissionService,
    private readonly unitKernel: UnitKernelService,
    private readonly identity: ResourceIdentityResolutionService,
  ) {}

  /**
   * Persist observations, additively and idempotently. A resource with no name
   * cannot be searched for, so it is never observed. Re-importing the same
   * located source row does not duplicate (unique on workspace + provenance +
   * name + type); a hand-built row with null provenance always inserts, which is
   * the honest behaviour. Never touches a resource that already resolved.
   */
  async observeMany(
    inputs: readonly ObserveResourceInput[],
  ): Promise<{ persisted: number }> {
    const rows = inputs
      .filter((input) => input.rawName.trim().length > 0)
      .map((input) => ({
        workspaceId: input.workspaceId,
        origin: input.origin,
        rawName: input.rawName,
        rawCode: input.rawCode ?? null,
        rawUnit: input.rawUnit ?? null,
        resourceType: input.resourceType,
        sourceSha256: input.provenance?.sourceSha256 ?? null,
        sourceFileName: input.provenance?.sourceFileName ?? null,
        parserContractVersion: input.provenance?.parserContractVersion ?? null,
        sheetName: input.provenance?.sheetName ?? null,
        sourceRowNumber: input.provenance?.sourceRowNumber ?? null,
        sourceCodeCellAddress: input.provenance?.sourceCodeCellAddress ?? null,
        sourceNameCellAddress: input.provenance?.sourceNameCellAddress ?? null,
        sourceUnitCellAddress: input.provenance?.sourceUnitCellAddress ?? null,
        candidatesJson:
          input.candidates && input.candidates.length > 0
            ? [...new Set(input.candidates)]
            : Prisma.JsonNull,
      }));
    if (rows.length === 0) return { persisted: 0 };
    const result = await this.prisma.observedResource.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return { persisted: result.count };
  }

  /** The observations still awaiting a human decision, newest first. */
  async listOpen(workspaceId: string) {
    return this.prisma.observedResource.findMany({
      where: { workspaceId, status: ObservedResourceStatus.OBSERVED },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * The open observations, each enriched for a human curator with what the
   * shared authorities say RIGHT NOW: the live identity candidates (name +
   * catalog id, so "this is an existing resource" can carry the id the mint
   * safety needs) and the unit the Unit Kernel can currently prove for the
   * observed spelling (so "genuinely new" can name a canonical unit).
   *
   * This is a READ. It resolves through the ONE identity kernel and the ONE
   * Unit Kernel — never a second matcher — and it changes nothing: candidates
   * are suggestions, not identity, and no catalog is written here. Evidence is
   * loaded ONCE for the workspace and every observation resolved against it.
   */
  async listOpenForCuration(workspaceId: string) {
    const observations = await this.listOpen(workspaceId);
    if (observations.length === 0) return [];
    const evidence = await this.identity.loadEvidence(this.prisma, workspaceId);
    return Promise.all(
      observations.map(async (observation) => {
        const resolution = await this.identity.resolve(evidence, {
          rawName: observation.rawName,
          rawCode: observation.rawCode,
          rawUnit: observation.rawUnit,
          resourceType: observation.resourceType,
        });
        const candidates = resolution.candidates.map((candidate) => ({
          resourceCatalogId: candidate.resourceCatalogId,
          name: candidate.name,
        }));
        let suggestedUnitDefinitionId: string | null = null;
        if (observation.rawUnit) {
          const unit = await this.unitKernel.resolve(
            observation.rawUnit,
            observation.rawUnit,
          );
          if (
            unit.status === UNIT_RESOLUTION_STATUS.RESOLVED &&
            unit.sourceUnitDefinition
          ) {
            suggestedUnitDefinitionId = unit.sourceUnitDefinition.id;
          }
        }
        return {
          id: observation.id,
          rawName: observation.rawName,
          rawCode: observation.rawCode,
          rawUnit: observation.rawUnit,
          resourceType: observation.resourceType,
          origin: observation.origin,
          status: observation.status,
          candidates,
          suggestedUnitDefinitionId,
        };
      }),
    );
  }

  /**
   * HUMAN DECISION — this observation is one SIMPROK already has. Record the
   * chosen existing ResourceCatalog identity on the observation. Mints nothing.
   * The chosen id must be a real, ACTIVE catalog row the workspace may see
   * (its own or a global one).
   */
  async curateExisting(params: {
    workspaceId: string;
    observationId: string;
    selectedResourceCatalogId: string;
    actorAccountId: string;
    reason?: string | null;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const observation = await this.loadOpen(
        tx,
        params.workspaceId,
        params.observationId,
      );
      const catalog = await tx.resourceCatalog.findFirst({
        where: {
          id: params.selectedResourceCatalogId,
          status: 'ACTIVE',
          OR: [{ workspaceId: params.workspaceId }, { workspaceId: null }],
        },
        select: { id: true },
      });
      if (!catalog)
        throw new ConflictException('SELECTED_RESOURCE_NOT_VISIBLE');
      return tx.observedResource.update({
        where: { id: observation.id },
        data: {
          status: ObservedResourceStatus.RESOLVED_EXISTING,
          resolvedResourceCatalogId: catalog.id,
          decidedByAccountId: params.actorAccountId,
          decidedAt: new Date(),
          reason: params.reason ?? null,
        },
      });
    });
  }

  /**
   * HUMAN DECISION — this observation is genuinely new. The reviewer names a
   * canonical unit (never invented here), and the ONE admission authority mints
   * exactly one ResourceCatalog + one ResourceSourceIdentity. Fails closed if the
   * identity turns out to still be known, if the unit is not representable, or if
   * the observation lacks the provenance a sighting requires.
   */
  async curateNew(params: {
    workspaceId: string;
    observationId: string;
    unitDefinitionId: string;
    actorAccountId: string;
    reason?: string | null;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const observation = await this.loadOpen(
          tx,
          params.workspaceId,
          params.observationId,
        );

        const unitDefinition = await tx.unitDefinition.findFirst({
          where: { id: params.unitDefinitionId, isActive: true },
        });
        if (!unitDefinition)
          throw new ConflictException('UNIT_UNKNOWN_OR_INACTIVE');

        // The Unit Kernel is the authority; a definition existing is not the
        // same fact as its code being resolvable. No new alias, no new rule.
        const unitProof = await this.unitKernel.resolve(
          unitDefinition.code,
          unitDefinition.code,
        );
        if (unitProof.status !== UNIT_RESOLUTION_STATUS.RESOLVED) {
          throw new ConflictException(
            'UNIT_NOT_REPRESENTABLE_BY_UNIT_AUTHORITY',
          );
        }

        const admissionInput: AdmitObservedResourceInput = {
          workspaceId: params.workspaceId,
          rawName: observation.rawName,
          rawCode: observation.rawCode,
          rawUnit: observation.rawUnit,
          resourceType: observation.resourceType,
          baseUnit: unitDefinition.code,
          provenance: {
            sourceSha256: observation.sourceSha256 ?? '',
            sourceFileName: observation.sourceFileName ?? '',
            parserContractVersion: observation.parserContractVersion ?? '',
            sheetName: observation.sheetName ?? '',
            sourceRowNumber: observation.sourceRowNumber ?? 0,
            sourceNameCellAddress: observation.sourceNameCellAddress ?? '',
            sourceCodeCellAddress: observation.sourceCodeCellAddress,
            sourceUnitCellAddress: observation.sourceUnitCellAddress,
          },
        };

        const catalog = await this.admission
          .admitObservedResource(tx, admissionInput)
          .catch((error: unknown) => {
            if (error instanceof ResourceAdmissionNotExhaustedError) {
              throw new ConflictException('RESOURCE_IDENTITY_NOT_EXHAUSTED');
            }
            if (error instanceof ResourceProvenanceAlreadyBoundError) {
              throw new ConflictException('RESOURCE_PROVENANCE_ALREADY_BOUND');
            }
            if (error instanceof ResourceAdmissionProvenanceIncompleteError) {
              throw new ConflictException({
                statusCode: 409,
                error: 'Conflict',
                message: 'OBSERVATION_PROVENANCE_INCOMPLETE',
                missing: error.missing,
              });
            }
            throw error;
          });

        const updated = await tx.observedResource.update({
          where: { id: observation.id },
          data: {
            status: ObservedResourceStatus.ADMITTED_NEW,
            resolvedResourceCatalogId: catalog.id,
            decidedByAccountId: params.actorAccountId,
            decidedAt: new Date(),
            reason: params.reason ?? null,
          },
        });
        return { admittedResource: catalog, observation: updated };
      },
      // The admission advisory lock can make a genuine-race loser wait for the
      // winner's whole admission to commit; the default 5s would time that out.
      { timeout: 20_000, maxWait: 20_000 },
    );
  }

  private async loadOpen(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    observationId: string,
  ) {
    const observation = await tx.observedResource.findFirst({
      where: { id: observationId, workspaceId },
    });
    if (!observation) throw new NotFoundException('OBSERVATION_NOT_FOUND');
    if (observation.status !== ObservedResourceStatus.OBSERVED) {
      throw new ConflictException('OBSERVATION_ALREADY_DECIDED');
    }
    return observation;
  }
}
