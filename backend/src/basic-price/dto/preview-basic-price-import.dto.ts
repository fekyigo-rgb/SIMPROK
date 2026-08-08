import { IsOptional, IsString, IsUUID, IsEnum, IsBoolean, IsDateString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import {
  PriceSourceType,
  PriceSourceOrigin,
  PriceEffectiveDateProvenance,
  PriceSourcePeriodGranularity,
} from '@prisma/client';

/**
 * RM-03D1 — a provenance string must actually say something. `@IsString()`
 * happily accepts "   ", and a NOT NULL column would store it, so a blank
 * period label or derivation rule would satisfy every check while proving
 * nothing. At least one non-whitespace character is required.
 */
const NON_BLANK = /\S/;

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

  /**


   * RM-03D1 — TEMPORAL PROVENANCE. A source stating only "TA 2024" states no


   * day, but every applicability rule downstream needs one. These three keep


   * the derived date honest: the source's own wording, whether the date is the


   * source's or SIMPROK's, and the named rule that produced it. Omitting them


   * leaves provenance unknown, which never reads as source-stated.


   */


  @IsOptional() @IsString() @Matches(NON_BLANK) sourcePeriodLabel?: string;
  @IsOptional() @IsEnum(PriceSourcePeriodGranularity) sourcePeriodGranularity?: PriceSourcePeriodGranularity;


  @IsOptional() @IsEnum(PriceEffectiveDateProvenance) effectiveDateProvenance?: PriceEffectiveDateProvenance;


  @IsOptional() @IsString() @Matches(NON_BLANK) effectiveDateDerivationRule?: string;



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
