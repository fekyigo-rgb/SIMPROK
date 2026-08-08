import { IsOptional, IsString, IsUUID, IsEnum, IsBoolean, IsDateString, IsInt } from 'class-validator';
import { Transform } from 'class-transformer';
import { PriceSourceType, PriceSourceOrigin, PriceEffectiveDateProvenance } from '@prisma/client';

const toBoolean = ({ value }: { value: unknown }) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

/**
 * Batch-mutable fields only (01-RM02B0-SCHEMA-CONTRACT.md §5:
 * BATCH_MUTABLE_FIELDS) — never the immutable provenance fields
 * (sourceFileName/sourceSha256/importFingerprint/etc.). The service layer
 * enforces the "mutable only until status leaves
 * NEEDS_REVIEW/READY_FOR_REVIEW" rule; this DTO only shapes the request
 * body. `version` is required for the optimistic-concurrency check
 * (test matrix I06) — a stale version fails closed.
 */
export class UpdateBasicPriceImportBatchDto {
  @IsInt() version!: number;

  @IsOptional() @IsUUID() regionId?: string;
  @IsOptional() @IsDateString() effectiveDate?: string;

  /**


   * RM-03D1 — TEMPORAL PROVENANCE. A source stating only "TA 2024" states no


   * day, but every applicability rule downstream needs one. These three keep


   * the derived date honest: the source's own wording, whether the date is the


   * source's or SIMPROK's, and the named rule that produced it. Omitting them


   * leaves provenance unknown, which never reads as source-stated.


   */


  @IsOptional() @IsString() sourcePeriodLabel?: string;


  @IsOptional() @IsEnum(PriceEffectiveDateProvenance) effectiveDateProvenance?: PriceEffectiveDateProvenance;


  @IsOptional() @IsString() effectiveDateDerivationRule?: string;



  @IsOptional() @IsEnum(PriceSourceType) sourceType?: PriceSourceType;
  @IsOptional() @IsEnum(PriceSourceOrigin) sourceOrigin?: PriceSourceOrigin;
  @IsOptional() @IsString() sourceOrganizationName?: string;
  @IsOptional() @IsString() sourceVendorName?: string;

  @IsOptional() @Transform(toBoolean) @IsBoolean() priceCoverageDeclared?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() transportIncluded?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() loadingIncluded?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() unloadingIncluded?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() deliveredToProject?: boolean;
}
