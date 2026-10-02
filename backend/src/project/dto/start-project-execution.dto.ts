import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

const normalizeOptionalText = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export class StartProjectExecutionDto {
  @IsUUID()
  commandId: string;

  @Transform(normalizeOptionalText)
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  reason?: string;
}
