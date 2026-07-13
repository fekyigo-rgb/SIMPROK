import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreatePositionDto {
  @IsOptional()
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
