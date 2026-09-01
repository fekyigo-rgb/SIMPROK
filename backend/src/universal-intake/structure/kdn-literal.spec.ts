import { interpretKdnLiteral, KDN_LITERAL_REASONS } from './kdn-literal';

describe('BP-KDN-01 value law', () => {
  it('KDN-VAL-01 — 72.5 → 72.50', () => {
    const reading = interpretKdnLiteral('72.5');
    expect(reading.status).toBe('VALID');
    expect(reading.canonicalPercent).toBe('72.50');
  });

  it('KDN-VAL-02 — 72,5 → 72.50', () => {
    const reading = interpretKdnLiteral('72,5');
    expect(reading.status).toBe('VALID');
    expect(reading.canonicalPercent).toBe('72.50');
  });

  it('KDN-VAL-03 — 72.5% → 72.50', () => {
    expect(interpretKdnLiteral('72.5%').canonicalPercent).toBe('72.50');
    expect(interpretKdnLiteral('72,50%').canonicalPercent).toBe('72.50');
    expect(interpretKdnLiteral('72.50 %').canonicalPercent).toBe('72.50');
  });

  it('KDN-VAL-04 — 0 is exact zero, never unknown', () => {
    const reading = interpretKdnLiteral('0');
    expect(reading.status).toBe('VALID');
    expect(reading.canonicalPercent).toBe('0.00');
    expect(interpretKdnLiteral('0%').canonicalPercent).toBe('0.00');
  });

  it('KDN-VAL-05 — 100 is valid', () => {
    expect(interpretKdnLiteral('100').canonicalPercent).toBe('100.00');
    expect(interpretKdnLiteral('100%').canonicalPercent).toBe('100.00');
  });

  it('KDN-VAL-06 — blank is unknown, never zero', () => {
    for (const input of [null, undefined, '', '   ']) {
      const reading = interpretKdnLiteral(input);
      expect(reading.status).toBe('UNKNOWN');
      expect(reading.canonicalPercent).toBeNull();
      expect(reading.canonicalPercent).not.toBe('0.00');
    }
  });

  it('KDN-VAL-07 — -1 is rejected as KDN', () => {
    const reading = interpretKdnLiteral('-1');
    expect(reading.status).toBe('INVALID');
    expect(reading.reason).toBe(KDN_LITERAL_REASONS.OUT_OF_RANGE);
    expect(reading.canonicalPercent).toBeNull();
  });

  it('KDN-VAL-08 — 100.01 is rejected as KDN', () => {
    expect(interpretKdnLiteral('100.01').reason).toBe(
      KDN_LITERAL_REASONS.OUT_OF_RANGE,
    );
    expect(interpretKdnLiteral('135').reason).toBe(
      KDN_LITERAL_REASONS.OUT_OF_RANGE,
    );
  });

  it('KDN-VAL-09 — non-numeric is unresolved/rejected, never zero', () => {
    const tinggi = interpretKdnLiteral('tinggi');
    expect(tinggi.status).toBe('INVALID');
    expect(tinggi.reason).toBe(KDN_LITERAL_REASONS.NOT_NUMERIC);
    expect(tinggi.canonicalPercent).toBeNull();

    const na = interpretKdnLiteral('N/A');
    expect(na.status).toBe('INVALID');
    expect(na.canonicalPercent).not.toBe('0.00');
    expect(na.canonicalPercent).toBeNull();
  });

  it('never uses binary floating point for the canonical string', () => {
    const reading = interpretKdnLiteral('72.5');
    expect(typeof reading.canonicalPercent).toBe('string');
    expect(reading.canonicalPercent).not.toBe(72.5 as unknown as string);
  });
});
