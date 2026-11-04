import {
  compareConfirmedSpecifications,
  confirmedSpecifications,
} from './resource-identity-specification.contract';

describe('PR205 specification authority contract — optional, symmetric and fail-closed', () => {
  it('SPEC-A: absent is UNKNOWN, never an identity claim', () => {
    expect(confirmedSpecifications(null)).toBeNull();
    expect(confirmedSpecifications({})).toBeNull();
    expect(compareConfirmedSpecifications({ merek: 'Shimizu' }, null)).toBe('UNKNOWN');
  });
  it('SPEC-B: same proven brand/model gives a match irrespective of input order and letter case', () => {
    expect(confirmedSpecifications({ Brand: ' Shimizu ', model: 'PS-128' })).toEqual({
      merek: 'Shimizu', tipe: 'PS-128',
    });
    expect(compareConfirmedSpecifications({ merek: 'Shimizu', tipe: 'PS-128' }, {
      tipe: 'ps-128', merek: 'SHIMIZU',
    })).toBe('MATCH');
  });
  it('SPEC-C: positive differences on same key are a conflict, regardless of equal raw name', () => {
    expect(compareConfirmedSpecifications({ merek: 'Shimizu', tipe: 'PS-128' }, {
      merek: 'Panasonic', tipe: 'PS-128',
    })).toBe('CONFLICT');
  });
  it('SPEC-D: unprovided attribute and different attribute labels are UNKNOWN, not equivalent or different', () => {
    expect(compareConfirmedSpecifications({ ukuran: '5/7 cm' }, { ukuran: '50x70 mm' })).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ ukuran: '5/7 cm' }, { ukuran: '5/10 cm' })).toBe('CONFLICT');
    expect(compareConfirmedSpecifications({ ukuran: '5/7 cm' }, { dimensi: '50x70 mm' })).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ merek: 'Shimizu' }, { merek: 'Shimizu', tipe: 'PS-128' })).toBe('UNKNOWN');
  });
  it('BP-C2: confirmed use-context has controlled vocabulary but cannot claim conflict by wording alone', () => {
    expect(confirmedSpecifications({
      lingkungan: 'di dalam air', kompetensi: 'penyelam',
      metode: 'tremie', peruntukan: 'pekerjaan laut',
    })).toEqual({
      kompetensi: 'penyelam', lingkungan: 'di dalam air',
      metode: 'tremie', peruntukan: 'pekerjaan laut',
    });
    expect(compareConfirmedSpecifications(
      { lingkungan: 'air laut' }, { lingkungan: 'perairan laut' },
    )).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications(
      { kompetensi: 'penyelam' }, { kompetensi: 'pekerja bawah air' },
    )).toBe('UNKNOWN');
    expect(confirmedSpecifications({ komentar: 'new identity please' })).toBeNull();
  });

  it('accepts explicit dimension facts without guessing numerical equality or units', () => {
    expect(confirmedSpecifications({
      Panjang: '12 m', Lebar: '5 cm', Tinggi: '2 m',
      Berat: '50 kg', Volume: '20 liter',
    })).toEqual({ berat: '50 kg', lebar: '5 cm', panjang: '12 m', tinggi: '2 m', volume: '20 liter' });
    expect(compareConfirmedSpecifications({ berat: '40 kg' }, { berat: '50 kg' })).toBe('CONFLICT');
    expect(compareConfirmedSpecifications({ berat: '50kg' }, { berat: '50 kg' })).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ berat: '50 kg' }, { berat: '50 kg' })).toBe('MATCH');
  });

  it('distinguishes confirmed 40 kg and 50 kg cement packages without changing canonical unit conversion', () => {
    expect(compareConfirmedSpecifications({ merek: 'Conch', berat: '40 kg' },
      { merek: 'CONCH', berat: '50 kg' })).toBe('CONFLICT');
    expect(compareConfirmedSpecifications({ berat: '50 kg' },
      { berat: '40 kg' })).toBe('CONFLICT');
    expect(compareConfirmedSpecifications({ diameter: '10 mm' },
      { diameter: '12 mm' })).toBe('CONFLICT');
    expect(compareConfirmedSpecifications({ panjang: '12 m' },
      { panjang: '6 m' })).toBe('CONFLICT');
    expect(compareConfirmedSpecifications({ volume: '20 liter' },
      { volume: '25 liter' })).toBe('CONFLICT');
    expect(compareConfirmedSpecifications({ berat: '12 kg' },
      { berat: '12 kg' })).toBe('MATCH');
  });

  it('does not assert physical differences on mismatched units or ambiguous commercial measurements', () => {
    expect(compareConfirmedSpecifications({ berat: '40 kg' },
      { berat: '40000 g' })).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ berat: '1.000 kg' },
      { berat: '1000 kg' })).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ panjang: '12 meter' },
      { panjang: '6 m' })).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ kapasitas: 'bucket 0,8 m3' },
      { kapasitas: 'bucket 1,0 m3' })).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ berat: '40 kg' },
      { tipe: 'Portland' })).toBe('UNKNOWN');
  });

  it('Owner PASS: extra supplier specification is retained as evidence, not a second identity proof', () => {
    expect(confirmedSpecifications({ 'Spesifikasi Tambahan': 'cat air untuk dinding' }))
      .toEqual({ spesifikasi: 'cat air untuk dinding' });
    expect(compareConfirmedSpecifications(
      { spesifikasi: 'cat air untuk dinding' },
      { spesifikasi: 'cat air untuk dinding' },
    )).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications(
      { spesifikasi: 'cat air untuk dinding' },
      { spesifikasi: 'cat minyak untuk besi' },
    )).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications(
      { merek: 'Conch', berat: '40 kg', spesifikasi: 'Portland' },
      { merek: 'Conch', berat: '50 kg', spesifikasi: 'Portland' },
    )).toBe('CONFLICT');
  });

  it('GATE-1R: equal bucket capacity alone is UNKNOWN, not a resource identity proof', () => {
    const same = { kapasitas: 'Kapasitas bak: 5,2 m³' };
    expect(compareConfirmedSpecifications(same, same)).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications(same, { kapasitas: 'Kapasitas bak: 7 m³' })).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ mutu: 'BjTS 280', diameter: '10 mm' },
      { mutu: 'BjTS 280', diameter: '13 mm' })).toBe('CONFLICT');
    expect(compareConfirmedSpecifications({ merek: 'Shimizu', tipe: 'PS-128' },
      { merek: 'Shimizu', tipe: 'PS-128' })).toBe('MATCH');
  });

  it('GATE2 Format A real headers: Tipe/Model canonicalizes; combined supplier fields remain non-identity evidence', () => {
    const normalized=confirmedSpecifications({
      Merk:'Conch', 'Tipe/Model':'PCC', Berat:'40 kg',
      'Mutu dan Standar':'standar', 'Jenis/Kegunaan':'Semen Portland',
    });
    expect(normalized).toEqual({
      berat:'40 kg', jenis_kegunaan_sumber:'Semen Portland',
      merek:'Conch', mutu_dan_standar_sumber:'standar', tipe:'PCC',
    });
    expect(compareConfirmedSpecifications(
      { mutu_dan_standar_sumber:'Kategori Premium', jenis_kegunaan_sumber:'Cat air' },
      { mutu_dan_standar_sumber:'Kategori Premium', jenis_kegunaan_sumber:'Cat air' },
    )).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications(
      { merek:'Conch', tipe:'PCC', berat:'40 kg',
        mutu_dan_standar_sumber:'standar' },
      { merek:'Conch', tipe:'PCC', berat:'50 kg',
        mutu_dan_standar_sumber:'standar' },
    )).toBe('CONFLICT');
    expect(confirmedSpecifications({ 'Tipe/Model':'PCC', tipe:'OPC' })).toBeNull();
  });
  it('Format A literal semua merk is an ANY-BRAND scope, never a manufacturer identity or brand conflict', () => {
    const source = confirmedSpecifications({
      Merk: 'semua merk', 'Tipe/Model': 'Tronton', Berat: '10 Ton',
      Volume: '6,93 M3', 'Jenis/Kegunaan': 'Alat Angkut Material',
      'Mutu dan Standar': 'Standar',
    });
    expect(source).toMatchObject({ merek: 'semua merk', tipe: 'Tronton',
      berat: '10 Ton', volume: '6,93 M3',
      jenis_kegunaan_sumber: 'Alat Angkut Material' });
    // Exact source/audit text survives. A specific candidate's brand must
    // not be RULED_OUT merely because the source allowed all brands.
    expect(compareConfirmedSpecifications(source!, {
      merek: 'Mitsubishi', tipe: 'Tronton', berat: '10 Ton',
      volume: '6,93 M3', jenis_kegunaan_sumber: 'Alat Angkut Material',
      mutu_dan_standar_sumber: 'Standar',
    })).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications(source!, {
      merek: 'Hino', tipe: 'Tronton', berat: '15 Ton',
      volume: '6,93 M3', jenis_kegunaan_sumber: 'Alat Angkut Material',
      mutu_dan_standar_sumber: 'Standar',
    })).toBe('CONFLICT'); // REAL positive physical contradiction
    expect(compareConfirmedSpecifications({ merek: 'semua merk' }, { merek: 'Mitsubishi' }))
      .toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ merek: 'semua merk' }, { merek: 'semua merk' }))
      .toBe('UNKNOWN');
    expect(compareConfirmedSpecifications({ merek: 'Nippon', berat: '20 kg' },
      { merek: 'Jotun', berat: '20 kg' })).toBe('CONFLICT');
    expect(compareConfirmedSpecifications({ merek: 'Nippon', berat: '20 kg' },
      { merek: 'Nippon', berat: '25 kg' })).toBe('CONFLICT');
    // Do not convert a real, specific brand into a wild card.
    expect(compareConfirmedSpecifications({ merek: 'Nippon' }, { merek: 'semua merk' }))
      .toBe('UNKNOWN');
  });

  it('SPEC-E: never admit unsupported fields, structural values, empty values or contradictory aliases', () => {
    expect(confirmedSpecifications({ status: 'APPROVED' })).toBeNull();
    expect(confirmedSpecifications({ merek: { text: 'A' } })).toBeNull();
    expect(confirmedSpecifications({ merek: '' })).toBeNull();
    expect(confirmedSpecifications({ merek: 'A', brand: 'B' })).toBeNull();
  });
});

describe('G123 independent pre-merge guards: evaluate all facts and keep unverified source qualifiers fail-closed', () => {
  it.each([
    {
      label: 'equivalent numeric spelling must not hide different technical model',
      source: { panjang: '1.0 m', tipe: 'PCC' },
      candidate: { panjang: '1 m', tipe: 'OPC' },
    },
    {
      label: 'ambiguous thousands notation must not hide different brand',
      source: { berat: '1.000 kg', merek: 'Conch' },
      candidate: { berat: '1000 kg', merek: 'Nippon' },
    },
    {
      label: 'unit-spacing uncertainty must not hide a different model',
      source: { berat: '40kg', tipe: 'PCC' },
      candidate: { berat: '40 kg', tipe: 'OPC' },
    },
    {
      label: 'missing first attribute must not hide a later brand contradiction',
      source: { berat: '40 kg', merek: 'Conch' },
      candidate: { merek: 'Nippon' },
    },
  ])('$label', ({ source, candidate }) => {
    expect(compareConfirmedSpecifications(source, candidate)).toBe('CONFLICT');
  });

  it('unverified source quality without a corresponding catalog fact cannot authorize MATCH', () => {
    const source = { merek: 'Conch', berat: '40 kg', mutu_dan_standar_sumber: 'Premium' };
    const catalog = { merek: 'Conch', berat: '40 kg' };
    expect(compareConfirmedSpecifications(source, catalog)).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications(catalog, source)).toBe('UNKNOWN');
    expect(compareConfirmedSpecifications(source, {
      ...catalog, mutu_dan_standar_sumber: 'Economy',
    })).toBe('UNKNOWN');
  });

  it('source-only free text is never independent identity proof', () => {
    expect(compareConfirmedSpecifications(
      { spesifikasi: 'cat dinding', jenis_kegunaan_sumber: 'interior' },
      { spesifikasi: 'cat dinding', jenis_kegunaan_sumber: 'interior' },
    )).toBe('UNKNOWN');
  });

  it('keeps exact typed identity with equal supplier qualifiers and preserves proven 40 vs 50 kg conflict', () => {
    const forty = { merek: 'Conch', tipe: 'PCC', berat: '40 kg', mutu_dan_standar_sumber: 'Standar' };
    expect(compareConfirmedSpecifications(forty, {
      tipe: 'pcc', merek: 'CONCH', berat: '40 kg', mutu_dan_standar_sumber: 'standar',
    })).toBe('MATCH');
    expect(compareConfirmedSpecifications(forty, {
      merek: 'Conch', tipe: 'PCC', berat: '50 kg', mutu_dan_standar_sumber: 'Standar',
    })).toBe('CONFLICT');
    expect(compareConfirmedSpecifications(
      { merek: 'semua merk', tipe: 'Tronton' },
      { merek: 'Mitsubishi', tipe: 'Tronton' },
    )).toBe('UNKNOWN');
  });
});
