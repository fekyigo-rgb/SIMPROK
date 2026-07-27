import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS } from '../common/constants/permissions';
import { Permissions } from '../common/decorators/permissions.decorator';
import { BasicPriceImportLookupService } from './basic-price-import-lookup.service';
import { SearchResourceCatalogDto, SearchUnitDefinitionDto } from './dto/search-basic-price-import-lookups.dto';

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
}
