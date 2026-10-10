import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AhspService } from './services/ahsp.service';
import type { CreateAhspDto, UpdateAhspDto } from './services/ahsp.service';
import { AhspVersionService } from './services/ahsp-version.service';
import type { CreateAhspVersionDto } from './services/ahsp-version.service';
import { AhspSnapshotService } from './services/ahsp-snapshot.service';
import { TrustedAhspActorService } from './services/trusted-ahsp-actor.service';
import {
  AHSP_DOCUMENT_MAX_BYTES,
  AhspDocumentCanonicalizationService,
  isAhspIntakeError,
} from './services/ahsp-document-canonicalization.service';
import type { AhspImportDecision } from './services/ahsp-document-canonicalization.service';
import { AhspImportAssistedClassificationService } from './services/ahsp-import-assisted-classification.service';
import { parseAssistedClassificationContext } from './document/ahsp-assisted-classification';
import { RetireAhspVersionDto } from './dto/retire-ahsp-version.dto';
import { AhspClassificationAssignmentProvenance, ConstructionClassificationLevel, LocationType, MethodType, OwnershipType, ResourceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AhspClassificationAssignmentService, type AhspClassificationAssignmentView } from './services/ahsp-classification-assignment.service';
import { BasicPriceImportLookupService } from '../basic-price/basic-price-import-lookup.service';
import { SearchResourceCatalogDto } from '../basic-price/dto/search-basic-price-import-lookups.dto';
import { ResourceObservationService } from '../resource-catalog/resource-observation.service';
import { UnitKernelService } from '../unit-kernel/unit-kernel.service';
import { UNIT_RESOLUTION_STATUS } from '../unit-kernel/unit-kernel.contracts';
import { RealityNormalizationEngine } from './services/reality-normalization.engine';
import { classifyAhspIdentity } from './document/ahsp-identity-classifier';

/**
 * Parse the optional multipart `decisions` field into import decisions, failing
 * SAFE: anything that is not a well-formed JSON array degrades to no decisions,
 * so the commit holds every flagged AHSP for the human rather than throwing or
 * silently writing. The service re-validates each entry, so this only shapes.
 */
function parseAhspImportDecisions(raw: unknown): AhspImportDecision[] {
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AhspImportDecision[]) : [];
  } catch {
    return [];
  }
}

/**
 * What the guards attach that the import-journal routes read. Declared rather
 * than read off `any`, the same shape the Basic Price controller declares.
 */
interface WorkspaceScopedRequest {
  user?: { id?: string };
  workspaceContext?: { workspaceId?: string };
}

/**
 * How an AHSP document upload is received — the one place its file name is decoded.
 *
 * Browsers put a file's name into the multipart header as raw UTF-8 bytes
 * (filename="..."). Multer hands header parameters to busboy as latin1 unless
 * told otherwise, so every non-ASCII name reached the source envelope — and the
 * import journal's provenance — with each UTF-8 byte turned into its own
 * character. `defParamCharset` is busboy's own switch for that one decoding step:
 * ASCII names are unchanged, the file bytes are untouched, and a name that
 * arrives already decoded (RFC 5987 filename*) is never decoded a second time.
 */
export const AHSP_DOCUMENT_UPLOAD_OPTIONS = {
  limits: { fileSize: AHSP_DOCUMENT_MAX_BYTES },
  defParamCharset: 'utf8',
};

/**
 * AHSP Controller — Golden Path v0 Slice A
 *
 * Semua endpoint dilindungi JWT + PermissionsGuard.
 * WorkspaceId dibaca dari x-workspace-id header (via PermissionsGuard context).
 * Tidak ada endpoint publik.
 */
@Controller('ahsp')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AhspController {
  constructor(
    private readonly ahspService: AhspService,
    private readonly ahspVersionService: AhspVersionService,
    private readonly ahspSnapshotService: AhspSnapshotService,
    private readonly trustedActor: TrustedAhspActorService,
    private readonly documents: AhspDocumentCanonicalizationService,
    private readonly assistedClassification: AhspImportAssistedClassificationService,
    private readonly assignments: AhspClassificationAssignmentService,
    private readonly prisma: PrismaService,
    /** Read-only catalog search. Same service as Basic Price. Not a second engine. */
    private readonly resourceLookup: BasicPriceImportLookupService,
    private readonly observations: ResourceObservationService,
    /** Existing canonical unit authority; Manual only asks it what outputUnit means. */
    private readonly units: UnitKernelService,
    /** Existing AHSP normalization home used by the existing pure identity classifier. */
    private readonly norm: RealityNormalizationEngine,
  ) {}

  /**
   * RM-03B remediation — the ONE way this controller learns who is acting.
   *
   * Every mutation below records provenance (createdBy/approvedBy/archivedBy/
   * deletedBy/ownershipTransferredBy, plus an audit `who`). Each used to read
   * `body.userId`, so an authenticated User A could attribute their own change
   * to User B. The workspace was already trusted, so nothing leaked across
   * tenants — but the audit trail lied, and provenance is the product here.
   *
   * `body.userId` is now never read for authority on any route. Where the
   * request type still carries the field it is inert, and a test proves it.
   */
  private resolveActor(request: any): Promise<string> {
    return this.trustedActor.resolveActorUserId(request.workspaceContext);
  }

  // ─────────────────────────────────────────────
  // AHSP CRUD
  // ─────────────────────────────────────────────

  @Get('health')
  @Permissions('AHSP_VIEW')
  healthCheck() {
    return { module: 'ahsp', status: 'ok' };
  }

  /**
   * Manual/AHSP door onto the existing catalog search.
   * Reads only. Workspace comes from the guard. BASIC_PRICE_RESOLVE is not required.
   */
  @Get('resource-search')
  @Permissions('AHSP_MANAGE')
  async searchManualResources(
    @Req() request: WorkspaceScopedRequest,
    @Query() dto: SearchResourceCatalogDto,
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    return this.resourceLookup.searchResources(workspaceId, dto, 'WORKSPACE_PLUS_GLOBAL');
  }

  /**
   * Manual/AHSP door onto KNOWLEDGE INTAKE for a resource the catalog lacks.
   *
   * The SAME door the search above is, one verb later: an AHSP editor who cannot
   * find a resource states it here instead of being sent to Basic Price, which is
   * why this carries AHSP_MANAGE and not a pricing permission. It writes no price
   * and asks for none — existence and price are separate facts.
   *
   * It decides nothing itself. The shared resource-catalog domain answers with
   * REUSED / REVIEW_REQUIRED / CREATED off ONE identity kernel reading, so this
   * route is a door and not a second matcher.
   */
  @Post('resources')
  @Permissions('AHSP_MANAGE')
  async acceptManualResource(
    @Req() request: WorkspaceScopedRequest,
    @Body()
    body: {
      name?: unknown;
      code?: unknown;
      resourceType?: unknown;
      unitDefinitionId?: unknown;
      refusedCandidateIds?: unknown;
      candidateContextDigest?: unknown;
    },
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    if (typeof body?.name !== 'string' || body.name.trim() === '') {
      throw new BadRequestException('RESOURCE_NAME_REQUIRED');
    }
    if (
      typeof body?.unitDefinitionId !== 'string' ||
      body.unitDefinitionId === ''
    ) {
      throw new BadRequestException('UNIT_DEFINITION_ID_REQUIRED');
    }
    // The section the editor was working in IS the type. It is validated rather
    // than trusted, so a body can never mint a LABOR row into MATERIAL.
    const resourceType = body?.resourceType;
    if (
      resourceType !== 'LABOR' &&
      resourceType !== 'MATERIAL' &&
      resourceType !== 'EQUIPMENT'
    ) {
      throw new BadRequestException('RESOURCE_TYPE_INVALID');
    }
    // Both halves of an examination, or neither — the same law the curation
    // route states, because it is the same examination channel.
    const refused = body?.refusedCandidateIds;
    const digest = body?.candidateContextDigest;
    const hasRefused = refused !== undefined && refused !== null;
    const hasDigest = digest !== undefined && digest !== null;
    if (hasRefused !== hasDigest) {
      throw new BadRequestException('EXAMINATION_INCOMPLETE');
    }
    if (
      hasRefused &&
      (!Array.isArray(refused) ||
        refused.length === 0 ||
        !refused.every((value) => typeof value === 'string' && value !== '') ||
        typeof digest !== 'string' ||
        digest === '')
    ) {
      throw new BadRequestException('EXAMINATION_INVALID');
    }
    return this.observations.acceptHumanDeclaredResource({
      workspaceId,
      rawName: body.name,
      rawCode: typeof body.code === 'string' ? body.code : null,
      resourceType,
      unitDefinitionId: body.unitDefinitionId,
      examination: hasRefused
        ? {
            refusedCandidateIds: refused as string[],
            candidateContextDigest: digest as string,
          }
        : null,
    });
  }

  /**
   * THE standalone AHSP discovery door — the one the sidebar opens.
   *
   * It answers the question a user asks OUTSIDE a project: 'what AHSP is
   * visible to my workspace'. That is a different contract from the RAB
   * picker, which asks 'what may this BOQ item bind to right now', and the two
   * are deliberately not sharing a query: binding eligibility is a security
   * invariant tied to what selectForBoqItem revalidates, and a display surface
   * must never be able to pull on it.
   *
   * Workspace comes from the guard-verified context, exactly as every other
   * route here reads it — never from the client, so no caller can name another
   * tenant's workspace and read its AHSP.
   */
  @Get()
  @Permissions('AHSP_VIEW')
  async list(@Req() request: any) {
    const workspaceId: string | undefined =
      request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    return this.ahspService.list(workspaceId);
  }

  @Post('document/preview')
  @Permissions('AHSP_MANAGE')
  @UseInterceptors(FileInterceptor('file', AHSP_DOCUMENT_UPLOAD_OPTIONS))
  async previewDocument(@Req() request: any, @UploadedFile() file: { buffer?: Buffer; originalname?: string; mimetype?: string }) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    if (!workspaceId) throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    try {
      return await this.documents.previewUpload({
        file,
        workspaceId,
        actorAccountId: request.user?.id,
      });
    } catch (error) {
      if (isAhspIntakeError(error)) throw new BadRequestException(error.code);
      throw error;
    }
  }

  @Post('document/commit')
  @Permissions('AHSP_MANAGE')
  @UseInterceptors(FileInterceptor('file', AHSP_DOCUMENT_UPLOAD_OPTIONS))
  async commitDocument(@Req() request: any, @UploadedFile() file: { buffer?: Buffer; originalname?: string; mimetype?: string }) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    if (!workspaceId) throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    const userId = await this.resolveActor(request);
    // Human duplicate decisions arrive as a JSON text field alongside the file
    // (multipart). There is no global ValidationPipe here, so a malformed value
    // degrades to "no decision" — never a throw, never a silent write; the
    // service already re-derives the verdict and holds anything undecided.
    const decisions = parseAhspImportDecisions(request.body?.decisions);
    const assistedClassification = parseAssistedClassificationContext(
      request.body?.assistedClassification,
    );
    try {
      return await this.documents.commitUpload({
        file,
        workspaceId,
        actorAccountId: request.user?.id,
        userId,
        decisions,
        assistedClassification,
      });
    } catch (error) {
      if (isAhspIntakeError(error)) throw new BadRequestException(error.code);
      throw error;
    }
  }

  /**
   * Durable intake without a business save. The same upload the preview used
   * becomes the existing import journal. AHSP and its version wait for commit.
   */
  @Post('document/intake')
  @Permissions('AHSP_MANAGE')
  @UseInterceptors(FileInterceptor('file', AHSP_DOCUMENT_UPLOAD_OPTIONS))
  async openImportReview(
    @Req() request: any,
    @UploadedFile() file: { buffer?: Buffer; originalname?: string; mimetype?: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    if (!workspaceId) throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    const userId = await this.resolveActor(request);
    try {
      return await this.documents.openImportReviewUpload({
        file,
        workspaceId,
        actorAccountId: request.user?.id,
        userId,
      });
    } catch (error) {
      if (isAhspIntakeError(error)) throw new BadRequestException(error.code);
      throw error;
    }
  }

  /**
   * IMPORT-SEAM-05 — where a reader finds an import again after leaving the page:
   * the workspace's recent documents and every line still waiting. Without it the
   * only way back to a held item would be to upload the file again.
   *
   * One page at a time, with `nextCursor` naming where the next page begins, so
   * an import older than the newest twenty is still reachable from here — a
   * bounded read that can be continued, never one huge read.
   */
  @Get('document/jobs')
  @Permissions('AHSP_MANAGE')
  async listImportJobs(
    @Req() request: WorkspaceScopedRequest,
    @Query('cursor') cursor?: string,
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    // The cursor is request input: only a string is passed on, and the journal
    // proves its shape before it positions anything.
    return this.documents.listImportJobs(workspaceId, {
      cursor: typeof cursor === 'string' && cursor !== '' ? cursor : null,
    });
  }

  /**
   * IMPORT-SEAM-05 — continue an import from its durable journal, WITHOUT the
   * file: every held line is re-evaluated once, and whatever is now lawful is
   * written. Decisions travel as they do on commit, and are re-validated there.
   */
  @Post('document/jobs/:importJobId/continue')
  @Permissions('AHSP_MANAGE')
  async continueImportJob(
    @Req() request: WorkspaceScopedRequest,
    @Param('importJobId') importJobId: string,
    @Body() body: { decisions?: unknown },
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    const userId = await this.resolveActor(request);
    const decisions = Array.isArray(body?.decisions)
      ? (body.decisions as AhspImportDecision[])
      : parseAhspImportDecisions(body?.decisions);
    const assistedClassification = parseAssistedClassificationContext(
      (body as { assistedClassification?: unknown })?.assistedClassification,
    );
    return this.documents.continueImportJob({
      workspaceId,
      importJobId,
      userId,
      decisions,
      assistedClassification,
    });
  }

  /**
   * Recalculate a durable import from today's units and the scoped human
   * choices. The journal reasons move. The AHSP does not.
   */
  @Post('document/jobs/:importJobId/recheck')
  @Permissions('AHSP_MANAGE')
  async recheckImportJob(
    @Req() request: WorkspaceScopedRequest,
    @Param('importJobId') importJobId: string,
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    return this.documents.recheckImportJob({ workspaceId, importJobId });
  }

  /**
   * One human choice of an existing canonical unit for one durable import slot.
   * The slot is the journal line plus its immutable occurrence key. Nothing here
   * writes an alias or another unit definition.
   */
  @Put('document/jobs/:importJobId/lines/:lineNumber/unit-decisions/:occurrenceKey')
  @Permissions('AHSP_MANAGE')
  async setImportUnitDecision(
    @Req() request: WorkspaceScopedRequest,
    @Param('importJobId') importJobId: string,
    @Param('lineNumber') lineNumber: string,
    @Param('occurrenceKey') occurrenceKey: string,
    @Body() body: { unitDefinitionId?: unknown },
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    const parsedLine = Number(lineNumber);
    if (!Number.isInteger(parsedLine) || parsedLine < 1) {
      throw new BadRequestException('AHSP_IMPORT_UNIT_DECISION_OCCURRENCE_UNKNOWN');
    }
    if (typeof body?.unitDefinitionId !== 'string' || body.unitDefinitionId === '') {
      throw new BadRequestException('AHSP_IMPORT_UNIT_DECISION_UNIT_UNKNOWN');
    }
    const userId = await this.resolveActor(request);
    return this.documents.setUnitDecision({
      workspaceId,
      importJobId,
      lineNumber: parsedLine,
      occurrenceKey,
      unitDefinitionId: body.unitDefinitionId,
      userId,
    });
  }

  /** Remove only the scoped choice. The source spelling stays unresolved. */
  @Delete('document/jobs/:importJobId/lines/:lineNumber/unit-decisions/:occurrenceKey')
  @Permissions('AHSP_MANAGE')
  async clearImportUnitDecision(
    @Req() request: WorkspaceScopedRequest,
    @Param('importJobId') importJobId: string,
    @Param('lineNumber') lineNumber: string,
    @Param('occurrenceKey') occurrenceKey: string,
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    const parsedLine = Number(lineNumber);
    if (!Number.isInteger(parsedLine) || parsedLine < 1) {
      throw new BadRequestException('AHSP_IMPORT_UNIT_DECISION_OCCURRENCE_UNKNOWN');
    }
    return this.documents.clearUnitDecision({
      workspaceId,
      importJobId,
      lineNumber: parsedLine,
      occurrenceKey,
    });
  }

  /**
   * Product Law v1.4 — Import consumer of ConstructionClassificationService.
   * No standalone Classification controller; routes exist only for Import AHSP.
   */
  @Get('document/classification/roots')
  @Permissions('AHSP_MANAGE')
  async classificationRoots(@Req() request: WorkspaceScopedRequest) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    return this.assistedClassification.listRoots(workspaceId);
  }

  @Get('document/classification/children')
  @Permissions('AHSP_MANAGE')
  async classificationChildren(
    @Req() request: WorkspaceScopedRequest,
    @Query('parentId') parentId?: string,
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    if (!parentId || typeof parentId !== 'string') {
      throw new BadRequestException('CLASSIFICATION_PARENT_ID_REQUIRED');
    }
    return this.assistedClassification.listChildren({
      workspaceId,
      parentId,
    });
  }

  @Get('document/classification/search')
  @Permissions('AHSP_MANAGE')
  async classificationSearch(
    @Req() request: WorkspaceScopedRequest,
    @Query('q') q?: string,
    @Query('level') level?: string,
    @Query('preferredParentId') preferredParentId?: string,
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    const lawfulLevels = new Set(Object.values(ConstructionClassificationLevel));
    const resolvedLevel =
      level && lawfulLevels.has(level as ConstructionClassificationLevel)
        ? (level as ConstructionClassificationLevel)
        : undefined;
    return this.assistedClassification.search({
      workspaceId,
      q: typeof q === 'string' ? q : '',
      level: resolvedLevel,
      preferredParentId:
        typeof preferredParentId === 'string' && preferredParentId !== ''
          ? preferredParentId
          : undefined,
    });
  }

  @Post('document/classification/nodes')
  @Permissions('AHSP_MANAGE')
  async classificationCreateNode(
    @Req() request: WorkspaceScopedRequest,
    @Body()
    body: {
      level?: string;
      name?: string;
      parentId?: string;
      code?: string | null;
    },
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    const lawfulLevels = new Set(Object.values(ConstructionClassificationLevel));
    if (!body?.level || !lawfulLevels.has(body.level as ConstructionClassificationLevel)) {
      throw new BadRequestException('CLASSIFICATION_LEVEL_REQUIRED');
    }
    if (!body.parentId || typeof body.parentId !== 'string') {
      throw new BadRequestException('CLASSIFICATION_PARENT_ID_REQUIRED');
    }
    return this.assistedClassification.createLocalNode({
      workspaceId,
      level: body.level as ConstructionClassificationLevel,
      name: typeof body.name === 'string' ? body.name : '',
      parentId: body.parentId,
      code: body.code ?? null,
    });
  }

  @Get('document/jobs/:importJobId/assisted-classification')
  @Permissions('AHSP_MANAGE')
  async getAssistedClassification(
    @Req() request: WorkspaceScopedRequest,
    @Param('importJobId') importJobId: string,
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    return this.assistedClassification.loadJobContext({
      workspaceId,
      importJobId,
    });
  }

  @Post('document/jobs/:importJobId/assisted-classification')
  @Permissions('AHSP_MANAGE')
  async saveAssistedClassification(
    @Req() request: WorkspaceScopedRequest,
    @Param('importJobId') importJobId: string,
    @Body() body: unknown,
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    const context = parseAssistedClassificationContext(body);
    if (!context) {
      throw new BadRequestException('ASSISTED_CLASSIFICATION_INVALID');
    }
    return this.assistedClassification.saveJobContext({
      workspaceId,
      importJobId,
      context,
    });
  }

  /**
   * Manual AHSP — one transaction: parent, version (formula/unit/dasar/penerbit),
   * then HUMAN_ADDED leaf assignments. Any failure rolls the whole save back.
   * Not a second writer: calls AhspService.create, AhspVersionService.createVersion,
   * and AhspClassificationAssignmentService.addAssignment.
   */
  @Post('manual')
  @Permissions('AHSP_MANAGE')
  async createManual(
    @Req() request: WorkspaceScopedRequest,
    @Body()
    body: {
      workType?: string;
      methodName?: string;
      code?: string | null;
      fieldCategory?: string | null;
      subCategory?: string | null;
      classification?: string | null;
      keterangan?: string | null;
      outputUnit?: string;
      regulationReference?: string;
      issuerInstitution?: string;
      resources?: CreateAhspVersionDto['resources'];
      leafNodeIds?: string[];
      jenisPengadaanRootId?: string | null;
      pendingPaths?: Array<{
        kategori?: string;
        subkategori?: string;
        jenisPekerjaan?: string;
      }>;
    },
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    const methodName = typeof body?.methodName === 'string' ? body.methodName.trim() : '';
    const outputUnit = typeof body?.outputUnit === 'string' ? body.outputUnit.trim() : '';
    if (!methodName) throw new BadRequestException('AHSP_METHOD_NAME_REQUIRED');
    if (!outputUnit) throw new BadRequestException('AHSP_OUTPUT_UNIT_UNRESOLVED');

    // Resource identity and occurrence unit are separate facts. Manual rows
    // carry the canonical UnitDefinition.code selected from the shared unit
    // catalog. Validate that exact code against the same resource-family-filtered
    // catalog; do not feed canonical codes back through the raw-alias resolver.
    // ResourceCatalog.baseUnit remains a reference/default, never a hard lock.
    const resources = Array.isArray(body.resources) ? body.resources : [];
    for (const resource of resources) {
      const resourceType = Object.values(ResourceType).includes(resource.resourceType as ResourceType)
        ? (resource.resourceType as ResourceType)
        : null;
      if (!resourceType || typeof resource.baseUnit !== 'string' || resource.baseUnit.trim() === '') {
        throw new BadRequestException('AHSP_RESOURCE_UNIT_UNRESOLVED');
      }
      const code = resource.baseUnit.trim();
      const page = await this.resourceLookup.searchUnits({
        q: code,
        resourceType,
        page: 1,
        limit: 12,
      });
      const lawful = page.items.some(
        (item) => item.code.toLocaleLowerCase('en-US') === code.toLocaleLowerCase('en-US'),
      );
      if (!lawful) {
        throw new BadRequestException('AHSP_RESOURCE_UNIT_UNRESOLVED');
      }
    }

    const userId = await this.resolveActor(request);
    const declaredLeafIds = (Array.isArray(body.leafNodeIds) ? body.leafNodeIds : []).filter(
      (id): id is string => typeof id === 'string' && id.trim() !== '',
    );
    const pending = Array.isArray(body.pendingPaths) ? body.pendingPaths : [];
    const materializedLeafIds: string[] = [];
    if (pending.length > 0) {
      const rootId =
        typeof body.jenisPengadaanRootId === 'string' ? body.jenisPengadaanRootId.trim() : '';
      if (!rootId) throw new BadRequestException('CLASSIFICATION_PATH_ROOT_REQUIRED');
      for (const row of pending) {
        const leaf = await this.assistedClassification.materializeWorkspacePath({
          workspaceId,
          rootId,
          kategori: typeof row?.kategori === 'string' ? row.kategori : '',
          subkategori: typeof row?.subkategori === 'string' ? row.subkategori : '',
          jenisPekerjaan: typeof row?.jenisPekerjaan === 'string' ? row.jenisPekerjaan : '',
        });
        materializedLeafIds.push(leaf.id);
      }
    }
    const leafNodeIds = [...new Set([...declaredLeafIds, ...materializedLeafIds])];
    const workType =
      (typeof body.workType === 'string' && body.workType.trim()) || methodName;

    // ONE-TRUTH: ask the existing unit authority for the canonical output unit,
    // then ask the existing AHSP identity classifier against the existing
    // classification + current-version projection. No second duplicate engine.
    const outputResolution = await this.units.resolve(outputUnit, outputUnit);
    if (
      outputResolution.status !== UNIT_RESOLUTION_STATUS.RESOLVED ||
      !outputResolution.sourceUnitDefinition
    ) {
      throw new BadRequestException('AHSP_OUTPUT_UNIT_UNRESOLVED');
    }
    const identity = classifyAhspIdentity(
      {
        workspaceId,
        workType,
        methodName,
        code: body.code ?? null,
        context: {
          classificationLeafNodeIds: leafNodeIds,
          outputUnitCode: outputResolution.sourceUnitDefinition.code,
          resources: resources.map((resource) => ({
            resourceId: resource.resourceId,
            resourceType: resource.resourceType,
            baseUnit: resource.baseUnit,
            coefficient: resource.coefficient,
          })),
        },
      },
      await this.ahspService.loadIdentitySurface(workspaceId),
      {
        name: (raw) => this.norm.normalizeName(raw),
        code: (raw) => this.norm.normalizeCode(raw),
      },
    );

    if (identity.verdict === 'IDENTICAL') {
      throw new ConflictException('AHSP_SOURCE_IDENTITY_EXISTS');
    }

    const exactParent =
      identity.verdict === 'POSSIBLY_IDENTICAL' &&
      identity.possibleMatches.length === 1 &&
      identity.possibleMatches[0].signal === 'EXACT_PARENT'
        ? identity.possibleMatches[0]
        : null;

    // A normalized-name/code look-alike is evidence, not permission to mint a
    // second parent. Manual has no separate adjudication UI here, so fail closed.
    if (identity.verdict === 'POSSIBLY_IDENTICAL' && !exactParent) {
      throw new ConflictException('AHSP_IDENTITY_REVIEW_REQUIRED');
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      const assignments: AhspClassificationAssignmentView[] = [];

      if (exactParent) {
        // Same parent, changed recipe => the EXISTING version writer appends a
        // revision. Same recipe, new path => only the EXISTING assignment writer
        // extends the multi-path context. No second parent can be minted.
        let versionId = exactParent.currentVersionId ?? null;
        if (exactParent.formulaSame !== true) {
          const version = await this.ahspVersionService.createVersion(
            exactParent.ahspId,
            {
              workspaceId,
              userId,
              outputUnit,
              regulationReference: body.regulationReference,
              issuerInstitution: body.issuerInstitution,
              resources,
              ...(exactParent.currentVersionId
                ? { basedOnVersionId: exactParent.currentVersionId }
                : {}),
            },
            tx,
          );
          versionId = version.id;
        }
        if (!versionId) {
          throw new ConflictException('AHSP_EXISTING_VERSION_REQUIRED');
        }
        for (const leafNodeId of leafNodeIds) {
          assignments.push(
            await this.assignments.addAssignment(
              {
                ahspId: exactParent.ahspId,
                leafNodeId,
                provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
                actingWorkspaceId: workspaceId,
                actorAccountId: userId,
              },
              tx,
            ),
          );
        }
        return {
          id: exactParent.ahspId,
          keterangan: null,
          versionId,
          assignments,
          disposition:
            exactParent.formulaSame === true
              ? 'CLASSIFICATION_EXTENDED'
              : 'REVISION_CREATED',
        };
      }

      const ahsp = await this.ahspService.create(
        {
          workspaceId,
          userId,
          workType,
          methodName,
          methodType: MethodType.OTHER,
          locationType: LocationType.OTHER,
          code: body.code ?? null,
          fieldCategory: body.fieldCategory ?? null,
          subCategory: body.subCategory ?? null,
          classification: body.classification ?? null,
          keterangan: body.keterangan ?? null,
        },
        tx,
      );
      const version = await this.ahspVersionService.createVersion(
        ahsp.id,
        {
          workspaceId,
          userId,
          outputUnit,
          regulationReference: body.regulationReference,
          issuerInstitution: body.issuerInstitution,
          resources,
        },
        tx,
      );
      for (const leafNodeId of leafNodeIds) {
        assignments.push(
          await this.assignments.addAssignment(
            {
              ahspId: ahsp.id,
              leafNodeId,
              provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
              actingWorkspaceId: workspaceId,
              actorAccountId: userId,
            },
            tx,
          ),
        );
      }
      return {
        id: ahsp.id,
        keterangan: ahsp.keterangan,
        versionId: version.id,
        assignments,
        disposition: 'CREATED',
      };
    });
    // Formula/Manual acceptance is already committed above. Resource identity
    // enrichment is deliberately not a gate: if observation preparation is
    // temporarily unavailable, Detail/Tinjau Resource will retry on demand.
    let resourceReviewPrepared = true;
    try {
      await this.observations.ensureHandBuiltObservations(
        workspaceId,
        resources,
      );
    } catch {
      resourceReviewPrepared = false;
    }
    return { ...saved, resourceReviewPrepared };
  }

  @Get(':id/classification-assignments')
  @Permissions('AHSP_VIEW')
  async listClassificationAssignments(
    @Req() request: WorkspaceScopedRequest,
    @Param('id') id: string,
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    return this.assignments.listAssignments({
      ahspId: id,
      actingWorkspaceId: workspaceId,
    });
  }

  @Post(':id/classification-assignments')
  @Permissions('AHSP_MANAGE')
  async addClassificationAssignments(
    @Req() request: WorkspaceScopedRequest,
    @Param('id') id: string,
    @Body() body: { leafNodeIds?: string[] },
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    const actorAccountId = await this.resolveActor(request);
    const leafNodeIds = [
      ...new Set(
        (Array.isArray(body?.leafNodeIds) ? body.leafNodeIds : []).filter(
          (leafNodeId): leafNodeId is string =>
            typeof leafNodeId === 'string' && leafNodeId.trim() !== '',
        ),
      ),
    ];
    if (leafNodeIds.length === 0) {
      throw new BadRequestException(
        'AHSP_CLASSIFICATION_ASSIGNMENT_LEAF_REQUIRED',
      );
    }
    return this.prisma.$transaction(async (tx) =>
      Promise.all(
        leafNodeIds.map((leafNodeId) =>
          this.assignments.addAssignment(
            {
              ahspId: id,
              leafNodeId,
              provenance:
                AhspClassificationAssignmentProvenance.HUMAN_ADDED,
              actingWorkspaceId: workspaceId,
              actorAccountId,
            },
            tx,
          ),
        ),
      ),
    );
  }

  @Post(':id/classification-assignments/:assignmentId/deactivate')
  @Permissions('AHSP_MANAGE')
  async deactivateClassificationAssignment(
    @Req() request: WorkspaceScopedRequest,
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
  ) {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    const actorAccountId = await this.resolveActor(request);
    return this.assignments.deactivateAssignment({
      ahspId: id,
      assignmentId,
      actingWorkspaceId: workspaceId,
      actorAccountId,
    });
  }

  @Post()
  @Permissions('AHSP_MANAGE')
  async create(@Req() request: any, @Body() body: CreateAhspDto) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;

    // RM-03B tenant trust: the workspace comes from the guard-verified context
    // ONLY. This read `body.workspaceId ?? workspaceId`, so a client-supplied
    // field OVERRODE the verified one and a member of workspace B could plant
    // an AHSP into workspace A. That was already wrong; it becomes an
    // exploitable pricing path the moment workspace-private AHSPs are bindable,
    // because private eligibility is keyed on exactly this column. There is no
    // global ValidationPipe and CreateAhspDto is a plain interface, so a forged
    // body field is stripped nowhere else — it must be ignored here.
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    const userId = await this.resolveActor(request);

    // Both authority fields are destructured OUT of the body before it is
    // spread, so a forged value cannot survive even if the spread order were
    // later changed by accident. Relying on "the explicit key wins because it
    // comes second" is a property of this line, not of the contract.
    const { userId: _clientActor, workspaceId: _clientWorkspace, ...safeBody } = body;

    return this.ahspService.create({
      ...safeBody,
      workspaceId,
      userId,
    });
  }

  @Get(':id')
  @Permissions('AHSP_VIEW')
  async getById(@Req() request: any, @Param('id') id: string) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    return this.ahspService.getDetail(id, workspaceId);
  }

  @Patch(':id')
  @Permissions('AHSP_MANAGE')
  async update(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: UpdateAhspDto & { reason: string; userId?: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.update(id, body, actorUserId, body.reason, workspaceId);
  }

  @Delete(':id')
  @Permissions('AHSP_MANAGE')
  async delete(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId?: string; reason: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.delete(id, actorUserId, body.reason, workspaceId);
  }

  @Post(':id/archive')
  @Permissions('AHSP_MANAGE')
  async archive(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId?: string; reason: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.archive(id, actorUserId, body.reason, workspaceId);
  }

  @Post(':id/approve')
  @Permissions('AHSP_APPROVE')
  async approve(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId?: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.approve(id, actorUserId, workspaceId);
  }

  @Post(':id/transfer')
  @Permissions('AHSP_MANAGE')
  async transfer(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId?: string; reason: string; targetOwnershipType: OwnershipType },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.transfer(id, body.targetOwnershipType, actorUserId, body.reason, workspaceId);
  }

  /**
   * "Usulkan ke SIMPROK" — the workspace owner submits their AHSP for human
   * review. Records the submission; never approves or publishes. The reviewer's
   * decision stays on the separate approve/reject routes below.
   */
  @Post(':id/propose')
  @Permissions('AHSP_MANAGE')
  async propose(@Req() request: any, @Param('id') id: string) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.propose(id, actorUserId, workspaceId);
  }

  /** The immutable subject bound at propose. Not the live working AHSP. */
  @Get(':id/proposal-subject')
  @Permissions('AHSP_VIEW')
  async proposalSubject(@Req() request: any, @Param('id') id: string) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    return this.ahspService.readProposalSubject(id, workspaceId);
  }

  /** A reviewer declines a proposed AHSP (-> Ditolak). Separate authority. */
  @Post(':id/reject')
  @Permissions('AHSP_APPROVE')
  async reject(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId?: string; reason: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.reject(id, actorUserId, body.reason, workspaceId);
  }

  // ─────────────────────────────────────────────
  // AHSP VERSION
  // ─────────────────────────────────────────────

  @Post(':id/versions')
  @Permissions('AHSP_MANAGE')
  async createVersion(
    @Req() request: any,
    @Param('id') ahspId: string,
    @Body() body: CreateAhspVersionDto,
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    // Same trust inversion as create(), same fix. A version inherits the
    // eligibility of its parent AHSP, so a forged workspaceId here is just as
    // load-bearing as one on the AHSP itself.
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    const userId = await this.resolveActor(request);
    const { userId: _clientActor, workspaceId: _clientWorkspace, ...safeBody } = body;
    const version = await this.ahspVersionService.createVersion(ahspId, {
      ...safeBody,
      workspaceId,
      userId,
    });
    await this.observations.ensureHandBuiltObservations(
      workspaceId,
      Array.isArray(safeBody.resources) ? safeBody.resources : [],
    );
    return version;
  }

  // ─────────────────────────────────────────────
  // AHSP SNAPSHOT (freeze basis AHSP untuk BOQ)
  // ─────────────────────────────────────────────

  @Post('versions/:versionId/snapshot')
  @Permissions('AHSP_MANAGE')
  async createSnapshot(
    @Req() request: any,
    @Param('versionId') versionId: string,
    @Body() body: { userId?: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('workspaceId diperlukan untuk membuat AHSP Snapshot');
    }
    const actorUserId = await this.resolveActor(request);
    return this.ahspSnapshotService.createSnapshot(versionId, workspaceId, actorUserId);
  }

  // ─────────────────────────────────────────────
  // AHSP VERSION RETIREMENT (RM-03D1)
  // ─────────────────────────────────────────────

  /**
   * Withdraw ONE erroneous or replaced version from all future selection.
   *
   * The service already had `updateStatus` with no caller, so an incorrect
   * version stayed eligible forever and the only reachable alternative —
   * `POST :id/archive` — archives the whole AHSP parent and takes the correct
   * versions with it. This is the narrow, version-scoped act that was missing.
   *
   * PERMISSION — the SAME AHSP_MANAGE the create-version route already requires.
   * Withdrawing a version you may create is not a broader authority than
   * creating it, so no new permission code is minted. History is preserved: the
   * version, its resources, its audit log and every occurrence that priced
   * against it all survive, and only future eligibility changes.
   */
  @Post('versions/:versionId/retire')
  @Permissions('AHSP_MANAGE')
  async retireVersion(
    @Req() request: any,
    @Param('versionId') versionId: string,
    @Body() body: RetireAhspVersionDto,
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    // Same trusted-actor discipline as every other mutation here: the acting
    // user is derived, never read from the body.
    const actorUserId = await this.resolveActor(request);
    return this.ahspVersionService.retireVersion({
      versionId,
      workspaceId,
      status: body.status,
      userId: actorUserId,
      reason: body.reason,
    });
  }
}
