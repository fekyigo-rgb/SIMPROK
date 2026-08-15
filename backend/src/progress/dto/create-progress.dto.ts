import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsDecimal,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProgressEvidenceReferenceDto {
  @IsUrl({ require_protocol: true })
  url: string;

  @IsString()
  @Length(1, 120)
  label: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  mediaType?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  integrityHash?: string;
}

export class ProgressEntryDto {
  @IsUUID()
  boqItemId: string;

  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  installedQuantity: string;

  @IsDateString()
  workDate: string;

  @IsString()
  @Length(1, 80)
  captureMethod: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProgressEvidenceReferenceDto)
  evidenceReferences?: ProgressEvidenceReferenceDto[];
}

export class SubmitFieldProgressDto {
  @IsUUID()
  commandId: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProgressEntryDto)
  entries: ProgressEntryDto[];
}

export class CorrectProgressDto {
  @IsUUID()
  commandId: string;

  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  installedQuantity: string;

  @IsDateString()
  workDate: string;

  @IsString()
  @Length(1, 80)
  captureMethod: string;

  @IsString()
  @Length(1, 2000)
  reason: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  notes?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProgressEvidenceReferenceDto)
  evidenceReferences?: ProgressEvidenceReferenceDto[];
}

export class ProgressTransitionDto {
  @IsUUID()
  commandId: string;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  reason?: string;
}
