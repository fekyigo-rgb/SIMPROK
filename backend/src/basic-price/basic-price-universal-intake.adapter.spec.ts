import {
  BasicPriceUniversalIntakeAdapter,
  BASIC_PRICE_PARSER_CONTRACT_VERSION,
} from './basic-price-universal-intake.adapter';
import { buildBasicPriceXlsx } from '../../test/fixtures/basic-price-xlsx.fixture';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

/**
 * TEST X1 — NO XLSX REGRESSION.
 *
 * Every assertion below is the RM-02 suite's, unchanged. Only the call shape
 * moved: the sectioned workbook now reaches the Basic Price domain through the
 * Universal Smart Intake (envelope -> reader -> structure detector -> domain
 * adapter) instead of a bespoke XLSX parser. If the universal path read one
 * cell, one address, one rounding or one reason code differently from the
 * parser Owner already accepted, this file fails.
 */
describe('BasicPriceUniversalIntakeAdapter — sectioned XLSX (RM-02 regression)', () => {
  const adapter = new BasicPriceUniversalIntakeAdapter();

  it('parses section, identity, and price evidence for a clean row', async () => {
    const buffer = await buildBasicPriceXlsx();
    const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));

    expect(result.parserContractVersion).toBe(BASIC_PRICE_PARSER_CONTRACT_VERSION);
    expect(result.sheetName).toBe('HARGA SATUAN UPAH DAN BAHAN');
    expect(result.sourceSha256).toMatch(/^[0-9A-F]{64}$/);

    const row = result.rows.find((r) => r.sourceRowNumber === 9);
    expect(row).toMatchObject({
      sourceSection: 'LABOR',
      sourceCodeCellAddress: 'D9',
      sourceNameCellAddress: 'C9',
      sourceUnitCellAddress: 'E9',
      sourcePriceCellAddress: 'F9',
      rawResourceCodeText: 'L.01',
      rawResourceNameText: 'Pekerja',
      rawUnitText: 'Org/Hari',
      rawPriceNumericRoundTripString: '100000',
      proposedCanonicalPrice: '100000.00',
      canonicalRoundingMode: 'ROUND_HALF_UP',
      warnings: [],
      errors: [],
    });
  });

  it('retains the exact real-evidence long round-trip decimal string without ever rounding it', async () => {
    const buffer = await buildBasicPriceXlsx({ includeLongRoundTripDecimal: true });
    const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
    const row = result.rows.find((r) => r.sourceRowNumber === 9)!;

    expect(row.rawPriceNumericRoundTripString).toBe('158333.33333333334');
    expect(row.proposedCanonicalPrice).toBe('158333.33');
  });

  it('exact-tie ROUND_HALF_UP: 0.125 rounds up to 0.13, never down (mandatory per test matrix B06)', async () => {
    const buffer = await buildBasicPriceXlsx({ includeExactTieRounding: true });
    const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
    const row = result.rows.find((r) => r.sourceRowNumber === 10)!;

    expect(row.rawPriceNumericRoundTripString).toBe('0.125');
    expect(row.proposedCanonicalPrice).toBe('0.13');
  });

  it('a formula price cell with a numeric cached result is usable canonical evidence', async () => {
    const buffer = await buildBasicPriceXlsx({ includeFormulaCachedResult: true });
    const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
    const row = result.rows.find((r) => r.sourceRowNumber === 11)!;

    expect(row.rawPriceFormulaText).toBe('F9*1.5');
    expect(row.rawPriceCachedResultRoundTripString).toBe('150000');
    expect(row.rawPriceNumericRoundTripString).toBeNull();
    expect(row.proposedCanonicalPrice).toBe('150000.00');
    expect(row.errors).toEqual([]);
  });

  it('a formula error result (e.g. #REF!) on the KET column never blocks the price column of the same row', async () => {
    const buffer = await buildBasicPriceXlsx({ includeFormulaError: true });
    const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
    const row = result.rows.find((r) => r.sourceRowNumber === 9)!;
    // G (KET) is not part of BasicPriceImportRow's design and is never read.
    expect(row.errors).toEqual([]);
    expect(row.proposedCanonicalPrice).not.toBeNull();
  });

  it('missing unit AND missing price: row is preserved (never discarded), errors surface both gaps, no canonical price is fabricated', async () => {
    const buffer = await buildBasicPriceXlsx({ includeMissingUnit: true });
    const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
    const row = result.rows.find((r) => r.rawResourceNameText.startsWith('Kawat BRC'))!;

    expect(row).toBeDefined();
    expect(row.rawUnitText).toBeNull();
    expect(row.proposedCanonicalPrice).toBeNull();
    expect(row.errors).toEqual(expect.arrayContaining(['UNIT_REQUIRED', 'PRICE_CELL_EMPTY']));
  });

  it('missing price only: row is preserved with PRICE_CELL_EMPTY, unit is still captured', async () => {
    const buffer = await buildBasicPriceXlsx({ includeMissingPrice: true });
    const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
    const row = result.rows.find((r) => r.rawResourceNameText.startsWith('Balok kayu'))!;

    expect(row.rawUnitText).toBe('M3');
    expect(row.proposedCanonicalPrice).toBeNull();
    expect(row.errors).toEqual(['PRICE_CELL_EMPTY']);
  });

  /**
   * ZERO IS A PRICE. UNREADABLE IS NOT ZERO.
   *
   * This is the ONE place in SIMPROK where a source cell becomes a number:
   * `proposedCanonicalPrice` is derived here and nowhere else, and everything
   * downstream carries the resulting decimal STRING verbatim — the price
   * resolution kernel sets `adaptedPriceValue = selectedPrice.value` with
   * factor 1, and the occurrence orchestrator writes null when a resource is
   * unresolved. So if a blank cell can never become 0 here, it can never
   * become 0 anywhere.
   *
   * The Cost Kernel deliberately accepts an explicit 0 as a known price. That
   * law is only safe while THIS boundary refuses to manufacture one, which is
   * exactly what these cases pin. Blank is already covered above
   * (PRICE_CELL_EMPTY, twice); what follows covers the rest of the shapes a
   * real workbook produces.
   */
  describe('a price of zero and a price that cannot be read are different facts', () => {
    it('an explicitly stated 0 IS a price, and is carried as 0.00 with its rounding provenance', async () => {
      const buffer = await buildBasicPriceXlsx({ includeZeroPrice: true });
      const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
      const row = result.rows.find((r) =>
        r.rawResourceNameText.startsWith('Alat Bantu'),
      )!;

      expect(row.rawPriceNumericRoundTripString).toBe('0');
      expect(row.proposedCanonicalPrice).toBe('0.00');
      expect(row.canonicalRoundingMode).toBe('ROUND_HALF_UP');
      // A stated zero is not an error. The row is admissible.
      expect(row.errors).toEqual([]);
    });

    it('text where a number belongs is NOT zero — no canonical price is produced', async () => {
      const buffer = await buildBasicPriceXlsx({ includeTextPrice: true });
      const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
      const row = result.rows.find((r) =>
        r.rawResourceNameText.startsWith('Pasir'),
      )!;

      expect(row.proposedCanonicalPrice).toBeNull();
      expect(row.canonicalRoundingMode).toBeNull();
      expect(row.errors).toEqual(['PRICE_CELL_IS_TEXT_NOT_NUMBER']);
      // The unreadable text survives as evidence a human can inspect — it is
      // preserved, not silently swallowed and not converted.
      expect(row.rawPriceTextValue).toBe('Rp. -');
    });

    it('a formula whose result was never cached is NOT zero — SIMPROK does not evaluate spreadsheets', async () => {
      const buffer = await buildBasicPriceXlsx({
        includeFormulaWithoutCachedResult: true,
      });
      const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
      const row = result.rows.find((r) =>
        r.rawResourceNameText.startsWith('Semen'),
      )!;

      expect(row.proposedCanonicalPrice).toBeNull();
      expect(row.canonicalRoundingMode).toBeNull();
      expect(row.errors).toEqual(['FORMULA_NO_CACHED_RESULT']);
      // The formula text is kept, so the gap is explainable rather than blank.
      expect(row.rawPriceFormulaText).toBe('F33*2');
    });

    it('NO unreadable shape anywhere in one workbook ever yields a canonical price', async () => {
      const buffer = await buildBasicPriceXlsx({
        includeZeroPrice: true,
        includeTextPrice: true,
        includeFormulaWithoutCachedResult: true,
        includeMissingPrice: true,
        includeMissingUnit: true,
      });
      const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));

      const unreadable = result.rows.filter((r) =>
        r.errors.some((error) =>
          [
            'PRICE_CELL_EMPTY',
            'PRICE_CELL_IS_TEXT_NOT_NUMBER',
            'FORMULA_NO_CACHED_RESULT',
          ].includes(error),
        ),
      );
      // The matrix must actually be exercised — an empty filter would pass
      // this assertion vacuously.
      expect(unreadable.length).toBe(4);
      for (const row of unreadable) {
        expect(row.proposedCanonicalPrice).toBeNull();
      }

      // …while the one row that really does state zero still states it.
      const zero = result.rows.find((r) =>
        r.rawResourceNameText.startsWith('Alat Bantu'),
      )!;
      expect(zero.proposedCanonicalPrice).toBe('0.00');
    });
  });

  it('resolves a formula cell (external-reference-shaped) name/unit via cached result text, never [object Object]', async () => {
    const buffer = await buildBasicPriceXlsx();
    const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
    const row = result.rows.find((r) => r.sourceRowNumber === 33)!;

    expect(row.rawResourceNameText).toBe('Kawat jaring');
    expect(row.rawUnitText).toBe('Lbr');
    expect(row.rawResourceNameText).not.toContain('object Object');
  });

  it('classifies each of the three sections correctly by their real section-title markers', async () => {
    const buffer = await buildBasicPriceXlsx();
    const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));

    expect(result.rows.find((r) => r.sourceRowNumber === 9)?.sourceSection).toBe('LABOR');
    expect(result.rows.find((r) => r.sourceRowNumber === 33)?.sourceSection).toBe('MATERIAL');
    expect(result.rows.find((r) => r.sourceRowNumber === 316)?.sourceSection).toBe('EQUIPMENT');
  });

  it('never emits a row for a section-title, column-header, or nameless trailing-summary row', async () => {
    const buffer = await buildBasicPriceXlsx();
    const result = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));

    expect(result.rows.some((r) => r.sourceRowNumber === 5)).toBe(false); // "DAFTAR HARGA SATUAN UPAH" title
    expect(result.rows.some((r) => r.sourceRowNumber === 7)).toBe(false); // "NO" column header
    expect(result.rows.some((r) => r.sourceRowNumber === 28)).toBe(false); // material section title
    expect(result.rows.some((r) => r.sourceRowNumber === 331)).toBe(false); // trailing summary cell, no name
  });

  it('flags an ambiguous/missing sheet selection deterministically', async () => {
    const buffer = await buildBasicPriceXlsx();
    await expect(adapter.parse(testEnvelope(buffer, 'fixture.xlsx'), { selectedTable: 'NOT_A_REAL_SHEET' })).rejects.toThrow(
      'WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND',
    );
  });

  it('sourceSha256 is deterministic for identical bytes and changes for different content', async () => {
    // Two independent buildBasicPriceXlsx() calls are NOT "identical bytes"
    // by construction: ExcelJS stamps each generated workbook with
    // workbook.created/modified = new Date() at write time, so two
    // separately generated buffers legitimately differ byte-for-byte
    // whenever any wall-clock time elapses between the two calls (as
    // reliably happens under parallel test-suite load). The contract this
    // test actually owes is "hashing the exact same byte buffer twice
    // yields the same hash" — parse the one buffer twice for A/B.
    const buffer = await buildBasicPriceXlsx();
    const bufferC = await buildBasicPriceXlsx({ includeMissingUnit: true });

    const resultA = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
    const resultB = await adapter.parse(testEnvelope(buffer, 'fixture.xlsx'));
    const resultC = await adapter.parse(testEnvelope(bufferC, 'fixture.xlsx'));

    expect(resultA.sourceSha256).toBe(resultB.sourceSha256);
    expect(resultA.sourceSha256).not.toBe(resultC.sourceSha256);
  });
});
