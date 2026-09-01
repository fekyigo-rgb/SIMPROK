import { interpretPriceLiteral } from './price-literal';
import {
  isDecimalOutsideInclusiveRange,
  toFixedScale2HalfUp,
} from '../../common/money';

/**
 * BP-KDN-01 — %KDN VALUE LAW.
 *
 * A %KDN fact is a percentage in [0, 100]. Blank is UNKNOWN, never zero.
 * Stated 0 is a real fact. Invalid never becomes canonical. Canonical
 * persistence uses exact decimal scale 2 (`Decimal(5, 2)`), never IEEE-754.
 *
 * Representation suffixes (`72.5%`) are stripped before the existing locale
 * parser runs; they are not a "divide by 100" instruction. 72.5% means 72.50
 * as the KDN fact.
 *
 * `N/A` is NOT treated as unknown: no existing intake missing-marker law
 * names it, so it is a non-numeric value and fails closed (never 0).
 */

export const KDN_LITERAL_REASONS = {
  UNKNOWN: 'KDN_UNKNOWN',
  NOT_NUMERIC: 'KDN_NOT_NUMERIC',
  VALUE_AMBIGUOUS: 'KDN_VALUE_AMBIGUOUS',
  OUT_OF_RANGE: 'KDN_OUT_OF_RANGE',
} as const;

export type KdnLiteralReason =
  (typeof KDN_LITERAL_REASONS)[keyof typeof KDN_LITERAL_REASONS];

export type KdnLiteralStatus = 'UNKNOWN' | 'VALID' | 'INVALID';

export interface KdnLiteralReading {
  status: KdnLiteralStatus;
  /**
   * Exact two-decimal canonical string (`"72.50"`), present ONLY when VALID.
   * Never a float. Scale matches `Decimal(5, 2)`, not invented precision.
   */
  canonicalPercent: string | null;
  reason: KdnLiteralReason | null;
  /** The source text after trim / percent-suffix strip, for provenance. */
  normalizedInput: string | null;
}

const PERCENT_SUFFIX = /%\s*$/;

function reading(
  status: KdnLiteralStatus,
  reason: KdnLiteralReason | null,
  canonicalPercent: string | null = null,
  normalizedInput: string | null = null,
): KdnLiteralReading {
  return { status, canonicalPercent, reason, normalizedInput };
}

/**
 * Strip a trailing percent mark so `72.5%` and `72,50 %` reach the locale
 * parser as numeric literals. A `%` anywhere else is left in place and will
 * fail as non-numeric — which is the honest outcome, not a guess.
 */
export function stripKdnPercentSuffix(input: string): string {
  return input.replace(PERCENT_SUFFIX, '').trim();
}

export function interpretKdnLiteral(
  input: string | null | undefined,
): KdnLiteralReading {
  if (input === null || input === undefined) {
    return reading('UNKNOWN', KDN_LITERAL_REASONS.UNKNOWN);
  }
  const trimmed = input.trim();
  if (trimmed === '') {
    return reading('UNKNOWN', KDN_LITERAL_REASONS.UNKNOWN, null, '');
  }

  const withoutPercent = stripKdnPercentSuffix(trimmed);
  if (withoutPercent === '') {
    // A cell that contained only "%" stated no number.
    return reading('INVALID', KDN_LITERAL_REASONS.NOT_NUMERIC, null, trimmed);
  }

  const literal = interpretPriceLiteral(withoutPercent);
  if (literal.outcome === 'AMBIGUOUS') {
    return reading(
      'INVALID',
      KDN_LITERAL_REASONS.VALUE_AMBIGUOUS,
      null,
      withoutPercent,
    );
  }
  if (literal.outcome !== 'NUMERIC' || literal.canonicalSourceString === null) {
    return reading(
      'INVALID',
      KDN_LITERAL_REASONS.NOT_NUMERIC,
      null,
      withoutPercent,
    );
  }

  const exactSource = literal.canonicalSourceString;
  if (isDecimalOutsideInclusiveRange(exactSource, '0', '100')) {
    return reading(
      'INVALID',
      KDN_LITERAL_REASONS.OUT_OF_RANGE,
      null,
      exactSource,
    );
  }

  const canonicalPercent = toFixedScale2HalfUp(exactSource);

  return reading(
    'VALID',
    null,
    canonicalPercent,
    literal.canonicalSourceString,
  );
}
