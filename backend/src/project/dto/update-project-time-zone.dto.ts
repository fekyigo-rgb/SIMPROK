import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const normalizeOptionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class UpdateProjectTimeZoneDto {
  @Transform(normalizeOptionalText)
  @IsString()
  @MaxLength(64)
  @IsOptional()
  timeZone?: string | null;
}
