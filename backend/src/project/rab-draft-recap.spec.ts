import { Prisma } from '@prisma/client';
import {
  buildDraftRecap,
  incompletePricingRecap,
  serializeDraftRecap,
  type DraftRecap,
} from './rab-draft-recap';

describe('rab-draft-recap serializer — UTANG-API-MONEY-05 exact decimal contract', () => {
  it('A-01: money above Number.MAX_SAFE_INTEGER stays exact, not a JS Number', () => {
    const recap: DraftRecap = {
      subtotal: new Prisma.Decimal('9007199254740993.01'),
      marginPercent: new Prisma.Decimal(0),
      marginAmount: new Prisma.Decimal(0),
      taxPercent: new Prisma.Decimal(0),
      taxAmount: new Prisma.Decimal(0),
      grandTotal: new Prisma.Decimal('9007199254740993.01'),
    };

    const result = serializeDraftRecap(recap);

    expect(result.subtotal).toBe('9007199254740993.01');
    expect(result.grandTotal).toBe('9007199254740993.01');
    expect(typeof result.subtotal).toBe('string');
    expect(typeof result.grandTotal).toBe('string');
  });

  it('A-02: a .01 fraction survives the full buildDraftRecap -> serializeDraftRecap pipeline exactly', () => {
    const recap = buildDraftRecap(new Prisma.Decimal('1000.01'), 0, 0);

    const result = serializeDraftRecap(recap);

    expect(result.subtotal).toBe('1000.01');
    expect(result.grandTotal).toBe('1000.01');
  });

  it('A-03: marginAmount/taxAmount/grandTotal are exact and scale 2 for a realistic subtotal', () => {
    const recap = buildDraftRecap(new Prisma.Decimal('1000000'), 10, 11);

    const result = serializeDraftRecap(recap);

    expect(result.subtotal).toBe('1000000.00');
    expect(result.marginAmount).toBe('100000.00');
    expect(result.taxAmount).toBe('121000.00');
    expect(result.grandTotal).toBe('1221000.00');
  });

  it('A-04: an integer money value is rendered with two decimal places', () => {
    const recap = buildDraftRecap(new Prisma.Decimal('10'), 0, 0);

    const result = serializeDraftRecap(recap);

    expect(result.subtotal).toBe('10.00');
    expect(result.grandTotal).toBe('10.00');
  });

  it('A-05: percentages (including a non-integer one) serialize as exact two-decimal strings', () => {
    const recap = buildDraftRecap(new Prisma.Decimal('1000000'), 7.5, 15);

    const result = serializeDraftRecap(recap);

    expect(result.marginPercent).toBe('7.50');
    expect(result.taxPercent).toBe('15.00');
    expect(result.ppnPercent).toBe('15.00');
  });

  it('A-06: incompletePricingRecap keeps every money field null', () => {
    const result = incompletePricingRecap(5, 12);

    expect(result.pricingStatus).toBe('INCOMPLETE');
    expect(result.subtotal).toBeNull();
    expect(result.marginAmount).toBeNull();
    expect(result.taxAmount).toBeNull();
    expect(result.grandTotal).toBeNull();
  });

  it('A-07: incompletePricingRecap keeps an available percentage as an exact string, and a missing one as null', () => {
    const withDecimalPercents = incompletePricingRecap(
      new Prisma.Decimal('5.5'),
      new Prisma.Decimal('12.25'),
    );
    expect(withDecimalPercents.marginPercent).toBe('5.50');
    expect(withDecimalPercents.taxPercent).toBe('12.25');
    expect(withDecimalPercents.ppnPercent).toBe('12.25');

    const withoutPercents = incompletePricingRecap(null, undefined);
    expect(withoutPercents.marginPercent).toBeNull();
    expect(withoutPercents.taxPercent).toBeNull();
    expect(withoutPercents.ppnPercent).toBeNull();
  });

  it('A-08: the serializer never emits scientific notation, for a large boundary value or a small percentage', () => {
    const recap: DraftRecap = {
      subtotal: new Prisma.Decimal('9007199254740993.01'),
      marginPercent: new Prisma.Decimal('0.01'),
      marginAmount: new Prisma.Decimal('0.01'),
      taxPercent: new Prisma.Decimal('0.01'),
      taxAmount: new Prisma.Decimal('0.01'),
      grandTotal: new Prisma.Decimal('9007199254740993.03'),
    };

    const result = serializeDraftRecap(recap);

    const moneyAndPercentFields = [
      result.subtotal,
      result.marginPercent,
      result.marginAmount,
      result.taxPercent,
      result.ppnPercent,
      result.taxAmount,
      result.grandTotal,
    ];
    for (const value of moneyAndPercentFields) {
      expect(value).not.toMatch(/e/i);
    }
    expect(result.marginPercent).toBe('0.01');
    expect(result.grandTotal).toBe('9007199254740993.03');
  });

  it('A-09: rounding is explicit ROUND_HALF_UP, proven against a non-default ambient global rounding mode', () => {
    const originalRounding = Prisma.Decimal.rounding;
    // Deliberately mis-set the ambient global default to something that would
    // round a x.xx5 boundary DOWN, so a pass here can only be explained by
    // the serializer passing its own explicit ROUND_HALF_UP — never by
    // silently inheriting whatever the process-wide default happens to be.
    Prisma.Decimal.set({ rounding: Prisma.Decimal.ROUND_DOWN });
    try {
      const recap: DraftRecap = {
        subtotal: new Prisma.Decimal('0.125'),
        marginPercent: new Prisma.Decimal(0),
        marginAmount: new Prisma.Decimal('0.125'),
        taxPercent: new Prisma.Decimal(0),
        taxAmount: new Prisma.Decimal('0.135'),
        grandTotal: new Prisma.Decimal('0.125'),
      };

      const result = serializeDraftRecap(recap);

      // ROUND_HALF_UP: 0.125 -> 0.13, 0.135 -> 0.14. ROUND_DOWN (the ambient
      // mode set above) would instead have produced 0.12 and 0.13.
      expect(result.subtotal).toBe('0.13');
      expect(result.marginAmount).toBe('0.13');
      expect(result.taxAmount).toBe('0.14');
    } finally {
      Prisma.Decimal.set({ rounding: originalRounding });
    }
  });
});
