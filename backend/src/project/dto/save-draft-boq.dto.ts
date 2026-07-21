import {
  IsArray,
  ValidateNested,
  IsString,
  IsNumber,
  Min,
  IsOptional,
  IsEnum,
} from 'class-validator';
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
  @Type(() => Number)
  quantity?: number;

  @IsString()
  @IsOptional()
  unit?: string;

  /**
   * null/undefined = no authoritative price yet (never invent 0). An
   * explicit numeric 0 is a real human-entered price and must round-trip
   * as 0, distinct from "not priced".
   */
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  unitPrice?: number | null;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  sortOrder?: number;
}

export class SaveDraftBoqDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DraftBoqRowDto)
  rows: DraftBoqRowDto[];

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  marginPercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  ppnPercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  taxPercent?: number;
}
