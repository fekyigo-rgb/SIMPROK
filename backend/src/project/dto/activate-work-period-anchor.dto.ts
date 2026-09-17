import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

const PROJECT_BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

const normalizeOptionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export class ActivateWorkPeriodAnchorDto {
  @IsUUID()
  commandId: string;

  @IsString()
  @Matches(PROJECT_BUSINESS_DATE)
  anchorDate: string;

  @Transform(normalizeOptionalText)
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  reason?: string;
}
