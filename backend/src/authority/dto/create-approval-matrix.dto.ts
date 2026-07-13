import { IsNumber, IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

export class CreateApprovalMatrixDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  workspaceId?: string;

  @IsString()
  authorityId: string;

  @IsString()
  objectType: string;

  @IsString()
  requiredPositionId: string;

  @IsOptional()
  @IsNumber()
  minValue?: number;

  @IsOptional()
  @IsNumber()
  maxValue?: number;

  @IsOptional()
  @IsNumber()
  priority?: number;
}
