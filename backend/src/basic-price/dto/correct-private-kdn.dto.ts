import { IsString, Matches, MinLength } from 'class-validator';

/**
 * BP-CHANGE-SEM-03 — correct a stated private KDN that was recorded wrong.
 *
 * Not enrichment. Does not PATCH the predecessor. Money and business date
 * stay on the successor as they were. `expectedValue` / `expectedKdnPercent`
 * are stale-edit tokens.
 */
const NON_BLANK = /\S/;

export class CorrectPrivateKdnDto {
  @IsString() @MinLength(1) @Matches(NON_BLANK) expectedValue!: string;
  @IsString() @MinLength(1) @Matches(NON_BLANK) expectedKdnPercent!: string;
  @IsString() @MinLength(1) @Matches(NON_BLANK) proposedKdnPercent!: string;
  @IsString() @MinLength(1) @Matches(NON_BLANK) reason!: string;
}
