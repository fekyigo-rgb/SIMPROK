import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const normalizeOptionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export class UpdateProjectTimeZoneDto {
  @IsUUID()
  commandId: string;

  @Transform(normalizeOptionalText)
  @ValidateIf((_object, value) => value !== null)
  @IsString()
  @MaxLength(64)
  timeZone: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 2000)
  reason?: string;
}
