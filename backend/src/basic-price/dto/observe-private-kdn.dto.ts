import { IsString, Matches, MinLength } from 'class-validator';

/**
 * BP-CHANGE-SEM-03 — record a later lawful private KDN observation.
 *
 * Not enrichment (null-fill) and not a correction of the existing fact.
 * `effectiveDate` is the business date of the NEW observation.
 * `expectedValue` / `expectedKdnPercent` are stale-edit tokens.
 */
const NON_BLANK = /\S/;

export class ObservePrivateKdnDto {
  @IsString() @MinLength(1) @Matches(NON_BLANK) expectedValue!: string;
  @IsString() @MinLength(1) @Matches(NON_BLANK) expectedKdnPercent!: string;
  @IsString() @MinLength(1) @Matches(NON_BLANK) proposedKdnPercent!: string;
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'effectiveDate must be an exact YYYY-MM-DD calendar date',
  })
  effectiveDate!: string;
  @IsString() @MinLength(1) @Matches(NON_BLANK) reason!: string;
}
