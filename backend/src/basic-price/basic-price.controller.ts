import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { BasicPriceService } from './basic-price.service';

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
  constructor(private readonly basicPriceService: BasicPriceService) {}

  @Get('health')
  @Permissions('BASIC_PRICE_VIEW')
  healthCheck() {
    return this.basicPriceService.healthCheck();
  }

  /**
   * GET /basic-prices
   * Ambil semua harga dasar untuk workspace aktif.
   */
  @Get()
  @Permissions('BASIC_PRICE_VIEW')
  findAll(@Req() request: any) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    return this.basicPriceService.findAllForWorkspace(workspaceId);
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
