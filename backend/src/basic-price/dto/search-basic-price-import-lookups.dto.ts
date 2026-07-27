import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ResourceType, UnitDimension, UnitKind } from '@prisma/client';

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
