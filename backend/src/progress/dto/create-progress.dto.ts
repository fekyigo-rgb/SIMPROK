import {
  ArrayMaxSize,
  Equals,
  IsArray,
  IsDecimal,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
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

const PROJECT_BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

export enum ProgressCorrectionReasonCode {
  DATA_ENTRY_ERROR = 'DATA_ENTRY_ERROR',
  MEASUREMENT_UPDATE = 'MEASUREMENT_UPDATE',
  FIELD_FACT_CORRECTION = 'FIELD_FACT_CORRECTION',
  ADMINISTRATIVE_CORRECTION = 'ADMINISTRATIVE_CORRECTION',
  OTHER = 'OTHER',
}

export class ProgressEntryDto {
  @IsUUID()
  boqItemId: string;

  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  installedQuantity: string;

  @Matches(PROJECT_BUSINESS_DATE, {
    message: 'workDate must be a project business date in YYYY-MM-DD format',
  })
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

  @Matches(PROJECT_BUSINESS_DATE, {
    message: 'workDate must be a project business date in YYYY-MM-DD format',
  })
  workDate: string;

  @IsString()
  @Length(1, 80)
  captureMethod: string;

  @IsEnum(ProgressCorrectionReasonCode)
  reasonCode: ProgressCorrectionReasonCode;

  @IsString()
  @Length(1, 2000)
  reasonText: string;

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

export class ProgressSemanticAttestationDto {
  @IsUUID()
  commandId: string;

  @Matches(/^[a-f0-9]{64}$/)
  contextDigest: string;

  @Equals(true)
  confirmed: true;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  reason?: string;
}
