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
import {
  Permissions,
  PermissionsAll,
} from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import {
  BasicPriceImportService,
  MAX_UPLOAD_BYTES,
} from './basic-price-import.service';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import { BasicPriceRowMappingCandidatesService } from './basic-price-row-mapping-candidates.service';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';
import { TrustedBasicPriceActorService } from './trusted-basic-price-actor.service';
import { WorkspacePermissionResolverService } from '../auth/workspace-permission-resolver.service';
import { PreviewBasicPriceImportDto } from './dto/preview-basic-price-import.dto';
import { UpdateBasicPriceImportBatchDto } from './dto/update-basic-price-import-batch.dto';
import {
  ResolveBasicPriceImportRowDto,
  RejectBasicPriceImportRowDto,
} from './dto/resolve-basic-price-import-row.dto';
import { AdmitResourceForImportRowDto } from './dto/admit-resource-for-import-row.dto';
import { AcceptMachineProvenRowsDto } from './dto/accept-machine-proven-rows.dto';
import { BasicPriceSmartSaveService } from './basic-price-smart-save.service';
import { CorrectPrivateProvenanceDto } from './dto/correct-private-provenance.dto';
import { EnrichBasicPriceKdnDto } from './dto/enrich-basic-price-kdn.dto';
import { CorrectPrivateBasicPriceDto } from './dto/correct-private-basic-price.dto';
import { ObservePrivateBasicPriceDto } from './dto/observe-private-basic-price.dto';
import { ObservePrivateKdnDto } from './dto/observe-private-kdn.dto';
import { CorrectPrivateKdnDto } from './dto/correct-private-kdn.dto';

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
/**
 * The two SERVER-DERIVED identities every route here reads off the request.
 *
 * `PermissionsGuard` resolves `workspaceContext` from the x-workspace-id header
 * and `JwtAuthGuard` resolves `user`, so by the time a handler runs both are
 * present. Declared once so a handler can name what it reads instead of
 * reaching into `any`.
 */
interface RequestIdentity {
  workspaceContext: { workspaceId: string };
  user: { id: string };
}

@Controller('basic-price-imports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BasicPriceImportController {
  constructor(
    private readonly importService: BasicPriceImportService,
    private readonly resolutionService: BasicPriceRowResolutionService,
    private readonly mappingCandidatesService: BasicPriceRowMappingCandidatesService,
    private readonly privateAssetService: BasicPricePrivateAssetService,
    private readonly trustedActor: TrustedBasicPriceActorService,
    private readonly smartSaveService: BasicPriceSmartSaveService,
    private readonly permissionResolver: WorkspacePermissionResolverService,
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
    // Distinguishing "client sent effectiveDateProvenance: null" (CLEAR the
    // claim) from "client omitted it" (leave it alone) requires the
    // pre-transform raw body — the global ValidationPipe runs with
    // transform: true, and class-transformer materializes every declared DTO
    // field as an own property regardless of what the client actually sent.
    // Same technique the BOQ persist route already uses for unitPrice.
    const providedKeys = Object.keys(request.body ?? {});
    return this.importService.updateBatchMetadata(
      workspaceId,
      batchId,
      dto,
      currentAccountId,
      providedKeys,
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
   * ONE GOVERNED ACCEPTANCE for every row SIMPROK has already proven.
   *
   * SAME PERMISSION, SAME AUTHORITY, SAME AUDIT as pressing `Selesaikan` once —
   * because it IS that act, made once instead of N times. `BASIC_PRICE_RESOLVE`
   * is deliberately not widened: accepting thirteen proven rows is not a larger
   * capability than accepting one, it is the same capability exercised without
   * transcription.
   *
   * THE BODY CARRIES NO IDENTITY. It may name rows to LEAVE ALONE, and nothing
   * else; the eligible set is derived server-side at execution time. A request
   * that could name catalog ids would make the browser the identity authority.
   */
  /**
   * `Simpan & Gunakan` — ONE user intent, ONE backend command.
   *
   * The browser used to sequence this itself: accept-machine-proven, wait,
   * keep-private. Two business mutations orchestrated by a client, so a dropped
   * connection between them left the batch half-done with nobody able to say
   * which half. The orchestration is now server-side and this is the only route
   * a normal `Simpan & Gunakan` press calls.
   *
   * BOTH PERMISSIONS, VIA `PermissionsAll` — binding an identity and
   * materializing a price are two capabilities, and a caller holding only one
   * must not acquire the other by pressing a button that does both.
   *
   * THE BODY CARRIES NO IDENTITY. It may name rows to LEAVE ALONE and nothing
   * else; the eligible set is derived server-side at execution time.
   */
  @Post(':batchId/smart-save')
  @PermissionsAll(
    PERMISSIONS.BASIC_PRICE_RESOLVE,
    PERMISSIONS.BASIC_PRICE_SUBMIT,
  )
  async smartSave(
    @Req() request: RequestIdentity,
    @Param('batchId') batchId: string,
    @Body() dto: AcceptMachineProvenRowsDto,
  ) {
    // Both halves of the identity are SERVER-DERIVED: the workspace from
    // PermissionsGuard's resolved context, the account from the verified JWT.
    const actor = await this.trustedActor.resolveActor(
      request.workspaceContext,
      request.user.id,
    );
    return this.smartSaveService.acceptProvenAndKeepPrivate({
      workspaceId: request.workspaceContext.workspaceId,
      batchId,
      actor,
      reviewerAccountId: request.user.id,
      excludeRowIds: dto?.excludeRowIds,
    });
  }

  /**
   * The BINDING half on its own, kept because it is a genuinely separate
   * capability (`BASIC_PRICE_RESOLVE` alone) and because the acceptance suite
   * exercises it directly. The normal product door is `smart-save` above.
   */
  @Post(':batchId/accept-machine-proven')
  @Permissions(PERMISSIONS.BASIC_PRICE_RESOLVE)
  async acceptMachineProvenRows(
    /**
     * TYPED, unlike its neighbours. Every other route here takes `any` and
     * reads two fields off it unchecked; that is pre-existing debt this task
     * does not own and does not spread. Both facts are SERVER-DERIVED — the
     * workspace from the context guard, the account from the auth guard — and
     * naming their shape costs nothing and removes three unsafe reads.
     */
    @Req() request: RequestIdentity,
    @Param('batchId') batchId: string,
    @Body() dto: AcceptMachineProvenRowsDto,
  ) {
    const workspaceId = request.workspaceContext.workspaceId;
    const reviewerAccountId = request.user.id;
    return this.resolutionService.acceptMachineProvenRows(
      workspaceId,
      batchId,
      reviewerAccountId,
      { excludeRowIds: dto?.excludeRowIds },
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

  /**
   * RM-03D1 — admit a genuinely new canonical resource from one reviewed row.
   *
   * PERMISSION — deliberately the SAME BASIC_PRICE_RESOLVE code as resolve,
   * and deliberately NOT a new one. This is the identity half of the identical
   * authority ("say what this row of MY batch means"), held by exactly the
   * same people, on exactly the same batch-ownership boundary. Minting a new
   * permission would either need it added to the ACTIVE_MEMBERSHIP baseline —
   * an Owner decision this slice has no authority to take — or leave the
   * capability 403 everywhere behind a per-environment activation.
   *
   * It is strictly narrower than resolve, not wider: resolve accepts any
   * existing resource the reviewer names, while this one refuses outright
   * unless ResourceIdentityResolutionService — the same authority the Golden
   * Thread uses, over this workspace's catalog AND the global one — has
   * exhausted every defensible candidate. A differently-spelled resource
   * SIMPROK already knows is never duplicated here.
   */
  @Post(':batchId/rows/:rowId/admit-resource')
  @Permissions(PERMISSIONS.BASIC_PRICE_RESOLVE)
  async admitResourceForRow(
    @Req() request: any,
    @Param('batchId') batchId: string,
    @Param('rowId') rowId: string,
    @Body() dto: AdmitResourceForImportRowDto,
  ) {
    // Both halves of the identity are server-derived: the workspace from
    // PermissionsGuard's resolved context, the reviewer from the verified JWT.
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const reviewerAccountId: string = request.user.id;
    return this.resolutionService.admitResourceForRow(
      workspaceId,
      batchId,
      rowId,
      reviewerAccountId,
      dto,
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

  /**
   * RM-03D1 — re-apply this batch's corrected provenance to the private prices
   * it already produced.
   *
   * `keep-private` copies the batch's metadata at write time and is idempotent,
   * so correcting the batch afterwards — which `PATCH :batchId` already allows
   * while the batch is still mutable — reached the batch and nothing else. The
   * only other writer of a BasicPrice is the publication ladder, which would
   * stamp a private asset PUBLISHED. Before this route the choice was therefore
   * a permanently mis-described price or an unlawful write.
   *
   * PERMISSION — the SAME BASIC_PRICE_SUBMIT as `keep-private`, deliberately not
   * a new code. It is the identical authority ("describe my own materialized
   * import rows truthfully"), held by exactly the same people, and strictly
   * weaker than the write that created those rows: it can change how a price is
   * DESCRIBED, never what it costs, and never its publication or verification
   * state.
   */
  @Post(':batchId/correct-private-provenance')
  @Permissions(PERMISSIONS.BASIC_PRICE_SUBMIT)
  async correctPrivateProvenance(
    @Req() request: any,
    @Param('batchId') batchId: string,
    @Body() dto: CorrectPrivateProvenanceDto,
  ) {
    // Both halves of the identity are server-derived, exactly as keep-private.
    const actor = await this.trustedActor.resolveActor(
      request.workspaceContext,
      request.user?.id,
    );
    return this.privateAssetService.correctPrivateProvenanceFromBatch({
      batchId,
      actor,
      reason: dto.reason,
    });
  }

  /**
   * BP-KDN-01 — fill a previously unknown %KDN on an existing private price
   * this workspace owns. Does not create a Basic Price and does not touch
   * money. Same BASIC_PRICE_SUBMIT as provenance correction.
   */
  @Post('prices/:priceId/kdn')
  @Permissions(PERMISSIONS.BASIC_PRICE_SUBMIT)
  async enrichKdn(
    @Req() request: any,
    @Param('priceId') priceId: string,
    @Body() dto: EnrichBasicPriceKdnDto,
  ) {
    const actor = await this.trustedActor.resolveActor(
      request.workspaceContext,
      request.user?.id,
    );
    return this.privateAssetService.enrichKdn({
      basicPriceId: priceId,
      actor,
      kdnPercent: dto.kdnPercent,
      reason: dto.reason,
      expectedKdnPercent: dto.expectedKdnPercent,
    });
  }

  /**
   * BP-DETAIL-MAINT-02 — fill a previously unknown %KDN on a SIMPROK Catalog
   * observation. Workspace catalog: BASIC_PRICE_VERIFY. Shared catalog:
   * BASIC_PRICE_PROMOTE_SHARED. Ordinary SUBMIT cannot enter. Same KDN
   * interpreter and fill-missing law as the private enrich route.
   */
  @Post('prices/:priceId/catalog-kdn')
  @Permissions(
    PERMISSIONS.BASIC_PRICE_VERIFY,
    PERMISSIONS.BASIC_PRICE_PROMOTE_SHARED,
  )
  async enrichCatalogKdn(
    @Req() request: any,
    @Param('priceId') priceId: string,
    @Body() dto: EnrichBasicPriceKdnDto,
  ) {
    const actor = await this.trustedActor.resolveActor(
      request.workspaceContext,
      request.user?.id,
    );
    const effective = await this.permissionResolver.resolve(
      actor.accountId,
      actor.workspaceId,
    );
    const held = effective?.permissions ?? [];
    return this.privateAssetService.enrichCatalogKdn({
      basicPriceId: priceId,
      actor,
      kdnPercent: dto.kdnPercent,
      reason: dto.reason,
      expectedKdnPercent: dto.expectedKdnPercent,
      canVerify: held.includes(PERMISSIONS.BASIC_PRICE_VERIFY),
      canPromoteShared: held.includes(PERMISSIONS.BASIC_PRICE_PROMOTE_SHARED),
    });
  }

  /**
   * BP-DETAIL-MAINT-02 — private post-create money correction.
   *
   * Creates a successor observation. Does not PATCH the predecessor. Same
   * BASIC_PRICE_SUBMIT as keep-private / KDN enrich. Catalog money still
   * routes through review and publication, never this door.
   */
  @Post('prices/:priceId/corrections')
  @Permissions(PERMISSIONS.BASIC_PRICE_SUBMIT)
  async correctPrivatePrice(
    @Req() request: any,
    @Param('priceId') priceId: string,
    @Body() dto: CorrectPrivateBasicPriceDto,
  ) {
    const actor = await this.trustedActor.resolveActor(
      request.workspaceContext,
      request.user?.id,
    );
    return this.privateAssetService.correctPrivatePrice({
      basicPriceId: priceId,
      actor,
      expectedValue: dto.expectedValue,
      proposedValue: dto.proposedValue,
      reason: dto.reason,
    });
  }

  /**
   * BP-CHANGE-SEM-03 — later lawful private price observation.
   *
   * Same BASIC_PRICE_SUBMIT as keep-private / correction. Does not claim
   * the predecessor was wrong. Catalog money still routes through review
   * and publication, never this door.
   */
  @Post('prices/:priceId/observations')
  @Permissions(PERMISSIONS.BASIC_PRICE_SUBMIT)
  async observePrivatePrice(
    @Req() request: RequestIdentity,
    @Param('priceId') priceId: string,
    @Body() dto: ObservePrivateBasicPriceDto,
  ) {
    const actor = await this.trustedActor.resolveActor(
      request.workspaceContext,
      request.user?.id,
    );
    return this.privateAssetService.observePrivatePrice({
      basicPriceId: priceId,
      actor,
      expectedValue: dto.expectedValue,
      proposedValue: dto.proposedValue,
      effectiveDate: dto.effectiveDate,
      reason: dto.reason,
      sameSource: dto.sameSource,
      sourceIdentityName: dto.sourceIdentityName,
    });
  }

  /**
   * BP-CHANGE-SEM-03 — later lawful private KDN observation.
   *
   * Not the null-fill enrich writer. Catalog KDN still has no stated-value
   * overwrite from this door.
   */
  @Post('prices/:priceId/kdn-observations')
  @Permissions(PERMISSIONS.BASIC_PRICE_SUBMIT)
  async observePrivateKdn(
    @Req() request: RequestIdentity,
    @Param('priceId') priceId: string,
    @Body() dto: ObservePrivateKdnDto,
  ) {
    const actor = await this.trustedActor.resolveActor(
      request.workspaceContext,
      request.user?.id,
    );
    return this.privateAssetService.observePrivateKdn({
      basicPriceId: priceId,
      actor,
      expectedValue: dto.expectedValue,
      expectedKdnPercent: dto.expectedKdnPercent,
      proposedKdnPercent: dto.proposedKdnPercent,
      effectiveDate: dto.effectiveDate,
      reason: dto.reason,
    });
  }

  /**
   * BP-CHANGE-SEM-03 — stated private KDN was recorded wrong.
   *
   * Successor with supersession. Does not PATCH. Does not use enrich.
   */
  @Post('prices/:priceId/kdn-corrections')
  @Permissions(PERMISSIONS.BASIC_PRICE_SUBMIT)
  async correctPrivateKdn(
    @Req() request: RequestIdentity,
    @Param('priceId') priceId: string,
    @Body() dto: CorrectPrivateKdnDto,
  ) {
    const actor = await this.trustedActor.resolveActor(
      request.workspaceContext,
      request.user?.id,
    );
    return this.privateAssetService.correctPrivateKdn({
      basicPriceId: priceId,
      actor,
      expectedValue: dto.expectedValue,
      expectedKdnPercent: dto.expectedKdnPercent,
      proposedKdnPercent: dto.proposedKdnPercent,
      reason: dto.reason,
    });
  }
}
