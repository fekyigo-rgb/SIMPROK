import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateProjectAhspOccurrenceDto {
  @IsUUID()
  ahspVersionId!: string;

  @IsUUID()
  ahspResourceId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  idempotencyKey!: string;
}

export class SelectAhspForBoqItemDto {
  @IsUUID()
  ahspVersionId!: string;

  @IsDateString({ strict: true })
  businessPricingAsOfDate!: string;

  @IsUUID()
  referenceRegionId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  idempotencyKey!: string;
}
