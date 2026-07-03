import { IsArray, ValidateNested, IsString, IsNotEmpty, IsNumber, Min, IsOptional, ValidateIf, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum ItemTypeEnum {
  FOLDER = 'FOLDER',
  WORK_ITEM = 'WORK_ITEM',
  NOTE = 'NOTE',
}

export class BoqItemDto {
  @IsString()
  @IsNotEmpty()
  wbsCode: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @ValidateIf(o => o.itemType !== 'FOLDER' && o.itemType !== 'NOTE')
  @IsNumber()
  @Min(0.000001)
  quantity?: number;

  @ValidateIf(o => o.itemType !== 'FOLDER' && o.itemType !== 'NOTE')
  @IsString()
  @IsNotEmpty()
  unit?: string;

  @ValidateIf(o => o.itemType !== 'FOLDER' && o.itemType !== 'NOTE')
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsNumber()
  @IsOptional()
  plannedCost?: number; // legacy for now, backend will recalculate

  @IsString()
  @IsOptional()
  tempId?: string;

  @IsString()
  @IsOptional()
  parentTempId?: string;

  @IsEnum(ItemTypeEnum)
  itemType: ItemTypeEnum;

  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}

export class InitiateProjectDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BoqItemDto)
  items: BoqItemDto[];
}
