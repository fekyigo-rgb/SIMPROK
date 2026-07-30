import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS } from '../common/constants/permissions';
import { Permissions } from '../common/decorators/permissions.decorator';
import { BasicPriceImportLookupService } from './basic-price-import-lookup.service';
import {
  SearchRegionDto,
  SearchResourceCatalogDto,
  SearchUnitDefinitionDto,
} from './dto/search-basic-price-import-lookups.dto';

@Controller('basic-price-import-lookups')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BasicPriceImportLookupController {
  constructor(private readonly lookupService: BasicPriceImportLookupService) {}

  @Get('resources')
  @Permissions(PERMISSIONS.BASIC_PRICE_REVIEW_VIEW)
  searchResources(@Req() request: any, @Query() dto: SearchResourceCatalogDto) {
    return this.lookupService.searchResources(request.workspaceContext.workspaceId, dto);
  }

  @Get('units')
  @Permissions(PERMISSIONS.BASIC_PRICE_REVIEW_VIEW)
  searchUnits(@Query() dto: SearchUnitDefinitionDto) {
    return this.lookupService.searchUnits(dto);
  }

  /**
   * RM-02D2A2 — canonical GLOBAL active Region list for the import Region
   * selector. Gated by BASIC_PRICE_IMPORT per the locked contract; Region has
   * no workspaceId so the service does not workspace-scope it.
   */
  @Get('regions')
  @Permissions(PERMISSIONS.BASIC_PRICE_IMPORT)
  searchRegions(@Query() dto: SearchRegionDto) {
    return this.lookupService.searchRegions(dto);
  }
}
