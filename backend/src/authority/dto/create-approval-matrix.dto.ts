import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateApprovalMatrixDto {
  @IsString()
  workspaceId: string;

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
