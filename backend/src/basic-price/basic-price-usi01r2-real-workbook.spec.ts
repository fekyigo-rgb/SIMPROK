import { existsSync, readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { BasicPriceUniversalIntakeAdapter } from './basic-price-universal-intake.adapter';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

/**
 * USI-01R2 §9/§10 — REHEARSAL AGAINST THE OWNER'S ACTUAL FILES.
 *
 * These run the REAL production pipeline — envelope, reader registry, structure
 * detector, Basic Price domain adapter — over the two real workbooks. No
 * fixture stands in for them, and nothing here is read-only-by-accident: the
 * adapter never writes, and no database is involved at all.
 *
 * The files live outside the repository (they are Owner business data and are
 * never committed), so the suite SKIPS rather than fails when they are absent —
 * a machine without them still gets a green build, and the report says plainly
 * that the rehearsal did not run.
 */
const OWNER_ROOT = 'C:/SIMPROK';
const WORKBOOK_A = `${OWNER_ROOT}/BASIC PRICE IKK - SIMPROK READY 2024.xlsx`;
const WORKBOOK_B = `${OWNER_ROOT}/Harga kota Ambon.xlsx`;

const adapter = new BasicPriceUniversalIntakeAdapter();
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex').toUpperCase();

const describeIf = (path: string) => (existsSync(path) ? describe : describe.skip);

describeIf(WORKBOOK_A)('REAL Workbook A — BASIC PRICE IKK SIMPROK READY 2024', () => {
  let bytes: Buffer;
  let knowledge: Awaited<ReturnType<typeof adapter.parse>>;

  beforeAll(async () => {
    bytes = readFileSync(WORKBOOK_A);
    knowledge = await adapter.parse(testEnvelope(bytes, 'BASIC PRICE IKK - SIMPROK READY 2024.xlsx'));

  // Reading and fully parsing a real workbook comfortably beats Jest's default
  // 5s hook timeout on an idle machine, and does NOT under a loaded CI runner —
  // which turns a healthy suite into a phantom failure. The budget is explicit.
  }, 120_000);

  it('reports the source artifact exactly as it is', () => {
    expect(statSync(WORKBOOK_A).size).toBe(bytes.length);
    expect(sha(bytes)).toBe(
      'A489B144423A1A6E7B34DDCAB1956411F5DB18A56973C785C79A5B29BA7AE5DC',
    );
  });

  it('SIMPROK finds the one price table among four sheets, unaided', () => {
    // README, QA_EXCEPTIONS and SOURCE_3_KECAMATAN prove nothing; BASIC_PRICE_READY
    // does. No sheet name was supplied, and none was needed.
    expect(knowledge.sheetName).toBe('BASIC_PRICE_READY');
    expect(knowledge.structure).toBe('SEMANTIC_HEADER_TABLE');
  });

  it('reads the real header row and its 19 real columns', () => {
    expect(knowledge.rows.length).toBeGreaterThan(0);
    const row = knowledge.rows[0];
    expect(row.sourceNameCellAddress).toMatch(/^D\d+$/); // resource_name is column D
    expect(row.sourcePriceCellAddress).toMatch(/^J\d+$/); // selected_price_2024 is column J
  });

  it('derives 86 candidate rows from the source, without being told the number', () => {
    // The workbook's own README states 86. SIMPROK is never given that figure;
    // it counts what it can actually read, and the two agree.
    expect(knowledge.totalSourceRows).toBe(86);
    expect(knowledge.rows).toHaveLength(86);
  });

  it('resolves resource families from the source’s OWN category words', () => {
    const byFamily = (family: string | null) =>
      knowledge.rows.filter((r) => r.sourceSection === family).length;

    expect(byFamily('MATERIAL')).toBe(46); // BAHAN DASAR + AGREGAT + KAYU + BESI/ALUMINIUM
    expect(byFamily('LABOR')).toBe(17); // UPAH
    expect(byFamily('EQUIPMENT')).toBe(15); // ALAT
    expect(byFamily(null)).toBe(8); // LAIN-LAIN — refused, see below
    expect(byFamily('MATERIAL') + byFamily('LABOR') + byFamily('EQUIPMENT') + byFamily(null)).toBe(86);

    expect(knowledge.sectionProvenance).toBe('SOURCE_ROW_CATEGORY');
  });

  it.each([['Buldozer'], ['Excavator'], ['Genset']])(
    'MANDATORY REAL ROW PROOF: %s is EQUIPMENT, on the source’s authority',
    (name) => {
      const row = knowledge.rows.find((r) => r.rawResourceNameText === name);
      expect(row).toBeDefined();
      expect(row!.sourceSection).toBe('EQUIPMENT');
      expect(row!.rawSourceCategoryName).toBe('ALAT');
      expect(row!.rawSourceCategoryCode).toBe('F');
      expect(row!.sourceSectionProvenance).toBe('SOURCE_ROW_CATEGORY');
    },
  );

  it('rich BAHAN categories resolve to MATERIAL — not just the bare word "BAHAN"', () => {
    // Four different multi-word BAHAN phrases; a one-word exact table would
    // have failed every one of them.
    const sample = [
      { name: 'Air', category: 'BAHAN DASAR' },
      { name: 'Pasir beton', category: 'BAHAN AGREGAT KASAR, BAHAN PEREKAT' },
      { name: 'Balok Kayu Kelas II', category: 'BAHAN KAYU' },
    ];
    for (const { name, category } of sample) {
      const row = knowledge.rows.find((r) => r.rawResourceNameText === name);
      expect(row).toBeDefined();
      expect(row!.sourceSection).toBe('MATERIAL');
      expect(row!.rawSourceCategoryName).toBe(category);
    }
    const iron = knowledge.rows.filter(
      (r) => r.rawSourceCategoryName === 'BAHAN BESI DAN ALUMINIUM',
    );
    expect(iron).toHaveLength(29);
    expect(iron.every((r) => r.sourceSection === 'MATERIAL')).toBe(true);
  });

  it('UPAH rows resolve to LABOR', () => {
    const upah = knowledge.rows.filter((r) => r.rawSourceCategoryName === 'UPAH');
    expect(upah).toHaveLength(17);
    expect(upah.every((r) => r.sourceSection === 'LABOR')).toBe(true);
    expect(upah.some((r) => r.rawResourceNameText === 'Kepala Tukang Batu')).toBe(true);
  });

  it('LAIN-LAIN is REFUSED, because "other" is not a resource family', () => {
    const other = knowledge.rows.filter(
      (r) => r.rawSourceCategoryName === 'LAIN-LAIN',
    );
    expect(other).toHaveLength(8);
    for (const row of other) {
      expect(row.sourceSection).toBeNull();
      expect(row.sourceSectionProvenance).toBeNull();
      expect(row.errors).toContain('SOURCE_CATEGORY_UNRECOGNIZED');
      // LAW 2.2 — refused, but never discarded.
      expect(row.rawSourceCategoryName).toBe('LAIN-LAIN');
      expect(row.rawSourceCategoryCode).toBe('G');
    }
    // Solar is a real LAIN-LAIN row; it is genuinely neither plainly a material
    // nor plainly equipment, which is exactly why SIMPROK will not choose.
    expect(other.some((r) => r.rawResourceNameText === 'Solar')).toBe(true);
  });

  it('every unit is present and every price is readable, matching the workbook’s own QA', () => {
    // README reports: satuan kosong = 0, harga berupa teks = 0.
    expect(knowledge.rows.filter((r) => r.rawUnitText === null)).toHaveLength(0);
    expect(knowledge.rows.filter((r) => r.errors.includes('UNIT_REQUIRED'))).toHaveLength(0);
    expect(
      knowledge.rows.filter((r) => r.proposedCanonicalPrice === null),
    ).toHaveLength(0);
  });

  it('preserves the source’s supporting evidence rather than only its price', () => {
    const air = knowledge.rows.find((r) => r.rawResourceNameText === 'Air')!;
    expect(air.rawUnitText).toBe('ltr');
    expect(air.proposedCanonicalPrice).toBe('212.00');
    // The preparer's unit candidate is EVIDENCE, never adopted as the unit.
    expect(air.rawSourceContext).toMatchObject({
      simprok_unit_candidate: 'ltr',
      unit_semantic: 'liter',
      harga_ikk_2024: '212',
      harga_dasar_source: '200',
      price_basis: 'IKK_FACTOR_1.06',
      source_year: '2024',
    });
  });
});

describeIf(WORKBOOK_B)('REAL Workbook B — Harga kota Ambon', () => {
  let bytes: Buffer;

  beforeAll(() => {
    bytes = readFileSync(WORKBOOK_B);

  // The real Ambon workbook is 942 rows and is parsed once per jurisdiction
  // here. Jest's default 5s hook timeout is enough on an idle machine and not
  // under a loaded CI runner. The budget is stated explicitly.
  }, 120_000);

  const readRegion = (label: string) =>
    adapter.parse(testEnvelope(bytes, 'Harga kota Ambon.xlsx'), {
      declaredSection: 'MATERIAL',
      selectedRegionLabel: label,
      selectedNameColumn: 2,
      selectedUnitColumn: 4,
    });

  it('reports the source artifact exactly as it is', () => {
    expect(statSync(WORKBOOK_B).size).toBe(bytes.length);
    expect(sha(bytes)).toMatch(/^[0-9A-F]{64}$/);
  });

  it('detects the three real jurisdictions without being told them', async () => {
    await expect(
      adapter.parse(testEnvelope(bytes, 'Harga kota Ambon.xlsx'), {
        declaredSection: 'MATERIAL',
        selectedNameColumn: 2,
        selectedUnitColumn: 4,
      }),
    ).rejects.toMatchObject({
      code: 'REGION_COLUMN_SELECTION_REQUIRED',
      details: expect.objectContaining({
        choices: ['SIRIMAU', 'TELUK AMBON', 'BAGUALA'],
      }),
    });
  });

  it.each([
    ['SIRIMAU', '398000.00'],
    ['TELUK AMBON', '344000.00'],
    ['BAGUALA', '314000.00'],
  ])('REGION ISOLATION: %s takes its own column and no other', async (label, expected) => {
    const knowledge = await readRegion(label);
    const row = knowledge.rows.find((r) => r.rawResourceNameText === 'Batu Belah');
    expect(row).toBeDefined();
    expect(row!.proposedCanonicalPrice).toBe(expected);
    expect(knowledge.regionScopeLabel).toBe(label);
  });

  it('ZERO cross-region leakage across the whole real file', async () => {
    const [sirimau, teluk, baguala] = await Promise.all([
      readRegion('SIRIMAU'),
      readRegion('TELUK AMBON'),
      readRegion('BAGUALA'),
    ]);
    const prices = (k: Awaited<ReturnType<typeof readRegion>>) =>
      k.rows.map((r) => `${r.sourceRowNumber}:${r.proposedCanonicalPrice}`);

    expect(prices(sirimau)).not.toEqual(prices(teluk));
    expect(prices(teluk)).not.toEqual(prices(baguala));
    expect(prices(baguala)).not.toEqual(prices(sirimau));
    // Sibling jurisdictions survive only as raw evidence, never as this
    // batch's price.
    const row = sirimau.rows.find((r) => r.rawResourceNameText === 'Batu Belah')!;
    expect(row.rawSourceContext).toMatchObject({
      'TELUK AMBON': '344000',
      BAGUALA: '314000',
    });
  });

  it('refuses to guess the real OCR damage in this file', async () => {
    const knowledge = await readRegion('TELUK AMBON');
    // "T73.000,00" and "T43.000,00" are OCR corruption of a price. SIMPROK
    // reads them as text, refuses to invent a number, and keeps the characters.
    const refused = knowledge.rows.filter(
      (r) => r.proposedCanonicalPrice === null && r.rawPriceTextValue !== null,
    );
    expect(refused.length).toBeGreaterThan(0);
    expect(
      refused.some((r) => (r.rawPriceTextValue ?? '').includes('T73.000')),
    ).toBe(true);
  });
});
