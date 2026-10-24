import { Transform, Type } from 'class-transformer';
import { SaveDraftBoqDto } from './save-draft-boq.dto';
import {
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const DECIMAL_18_2_NON_NEGATIVE = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

const normalizeOptionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// These are approved vocabulary labels, not untrusted classification node IDs.
// The ProjectService maps them through the shared classification authority
// only during explicit project creation, inside the same transaction.
export class ProjectVocabularyPathDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  kategori: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(180)
  subkategori?: string;
}

export class CreateProjectDto {
  /** Only the explicit first Save Draft action supplies this optional document. */
  @IsOptional()
  @ValidateNested()
  @Type(() => SaveDraftBoqDto)
  initialDraft?: SaveDraftBoqDto;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @Matches(DECIMAL_18_2_NON_NEGATIVE)
  @IsOptional()
  budgetBaseline?: string | null;

  @Transform(normalizeOptionalText)
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  mainMaterialSpec?: string | null;

  @IsOptional()
  @IsUUID()
  workspaceId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  classificationNodeIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(80)
  @ValidateNested({ each: true })
  @Type(() => ProjectVocabularyPathDto)
  classificationVocabularyPaths?: ProjectVocabularyPathDto[];

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  locationRegionIds?: string[];
}
