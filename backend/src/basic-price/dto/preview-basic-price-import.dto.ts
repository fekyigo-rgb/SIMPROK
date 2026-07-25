import { IsOptional, IsString, IsUUID, IsEnum, IsBoolean, IsDateString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PriceSourceType, PriceSourceOrigin } from '@prisma/client';

// Multipart/form-data always sends field values as strings. class-transformer's
// `@Type(() => Boolean)` coerces via `Boolean(value)`, which treats the
// literal string "false" as truthy — a real, easy-to-miss defect for a
// money-adjacent coverage flag. This explicit transform is the only safe way
// to accept a boolean from a multipart body.
const toBoolean = ({ value }: { value: unknown }) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * Metadata supplied alongside the workbook upload, all optional at
 * preview time (they can be set/corrected later via
 * UpdateBasicPriceImportBatchDto, up until the batch leaves
 * NEEDS_REVIEW/READY_FOR_REVIEW — see 01-RM02B0-SCHEMA-CONTRACT.md §5/§12.2).
 * Every one of these fields is a fingerprint input (§5): a different value
 * for the same file MUST produce a different batch, never silently reuse
 * an existing one.
 */
export class PreviewBasicPriceImportDto {
  @IsOptional() @IsUUID() regionId?: string;
  @IsOptional() @IsDateString() effectiveDate?: string;

  @IsOptional() @IsEnum(PriceSourceType) sourceType?: PriceSourceType;
  @IsOptional() @IsEnum(PriceSourceOrigin) sourceOrigin?: PriceSourceOrigin;
  @IsOptional() @IsString() sourceOrganizationName?: string;
  @IsOptional() @IsString() sourceVendorName?: string;

  @IsOptional() @Transform(toBoolean) @IsBoolean() priceCoverageDeclared?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() transportIncluded?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() loadingIncluded?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() unloadingIncluded?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() deliveredToProject?: boolean;

  @IsOptional() @IsString() selectedSheet?: string;
}
