import { IsOptional, IsString, IsUUID, IsEnum, IsBoolean, IsDateString, IsInt, Matches, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  PriceSourceType,
  PriceSourceOrigin,
  PriceEffectiveDateProvenance,
  PriceSourcePeriodGranularity,
} from '@prisma/client';
import type {
  BasicPriceSection,
  PriceTableStructure,
} from '../../universal-intake/structure/structure-detector';

/**
 * `@IsEnum` needs a runtime object, and these two vocabularies live in the
 * intake layer as TypeScript unions rather than Prisma enums — deliberately, so
 * that recognizing a new table shape never requires a database migration.
 */
const PRICE_TABLE_STRUCTURES = {
  SECTIONED_PRICE_LIST: 'SECTIONED_PRICE_LIST',
  SEMANTIC_HEADER_TABLE: 'SEMANTIC_HEADER_TABLE',
  REGIONAL_MATRIX: 'REGIONAL_MATRIX',
} as const;

const BASIC_PRICE_SECTIONS = {
  LABOR: 'LABOR',
  MATERIAL: 'MATERIAL',
  EQUIPMENT: 'EQUIPMENT',
} as const;

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

  /**
   * USI-01 §5 — THE HUMAN'S ANSWER TO A GENUINE AMBIGUITY, ASKED ONCE.
   *
   * None of these four is ever needed when the source proves exactly one
   * reading. They exist for the cases where SIMPROK deliberately refuses to
   * guess, and each corresponds to a named refusal the intake returns first:
   *
   *   selectedStructure    SOURCE_STRUCTURE_AMBIGUOUS — one table, two
   *                        plausible shapes.
   *   selectedRegionLabel  REGION_COLUMN_SELECTION_REQUIRED — the source covers
   *                        several jurisdictions and a batch carries one. This
   *                        is the source's OWN wording ("SIRIMAU"), not a
   *                        canonical Region; `regionId` remains the canonical
   *                        answer and is a separate human decision.
   *   declaredSection      SECTION_DECLARATION_REQUIRED — the source declares
   *                        no LABOR/MATERIAL/EQUIPMENT sections of its own, and
   *                        the resolution lifecycle downstream treats this as
   *                        authority, so a person states it rather than SIMPROK
   *                        inferring it from a resource's name.
   */
  @IsOptional()
  @IsEnum(PRICE_TABLE_STRUCTURES)
  selectedStructure?: PriceTableStructure;

  @IsOptional() @IsString() @Matches(NON_BLANK) selectedRegionLabel?: string;

  @IsOptional() @IsEnum(BASIC_PRICE_SECTIONS) declaredSection?: BasicPriceSection;

  /**
   * USI-01R2 §10 — WHICH COLUMN IS THE RESOURCE NAME, AND WHICH IS THE UNIT.
   *
   * Needed only for a source whose shape is proven but whose columns carry no
   * header — a scanned regional price list is the real case. SIMPROK answers
   * COLUMN_ROLE_SELECTION_REQUIRED with the candidate columns and real sample
   * values from the file, and a person picks once. It can never override a
   * header the source DID state.
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) selectedNameColumn?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) selectedUnitColumn?: number;
  /**
   * BP-KDN-01 — confirm an ambiguous/conflict KDN-like column. Optional.
   * Ignored when the document already proved a CLEAR KDN heading. Never
   * required for a lawful price import.
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) selectedKdnColumn?: number;
}
