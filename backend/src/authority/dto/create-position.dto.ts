import { IsOptional, IsString } from 'class-validator';

export class CreatePositionDto {
  @IsString()
  workspaceId: string;

  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  parentPositionId?: string;
}
