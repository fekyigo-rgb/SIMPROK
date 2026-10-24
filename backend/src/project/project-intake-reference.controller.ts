import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
    private readonly prisma: PrismaService,
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

  /**
   * Read-only reconstruction of previously selected canonical regions for
   * provisional RAB backflow. Reuses Region hierarchy; never mutates it.
   */
  @Get('regions/selected-lineage')
  @Permissions(PERMISSIONS.PROJECT_CREATE)
  async selectedRegionLineage(@Query('ids') ids?: string) {
    const values = ids?.split(',').filter(Boolean) ?? [];
    if (values.length < 1 || values.length > 25 ||
        values.some((id) => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) {
      throw new BadRequestException('PROJECT_REGION_SELECTION_IDS_INVALID');
    }
    const nodes = new Map<string, { id: string; name: string; parentId: string | null; administrativeLevel: string }>();
    for (const selectedId of values) {
      let cursor: string | null = selectedId;
      let depth = 0;
      while (cursor) {
        if (depth++ >= 6) throw new BadRequestException('PROJECT_REGION_LINEAGE_INVALID');
        if (nodes.has(cursor)) break;
        const region: { id: string; name: string; parentId: string | null; administrativeLevel: string | null; isActive: boolean } | null =
          await this.prisma.region.findUnique({
            where: { id: cursor },
            select: { id: true, name: true, parentId: true, administrativeLevel: true, isActive: true },
          });
        if (!region || !region.isActive || !region.administrativeLevel) {
          throw new BadRequestException('PROJECT_REGION_SELECTION_UNAVAILABLE');
        }
        nodes.set(cursor, { id: region.id, name: region.name, parentId: region.parentId, administrativeLevel: region.administrativeLevel });
        cursor = region.parentId;
      }
    }
    // A reused ancestor must still lead to a real COUNTRY. Reject cycles and
    // broken/shifted hierarchy, never fabricate a previously chosen location.
    const levels = ['COUNTRY', 'PROVINCE', 'REGENCY_CITY', 'DISTRICT', 'VILLAGE'];
    for (const id of values) {
      const seen = new Set<string>();
      let cursor: string | null = id;
      let reachedCountry = false;
      while (cursor) {
        if (seen.has(cursor)) throw new BadRequestException('PROJECT_REGION_LINEAGE_CYCLE');
        seen.add(cursor);
        const node = nodes.get(cursor);
        if (!node || !levels.includes(node.administrativeLevel)) {
          throw new BadRequestException('PROJECT_REGION_LINEAGE_UNAVAILABLE');
        }
        if (node.administrativeLevel === 'COUNTRY') {
          reachedCountry = true;
          break;
        }
        const parent = node.parentId ? nodes.get(node.parentId) : null;
        if (!parent || levels.indexOf(parent.administrativeLevel) !== levels.indexOf(node.administrativeLevel) - 1) {
          throw new BadRequestException('PROJECT_REGION_LINEAGE_INVALID');
        }
        cursor = node.parentId;
      }
      if (!reachedCountry) throw new BadRequestException('PROJECT_REGION_COUNTRY_UNRESOLVED');
    }
    return { nodes: [...nodes.values()] };
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
