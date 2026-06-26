import { IsArray, IsDateString, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ProgressEntryDto {
  @IsString()
  boqItemId: string;

  @IsNumber()
  installedQuantity: number;

  @IsDateString()
  workDate: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}

export class SubmitFieldProgressDto {
  @IsString()
  projectId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProgressEntryDto)
  entries: ProgressEntryDto[];
}
