import { INTAKE_ERRORS } from '../universal-intake/intake-errors';
import {
  BasicPriceUniversalIntakeAdapter,
  BASIC_PRICE_REGIONAL_MATRIX_CONTRACT_VERSION,
  BASIC_PRICE_SEMANTIC_HEADER_CONTRACT_VERSION,
  SECTION_DECLARED_BY_UPLOADER_REASON,
} from './basic-price-universal-intake.adapter';
import {
  REGION_COLUMN_LABELS,
  buildAdversarialCsv,
  buildBasicPriceCsv,
  buildFlatRegionColumnCsv,
  buildNonPriceCsv,
  buildRegionalMatrixXlsx,
  buildSemanticHeaderXlsx,
} from '../../test/fixtures/usi01-source-shapes.fixture';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

const adapter = new BasicPriceUniversalIntakeAdapter();

describe('USI-01 Basic Price domain adapter', () => {
  describe('TEST X3 — the SIMPROK-READY workbook shape (Owner acceptance shape A)', () => {
    const parse = async (options = {}) =>
      adapter.parse(testEnvelope(await buildSemanticHeaderXlsx(options), 'ready.xlsx'), {
        declaredSection: 'MATERIAL',
      });

    it('one physical data row becomes exactly one Basic Price candidate', async () => {
      const knowledge = await parse();
      expect(knowledge.structure).toBe('SEMANTIC_HEADER_TABLE');
      expect(knowledge.parserContractVersion).toBe(
        BASIC_PRICE_SEMANTIC_HEADER_CONTRACT_VERSION,
      );
      expect(knowledge.totalSourceRows).toBe(4);
      expect(knowledge.rows).toHaveLength(4);
    });

    it('reads identity, unit and price from the roles the header proved', async () => {
      const knowledge = await parse();
      const row = knowledge.rows.find((r) => r.rawResourceNameText === 'Pasir Uji Struktur')!;
      expect(row).toMatchObject({
        sourceSection: 'MATERIAL',
        rawUnitText: 'M3',
        sourceNameCellAddress: 'A5',
        sourceUnitCellAddress: 'B5',
        sourcePriceCellAddress: 'D5',
        proposedCanonicalPrice: '398000.00',
        canonicalRoundingMode: 'ROUND_HALF_UP',
      });
    });

    it('rounds to canonical scale from the exact native value, never from a display string', async () => {
      const knowledge = await parse();
      const row = knowledge.rows.find((r) => r.rawResourceNameText === 'Besi Uji Struktur')!;
      expect(row.rawPriceNumericRoundTripString).toBe('17250.555');
      expect(row.proposedCanonicalPrice).toBe('17250.56');
    });

    it('LAW 2 — every column the domain has no field for survives verbatim', async () => {
      const knowledge = await parse();
      const row = knowledge.rows[0];
      // The preparer's SIMPROK-unit suggestion is a CLAIM, not the source's own
      // unit, so it is kept as evidence and never adopted as `rawUnitText`.
      expect(row.rawSourceContext).toEqual({
        simprok_unit_candidate: 'm3',
        sumber: 'Survei Uji',
        keterangan: 'baris bersih',
      });
      expect(row.rawUnitText).toBe('M3');
    });

    it('a section the SOURCE never declared is recorded as the uploader’s statement', async () => {
      const knowledge = await parse();
      expect(knowledge.sectionProvenance).toBe('UPLOADER_DECLARED');
      // Every row carries the flag, so no reader of a single row can mistake a
      // human's declaration for something the document said.
      for (const row of knowledge.rows) {
        expect(row.warnings).toContain(SECTION_DECLARED_BY_UPLOADER_REASON);
      }
    });

    it('refuses to invent a section when nobody declared one (§18)', async () => {
      await expect(
        adapter.parse(testEnvelope(await buildSemanticHeaderXlsx(), 'ready.xlsx')),
      ).rejects.toMatchObject({ code: INTAKE_ERRORS.SECTION_DECLARATION_REQUIRED });
    });

    it('TEST X5 — an XLSX text price cell stays raw evidence, never a number', async () => {
      const knowledge = await parse({ includeTextPriceRow: true });
      const row = knowledge.rows.find((r) => r.rawResourceNameText === 'Kayu Uji Struktur')!;
      expect(row.proposedCanonicalPrice).toBeNull();
      expect(row.rawPriceTextValue).toBe('Rp. -');
      expect(row.errors).toContain('PRICE_CELL_IS_TEXT_NOT_NUMBER');
    });

    it('TEST X2 — a workbook of several sheets needs no sheet name when one table is proven', async () => {
      const knowledge = await adapter.parse(
        testEnvelope(
          await buildSemanticHeaderXlsx({
            extraEmptySheetNames: ['Catatan', 'Lampiran'],
          }),
          'ready.xlsx',
        ),
        { declaredSection: 'MATERIAL' },
      );
      // Never a first-sheet fallback: the sheet was chosen because it PROVED a
      // price table, and the other two proved nothing.
      expect(knowledge.rows).toHaveLength(4);
    });

    it('two proven tables ask a human ONCE, and name the choice', async () => {
      const envelope = testEnvelope(
        await buildSemanticHeaderXlsx({ includeSecondPriceSheet: true }),
        'ready.xlsx',
      );
      await expect(adapter.parse(envelope, { declaredSection: 'MATERIAL' })).rejects.toMatchObject(
        { code: INTAKE_ERRORS.SOURCE_TABLE_AMBIGUOUS },
      );
      // And once answered, it proceeds without further questions.
      const knowledge = await adapter.parse(envelope, {
        declaredSection: 'MATERIAL',
        selectedTable: 'Lembar Kedua',
      });
      expect(knowledge.rows.map((r) => r.rawResourceNameText)).toEqual([
        'Kerikil Uji Struktur',
        'Sirtu Uji Struktur',
      ]);
    });
  });

  describe('TEST X4 / R1-R4 — the regional matrix (Owner acceptance shape B)', () => {
    // ONE buffer, reused. ExcelJS stamps every generated workbook with its own
    // creation time, so calling the builder twice yields two byte-different
    // files — and "the same artifact scoped to two regions" is precisely the
    // claim these tests exist to make.
    let matrixBytes: Buffer;
    beforeAll(async () => {
      matrixBytes = await buildRegionalMatrixXlsx();
    });

    const parseRegion = async (label: string) =>
      adapter.parse(testEnvelope(matrixBytes, 'ambon.xlsx'), {
        declaredSection: 'MATERIAL',
        selectedRegionLabel: label,
      });

    it('refuses to produce one geography-less price, and names the jurisdictions', async () => {
      // "Batu Belah | M3 | 398000 | 344000 | 314000" must NEVER collapse into a
      // single price with no place attached (§8).
      await expect(
        adapter.parse(testEnvelope(matrixBytes, 'ambon.xlsx'), {
          declaredSection: 'MATERIAL',
        }),
      ).rejects.toMatchObject({
        code: INTAKE_ERRORS.REGION_COLUMN_SELECTION_REQUIRED,
        details: expect.objectContaining({ choices: [...REGION_COLUMN_LABELS] }),
      });
    });

    it.each([
      ['SIRIMAU', '398000.00', 'C4'],
      ['TELUK AMBON', '344000.00', 'D4'],
      ['BAGUALA', '314000.00', 'E4'],
    ])(
      'TESTS R1-R3: %s takes its OWN column and no other',
      async (label, expectedPrice, expectedAddress) => {
        const knowledge = await parseRegion(label);
        const row = knowledge.rows.find((r) => r.rawResourceNameText === 'Batu Belah Uji')!;
        expect(row.proposedCanonicalPrice).toBe(expectedPrice);
        expect(row.sourcePriceCellAddress).toBe(expectedAddress);
        expect(knowledge.regionScopeLabel).toBe(label);
        expect(knowledge.parserContractVersion).toBe(
          BASIC_PRICE_REGIONAL_MATRIX_CONTRACT_VERSION,
        );
      },
    );

    it('R1-R3 stated as isolation: no two jurisdictions ever share a price', async () => {
      const [sirimau, teluk, baguala] = await Promise.all(
        REGION_COLUMN_LABELS.map((label) => parseRegion(label)),
      );
      const priceOf = (knowledge: Awaited<ReturnType<typeof parseRegion>>) =>
        knowledge.rows.map((r) => r.proposedCanonicalPrice);

      expect(priceOf(sirimau)).toEqual(['398000.00', '285000.00', '133800.00']);
      expect(priceOf(teluk)).toEqual(['344000.00', '262500.00', '128000.00']);
      expect(priceOf(baguala)).toEqual(['314000.00', '240000.00', '121500.00']);
      expect(priceOf(sirimau)).not.toEqual(priceOf(teluk));
      expect(priceOf(teluk)).not.toEqual(priceOf(baguala));
      expect(priceOf(baguala)).not.toEqual(priceOf(sirimau));
    });

    it('TEST R4: one artifact supports several regions WITHOUT duplicating a fact', async () => {
      const sirimau = await parseRegion('SIRIMAU');
      const baguala = await parseRegion('BAGUALA');

      // Same bytes — the source is one artifact and says so.
      expect(sirimau.sourceSha256).toBe(baguala.sourceSha256);
      // Different readings — each is scoped, and each says which column it read.
      expect(sirimau.regionScopeLabel).not.toBe(baguala.regionScopeLabel);
      // And no reading pretends to hold the others' prices.
      expect(sirimau.rows[0].proposedCanonicalPrice).not.toBe(
        baguala.rows[0].proposedCanonicalPrice,
      );
    });

    it('LAW 2: the jurisdictions NOT taken survive as raw evidence, never as prices', async () => {
      const knowledge = await parseRegion('SIRIMAU');
      const row = knowledge.rows[0];
      expect(row.rawSourceContext).toEqual({
        'TELUK AMBON': '344000',
        BAGUALA: '314000',
      });
      // Retained under the source's own headers, in a context blob nothing
      // computes from — the price for this batch is Sirimau's and only Sirimau's.
      expect(row.proposedCanonicalPrice).toBe('398000.00');
    });

    it('a resource priced in one jurisdiction only does not inherit a price elsewhere', async () => {
      const envelope = testEnvelope(
        await buildRegionalMatrixXlsx({ includePartiallyPricedRow: true }),
        'ambon.xlsx',
      );
      const sirimau = await adapter.parse(envelope, {
        declaredSection: 'MATERIAL',
        selectedRegionLabel: 'SIRIMAU',
      });
      const baguala = await adapter.parse(envelope, {
        declaredSection: 'MATERIAL',
        selectedRegionLabel: 'BAGUALA',
      });

      const named = (k: typeof sirimau) =>
        k.rows.find((r) => r.rawResourceNameText === 'Kerikil Uji Sebagian')!;
      expect(named(sirimau).proposedCanonicalPrice).toBe('410000.00');
      expect(named(baguala).proposedCanonicalPrice).toBeNull();
      expect(named(baguala).errors).toContain('PRICE_CELL_EMPTY');
    });

    it('an unknown jurisdiction label is refused with the real choices', async () => {
      await expect(parseRegion('AMBON RAYA')).rejects.toMatchObject({
        code: INTAKE_ERRORS.REGION_COLUMN_NOT_FOUND,
        details: expect.objectContaining({ choices: [...REGION_COLUMN_LABELS] }),
      });
    });
  });

  describe('CSV candidates', () => {
    const parseCsv = async (bytes: Buffer, selection = {}) =>
      adapter.parse(testEnvelope(bytes, 'harga.csv'), {
        declaredSection: 'MATERIAL',
        ...selection,
      });

    it('TEST C1: a clean Basic Price CSV becomes candidates', async () => {
      const knowledge = await parseCsv(buildBasicPriceCsv());
      expect(knowledge.locatorDialect).toBe('CSV_RC');
      expect(knowledge.rows).toHaveLength(3);
      expect(knowledge.rows[0]).toMatchObject({
        rawResourceNameText: 'Pasir Uji CSV',
        rawUnitText: 'M3',
        proposedCanonicalPrice: '398000.00',
      });
    });

    it('TEST C6: a CSV row NEVER receives a fabricated Excel cell address or cell type', async () => {
      const knowledge = await parseCsv(buildBasicPriceCsv());
      for (const row of knowledge.rows) {
        for (const address of [
          row.sourceNameCellAddress,
          row.sourceUnitCellAddress,
          row.sourcePriceCellAddress,
        ]) {
          expect(address).toMatch(/^R\d+C\d+$/);
          expect(address).not.toMatch(/^[A-Z]+\d+$/);
        }
        // No spreadsheet ever ran, so every spreadsheet-only field is null.
        expect(row.rawPriceCellType).toBeNull();
        expect(row.rawPriceNumberFormat).toBeNull();
        expect(row.rawPriceFormulaText).toBeNull();
        expect(row.rawPriceCachedResultRoundTripString).toBeNull();
      }
    });

    it('a source with no code column says so, rather than inventing a coordinate', async () => {
      const knowledge = await parseCsv(buildBasicPriceCsv());
      expect(knowledge.rows[0].sourceCodeCellAddress).toBe('NO_SOURCE_COLUMN');
      expect(knowledge.rows[0].rawResourceCodeText).toBeNull();
      expect(knowledge.rows[0].warnings).toContain('RESOURCE_CODE_MISSING');
    });

    describe('the adversarial CSV', () => {
      const adversarial = () => parseCsv(buildAdversarialCsv());
      const rowNamed = (rows: Array<{ rawResourceNameText: string }>, name: string) =>
        rows.find((r) => r.rawResourceNameText === name)!;

      it('TEST C2/C3: quoted commas and non-ASCII names arrive intact', async () => {
        const { rows } = await adversarial();
        expect(rowNamed(rows, 'Batu Belah, Nomor 2')).toBeDefined();
        expect(rowNamed(rows, 'Semen Grésik Ünicode')).toBeDefined();
      });

      it('reads both numeric locales when the string proves which one it is', async () => {
        const { rows } = await adversarial();
        expect(rowNamed(rows, 'Besi Beton Uji')).toMatchObject({
          rawPriceTextValue: '17.250,55',
          proposedCanonicalPrice: '17250.55',
        });
        expect(rowNamed(rows, 'Kayu Balok Uji')).toMatchObject({
          rawPriceTextValue: '1,250.50',
          proposedCanonicalPrice: '1250.50',
        });
      });

      it('records HOW a locale was read, so a reviewer can audit the reading', async () => {
        const { rows } = await adversarial();
        expect(rowNamed(rows, 'Besi Beton Uji').warnings).toEqual(
          expect.arrayContaining([
            'PRICE_TEXT_DECIMAL_SEPARATOR_COMMA',
            'PRICE_TEXT_GROUPING_SEPARATOR_DOT',
          ]),
        );
      });

      it('TEST C5: an ambiguous numeric locale is NOT silently converted', async () => {
        const { rows } = await adversarial();
        const ambiguous = rowNamed(rows, 'Cat Tembok Uji');
        expect(ambiguous.proposedCanonicalPrice).toBeNull();
        expect(ambiguous.errors).toContain('PRICE_TEXT_NUMERIC_LOCALE_AMBIGUOUS');
        // TEST C4/I5 — and the source's own characters are still there.
        expect(ambiguous.rawPriceTextValue).toBe('125.000');
      });

      it('§13: a currency-annotated price stays evidence, and is never defaulted to IDR', async () => {
        const { rows } = await adversarial();
        const currency = rowNamed(rows, 'Paku Uji');
        expect(currency.proposedCanonicalPrice).toBeNull();
        expect(currency.errors).toContain('PRICE_TEXT_NOT_NUMERIC');
        expect(currency.rawPriceTextValue).toBe('Rp 21500');
      });

      it('TEST I3: a missing unit stays unresolved, and never blocks its healthy siblings', async () => {
        const { rows } = await adversarial();
        expect(rowNamed(rows, 'Upah Uji Tanpa Satuan')).toMatchObject({
          rawUnitText: null,
          errors: expect.arrayContaining(['UNIT_REQUIRED']),
        });
        // §15 — one bad row does not cancel the rest.
        expect(rows).toHaveLength(7);
        expect(rows.filter((r) => r.proposedCanonicalPrice !== null)).toHaveLength(5);
      });

      it('reads a semicolon-delimited file exactly as it reads a comma-delimited one', async () => {
        const semicolon = await parseCsv(buildAdversarialCsv({ semicolonDelimited: true }));
        const comma = await adversarial();
        expect(semicolon.rows.map((r) => r.rawResourceNameText)).toEqual(
          comma.rows.map((r) => r.rawResourceNameText),
        );
      });
    });

    it('§5 flat table with a Region column: only the chosen jurisdiction’s rows are taken', async () => {
      const sirimau = await parseCsv(buildFlatRegionColumnCsv(), {
        selectedRegionLabel: 'SIRIMAU',
      });
      const baguala = await parseCsv(buildFlatRegionColumnCsv(), {
        selectedRegionLabel: 'BAGUALA',
      });

      expect(sirimau.rows.map((r) => r.proposedCanonicalPrice)).toEqual([
        '398000.00',
        '285000.00',
      ]);
      // Out-of-scope rows are simply not part of THIS batch — not rejected, not
      // merged, and still available to a batch that scopes to them.
      expect(baguala.rows.map((r) => r.proposedCanonicalPrice)).toEqual(['262500.00']);
      expect(sirimau.totalSourceRows).toBe(4);
    });

    it('readable text that is not a price table is refused precisely (§17)', async () => {
      await expect(parseCsv(buildNonPriceCsv())).rejects.toMatchObject({
        code: INTAKE_ERRORS.NO_PRICE_TABLE_DETECTED,
        details: expect.objectContaining({
          rejections: expect.any(Object),
        }),
      });
    });
  });
});

describe('USI-01 — a spreadsheet reading never claims a text interpretation', () => {
  it('an XLSX numeric price carries no separator-provenance warning', async () => {
    // "17250.555" read from a workbook's own binary number was never parsed
    // from text, so SIMPROK must not report having chosen a decimal separator
    // for it. Only a delimited source's text price earns that warning.
    const knowledge = await adapter.parse(
      testEnvelope(await buildSemanticHeaderXlsx(), 'ready.xlsx'),
      { declaredSection: 'MATERIAL' },
    );
    const row = knowledge.rows.find((r) => r.rawResourceNameText === 'Besi Uji Struktur')!;
    expect(row.warnings.filter((w) => w.startsWith('PRICE_TEXT_'))).toEqual([]);
    expect(row.rawPriceNumericRoundTripString).toBe('17250.555');
  });
});
