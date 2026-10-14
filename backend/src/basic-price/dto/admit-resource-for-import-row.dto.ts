import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsHash,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ResourceType } from '@prisma/client';

/**
 * RM-03D1 — REVIEWED RESOURCE ADMISSION.
 *
 * A reviewer looked at one imported row, saw that no canonical resource in
 * this workspace answers to it, and is choosing to admit it as a new one.
 *
 * The row itself supplies everything factual: the name, the source code (or
 * its absence), the resource type, and the full source provenance. Nothing in
 * this body names or describes the resource, because nothing here is allowed
 * to invent one — the only things a human adds are the canonical unit and the
 * reason they are creating rather than choosing.
 *
 * `reason` is REQUIRED here, unlike on resolve. Choosing an existing resource
 * can be self-evident; bringing a new canonical identity into a workspace
 * never is, and the audit trail must carry why.
 */
export class AdmitResourceForImportRowDto {
  /** Optimistic concurrency, exactly as resolve — a stale version fails closed. */
  @IsInt() version!: number;

  /**
   * The canonical unit the reviewer asserts for THIS source row. It becomes
   * the admitted resource's baseUnit, so it must already exist as a
   * UnitDefinition — admission never mints unit vocabulary.
   */
  @IsUUID() unitDefinitionId!: string;

  @IsString() @MinLength(1) reason!: string;

  /** Human-corrected canonical name for THIS reviewed admission only.
   * Optional for legacy callers. The workbook's raw name is never replaced. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(240)
  @Matches(/^\S(?:[\s\S]*\S)?$/u)
  correctedCanonicalName?: string;

  /** Human-confirmed effective type; the server rejects source-authoritative overrides. */
  @IsEnum(ResourceType)
  confirmedResourceType!: ResourceType;

  /** Exactly the visible NAME_SIMILARITY_ONLY candidates the human refused. */
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  refusedCandidateIds!: string[];

  /** Server-generated binding from the current GET review projection. */
  @IsHash('sha256')
  reviewBindingFingerprint!: string;
}

/** One explicit row choice from the server-issued review projection. */
export class BulkAdmitSafeNewSelectionDto {
  @IsUUID() rowId!: string;

  @IsInt() version!: number;

  @IsUUID() unitDefinitionId!: string;

  /** Never inferred from the uploader-wide section hint. */
  @IsEnum(ResourceType)
  confirmedResourceType!: ResourceType;

  /** Binds the choice to the exact current row/type/candidate question. */
  @IsHash('sha256')
  reviewBindingFingerprint!: string;
}

/**
 * Bounded human selection for safe NEW admissions only.
 *
 * There are deliberately no catalog ids and no force flag. Candidate-bearing
 * rows remain on the individual examine/refuse path.
 */
export class BulkAdmitSafeNewResourcesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BulkAdmitSafeNewSelectionDto)
  selections!: BulkAdmitSafeNewSelectionDto[];

  @IsString()
  @MinLength(1)
  reason!: string;
}
