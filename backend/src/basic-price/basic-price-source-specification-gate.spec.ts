import {
  hasExplicitUnverifiedSourceSpecification as pending,
  SOURCE_SPECIFICATION_UNVERIFIED,
} from './basic-price-source-specification-gate';

describe('BP205-SPEC-SAFETY: source qualifiers cannot silently auto-merge identities', () => {
  it('flags both brand variants even with the same resource name', () => {
    expect(pending({ Merek: 'MEREK A' })).toBe(true);
    expect(pending({ Merek: 'MEREK B' })).toBe(true);
    expect(SOURCE_SPECIFICATION_UNVERIFIED).toBe(
      'SOURCE_SPECIFICATION_UNVERIFIED',
    );
  });
  it('flags genuine type/size/colour fields but does not infer what values mean', () => {
    for (const key of ['Tipe', 'Model', 'Ukuran', 'Warna', 'Spesifikasi']) {
      expect(pending({ [key]: 'sesuatu' })).toBe(true);
    }
  });
  it('does not block the previously PASS Jenis source-category and unrelated notes', () => {
    expect(pending({ Jenis: 'BAHAN' })).toBe(false);
    expect(pending({ Catatan: 'dari pemasok' })).toBe(false);
    expect(pending(null)).toBe(false);
    expect(pending({ Merek: '  ' })).toBe(false);
  });
  it('never asserts equality or difference from blank, unsupported or numeric source facts', () => {
    expect(pending({ Merek: null })).toBe(false);
    expect(pending({ Diameter: 100 })).toBe(true);
    expect(pending({ Ukuran: ['5/7'] })).toBe(true);
  });
});
