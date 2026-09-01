import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

/**
 * BP-CHANGE-SEM-03 / BP-EVIDENCE-MIG-04 — later lawful private price observation.
 *
 * Not a correction. `effectiveDate` is the business date of the NEW
 * observation, never silently taken from `createdAt`. `expectedValue` is the
 * stale-edit token for the price the actor actually reviewed.
 *
 * This door is the field/user-reported path. Documentary new prices enter
 * through Import. `sameSource` defaults to true: reuse the predecessor's
 * source identity while creating NEW observation evidence. When false, a
 * concise new source identity name is required; the predecessor is not
 * overwritten.
 */
const NON_BLANK = /\S/;

export class ObservePrivateBasicPriceDto {
  @IsString() @MinLength(1) @Matches(NON_BLANK) expectedValue!: string;
  @IsString() @MinLength(1) @Matches(NON_BLANK) proposedValue!: string;
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'effectiveDate must be an exact YYYY-MM-DD calendar date',
  })
  effectiveDate!: string;
  @IsString() @MinLength(1) @Matches(NON_BLANK) reason!: string;
  @IsOptional() @IsBoolean() sameSource?: boolean;
  @IsOptional() @IsString() @Matches(NON_BLANK) sourceIdentityName?: string;
}
