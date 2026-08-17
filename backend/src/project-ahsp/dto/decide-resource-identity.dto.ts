import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * GHX-01 — everything a client may say when recording a decision.
 *
 * Deliberately three fields. Workspace, AHSP source fact, project, occurrence,
 * AHSP version, actor, policy, generation, previous decision, candidate set and
 * digest are ALL derived server-side: letting a client state any of them would
 * let it choose the scope of its own authority.
 */
export class DecideResourceIdentityDto {
  /** One of the legitimate candidates the decision context presented. */
  @IsUUID()
  selectedResourceCatalogId!: string;

  /** The opaque server-issued context. Echoed back exactly as received. */
  @IsString()
  @IsNotEmpty()
  decisionContextToken!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
