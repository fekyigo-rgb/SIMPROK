import { IsString, Matches, MinLength } from 'class-validator';

/**
 * BP-DETAIL-MAINT-02 — correct a private money fact that was recorded wrong.
 *
 * Does not PATCH the predecessor. Copies the predecessor's business date.
 * `expectedValue` is the stale-edit token for the price the actor reviewed.
 * A later lawful market price is a different writer (new observation).
 */
const NON_BLANK = /\S/;

export class CorrectPrivateBasicPriceDto {
  @IsString() @MinLength(1) @Matches(NON_BLANK) expectedValue!: string;
  @IsString() @MinLength(1) @Matches(NON_BLANK) proposedValue!: string;
  @IsString() @MinLength(1) @Matches(NON_BLANK) reason!: string;
}
