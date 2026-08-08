import { IsEnum, IsString, MinLength } from 'class-validator';

/**
 * RM-03D1 — the two retirement outcomes the domain already defines.
 *
 * `PRIVATE_UNUSABLE_VERSION_STATUSES` in project-ahsp/ahsp-eligibility.policy.ts
 * states the meanings this reuses verbatim: a private version is disqualified
 * because it has been REPLACED (SUPERSEDED) or RETIRED (ARCHIVED) — never
 * because nobody nationally published it. These are the only two values a
 * retirement may set, so this route can never reach DRAFT, UNDER_REVIEW,
 * VERIFIED or PUBLISHED: promoting a version is a different act with different
 * authority, and it is not reachable from here.
 */
export enum AhspVersionRetirementStatus {
  /** Replaced by a corrected successor version of the same AHSP. */
  SUPERSEDED = 'SUPERSEDED',
  /** Retired outright — erroneous or abandoned, with no equivalent successor. */
  ARCHIVED = 'ARCHIVED',
}

export class RetireAhspVersionDto {
  @IsEnum(AhspVersionRetirementStatus)
  status!: AhspVersionRetirementStatus;

  /**
   * REQUIRED. Retiring a version removes it from every future selection, and an
   * audit trail that cannot say why a priced-against version was withdrawn is
   * not an audit trail. Stored verbatim on the existing AHSPAuditLog.
   */
  @IsString()
  @MinLength(1)
  reason!: string;
}
