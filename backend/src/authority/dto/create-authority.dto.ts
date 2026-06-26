import { IsOptional, IsString } from 'class-validator';

export class CreateAuthorityDto {
  @IsString()
  code: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
