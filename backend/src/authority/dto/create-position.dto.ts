import { IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

export class CreatePositionDto {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  workspaceId?: string;

  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  parentPositionId?: string;
}
