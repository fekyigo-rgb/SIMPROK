import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

const DECIMAL_18_2_NON_NEGATIVE = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

const normalizeOptionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class UpdateProjectIntakeContextDto {
  // Only supplied for an explicit, Owner-confirmed change to saved Project
  // geography. No mutation when omitted, preserving prior API behavior.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(250)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  locationRegionIds?: string[];

  // Compare-and-swap: never silently replace a concurrent user's selection.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(250)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  expectedLocationRegionIds?: string[];
  @IsString()
  @Matches(DECIMAL_18_2_NON_NEGATIVE)
  @IsOptional()
  budgetBaseline?: string | null;

  @Transform(normalizeOptionalText)
  @IsString()
  @MaxLength(5000)
  @IsOptional()
  mainMaterialSpec?: string | null;

  // F03A: explicitly stated preference, NOT authority to choose a price yet.
  // Null clears the preference; omitted leaves prior Project truth untouched.
  @IsOptional()
  @IsIn(['LOWEST', 'MIDDLE', 'HIGHEST'])
  priceSelectionPreferenceMode?: 'LOWEST' | 'MIDDLE' | 'HIGHEST' | null;

  // Required compare-and-swap for any preference write, including clearing.
  @IsOptional()
  @IsIn(['LOWEST', 'MIDDLE', 'HIGHEST'])
  expectedPriceSelectionPreferenceMode?: 'LOWEST' | 'MIDDLE' | 'HIGHEST' | null;
}
