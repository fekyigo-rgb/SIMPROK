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

  it('reads named dimensional columns from a multi-level supplier specification table without guessing units or identity', () => {
    const source = {
      KDN: 65.5,
      Merk: 'Conch',
      Panjang: '12 m',
      Lebar: null,
      Tinggi: '',
      Diameter: '10 mm',
      Volume: '20 liter',
      Berat: '50 kg',
      Kapasitas: '0,8 m3',
      Keterangan: 'Cat tembok',
    };
    expect(sourceSpecificationEvidence(source)).toEqual([
      { label: 'Merk', value: 'Conch' },
      { label: 'Panjang', value: '12 m' },
      { label: 'Diameter', value: '10 mm' },
      { label: 'Volume', value: '20 liter' },
      { label: 'Berat', value: '50 kg' },
      { label: 'Kapasitas', value: '0,8 m3' },
    ]);
    // KDN and Keterangan remain with their existing, separate owners.
    expect(sourceSpecificationEvidence({ KDN: 0, Keterangan: 'Cat air' })).toEqual([]);
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

describe('G123 real Format A — combined source headers remain source evidence', () => {
  it('preserves supplier typed/model, quality, use, additional specification without classifying generic Jenis', () => {
    expect(sourceSpecificationEvidence({
      'Tipe/Model': 'PCC',
      'Mutu dan Standar': 'Premium',
      'Jenis/Kegunaan': 'Semen Portland',
      'Spesifikasi Tambahan': 'Ketahanan cuaca',
      'Jenis': 'BAHAN',
      'Keterangan': 'Informasi pemasok',
    })).toEqual([
      { label: 'Tipe/Model', value: 'PCC' },
      { label: 'Mutu dan Standar', value: 'Premium' },
      { label: 'Jenis/Kegunaan', value: 'Semen Portland' },
      { label: 'Spesifikasi Tambahan', value: 'Ketahanan cuaca' },
    ]);
  });
});
