import { sourceSpecificationEvidence } from './basic-price-source-specification-gate';

describe('PR205 private source specification readback — evidence, never an identity decision', () => {
  it('projects only explicit specifications while preserving raw source labels', () => {
    expect(sourceSpecificationEvidence({
      Kode: 'M-01',
      Jenis: 'BAHAN',
      Merek: 'Shimizu',
      Tipe: 'PS-128',
      Ukuran: '5/7 cm',
      Harga: 250000,
    })).toEqual([
      { label: 'Merek', value: 'Shimizu' },
      { label: 'Tipe', value: 'PS-128' },
      { label: 'Ukuran', value: '5/7 cm' },
    ]);
  });

  it('keeps numeric source dimensions as text without claiming unit equivalence', () => {
    expect(sourceSpecificationEvidence({ Diameter: 100 })).toEqual([
      { label: 'Diameter', value: '100' },
    ]);
  });

  it('does not invent specifications from blank or absent fields', () => {
    expect(sourceSpecificationEvidence(null)).toEqual([]);
    expect(sourceSpecificationEvidence({ Merek: '  ', Warna: null, Jenis: 'BAHAN' })).toEqual([]);
  });

  it('does not pretend a structured source value is a verified specification', () => {
    expect(sourceSpecificationEvidence({ Ukuran: ['5/7'], Model: { uncertain: true } })).toEqual([
      { label: 'Ukuran', value: null },
      { label: 'Model', value: null },
    ]);
  });
});
