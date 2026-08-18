/**
 * USI-01 LAW 5 + §13 — NORMALIZE WITHOUT LYING.
 *
 * Turning the text `1.250,50` into a number is a DECISION about which locale
 * wrote it, and SIMPROK is only allowed to make that decision when the string
 * itself proves the answer. Everything else becomes reviewable evidence with a
 * named reason — never a fabricated canonical fact.
 *
 * This interpreter exists ONLY for sources whose cells carry no native numeric
 * type (delimited text, and later JSON/API text payloads). A spreadsheet's
 * numeric cell is already unambiguous and is read from its native round-trip
 * value instead — text interpretation is never applied on top of it.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE:
 *   - No currency is inferred. A literal carrying "Rp", "$" or any other symbol
 *     is NOT_NUMERIC by name, because the Basic Price domain models no currency
 *     and defaulting an unknown one to IDR is exactly the silent lie §13
 *     forbids.
 *   - No whitespace-grouped literal ("1 250,50") is accepted. It is a real
 *     convention, but nothing in evidence demands it yet, and guessing at it
 *     would risk reading "12 34" as 1234.
 */

export type PriceLiteralOutcome = 'NUMERIC' | 'AMBIGUOUS' | 'NOT_NUMERIC';

export const PRICE_LITERAL_REASONS = {
  EMPTY: 'PRICE_TEXT_EMPTY',
  NON_NUMERIC: 'PRICE_TEXT_NOT_NUMERIC',
  WHITESPACE: 'PRICE_TEXT_WHITESPACE_GROUPING_UNSUPPORTED',
  /** One separator, exactly three trailing digits: 1.250 is 1250 or 1.25. */
  SEPARATOR_ROLE_AMBIGUOUS: 'PRICE_TEXT_NUMERIC_LOCALE_AMBIGUOUS',
  MALFORMED_GROUPING: 'PRICE_TEXT_MALFORMED_GROUPING',
  MALFORMED_MIXED: 'PRICE_TEXT_MALFORMED_MIXED_SEPARATORS',
} as const;

export interface PriceLiteralReading {
  outcome: PriceLiteralOutcome;
  /**
   * A plain, locale-free numeric string suitable for exact decimal
   * construction. Present ONLY when the outcome is NUMERIC.
   */
  canonicalSourceString: string | null;
  /** Which separator role the evidence proved, when it proved one. */
  decimalSeparator: '.' | ',' | null;
  groupingSeparator: '.' | ',' | null;
  reason: string | null;
}

const NUMERIC_SHAPE = /^[+-]?[0-9.,]+$/;

function reading(
  outcome: PriceLiteralOutcome,
  reason: string | null,
  canonicalSourceString: string | null = null,
  decimalSeparator: '.' | ',' | null = null,
  groupingSeparator: '.' | ',' | null = null,
): PriceLiteralReading {
  return { outcome, canonicalSourceString, decimalSeparator, groupingSeparator, reason };
}

/** Grouping is proven only when every group after the first is exactly three digits. */
function groupsAreValid(parts: string[]): boolean {
  if (parts.length < 2) return false;
  if (!/^\d{1,3}$/.test(parts[0])) return false;
  return parts.slice(1).every((part) => /^\d{3}$/.test(part));
}

export function interpretPriceLiteral(input: string | null | undefined): PriceLiteralReading {
  if (input === null || input === undefined) {
    return reading('NOT_NUMERIC', PRICE_LITERAL_REASONS.EMPTY);
  }

  const trimmed = input.trim();
  if (trimmed === '') return reading('NOT_NUMERIC', PRICE_LITERAL_REASONS.EMPTY);
  // ORDER IS THE DIAGNOSTIC. "Rp 21500" and "1 250,50" both contain a space,
  // but only one of them is a whitespace-grouping question — the other is a
  // currency token, and telling a human "whitespace grouping is unsupported"
  // about it would send them to fix the wrong thing (§17).
  if (!/^[+-]?[\s0-9.,]+$/.test(trimmed)) {
    return reading('NOT_NUMERIC', PRICE_LITERAL_REASONS.NON_NUMERIC);
  }
  if (/\s/.test(trimmed)) {
    return reading('NOT_NUMERIC', PRICE_LITERAL_REASONS.WHITESPACE);
  }
  if (!NUMERIC_SHAPE.test(trimmed)) {
    return reading('NOT_NUMERIC', PRICE_LITERAL_REASONS.NON_NUMERIC);
  }

  const sign = trimmed.startsWith('-') ? '-' : '';
  const body = trimmed.replace(/^[+-]/, '');
  if (!/\d/.test(body)) return reading('NOT_NUMERIC', PRICE_LITERAL_REASONS.NON_NUMERIC);

  const dots = (body.match(/\./g) ?? []).length;
  const commas = (body.match(/,/g) ?? []).length;

  // No separator at all: a plain integer states itself.
  if (dots === 0 && commas === 0) {
    return reading('NUMERIC', null, `${sign}${body}`);
  }

  // Both kinds present: the LAST one to appear is the decimal separator and the
  // other is grouping — a rule every locale that uses both agrees on. It still
  // has to be well-formed before it is believed.
  if (dots > 0 && commas > 0) {
    const decimalSeparator = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',';
    const groupingSeparator = decimalSeparator === '.' ? ',' : '.';
    const decimalCount = decimalSeparator === '.' ? dots : commas;
    if (decimalCount !== 1) {
      return reading('NOT_NUMERIC', PRICE_LITERAL_REASONS.MALFORMED_MIXED);
    }
    const [integerPart, fractionPart] = body.split(decimalSeparator);
    if (!/^\d+$/.test(fractionPart ?? '')) {
      return reading('NOT_NUMERIC', PRICE_LITERAL_REASONS.MALFORMED_MIXED);
    }
    const groups = integerPart.split(groupingSeparator);
    if (!groupsAreValid(groups)) {
      return reading('NOT_NUMERIC', PRICE_LITERAL_REASONS.MALFORMED_MIXED);
    }
    return reading(
      'NUMERIC',
      null,
      `${sign}${groups.join('')}.${fractionPart}`,
      decimalSeparator,
      groupingSeparator,
    );
  }

  const separator: '.' | ',' = dots > 0 ? '.' : ',';
  const occurrences = dots > 0 ? dots : commas;
  const parts = body.split(separator);

  // Repeated: only grouping can repeat, and only in valid group positions.
  if (occurrences > 1) {
    if (!groupsAreValid(parts)) {
      return reading('NOT_NUMERIC', PRICE_LITERAL_REASONS.MALFORMED_GROUPING);
    }
    return reading('NUMERIC', null, `${sign}${parts.join('')}`, null, separator);
  }

  const [integerPart, fractionPart] = parts;
  if (!/^\d+$/.test(integerPart) || !/^\d+$/.test(fractionPart ?? '')) {
    return reading('NOT_NUMERIC', PRICE_LITERAL_REASONS.NON_NUMERIC);
  }

  // THE ONE GENUINELY UNDECIDABLE CASE. A single separator with exactly three
  // digits after it is a thousands group in Indonesia and a decimal fraction in
  // the United States, and the string carries no evidence for either. SIMPROK
  // refuses to pick.
  if (fractionPart.length === 3) {
    const groupingImpossible = integerPart.length > 3 || integerPart.startsWith('0');
    if (!groupingImpossible) {
      return reading('AMBIGUOUS', PRICE_LITERAL_REASONS.SEPARATOR_ROLE_AMBIGUOUS);
    }
    // "0.500" and "1234.567" cannot be grouped literals — a group is never
    // longer than three digits and never begins with a padding zero — so the
    // separator is proven decimal.
    return reading('NUMERIC', null, `${sign}${integerPart}.${fractionPart}`, separator);
  }

  return reading('NUMERIC', null, `${sign}${integerPart}.${fractionPart}`, separator);
}
