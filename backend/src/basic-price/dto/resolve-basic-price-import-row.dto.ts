import { IsInt, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

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

export class RejectBasicPriceImportRowDto {
  @IsInt() version!: number;

  // Required — state machine B: "NEEDS_REVIEW / READY_FOR_SUBMISSION -> REJECTED ... reason required".
  @IsString() @MinLength(1) reason!: string;
}
