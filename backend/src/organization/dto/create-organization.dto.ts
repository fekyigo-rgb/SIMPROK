import { IsEnum, IsOptional, IsString } from 'class-validator';
import { OrganizationType } from '@prisma/client';

export class CreateOrganizationDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEnum(OrganizationType)
  type?: OrganizationType;
}
