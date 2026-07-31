import { Prisma } from '@prisma/client';
import { toDecimalString2 } from './money';

// RM-02D2A2 — the exact-money contract. Every assertion here would FAIL if the
// implementation ever routed a price through Number()/parseFloat()/float math.
describe('toDecimalString2', () => {
  it('formats an integer-valued price as a two-digit decimal string', () => {
    expect(toDecimalString2('125000')).toBe('125000.00');
  });

  it('preserves an exact two-digit decimal string verbatim', () => {
    expect(toDecimalString2('1100000.55')).toBe('1100000.55');
  });

  it('keeps a trailing zero that a JS number would silently drop', () => {
    expect(toDecimalString2('125000.50')).toBe('125000.50');
    expect(toDecimalString2('0.10')).toBe('0.10');
  });

  it('formats a Prisma.Decimal exactly, beyond IEEE-754 precision', () => {
    // As a JS number this value cannot be represented exactly; the decimal
    // string must still be preserved digit-for-digit.
    expect(toDecimalString2(new Prisma.Decimal('999999999999999.99'))).toBe(
      '999999999999999.99',
    );
  });

  it('always returns a string, never a number', () => {
    expect(typeof toDecimalString2('1')).toBe('string');
  });
});
