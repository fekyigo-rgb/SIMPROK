import {
  BasicPriceXlsxIntakeAdapter,
  BASIC_PRICE_PARSER_CONTRACT_VERSION,
} from './basic-price-xlsx-intake.adapter';
import { buildBasicPriceXlsx } from '../../test/fixtures/basic-price-xlsx.fixture';

describe('BasicPriceXlsxIntakeAdapter', () => {
  const adapter = new BasicPriceXlsxIntakeAdapter();

  it('parses section, identity, and price evidence for a clean row', async () => {
    const buffer = await buildBasicPriceXlsx();
    const result = await adapter.parse(buffer, 'fixture.xlsx');

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
    const result = await adapter.parse(buffer, 'fixture.xlsx');
    const row = result.rows.find((r) => r.sourceRowNumber === 9)!;

    expect(row.rawPriceNumericRoundTripString).toBe('158333.33333333334');
    expect(row.proposedCanonicalPrice).toBe('158333.33');
  });

  it('exact-tie ROUND_HALF_UP: 0.125 rounds up to 0.13, never down (mandatory per test matrix B06)', async () => {
    const buffer = await buildBasicPriceXlsx({ includeExactTieRounding: true });
    const result = await adapter.parse(buffer, 'fixture.xlsx');
    const row = result.rows.find((r) => r.sourceRowNumber === 10)!;

    expect(row.rawPriceNumericRoundTripString).toBe('0.125');
    expect(row.proposedCanonicalPrice).toBe('0.13');
  });

  it('a formula price cell with a numeric cached result is usable canonical evidence', async () => {
    const buffer = await buildBasicPriceXlsx({ includeFormulaCachedResult: true });
    const result = await adapter.parse(buffer, 'fixture.xlsx');
    const row = result.rows.find((r) => r.sourceRowNumber === 11)!;

    expect(row.rawPriceFormulaText).toBe('F9*1.5');
    expect(row.rawPriceCachedResultRoundTripString).toBe('150000');
    expect(row.rawPriceNumericRoundTripString).toBeNull();
    expect(row.proposedCanonicalPrice).toBe('150000.00');
    expect(row.errors).toEqual([]);
  });

  it('a formula error result (e.g. #REF!) on the KET column never blocks the price column of the same row', async () => {
    const buffer = await buildBasicPriceXlsx({ includeFormulaError: true });
    const result = await adapter.parse(buffer, 'fixture.xlsx');
    const row = result.rows.find((r) => r.sourceRowNumber === 9)!;
    // G (KET) is not part of BasicPriceImportRow's design and is never read.
    expect(row.errors).toEqual([]);
    expect(row.proposedCanonicalPrice).not.toBeNull();
  });

  it('missing unit AND missing price: row is preserved (never discarded), errors surface both gaps, no canonical price is fabricated', async () => {
    const buffer = await buildBasicPriceXlsx({ includeMissingUnit: true });
    const result = await adapter.parse(buffer, 'fixture.xlsx');
    const row = result.rows.find((r) => r.rawResourceNameText.startsWith('Kawat BRC'))!;

    expect(row).toBeDefined();
    expect(row.rawUnitText).toBeNull();
    expect(row.proposedCanonicalPrice).toBeNull();
    expect(row.errors).toEqual(expect.arrayContaining(['UNIT_REQUIRED', 'PRICE_CELL_EMPTY']));
  });

  it('missing price only: row is preserved with PRICE_CELL_EMPTY, unit is still captured', async () => {
    const buffer = await buildBasicPriceXlsx({ includeMissingPrice: true });
    const result = await adapter.parse(buffer, 'fixture.xlsx');
    const row = result.rows.find((r) => r.rawResourceNameText.startsWith('Balok kayu'))!;

    expect(row.rawUnitText).toBe('M3');
    expect(row.proposedCanonicalPrice).toBeNull();
    expect(row.errors).toEqual(['PRICE_CELL_EMPTY']);
  });

  it('resolves a formula cell (external-reference-shaped) name/unit via cached result text, never [object Object]', async () => {
    const buffer = await buildBasicPriceXlsx();
    const result = await adapter.parse(buffer, 'fixture.xlsx');
    const row = result.rows.find((r) => r.sourceRowNumber === 33)!;

    expect(row.rawResourceNameText).toBe('Kawat jaring');
    expect(row.rawUnitText).toBe('Lbr');
    expect(row.rawResourceNameText).not.toContain('object Object');
  });

  it('classifies each of the three sections correctly by their real section-title markers', async () => {
    const buffer = await buildBasicPriceXlsx();
    const result = await adapter.parse(buffer, 'fixture.xlsx');

    expect(result.rows.find((r) => r.sourceRowNumber === 9)?.sourceSection).toBe('LABOR');
    expect(result.rows.find((r) => r.sourceRowNumber === 33)?.sourceSection).toBe('MATERIAL');
    expect(result.rows.find((r) => r.sourceRowNumber === 316)?.sourceSection).toBe('EQUIPMENT');
  });

  it('never emits a row for a section-title, column-header, or nameless trailing-summary row', async () => {
    const buffer = await buildBasicPriceXlsx();
    const result = await adapter.parse(buffer, 'fixture.xlsx');

    expect(result.rows.some((r) => r.sourceRowNumber === 5)).toBe(false); // "DAFTAR HARGA SATUAN UPAH" title
    expect(result.rows.some((r) => r.sourceRowNumber === 7)).toBe(false); // "NO" column header
    expect(result.rows.some((r) => r.sourceRowNumber === 28)).toBe(false); // material section title
    expect(result.rows.some((r) => r.sourceRowNumber === 331)).toBe(false); // trailing summary cell, no name
  });

  it('flags an ambiguous/missing sheet selection deterministically', async () => {
    const buffer = await buildBasicPriceXlsx();
    await expect(adapter.parse(buffer, 'fixture.xlsx', 'NOT_A_REAL_SHEET')).rejects.toThrow(
      'WORKBOOK_SHEET_AMBIGUOUS_OR_NOT_FOUND',
    );
  });

  it('sourceSha256 is deterministic for identical bytes and changes for different content', async () => {
    const bufferA = await buildBasicPriceXlsx();
    const bufferB = await buildBasicPriceXlsx();
    const bufferC = await buildBasicPriceXlsx({ includeMissingUnit: true });

    const resultA = await adapter.parse(bufferA, 'fixture.xlsx');
    const resultB = await adapter.parse(bufferB, 'fixture.xlsx');
    const resultC = await adapter.parse(bufferC, 'fixture.xlsx');

    expect(resultA.sourceSha256).toBe(resultB.sourceSha256);
    expect(resultA.sourceSha256).not.toBe(resultC.sourceSha256);
  });
});
