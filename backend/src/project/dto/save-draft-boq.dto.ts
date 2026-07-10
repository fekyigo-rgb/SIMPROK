import { IsArray, ValidateNested, IsString, IsNumber, Min, IsOptional, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ItemTypeEnum } from './initiate-project.dto';

export class DraftBoqRowDto {
  @IsString()
  tempId: string;

  @IsString()
  @IsOptional()
  parentTempId?: string | null;

  @IsEnum(ItemTypeEnum)
  itemType: ItemTypeEnum;

  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  wbsCode?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  quantity?: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitPrice?: number;

  @IsNumber()
  @IsOptional()
  sortOrder?: number;
}

export class SaveDraftBoqDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftBoqRowDto)
  rows: DraftBoqRowDto[];
}
