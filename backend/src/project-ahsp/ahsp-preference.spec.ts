import {
  AHSP_PREFERENCE_BAND,
  classificationPathsFromLeaves,
  rankAhspPreference,
  type AhspPreferenceCandidate,
} from './ahsp-preference';

const BINA = 'd110bb4a-5afc-4a37-8ce9-b054e99c9c6f';
const JALAN = 'b5c0cfb1-0849-47d9-93e7-88e6bc36c2c4';
const CIPTA = 'ce984cc4-30ed-4bd5-ba38-5dea74b57d36';
const GEDUNG = 'ae7b03ba-6794-4208-9ecd-69be6a4c03b6';
const JEMBATAN = '907c04b2-3d57-41f7-b724-79a88d51faf0';

const path = (
  kategoriId: string,
  subkategoriId: string,
  jenisPekerjaan: string,
  label: string,
) => ({ kategoriId, subkategoriId, jenisPekerjaan, label });

const candidate = (
  id: string,
  workType: string,
  paths: AhspPreferenceCandidate['paths'],
  unitCompatible = true,
  methodName = 'Metode standar',
): AhspPreferenceCandidate & { id: string } => ({
  id,
  workType,
  methodName,
  unitCompatible,
  paths,
});

const context = {
  selectedKategoriIds: [BINA, CIPTA],
  selectedSubkategoriIds: [JALAN, GEDUNG],
  boqName: 'Pasangan batu',
};

describe('RI-01K AHSP preference', () => {
  it('gives a fitting Bina Marga AHSP priority and keeps Cipta Karya discoverable', () => {
    const ranked = rankAhspPreference(
      [
        candidate('cipta', 'Pasangan batu gedung', [
          path(CIPTA, GEDUNG, 'Pasangan batu', 'Pekerjaan Konstruksi · Cipta Karya · Gedung · Pasangan batu'),
        ]),
        candidate('bina', 'Pasangan batu kali', [
          path(BINA, JALAN, 'Pasangan batu', 'Pekerjaan Konstruksi · Bina Marga · Jalan · Pasangan batu'),
        ]),
      ],
      {
        selectedKategoriIds: [BINA],
        selectedSubkategoriIds: [JALAN],
        boqName: 'Pasangan batu',
      },
    );
    expect(ranked.map((item) => item.id)).toEqual(['bina', 'cipta']);
    expect(ranked[0].preference.band).toBe(AHSP_PREFERENCE_BAND.PREFERRED_SUBKATEGORI);
    expect(ranked[0].preference.recommended).toBe(true);
    expect(ranked[0].preference.classificationPath).toContain('Bina Marga');
    expect(ranked[1].preference.band).toBe(AHSP_PREFERENCE_BAND.CROSS_CATEGORY_FALLBACK);
    expect(ranked[1].preference.recommended).toBe(true);
    expect(ranked[1].preference.classificationPath).toContain('Cipta Karya');
    expect(ranked[1].preference.reason).toContain('Ada kandidat pada kategori pilihan');
    expect(ranked[1].preference.reason).not.toContain('Tidak ada kecocokan');
  });

  it('keeps every selected subkategori in the preferred band', () => {
    const ranked = rankAhspPreference(
      [
        candidate('cipta', 'Pasangan batu gedung', [
          path(CIPTA, GEDUNG, 'Pasangan batu', 'Cipta Karya · Gedung · Pasangan batu'),
        ]),
        candidate('bina', 'Pasangan batu kali', [
          path(BINA, JALAN, 'Pasangan batu', 'Bina Marga · Jalan · Pasangan batu'),
        ]),
      ],
      context,
    );
    expect(ranked.map((item) => item.id)).toEqual(['cipta', 'bina']);
    expect(
      ranked.every(
        (item) =>
          item.preference.band === AHSP_PREFERENCE_BAND.PREFERRED_SUBKATEGORI &&
          item.preference.recommended,
      ),
    ).toBe(true);
  });

  it('uses an honest cross-category fallback when no preferred candidate fits', () => {
    const ranked = rankAhspPreference(
      [
        candidate('bina-other', 'Galian biasa', [
          path(BINA, JALAN, 'Galian', 'Pekerjaan Konstruksi · Bina Marga · Jalan · Galian'),
        ]),
        candidate('cipta-fit', 'Pasangan batu gedung', [
          path(CIPTA, 'other-sub', 'Pasangan batu', 'Pekerjaan Konstruksi · Cipta Karya · Gedung · Pasangan batu'),
        ]),
      ],
      {
        selectedKategoriIds: [BINA],
        selectedSubkategoriIds: [JALAN],
        boqName: 'Pasangan batu',
      },
    );
    expect(ranked[0].id).toBe('cipta-fit');
    expect(ranked[0].preference.band).toBe(AHSP_PREFERENCE_BAND.CROSS_CATEGORY_FALLBACK);
    expect(ranked[0].preference.reason).toContain('Tidak ada kecocokan pada kategori pilihan');
    expect(ranked[1].preference.recommended).toBe(false);
    expect(ranked[1].preference.band).toBe(AHSP_PREFERENCE_BAND.NOT_RECOMMENDED);
  });

  it('does not recommend Pasangan beton for Pasangan batu on one shared word', () => {
    const ranked = rankAhspPreference(
      [
        candidate('beton', 'Pasangan beton', [
          path(BINA, JALAN, 'Pasangan beton', 'Bina Marga · Jalan · Pasangan beton'),
        ]),
      ],
      {
        selectedKategoriIds: [BINA],
        selectedSubkategoriIds: [JALAN],
        boqName: 'Pasangan batu',
      },
    );
    expect(ranked[0].preference.recommended).toBe(false);
    expect(ranked[0].preference.band).toBe(AHSP_PREFERENCE_BAND.NOT_RECOMMENDED);
  });

  it('does not recommend Timbunan tanah for Galian tanah on one shared word', () => {
    const ranked = rankAhspPreference(
      [
        candidate('timbunan', 'Timbunan tanah', [
          path(BINA, JALAN, 'Timbunan tanah', 'Bina Marga · Jalan · Timbunan tanah'),
        ]),
      ],
      {
        selectedKategoriIds: [BINA],
        selectedSubkategoriIds: [JALAN],
        boqName: 'Galian tanah',
      },
    );
    expect(ranked[0].preference.recommended).toBe(false);
    expect(ranked[0].preference.band).toBe(AHSP_PREFERENCE_BAND.NOT_RECOMMENDED);
  });

  it('does not recommend an unsuitable AHSP only because its category matches', () => {
    const ranked = rankAhspPreference(
      [
        candidate('bina-unfit', 'Laston lapis aus', [
          path(BINA, JALAN, 'Laston', 'Pekerjaan Konstruksi · Bina Marga · Jalan · Laston'),
        ]),
        candidate('cipta-fit', 'Pasangan batu', [
          path(CIPTA, GEDUNG, 'Pasangan batu', 'Pekerjaan Konstruksi · Cipta Karya · Gedung · Pasangan batu'),
        ]),
      ],
      {
        selectedKategoriIds: [BINA],
        selectedSubkategoriIds: [JALAN],
        boqName: 'Pasangan batu',
      },
    );
    expect(ranked[0].id).toBe('cipta-fit');
    expect(ranked[0].preference.recommended).toBe(true);
    expect(ranked.find((item) => item.id === 'bina-unfit')?.preference.recommended).toBe(false);
  });

  it('does not recommend a unit-incompatible AHSP', () => {
    const ranked = rankAhspPreference(
      [
        candidate(
          'wrong-unit',
          'Pasangan batu',
          [path(BINA, JALAN, 'Pasangan batu', 'Bina Marga · Jalan · Pasangan batu')],
          false,
        ),
      ],
      context,
    );
    expect(ranked[0].preference.band).toBe(AHSP_PREFERENCE_BAND.NOT_RECOMMENDED);
    expect(ranked[0].preference.recommended).toBe(false);
    expect(ranked[0].preference.reason).toContain('Satuan');
  });

  it('keeps the best canonical path when one AHSP has several', () => {
    const ranked = rankAhspPreference(
      [
        candidate('multi', 'Pasangan batu', [
          path(CIPTA, GEDUNG, 'Pasangan batu', 'Cipta Karya · Gedung · Pasangan batu'),
          path(BINA, JALAN, 'Pasangan batu', 'Bina Marga · Jalan · Pasangan batu'),
        ]),
      ],
      {
        selectedKategoriIds: [BINA],
        selectedSubkategoriIds: [JALAN],
        boqName: 'Pasangan batu',
      },
    );
    expect(ranked[0].preference.band).toBe(AHSP_PREFERENCE_BAND.PREFERRED_SUBKATEGORI);
    expect(ranked[0].preference.classificationPath).toContain('Bina Marga');
  });

  it('does not invent a classification when the assignment is missing', () => {
    const ranked = rankAhspPreference(
      [candidate('bare', 'Pasangan batu', [])],
      context,
    );
    expect(ranked[0].preference.band).toBe(AHSP_PREFERENCE_BAND.INSUFFICIENT_CLASSIFICATION);
    expect(ranked[0].preference.classificationPath).toBeNull();
    expect(ranked[0].preference.recommended).toBe(false);
    expect(classificationPathsFromLeaves([null, { id: 'x', name: 'Bukan daun', level: 'KATEGORI' }])).toEqual(
      [],
    );
  });

  it('treats a selected Kategori without a Subkategori as the broader preference', () => {
    const ranked = rankAhspPreference(
      [
        candidate('jalan', 'Pasangan batu', [
          path(BINA, JALAN, 'Pasangan batu', 'Bina Marga · Jalan · Pasangan batu'),
        ]),
        candidate('jembatan', 'Pasangan batu', [
          path(BINA, JEMBATAN, 'Pasangan batu', 'Bina Marga · Jembatan · Pasangan batu'),
        ]),
      ],
      {
        selectedKategoriIds: [BINA, CIPTA],
        selectedSubkategoriIds: [],
        boqName: 'Pasangan batu',
      },
    );
    expect(ranked.every((item) => item.preference.band === AHSP_PREFERENCE_BAND.PREFERRED_KATEGORI)).toBe(
      true,
    );
    expect(ranked.map((item) => item.id)).toEqual(['jalan', 'jembatan']);
  });

  it('does not call another category a fallback when the project has no kategori', () => {
    const ranked = rankAhspPreference(
      [
        candidate('bina', 'Pasangan batu', [
          path(BINA, JALAN, 'Pasangan batu', 'Bina Marga · Jalan · Pasangan batu'),
        ]),
      ],
      { selectedKategoriIds: [], selectedSubkategoriIds: [], boqName: 'Pasangan batu' },
    );
    expect(ranked[0].preference.band).toBe(AHSP_PREFERENCE_BAND.INSUFFICIENT_CLASSIFICATION);
    expect(ranked[0].preference.recommended).toBe(false);
  });
});
