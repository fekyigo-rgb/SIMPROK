import { IsOptional, IsString } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  organizationId: string;
}
