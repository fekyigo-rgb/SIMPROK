import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { BasicPriceImportService, MAX_UPLOAD_BYTES } from './basic-price-import.service';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import { BasicPricePublicationService } from './basic-price-publication.service';
import { BasicPriceRowMappingCandidatesService } from './basic-price-row-mapping-candidates.service';
import { PreviewBasicPriceImportDto } from './dto/preview-basic-price-import.dto';
import { UpdateBasicPriceImportBatchDto } from './dto/update-basic-price-import-batch.dto';
import { ResolveBasicPriceImportRowDto, RejectBasicPriceImportRowDto } from './dto/resolve-basic-price-import-row.dto';

/**
 * BasicPriceImportController — RM-02 Basic Price import foundation.
 *
 * Every mutating route here is gated by a BASIC_PRICE_* permission code
 * that is declared but not yet seeded into any environment (see
 * DECLARED_NOT_SEEDED_PERMISSION_CODES in common/constants/permissions.ts)
 * — fail-closed (403) until a separate, Owner/PM-governed seeding task
 * grants them. WorkspaceId comes from PermissionsGuard's resolved
 * `request.workspaceContext` (x-workspace-id header), matching
 * BasicPriceController's existing convention exactly.
 */
@Controller('basic-price-imports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BasicPriceImportController {
  constructor(
    private readonly importService: BasicPriceImportService,
    private readonly resolutionService: BasicPriceRowResolutionService,
    private readonly mappingCandidatesService: BasicPriceRowMappingCandidatesService,
  ) {}

  @Post('preview')
  @Permissions(PERMISSIONS.BASIC_PRICE_IMPORT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async preview(@Req() request: any, @UploadedFile() file: any, @Body() dto: PreviewBasicPriceImportDto) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const uploadedByAccountId: string = request.user.id;
    return this.importService.preview(workspaceId, uploadedByAccountId, file, dto);
  }

  @Get(':batchId')
  @Permissions(PERMISSIONS.BASIC_PRICE_REVIEW_VIEW)
  async getBatch(@Req() request: any, @Param('batchId') batchId: string) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    return this.importService.getBatch(workspaceId, batchId);
  }

  @Patch(':batchId')
  @Permissions(PERMISSIONS.BASIC_PRICE_IMPORT)
  async updateBatch(@Req() request: any, @Param('batchId') batchId: string, @Body() dto: UpdateBasicPriceImportBatchDto) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    return this.importService.updateBatchMetadata(workspaceId, batchId, dto);
  }

  @Post(':batchId/rows/:rowId/resolve')
  @Permissions(PERMISSIONS.BASIC_PRICE_RESOLVE)
  async resolveRow(
    @Req() request: any,
    @Param('batchId') batchId: string,
    @Param('rowId') rowId: string,
    @Body() dto: ResolveBasicPriceImportRowDto,
  ) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const reviewerAccountId: string = request.user.id;
    return this.resolutionService.resolveRow(workspaceId, batchId, rowId, reviewerAccountId, dto);
  }

  /**
   * RM-02D1 — normalized-name candidate suggestions for one unresolved row.
   * Read-only, review-signal-only: never resolves anything, gated by the
   * same review-view permission as GET :batchId.
   */
  @Get(':batchId/rows/:rowId/candidates')
  @Permissions(PERMISSIONS.BASIC_PRICE_REVIEW_VIEW)
  async getRowCandidates(@Req() request: any, @Param('batchId') batchId: string, @Param('rowId') rowId: string) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    return this.mappingCandidatesService.findCandidatesForRow(workspaceId, batchId, rowId);
  }

  @Post(':batchId/rows/:rowId/reject')
  @Permissions(PERMISSIONS.BASIC_PRICE_RESOLVE)
  async rejectRow(
    @Req() request: any,
    @Param('batchId') batchId: string,
    @Param('rowId') rowId: string,
    @Body() dto: RejectBasicPriceImportRowDto,
  ) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    return this.resolutionService.rejectRow(workspaceId, batchId, rowId, dto);
  }

  @Post(':batchId/submit')
  @Permissions(PERMISSIONS.BASIC_PRICE_SUBMIT)
  async submitBatch(@Req() request: any, @Param('batchId') batchId: string) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    return this.importService.submitBatch(workspaceId, batchId);
  }
}

/**
 * Publication is not an import-batch concept (a verified BasicPrice may be
 * published regardless of whether it originated from an RM-02 import), so
 * this lives under the existing `basic-prices` path prefix — a second
 * controller class sharing that prefix with the read-only
 * BasicPriceController, contributing exactly one new mutating route. Kept
 * in this file (not basic-price.controller.ts) per the allowlist's "extend
 * only" instruction for that file, which frames the extension around
 * eligibility-policy reuse in the three existing read methods, not new
 * routes.
 */
@Controller('basic-prices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BasicPricePublicationController {
  constructor(private readonly publicationService: BasicPricePublicationService) {}

  @Post(':basicPriceId/publish')
  @Permissions(PERMISSIONS.BASIC_PRICE_PUBLISH)
  async publish(@Req() request: any, @Param('basicPriceId') basicPriceId: string) {
    const actorAccountId: string = request.user.id;
    return this.publicationService.publish(basicPriceId, actorAccountId);
  }
}
