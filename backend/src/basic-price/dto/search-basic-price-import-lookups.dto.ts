import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { RegionAdministrativeLevel, ResourceType, UnitDimension, UnitKind } from '@prisma/client';

class SearchBasicPriceImportLookupPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

export class SearchResourceCatalogDto extends SearchBasicPriceImportLookupPageDto {
  @IsOptional()
  @IsEnum(ResourceType)
  type?: ResourceType;
}

export class SearchUnitDefinitionDto extends SearchBasicPriceImportLookupPageDto {
  @IsOptional()
  @IsEnum(UnitDimension)
  dimension?: UnitDimension;

  @IsOptional()
  @IsEnum(UnitKind)
  kind?: UnitKind;
}

/**
 * RM-02D2A2 — Region is a canonical GLOBAL entity (no workspaceId). The
 * always-on filter is isActive. Optional `q` matches code/name/parent name.
 * Optional parentId / administrativeLevel let a caller walk the existing
 * Kemendagri tree WITHOUT a second Region engine. They return empty when
 * the national master is absent; they do not invent villages.
 */
export class SearchRegionDto extends SearchBasicPriceImportLookupPageDto {
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsEnum(RegionAdministrativeLevel)
  administrativeLevel?: RegionAdministrativeLevel;
}
