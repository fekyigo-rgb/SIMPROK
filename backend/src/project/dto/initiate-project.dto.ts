import { IsArray, ValidateNested, IsString, IsNotEmpty, IsNumber, Min, IsOptional, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class BoqItemDto {
  @IsString()
  @IsNotEmpty()
  wbsCode: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @ValidateIf(o => o.itemType !== 'FOLDER')
  @IsNumber()
  @Min(0.000001)
  quantity: number;

  @IsString()
  @IsOptional() // Make unit optional for FOLDER items
  unit?: string;

  @IsNumber()
  @Min(0)
  plannedCost: number;

  @IsString()
  @IsOptional()
  tempId?: string;

  @IsString()
  @IsOptional()
  parentTempId?: string;

  @IsString()
  @IsOptional()
  itemType?: string; // 'FOLDER' or 'WORK_ITEM'
}

export class InitiateProjectDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BoqItemDto)
  items: BoqItemDto[];
}
