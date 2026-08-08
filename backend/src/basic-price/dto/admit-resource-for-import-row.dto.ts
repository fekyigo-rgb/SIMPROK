import { IsInt, IsString, IsUUID, MinLength } from 'class-validator';

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
}
