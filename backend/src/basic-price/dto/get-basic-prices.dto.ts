import { IsOptional, IsString, IsInt, Min, Max, IsIn, IsUUID, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { PriceSourceOrigin, PriceVerificationStatus, PriceFreshnessStatus } from '@prisma/client';

export class GetBasicPricesDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsUUID()
  regionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @IsEnum(PriceSourceOrigin)
  sourceOrigin?: PriceSourceOrigin;

  @IsOptional()
  @IsEnum(PriceVerificationStatus)
  verificationStatus?: PriceVerificationStatus;

  @IsOptional()
  @IsEnum(PriceFreshnessStatus)
  freshnessStatus?: PriceFreshnessStatus;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsIn(['effectiveDate', 'createdAt', 'updatedAt'])
  sortBy?: 'effectiveDate' | 'createdAt' | 'updatedAt' = 'effectiveDate';
}
