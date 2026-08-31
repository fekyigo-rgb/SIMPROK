import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsIn,
  IsUUID,
  IsEnum,
  Matches,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  PriceSourceOrigin,
  PriceVerificationStatus,
  PriceFreshnessStatus,
  ResourceType,
} from '@prisma/client';
import {
  SOURCE_FAMILIES,
  type SourceFamily,
} from '../basic-price-source-family.util';

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

  // Category filter — canonical existing ResourceCatalog.type, no new
  // field/enum. Public category labels: MATERIAL -> Material/Bahan,
  // LABOR -> Upah/Tenaga Kerja, EQUIPMENT -> Peralatan.
  @IsOptional()
  @IsEnum(ResourceType)
  resourceType?: ResourceType;

  // Human source-family filter — a coarser grouping over the existing
  // sourceOrigin values (see basic-price-source-family.util.ts). Combines
  // with `sourceOrigin` as a narrowing AND, never widening eligibility;
  // `sourceOrigin` alone keeps working unchanged for backward compatibility.
  @IsOptional()
  @IsIn(SOURCE_FAMILIES)
  sourceFamily?: SourceFamily;

  // Explorer date-range filter (Explorer minimum: "tanggal awal", "tanggal akhir").
  // Mutually exclusive with `year` — combining both is an ambiguous time
  // interpretation and is rejected by the service (400), not silently merged.
  // Date-only contract: an exact YYYY-MM-DD calendar date, never a free-form
  // timestamp. This is a cheap format gate only — the service does the full
  // parse (exact regex + year/month/day round-trip, via date-only.util),
  // which is what actually rejects a calendar-invalid date (e.g.
  // "2026-02-30") instead of silently rolling it forward.
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateFrom must be an exact YYYY-MM-DD calendar date',
  })
  dateFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateTo must be an exact YYYY-MM-DD calendar date',
  })
  dateTo?: string;

  /**
   * BP-UX-FINAL-01C — "BERLAKU PADA TANGGAL", AND IT MEANS EXACTLY THAT.
   *
   * A DIFFERENT AXIS FROM `dateFrom`/`dateTo`/`year`, which all narrow
   * `effectiveDate` and answer "which prices STARTED in this window". This one
   * asks the question a person actually has — "what price APPLIED on this day"
   * — and is answered by the full temporal law the AHSP resolver and the Cost
   * Kernel already enforce:
   *
   *     effectiveDate <= asOf
   *     AND (validUntil IS NULL OR validUntil >= asOf)
   *     AND currentness evaluated AT asOf
   *
   * The UI shipped this control sending `dateTo` alone, which is only the first
   * of those three lines. A list filtered that way still contained prices whose
   * own source said they had expired, and prices a published correction had
   * already replaced — under a label that promised otherwise.
   *
   * ABSENT MEANS NOW, resolved ONCE at the service boundary — never "at some
   * point", and never re-read per clause.
   *
   * Same exact-calendar-date contract as the range filters: this is a cheap
   * format gate, and `parseDateOnlyUtc` does the real parse (exact regex plus a
   * year/month/day round-trip) so "2026-02-30" is refused rather than silently
   * rolled forward into a different question.
   */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'asOf must be an exact YYYY-MM-DD calendar date',
  })
  asOf?: string;

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
