import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUUID,
  IsEnum,
  IsISO8601,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  PriceSourceOrigin,
  PriceVerificationStatus,
  PriceFreshnessStatus,
} from '@prisma/client';

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

  // Explorer date-range filter (Explorer minimum: "tanggal awal", "tanggal akhir").
  // Mutually exclusive with `year` — combining both is an ambiguous time
  // interpretation and is rejected by the service (400), not silently merged.
  // `strict: true` rejects a calendar-invalid date (e.g. "2026-02-30", which
  // loose ISO8601 accepts and JS Date would silently roll over to March) —
  // the service additionally guards against ISO8601 "basic format" strings
  // (e.g. "20260601") that are format-valid but unparseable by JS Date.
  @IsOptional()
  @IsISO8601({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  dateTo?: string;

  // Source name filter — only meaningful when the row's provenance chain
  // actually carries a vendor/organization name (see basic-price-workflow
  // projection's deriveExplorerSourceName). Never widens eligibility.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceName?: string;

  // Public API hard lock: only the terminal PUBLISHED verification is queryable.
  // Internal-curation statuses (UNVERIFIED/SUBMITTED/UNDER_REVIEW/VERIFIED/REJECTED)
  // are rejected here; the service also enforces this defensively.
  @IsOptional()
  @IsIn([PriceVerificationStatus.PUBLISHED])
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
