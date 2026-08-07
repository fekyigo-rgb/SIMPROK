import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import {
  BasicPriceImportService,
  MAX_UPLOAD_BYTES,
} from './basic-price-import.service';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import { BasicPriceRowMappingCandidatesService } from './basic-price-row-mapping-candidates.service';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';
import { TrustedBasicPriceActorService } from './trusted-basic-price-actor.service';
import { PreviewBasicPriceImportDto } from './dto/preview-basic-price-import.dto';
import { UpdateBasicPriceImportBatchDto } from './dto/update-basic-price-import-batch.dto';
import {
  ResolveBasicPriceImportRowDto,
  RejectBasicPriceImportRowDto,
} from './dto/resolve-basic-price-import-row.dto';

/**
 * BasicPriceImportController — user-owned import boundary (Owner Decision:
 * ONE SIMPROK BASIC PRICE PRODUCT MODEL).
 *
 * Every route here is a USER activity on the caller's OWN import batch
 * (Activity A: preview/view/update the batch, resolve/reject/candidate-
 * lookup a row, submit the batch) — never internal curation. All of it is
 * gated by BASIC_PRICE_IMPORT/_RESOLVE/_SUBMIT, which
 * WorkspacePermissionResolverService grants structurally to every ACTIVE
 * WorkspaceMembership (see ACTIVE_MEMBERSHIP_BASELINE_PERMISSION_CODES in
 * common/constants/permissions.ts) — never BASIC_PRICE_REVIEW_VIEW/_VERIFY/
 * _PUBLISH, which remain internal-curation-only and are never a baseline.
 * Batch/row access is further scoped to the uploading account
 * (basic-price-import-ownership.util.ts) — a same-workspace teammate
 * holding the same capability cannot read or mutate another account's
 * batch. WorkspaceId comes from PermissionsGuard's resolved
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
    private readonly privateAssetService: BasicPricePrivateAssetService,
    private readonly trustedActor: TrustedBasicPriceActorService,
  ) {}

  @Post('preview')
  @Permissions(PERMISSIONS.BASIC_PRICE_IMPORT)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  async preview(
    @Req() request: any,
    @UploadedFile() file: any,
    @Body() dto: PreviewBasicPriceImportDto,
  ) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const uploadedByAccountId: string = request.user.id;
    return this.importService.preview(
      workspaceId,
      uploadedByAccountId,
      file,
      dto,
    );
  }

  @Get(':batchId')
  @Permissions(PERMISSIONS.BASIC_PRICE_IMPORT)
  async getBatch(@Req() request: any, @Param('batchId') batchId: string) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const currentAccountId: string = request.user.id;
    return this.importService.getBatch(workspaceId, batchId, currentAccountId);
  }

  @Patch(':batchId')
  @Permissions(PERMISSIONS.BASIC_PRICE_IMPORT)
  async updateBatch(
    @Req() request: any,
    @Param('batchId') batchId: string,
    @Body() dto: UpdateBasicPriceImportBatchDto,
  ) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const currentAccountId: string = request.user.id;
    return this.importService.updateBatchMetadata(
      workspaceId,
      batchId,
      dto,
      currentAccountId,
    );
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
    return this.resolutionService.resolveRow(
      workspaceId,
      batchId,
      rowId,
      reviewerAccountId,
      dto,
    );
  }

  /**
   * RM-02D1 — normalized-name candidate suggestions for one unresolved row
   * in the caller's OWN batch. Read-only, review-signal-only: never
   * resolves anything, gated by the same resolve permission as the
   * resolve/reject actions it supports.
   */
  @Get(':batchId/rows/:rowId/candidates')
  @Permissions(PERMISSIONS.BASIC_PRICE_RESOLVE)
  async getRowCandidates(
    @Req() request: any,
    @Param('batchId') batchId: string,
    @Param('rowId') rowId: string,
  ) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const currentAccountId: string = request.user.id;
    return this.mappingCandidatesService.findCandidatesForRow(
      workspaceId,
      batchId,
      rowId,
      currentAccountId,
    );
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
    const currentAccountId: string = request.user.id;
    return this.resolutionService.rejectRow(
      workspaceId,
      batchId,
      rowId,
      currentAccountId,
      dto,
    );
  }

  @Post(':batchId/submit')
  @Permissions(PERMISSIONS.BASIC_PRICE_SUBMIT)
  async submitBatch(@Req() request: any, @Param('batchId') batchId: string) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const currentAccountId: string = request.user.id;
    return this.importService.submitBatch(
      workspaceId,
      batchId,
      currentAccountId,
    );
  }

  /**
   * RM-03C — keep the caller's OWN resolved rows as workspace-private Basic
   * Prices, usable by this workspace immediately.
   *
   * This is the sibling of `submit` above, not a replacement for it, and the
   * two are not exclusive: `submit` hands the rows to SIMPROK's curation
   * queue, this one keeps them for the workspace. A batch may later do both;
   * a curation rejection never invalidates the private asset.
   *
   * PERMISSION — deliberately the SAME BASIC_PRICE_SUBMIT code as `submit`,
   * and deliberately NOT a new one. Both are the identical authority
   * ("materialize my own resolved import rows"), held by exactly the same
   * people: BASIC_PRICE_SUBMIT is an ACTIVE_MEMBERSHIP_BASELINE code, so every
   * ACTIVE membership already holds it. Keeping rows private is strictly the
   * LESS powerful of the two — it produces nothing outside the caller's own
   * workspace. Minting a new permission code would either need it added to the
   * baseline (an Owner decision this task has no authority to take) or leave
   * the capability 403 everywhere until a per-environment activation — which
   * would contradict "usable immediately, no second human".
   *
   * No verifier control, no publisher control, no review queue, no publication
   * queue is exposed here or anywhere else to a general user.
   */
  @Post(':batchId/keep-private')
  @Permissions(PERMISSIONS.BASIC_PRICE_SUBMIT)
  async keepBatchPrivate(
    @Req() request: any,
    @Param('batchId') batchId: string,
  ) {
    // Both halves of the identity come from the server: the workspace from
    // PermissionsGuard's resolved context, the account from the verified JWT.
    // Neither is read from the body or the query, so a forged workspaceId
    // cannot steer this write.
    const actor = await this.trustedActor.resolveActor(
      request.workspaceContext,
      request.user?.id,
    );
    return this.privateAssetService.keepBatchPrivate({ batchId, actor });
  }
}
