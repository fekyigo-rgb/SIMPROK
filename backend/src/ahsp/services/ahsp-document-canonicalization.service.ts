import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { LocationType, MethodType } from '@prisma/client';
import { IntakeError } from '../../universal-intake/intake-errors';
import { ReaderRegistry } from '../../universal-intake/readers/reader-registry';
import {
  MAX_ENVELOPE_BYTES,
  SourceEnvelope,
  sealSourceEnvelope,
} from '../../universal-intake/source-envelope';
import { PrismaService } from '../../prisma/prisma.service';
import { UnitKernelService } from '../../unit-kernel/unit-kernel.service';
import {
  UNIT_ALIAS_CONTEXT,
  UNIT_RESOLUTION_STATUS,
} from '../../unit-kernel/unit-kernel.contracts';
import {
  ResourceIdentityEvidence,
  ResourceIdentityResolutionService,
} from '../../resource-catalog/resource-identity-resolution.service';
import { understandAhspDocument } from '../document/ahsp-document-understanding';
import {
  AHSP_DOCUMENT_REASON,
  AhspDocumentKnowledge,
  AhspDocumentReasonCode,
  AhspResourceGroup,
  AhspResourceKnowledge,
  AhspWorkItemKnowledge,
} from '../document/ahsp-document-knowledge';
import { AhspService } from './ahsp.service';
import { AhspVersionService } from './ahsp-version.service';

export const AHSP_DOCUMENT_MAX_BYTES = MAX_ENVELOPE_BYTES;

/** Schema-required parent identity when the document does not state method/location. Not an official fact. */
const AHSP_PARENT_IDENTITY_FILLER = {
  methodType: MethodType.OTHER,
  locationType: LocationType.OTHER,
} as const;

const GROUP_TO_CONTEXT: Record<
  AhspResourceGroup,
  (typeof UNIT_ALIAS_CONTEXT)[keyof typeof UNIT_ALIAS_CONTEXT]
> = {
  LABOR: UNIT_ALIAS_CONTEXT.LABOR,
  MATERIAL: UNIT_ALIAS_CONTEXT.MATERIAL,
  EQUIPMENT: UNIT_ALIAS_CONTEXT.EQUIPMENT,
};

export interface AhspDocumentCommitResult {
  readonly knowledge: AhspDocumentKnowledge;
  readonly written: ReadonlyArray<{
    readonly workType: string;
    readonly methodName: string;
    readonly ahspId: string;
    readonly versionId: string;
  }>;
  readonly skipped: ReadonlyArray<{
    readonly workType: string | null;
    readonly methodName: string | null;
    readonly reasonCodes: readonly AhspDocumentReasonCode[];
  }>;
}

@Injectable()
export class AhspDocumentCanonicalizationService {
  constructor(
    private readonly ahspService: AhspService,
    private readonly versionService: AhspVersionService,
    private readonly units: UnitKernelService,
    private readonly identity: ResourceIdentityResolutionService,
    private readonly prisma: PrismaService,
  ) {}

  private readonly readers = ReaderRegistry.default();

  sealUpload(params: {
    bytes: Buffer;
    fileName: string;
    mediaType: string | null;
    workspaceId: string;
    organizationId: string;
    actorAccountId: string;
  }): SourceEnvelope {
    return sealSourceEnvelope({
      ingestionChannel: 'USER_UPLOAD',
      fileName: params.fileName,
      mediaType: params.mediaType,
      bytes: params.bytes,
      workspaceId: params.workspaceId,
      organizationId: params.organizationId,
      actorAccountId: params.actorAccountId,
    });
  }

  async previewUpload(params: {
    file: { buffer?: Buffer; originalname?: string; mimetype?: string } | undefined;
    workspaceId: string;
    actorAccountId: string;
  }): Promise<AhspDocumentKnowledge> {
    return this.preview(await this.envelopeFromUpload(params));
  }

  async commitUpload(params: {
    file: { buffer?: Buffer; originalname?: string; mimetype?: string } | undefined;
    workspaceId: string;
    actorAccountId: string;
    userId: string;
  }): Promise<AhspDocumentCommitResult> {
    return this.commit(await this.envelopeFromUpload(params), params.userId);
  }

  async preview(envelope: SourceEnvelope): Promise<AhspDocumentKnowledge> {
    const read = await this.readers.read(envelope);
    return this.resolveKnowledge(understandAhspDocument(read, envelope), envelope.workspaceId);
  }

  private async envelopeFromUpload(params: {
    file: { buffer?: Buffer; originalname?: string; mimetype?: string } | undefined;
    workspaceId: string;
    actorAccountId: string;
  }): Promise<SourceEnvelope> {
    if (!params.file?.buffer || !Buffer.isBuffer(params.file.buffer) || params.file.buffer.length === 0) {
      throw new BadRequestException('SOURCE_BYTES_REQUIRED');
    }
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: params.workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return this.sealUpload({
      bytes: params.file.buffer,
      fileName: params.file.originalname ?? 'ahsp.xlsx',
      mediaType: params.file.mimetype ?? null,
      workspaceId: params.workspaceId,
      organizationId: workspace.organizationId,
      actorAccountId: params.actorAccountId,
    });
  }

  async commit(
    envelope: SourceEnvelope,
    userId: string,
  ): Promise<AhspDocumentCommitResult> {
    const knowledge = await this.preview(envelope);
    const skipped: Array<AhspDocumentCommitResult['skipped'][number]> = [];
    const written: Array<AhspDocumentCommitResult['written'][number]> = [];
    for (const item of knowledge.workItems) {
      if (item.status !== 'READY' || !item.workType || !item.methodName) {
        skipped.push({
          workType: item.workType?.raw ?? null,
          methodName: item.methodName?.raw ?? null,
          reasonCodes: item.reasonCodes.length
            ? item.reasonCodes
            : [AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY],
        });
        continue;
      }
      try {
        const parent = await this.ahspService.create({
          workspaceId: envelope.workspaceId,
          workType: item.workType.raw,
          methodName: item.methodName.raw,
          methodType: AHSP_PARENT_IDENTITY_FILLER.methodType,
          locationType: AHSP_PARENT_IDENTITY_FILLER.locationType,
          userId,
        });
        const version = await this.versionService.createVersion(parent.id, {
          workspaceId: envelope.workspaceId,
          userId,
          outputUnit: item.resolvedOutputUnit ?? item.outputUnitRaw!.raw,
          regulationReference:
            item.regulationReference?.raw ??
            knowledge.document.regulationReference?.raw,
          resources: item.resources.map((resource) => ({
            resourceId: resource.resolvedResourceCatalogId!,
            resourceType: resource.group!,
            coefficient: resource.coefficient!,
            baseUnit: resource.resolvedBaseUnit ?? resource.rawUnit!,
          })),
        });
        written.push({
          workType: item.workType.raw,
          methodName: item.methodName.raw,
          ahspId: parent.id,
          versionId: version.id,
        });
      } catch (error) {
        if (error instanceof ConflictException) {
          skipped.push({
            workType: item.workType.raw,
            methodName: item.methodName.raw,
            reasonCodes: [AHSP_DOCUMENT_REASON.DUPLICATE_IDENTITY],
          });
          continue;
        }
        throw error;
      }
    }
    return { knowledge, written, skipped };
  }

  private async resolveKnowledge(
    knowledge: AhspDocumentKnowledge,
    workspaceId: string,
  ): Promise<AhspDocumentKnowledge> {
    if (knowledge.workItems.length === 0) return knowledge;
    const loaded = await this.identity.loadEvidence(this.prisma, workspaceId);
    const workItems: AhspWorkItemKnowledge[] = [];
    for (const item of knowledge.workItems) {
      workItems.push(await this.resolveWorkItem(item, loaded));
    }
    const anyReady = workItems.some((item) => item.status === 'READY');
    return {
      ...knowledge,
      workItems,
      status:
        knowledge.status === 'STRUCTURE_UNSUPPORTED'
          ? knowledge.status
          : anyReady
            ? 'READY'
            : 'UNRESOLVED',
    };
  }

  private async resolveWorkItem(
    item: AhspWorkItemKnowledge,
    evidence: ResourceIdentityEvidence,
  ): Promise<AhspWorkItemKnowledge> {
    const reasons: AhspDocumentReasonCode[] = [...item.reasonCodes];
    let resolvedOutputUnit: string | null = null;
    if (item.outputUnitRaw) {
      const unit = await this.units.resolve(
        item.outputUnitRaw.raw,
        item.outputUnitRaw.raw,
      );
      if (unit.status !== UNIT_RESOLUTION_STATUS.RESOLVED || !unit.sourceUnitDefinition) {
        reasons.push(AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED);
      } else {
        resolvedOutputUnit = item.outputUnitRaw.raw;
      }
    }
    const resources: AhspResourceKnowledge[] = [];
    for (const resource of item.resources) {
      resources.push(await this.resolveResource(resource, evidence));
    }
    if (resources.some((resource) => resource.status !== 'READY')) {
      reasons.push(AHSP_DOCUMENT_REASON.RESOURCE_UNRESOLVED);
    }
    const unique = [...new Set(reasons)];
    const ready =
      item.workType !== null &&
      item.methodName !== null &&
      resolvedOutputUnit !== null &&
      resources.length > 0 &&
      resources.every((resource) => resource.status === 'READY') &&
      unique.filter((code) => code !== AHSP_DOCUMENT_REASON.CURRENTNESS_UNPROVEN)
        .length === 0;
    return {
      ...item,
      resolvedOutputUnit,
      resources,
      reasonCodes: unique,
      status: ready ? 'READY' : 'UNRESOLVED',
    };
  }

  private async resolveResource(
    resource: AhspResourceKnowledge,
    evidence: ResourceIdentityEvidence,
  ): Promise<AhspResourceKnowledge> {
    if (
      resource.status !== 'READY' ||
      !resource.rawName ||
      !resource.rawUnit ||
      !resource.group ||
      resource.coefficient === null
    ) {
      return resource;
    }
    const unit = await this.units.resolve(
      resource.rawUnit,
      resource.rawUnit,
      undefined,
      GROUP_TO_CONTEXT[resource.group],
    );
    if (unit.status !== UNIT_RESOLUTION_STATUS.RESOLVED) {
      return {
        ...resource,
        status: 'UNRESOLVED',
        reasonCodes: [...resource.reasonCodes, AHSP_DOCUMENT_REASON.UNIT_UNRESOLVED],
      };
    }
    const identity = await this.identity.resolve(evidence, {
      rawName: resource.rawName,
      rawCode: resource.rawCode,
      rawUnit: resource.rawUnit,
      resourceType: resource.group,
    });
    if (identity.status !== 'RESOLVED' || !identity.resolvedResourceCatalogId) {
      return {
        ...resource,
        status: 'UNRESOLVED',
        reasonCodes: [
          ...resource.reasonCodes,
          AHSP_DOCUMENT_REASON.RESOURCE_UNRESOLVED,
        ],
      };
    }
    return {
      ...resource,
      resolvedResourceCatalogId: identity.resolvedResourceCatalogId,
      resolvedBaseUnit: resource.rawUnit,
    };
  }
}

export function isAhspIntakeError(error: unknown): error is IntakeError {
  return error instanceof IntakeError;
}
