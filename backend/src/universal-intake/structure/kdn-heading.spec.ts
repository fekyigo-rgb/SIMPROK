import { matchKdnHeading } from './kdn-heading';

describe('BP-KDN-01 heading law', () => {
  describe('KDN-IMP-01 — canonical heading `KDN (%)`', () => {
    it('is CLEAR', () => {
      expect(matchKdnHeading('KDN (%)')).toBe('CLEAR');
    });
  });

  describe('KDN-IMP-02 — alias `KDN`', () => {
    it('is CLEAR, including percent-suffix spellings', () => {
      expect(matchKdnHeading('KDN')).toBe('CLEAR');
      expect(matchKdnHeading('kdn')).toBe('CLEAR');
      expect(matchKdnHeading('% KDN')).toBe('CLEAR');
      expect(matchKdnHeading('KDN%')).toBe('CLEAR');
      expect(matchKdnHeading('%KDN')).toBe('CLEAR');
    });
  });

  describe('KDN-IMP-03 — clear `Kandungan Dalam Negeri`', () => {
    it('is CLEAR, including the persentase forms', () => {
      expect(matchKdnHeading('Kandungan Dalam Negeri')).toBe('CLEAR');
      expect(matchKdnHeading('Persentase KDN')).toBe('CLEAR');
      expect(matchKdnHeading('Persentase Kandungan Dalam Negeri')).toBe(
        'CLEAR',
      );
    });
  });

  describe('KDN-IMP-04 — ambiguous `LOCAL` is never auto-established', () => {
    it('flags LOCAL / LOKAL / DOMESTIC / TINGKAT LOKAL / TKDN as AMBIGUOUS', () => {
      expect(matchKdnHeading('LOCAL')).toBe('AMBIGUOUS');
      expect(matchKdnHeading('LOKAL')).toBe('AMBIGUOUS');
      expect(matchKdnHeading('DOMESTIC')).toBe('AMBIGUOUS');
      expect(matchKdnHeading('TINGKAT LOKAL')).toBe('AMBIGUOUS');
      expect(matchKdnHeading('TKDN')).toBe('AMBIGUOUS');
      expect(matchKdnHeading('Persentase TKDN')).toBe('AMBIGUOUS');
    });
  });

  describe('KDN-IMP-05 / KDN-DOM — non-KDN headings stay NONE', () => {
    it('does not treat a price, unit, note, or unlabelled heading as KDN', () => {
      expect(matchKdnHeading('Harga')).toBe('NONE');
      expect(matchKdnHeading('Satuan')).toBe('NONE');
      expect(matchKdnHeading('Sumber')).toBe('NONE');
      expect(matchKdnHeading('Nama Item')).toBe('NONE');
      expect(matchKdnHeading('')).toBe('NONE');
      expect(matchKdnHeading(null)).toBe('NONE');
      expect(matchKdnHeading('KDN Supplier')).toBe('NONE');
    });
  });

  it('KDN-DOM-01 — a CLEAR heading never folds into the word TKDN', () => {
    expect(matchKdnHeading('KDN (%)')).toBe('CLEAR');
    expect(matchKdnHeading('TKDN')).not.toBe('CLEAR');
  });
});
