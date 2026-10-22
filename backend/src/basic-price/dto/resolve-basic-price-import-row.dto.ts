import { IsEnum, IsInt, IsOptional, IsString, IsUUID, MinLength, MaxLength } from 'class-validator';
import { ResourceType } from '@prisma/client';

/**
 * Human resolution of one imported row: assigns the exact
 * ResourceCatalog/UnitDefinition identity. `version` guards against a
 * stale concurrent resolve (test matrix I06) — required, not optional.
 *
 * `reason` is optional (unlike reject's required reason) — a resolve driven
 * by an unambiguous normalized-name candidate is often self-evident, and
 * that fact is itself recorded server-side as the mapping's
 * suggestionSource (RM-02D1) regardless of whether free text is given. When
 * provided, it is stored verbatim on the mapping decision audit record.
 */
export class ResolveBasicPriceImportRowDto {
  @IsInt() version!: number;

  @IsUUID() resourceCatalogId!: string;
  @IsUUID() unitDefinitionId!: string;

  @IsOptional() @IsString() @MinLength(1) reason?: string;
}

/** Human type decision is allowed only when the file did not prove the type. */
export class ConfirmBasicPriceImportRowCategoryDto {
  @IsInt() version!: number;
  @IsEnum(ResourceType) resourceType!: ResourceType;
  @IsOptional() @IsString() @MinLength(10) @MaxLength(1200) reason?: string;
}

export class RejectBasicPriceImportRowDto {
  @IsInt() version!: number;

  // Required — state machine B: "NEEDS_REVIEW / READY_FOR_SUBMISSION -> REJECTED ... reason required".
  @IsString() @MinLength(1) reason!: string;
}

/** Compensate a CURRENT decision made by the same accountable reviewer.
 * This is not a generic deletion or identity-edit endpoint: original mapping,
 * provenance and source bytes remain, and a new append-only event records
 * the reversal. Version is mandatory for stale-client refusal.
 */
/** Clarifies an old unit-correction reason without rewriting the original mapping. */
export class ClarifyBasicPriceRowUnitReasonDto {
  @IsInt() version!: number;
  @IsString() @MinLength(30) @MaxLength(900) reason!: string;
}

export class CompensateBasicPriceImportRowDto {
  @IsInt() version!: number;
  @IsString() @MinLength(10) @MaxLength(1200) reason!: string;
}
