import { PRICE_LITERAL_REASONS, interpretPriceLiteral } from './price-literal';

/**
 * USI-01 LAW 5 + §13 + test C5.
 *
 * The single question this suite exists to answer: when may SIMPROK turn text
 * into a number, and when must it refuse? Every "refuses" case below is a case
 * where a plausible-looking guess would have produced a wrong price silently.
 */
describe('interpretPriceLiteral', () => {
  describe('reads what the string itself proves', () => {
    it.each([
      ['398000', '398000'],
      ['0', '0'],
      ['-2500', '-2500'],
      // Repeated separator can only be grouping — a decimal point does not repeat.
      ['1.250.000', '1250000'],
      ['1,250,000', '1250000'],
      // Two digits after the separator cannot be a thousands group.
      ['1250,55', '1250.55'],
      ['1250.55', '1250.55'],
      // Both separators present: the LAST one is the decimal, always.
      ['17.250,55', '17250.55'],
      ['1,250.50', '1250.50'],
      // Four digits after cannot be a group either.
      ['12.3456', '12.3456'],
    ])('%s -> %s', (input, expected) => {
      const reading = interpretPriceLiteral(input);
      expect(reading.outcome).toBe('NUMERIC');
      expect(reading.canonicalSourceString).toBe(expected);
    });

    it('a leading zero rules grouping out, so the separator is proven decimal', () => {
      // "0.500" cannot be five hundred: a thousands group never starts with a
      // padding zero.
      expect(interpretPriceLiteral('0.500')).toMatchObject({
        outcome: 'NUMERIC',
        canonicalSourceString: '0.500',
      });
    });

    it('an integer part longer than three digits rules grouping out too', () => {
      expect(interpretPriceLiteral('1234.567')).toMatchObject({
        outcome: 'NUMERIC',
        canonicalSourceString: '1234.567',
      });
    });

    it('records WHICH separator role was proven, so the reading is auditable', () => {
      expect(interpretPriceLiteral('17.250,55')).toMatchObject({
        decimalSeparator: ',',
        groupingSeparator: '.',
      });
      expect(interpretPriceLiteral('1,250.50')).toMatchObject({
        decimalSeparator: '.',
        groupingSeparator: ',',
      });
    });
  });

  describe('refuses when the string proves nothing (test C5)', () => {
    it('THE undecidable case: one separator, exactly three digits after', () => {
      // 125.000 is one hundred twenty-five thousand in Jakarta and one hundred
      // twenty-five in New York. The string carries no evidence for either, so
      // SIMPROK does not pick — a wrong answer here is a 1000x price error.
      const reading = interpretPriceLiteral('125.000');
      expect(reading.outcome).toBe('AMBIGUOUS');
      expect(reading.canonicalSourceString).toBeNull();
      expect(reading.reason).toBe(PRICE_LITERAL_REASONS.SEPARATOR_ROLE_AMBIGUOUS);
    });

    it('the same undecidability with a comma', () => {
      expect(interpretPriceLiteral('125,000').outcome).toBe('AMBIGUOUS');
    });

    it('never infers a currency, in either direction', () => {
      // §13: an unknown currency is NOT defaulted to IDR merely because SIMPROK
      // operates in Indonesia today.
      for (const literal of ['Rp 125000', '$125000', '125000 USD', '€1250']) {
        const reading = interpretPriceLiteral(literal);
        expect(reading.outcome).toBe('NOT_NUMERIC');
        expect(reading.canonicalSourceString).toBeNull();
      }
    });

    it.each([
      ['', PRICE_LITERAL_REASONS.EMPTY],
      ['   ', PRICE_LITERAL_REASONS.EMPTY],
      ['-', PRICE_LITERAL_REASONS.NON_NUMERIC],
      ['n/a', PRICE_LITERAL_REASONS.NON_NUMERIC],
      // Whitespace grouping is a real convention SIMPROK has no evidence for
      // yet, and guessing risks reading "12 34" as 1234.
      ['1 250,50', PRICE_LITERAL_REASONS.WHITESPACE],
      // Malformed grouping: 12 is not a valid three-digit group.
      ['1.250.12', PRICE_LITERAL_REASONS.MALFORMED_GROUPING],
      ['1.25,750,50', PRICE_LITERAL_REASONS.MALFORMED_MIXED],
    ])('%s is refused as %s', (input, reason) => {
      const reading = interpretPriceLiteral(input);
      expect(reading.outcome).toBe('NOT_NUMERIC');
      expect(reading.reason).toBe(reason);
    });

    it('null and undefined are refusals, never zero', () => {
      expect(interpretPriceLiteral(null).canonicalSourceString).toBeNull();
      expect(interpretPriceLiteral(undefined).canonicalSourceString).toBeNull();
    });
  });

  it('is a pure function of its input — identical text always reads identically', () => {
    const first = interpretPriceLiteral('17.250,55');
    const second = interpretPriceLiteral('17.250,55');
    expect(first).toEqual(second);
  });
});
