import {
  IsOptional,
  IsString,
  IsUUID,
  IsEnum,
  IsBoolean,
  IsDateString,
  IsInt,
  Matches,
} from 'class-validator';
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
   * SOFT RE-VERIFICATION — "check this again around here", stated by a person.
   *
   * A DIFFERENT FACT FROM `effectiveDate` ABOVE, and shown to the user under a
   * different label (`Verifikasi ulang pada`) for exactly that reason: one
   * ambiguous "Tanggal Berlaku" carrying two meanings is how a hard boundary
   * and a piece of advice get confused.
   *
   * OPTIONAL, AND NEVER DERIVED. SIMPROK computes no freshness horizon — no
   * canonical policy states one — so leaving this empty is a normal outcome
   * that stays empty. It is never mapped to `validUntil`, which is the only
   * date the system actually enforces.
   */
  @IsOptional() @IsDateString() reviewDate?: string;

  /**


   * RM-03D1 — TEMPORAL PROVENANCE. A source stating only "TA 2024" states no


   * day, but every applicability rule downstream needs one. These three keep


   * the derived date honest: the source's own wording, whether the date is the


   * source's or SIMPROK's, and the named rule that produced it. Omitting them


   * leaves provenance unknown, which never reads as source-stated.


   */

  @IsOptional() @IsString() @Matches(NON_BLANK) sourcePeriodLabel?: string;
  @IsOptional()
  @IsEnum(PriceSourcePeriodGranularity)
  sourcePeriodGranularity?: PriceSourcePeriodGranularity;

  @IsOptional()
  @IsEnum(PriceEffectiveDateProvenance)
  effectiveDateProvenance?: PriceEffectiveDateProvenance;

  @IsOptional()
  @IsString()
  @Matches(NON_BLANK)
  effectiveDateDerivationRule?: string;

  @IsOptional() @IsEnum(PriceSourceType) sourceType?: PriceSourceType;
  @IsOptional() @IsEnum(PriceSourceOrigin) sourceOrigin?: PriceSourceOrigin;
  @IsOptional() @IsString() sourceOrganizationName?: string;
  @IsOptional() @IsString() sourceVendorName?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  priceCoverageDeclared?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() transportIncluded?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() loadingIncluded?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() unloadingIncluded?: boolean;
  @IsOptional() @Transform(toBoolean) @IsBoolean() deliveredToProject?: boolean;

  /**
   * BP-REGION-TRUTH-07S §8 — "YES, THIS SOURCE SCOPE IS THIS REGION."
   *
   * A human decision about the batch's CURRENT region, and deliberately NOT a
   * region id. The caller states the INTENT; the server records WHICH Region the
   * intent was about, taken from the same merged state this request produces. A
   * browser therefore cannot confirm a scope against a region other than the one
   * it is actually saving, which is the whole point of asking.
   *
   * Sending `false` withdraws a previous confirmation. Omitting it changes
   * nothing — and a confirmation is silently reopened anyway whenever the region
   * itself moves, because an answer about one place proves nothing about another.
   */
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  confirmRegionScopeCompatibility?: boolean;
}
