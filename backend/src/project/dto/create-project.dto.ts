import { Transform } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';

const DECIMAL_18_2_NON_NEGATIVE = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

const normalizeOptionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class CreateProjectDto {
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
}
