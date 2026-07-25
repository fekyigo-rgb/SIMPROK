import { IsInt, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * Human resolution of one imported row: assigns the exact
 * ResourceCatalog/UnitDefinition identity. `version` guards against a
 * stale concurrent resolve (test matrix I06) — required, not optional.
 */
export class ResolveBasicPriceImportRowDto {
  @IsInt() version!: number;

  @IsUUID() resourceCatalogId!: string;
  @IsUUID() unitDefinitionId!: string;
}

export class RejectBasicPriceImportRowDto {
  @IsInt() version!: number;

  // Required — state machine B: "NEEDS_REVIEW / READY_FOR_SUBMISSION -> REJECTED ... reason required".
  @IsString() @MinLength(1) reason!: string;
}
