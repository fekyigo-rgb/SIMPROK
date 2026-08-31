import { Controller, Get, Param, Req, UseGuards, Query } from '@nestjs/common';
import { GetBasicPricesDto } from './dto/get-basic-prices.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { BasicPriceService } from './basic-price.service';
import { BasicPriceImportLookupService } from './basic-price-import-lookup.service';
import { SearchRegionDto } from './dto/search-basic-price-import-lookups.dto';

/**
 * The one fact `PermissionsGuard` attaches to every request that reaches this
 * controller. Declared rather than read off `any` so a new route cannot pick up
 * the wrong property name and fail at runtime instead of at build time.
 */
interface WorkspaceScopedRequest {
  workspaceContext?: { workspaceId?: string };
}

/**
 * BasicPriceController — Golden Path v0 Slice A
 *
 * Read-only. Semua endpoint dilindungi JWT + PermissionsGuard.
 * WorkspaceId dari x-workspace-id header (via PermissionsGuard context).
 * Write masuk via reality-intake domain (price submission flow).
 */
@Controller('basic-prices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BasicPriceController {
  constructor(
    private readonly basicPriceService: BasicPriceService,
    private readonly lookupService: BasicPriceImportLookupService,
  ) {}

  @Get('health')
  @Permissions('BASIC_PRICE_VIEW')
  healthCheck() {
    return this.basicPriceService.healthCheck();
  }

  /**
   * GET /basic-prices/lookups/regions
   *
   * Explorer-scoped Region lookup, gated by BASIC_PRICE_VIEW (not
   * BASIC_PRICE_IMPORT — the import lookup at
   * GET /basic-price-import-lookups/regions is deliberately left untouched
   * so its permission never widens; this bounded route reuses the same
   * service/query logic under the Explorer's own permission). Region is a
   * canonical GLOBAL entity — no workspaceId is invented here.
   */
  @Get('lookups/regions')
  @Permissions('BASIC_PRICE_VIEW')
  searchRegions(@Query() dto: SearchRegionDto) {
    return this.lookupService.searchRegions(dto);
  }

  /**
   * GET /basic-prices
   * Ambil semua harga dasar untuk workspace aktif dengan filter, pencarian, dan paginasi.
   */
  @Get()
  @Permissions('BASIC_PRICE_VIEW')
  findAll(@Req() request: any, @Query() query: GetBasicPricesDto) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    return this.basicPriceService.findAllForWorkspace(workspaceId, query);
  }

  /**
   * GET /basic-prices/by-resource/:resourceId
   * Cari harga dasar berdasarkan resource, scoped ke workspace.
   */
  @Get('by-resource/:resourceId')
  @Permissions('BASIC_PRICE_VIEW')
  findByResource(@Req() request: any, @Param('resourceId') resourceId: string) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    return this.basicPriceService.findByResource(resourceId, workspaceId);
  }

  /**
   * GET /basic-prices/:id/detail
   *
   * BP-UX-FINAL-01C — the browser-facing Basic Price detail: one explicit
   * projection carrying the human-readable price, the evidence facts SIMPROK
   * can actually prove, and the REAL persisted supersession timeline.
   *
   * A SEPARATE DOOR FROM `:id`, DELIBERATELY. The raw `:id` read below is a
   * proven contract — acceptance specs assert `status`, `verificationStatus`
   * and `supersedesBasicPriceId` directly off it — so it is left untouched and
   * the projected read gets its own bounded route rather than a breaking
   * change dressed up as a tidy-up.
   *
   * Declared BEFORE `:id` so the two-segment path is matched by this handler
   * and never swallowed by the single-segment one.
   *
   * Same permission and the same workspace context as every other read here:
   * this is a narrower view of data `BASIC_PRICE_VIEW` already opens, never a
   * new authority.
   */
  @Get(':id/detail')
  @Permissions('BASIC_PRICE_VIEW')
  findDetail(
    // TYPED, unlike its four neighbours. Those read `request: any` and each
    // costs two `no-unsafe-*` errors; that is pre-existing debt this mission is
    // not authorised to churn, but a NEW route has no reason to inherit it.
    // The shape is exactly what `PermissionsGuard` puts on the request.
    @Req() request: WorkspaceScopedRequest,
    @Param('id') id: string,
  ) {
    const workspaceId = request.workspaceContext?.workspaceId as string;
    return this.basicPriceService.findDetailForWorkspace(id, workspaceId);
  }

  /**
   * GET /basic-prices/:id
   * Ambil satu BasicPrice by ID, scoped ke workspace aktif.
   */
  @Get(':id')
  @Permissions('BASIC_PRICE_VIEW')
  findOne(@Req() request: any, @Param('id') id: string) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    return this.basicPriceService.findOneForWorkspace(id, workspaceId);
  }
}
