import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BasicPriceImportLookupService } from '../basic-price/basic-price-import-lookup.service';
import { SearchRegionDto } from '../basic-price/dto/search-basic-price-import-lookups.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS } from '../common/constants/permissions';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ConstructionClassificationService } from '../construction-classification/construction-classification.service';

interface ProjectIntakeRequest {
  workspaceContext?: { workspaceId?: string };
}

@Controller('project-intake')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProjectIntakeReferenceController {
  constructor(
    private readonly classification: ConstructionClassificationService,
    private readonly regions: BasicPriceImportLookupService,
  ) {}

  @Get('classification/roots')
  @Permissions(PERMISSIONS.PROJECT_CREATE)
  classificationRoots(@Req() request: ProjectIntakeRequest) {
    return this.classification.listVisibleRoots({
      workspaceId: this.workspaceId(request),
    });
  }

  @Get('classification/children')
  @Permissions(PERMISSIONS.PROJECT_CREATE)
  classificationChildren(
    @Req() request: ProjectIntakeRequest,
    @Query('parentId') parentId?: string,
  ) {
    if (!parentId) {
      throw new BadRequestException('CLASSIFICATION_PARENT_ID_REQUIRED');
    }
    return this.classification.listChildren({
      workspaceId: this.workspaceId(request),
      parentId,
    });
  }

  @Get('regions')
  @Permissions(PERMISSIONS.PROJECT_CREATE)
  searchRegions(@Query() dto: SearchRegionDto) {
    return this.regions.searchRegions(dto);
  }

  private workspaceId(request: ProjectIntakeRequest): string {
    const workspaceId = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('PROJECT_INTAKE_WORKSPACE_CONTEXT_REQUIRED');
    }
    return workspaceId;
  }
}
