import {
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * BP-KDN-01 — fill a previously unknown %KDN on an existing Basic Price.
 *
 * Does not create a new Basic Price. Does not touch money. `kdnPercent` is
 * the canonical two-decimal string (`"72.50"`). `reason` is required because
 * restating a persisted fact is never self-evident.
 *
 * `expectedKdnPercent` is the stale-edit token. Omit it to keep older callers.
 * Send `null` when Detail opened with no KDN. Send the canonical string when
 * a value was already shown. A mismatch fails closed; it is never last-write-wins.
 */
const NON_BLANK = /\S/;

export class EnrichBasicPriceKdnDto {
  @IsString() @MinLength(1) @Matches(NON_BLANK) kdnPercent!: string;
  @IsString() @MinLength(1) @Matches(NON_BLANK) reason!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  expectedKdnPercent?: string | null;
}
