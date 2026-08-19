import JSZip from 'jszip';
import {
  BasicPriceUniversalIntakeAdapter,
  PRICE_NORMALIZED_FROM_TEXT_REASON,
} from './basic-price-universal-intake.adapter';
import { SPREADSHEET_VALUE_TYPE } from '../universal-intake/readers/xlsx.reader';
import {
  PRICE_LITERAL_REASONS,
  interpretPriceLiteral,
} from '../universal-intake/structure/price-literal';
import {
  REGIONAL_TEXT_COLUMNS,
  REGIONAL_TEXT_REGIONS,
  REGIONAL_TEXT_ROWS,
  TEXT_PRICE_CASES,
  TEXT_PRICE_COLUMN,
  buildRegionalTextPriceXlsx,
  buildTextPriceXlsx,
  rowNumberOfCase,
} from '../../test/fixtures/usi01r3b-text-price.fixture';
import { buildAdversarialCsv } from '../../test/fixtures/usi01-source-shapes.fixture';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

/**
 * USI-01R3B §4–§14 — NORMALIZATION IS NOT CORRECTION.
 *
 * This is the whole seam, in one sentence: SIMPROK may change a price's
 * REPRESENTATION, never its MEANING.
 *
 *   "153.000,00" -> 153000.00   is NORMALIZATION. The quantity is identical;
 *                               only the notation moved. Automatic.
 *   "T73.000,00" -> 173000.00   would be CORRECTION. It guesses what the
 *                               document was supposed to say. Never automatic.
 *
 * USI-01R3A refused BOTH, purely because Excel had stored the cell as text —
 * which made SIMPROK demand that humans retype numbers it could already read
 * perfectly. That is uncertainty SIMPROK manufactured rather than reduced.
 *
 * Nothing here grants trust. A normalized price is still an unresolved,
 * unsubmitted candidate; the marker says only "SIMPROK read this out of text".
 */
describe('USI-01R3B — safe text-price normalization', () => {
  const adapter = new BasicPriceUniversalIntakeAdapter();
  let knowledge: Awaited<ReturnType<typeof adapter.parse>>;
  let bytes: Buffer;

  beforeAll(async () => {
    bytes = await buildTextPriceXlsx();
    knowledge = await adapter.parse(testEnvelope(bytes, 'text-price.xlsx'), {
      declaredSection: 'MATERIAL',
    });
  }, 60_000);

  const rowFor = (name: string) => {
    const row = knowledge.rows.find((r) => r.rawResourceNameText === name);
    expect(row).toBeDefined();
    return row!;
  };

  it('every case in the fixture reaches its stated verdict, and none is skipped', () => {
    // THE MATRIX AS A WHOLE. Each row below has its own named test, but this is
    // the assertion that fails if a case silently stops being exercised.
    expect(knowledge.rows).toHaveLength(TEXT_PRICE_CASES.length);
    for (const testCase of TEXT_PRICE_CASES) {
      expect(rowFor(testCase.name).proposedCanonicalPrice).toBe(
        testCase.expectedCanonicalPrice,
      );
    }
  });

  it('TXT-01: a native NUMBER cell is unchanged, and carries no text provenance', () => {
    const row = rowFor('Native Number Uji');
    expect(row.rawPriceCellType).toBe(SPREADSHEET_VALUE_TYPE.NUMBER);
    expect(row.proposedCanonicalPrice).toBe('250000.00');
    expect(row.canonicalRoundingMode).toBe('ROUND_HALF_UP');
    // A workbook number was never interpreted from text, so claiming it was
    // would describe a decision that never happened.
    expect(row.warnings).not.toContain(PRICE_NORMALIZED_FROM_TEXT_REASON);
    expect(row.rawPriceNumericRoundTripString).toBe('250000');
    expect(row.errors).toEqual([]);
  });

  it('TXT-12: native numeric rounding is bit-for-bit the RM-02 behaviour', () => {
    const row = rowFor('Native Rounding Uji');
    // 17250.555 -> 17250.56 under HALF_UP at two places, read from the
    // workbook's own binary number and never from its display text.
    expect(row.rawPriceNumericRoundTripString).toBe('17250.555');
    expect(row.proposedCanonicalPrice).toBe('17250.56');
    expect(row.warnings).not.toContain(PRICE_NORMALIZED_FROM_TEXT_REASON);
  });

  it('TXT-02: a STRING price with ONE numeric meaning normalizes', () => {
    const row = rowFor('Teks Deterministik Uji');
    expect(row.rawPriceCellType).toBe(SPREADSHEET_VALUE_TYPE.STRING);
    expect(row.proposedCanonicalPrice).toBe('153000.00');
    expect(row.canonicalRoundingMode).toBe('ROUND_HALF_UP');
    // RAW SOURCE TRUTH SURVIVES (§10) — the derived number sits BESIDE the
    // source's own characters, and replaces nothing.
    expect(row.rawPriceTextValue).toBe('153.000,00');
    expect(row.rawPriceDisplayText).toBe('153.000,00');
    // PROVENANCE, and it is not an error: nothing went wrong here.
    expect(row.warnings).toContain(PRICE_NORMALIZED_FROM_TEXT_REASON);
    expect(row.errors).not.toContain('PRICE_CELL_IS_TEXT_NOT_NUMBER');
    expect(row.errors).toEqual([]);
    // The separator roles the literal PROVED, in the vocabulary the delimited
    // sources already use — so a reviewer can audit the reading itself.
    expect(row.warnings).toContain('PRICE_TEXT_DECIMAL_SEPARATOR_COMMA');
    expect(row.warnings).toContain('PRICE_TEXT_GROUPING_SEPARATOR_DOT');
  });

  it('TXT-03: RICH_TEXT is still text — same number, and the shape stays truthful', () => {
    const row = rowFor('Rich Text Deterministik Uji');
    // THE CELL DOES NOT LIE ABOUT ITSELF. A normalized price must never
    // masquerade as a native numeric cell (§11).
    expect(row.rawPriceCellType).toBe(SPREADSHEET_VALUE_TYPE.RICH_TEXT);
    expect(row.rawPriceNumericRoundTripString).toBeNull();
    expect(row.proposedCanonicalPrice).toBe('153000.00');
    expect(row.rawPriceTextValue).toBe('153.000,00');
    expect(row.warnings).toContain(PRICE_NORMALIZED_FROM_TEXT_REASON);
    expect(row.errors).not.toContain('PRICE_CELL_IS_RICH_TEXT');

    // Identical to the STRING reading of the identical literal: the LITERAL
    // decides, not the storage shape.
    expect(row.proposedCanonicalPrice).toBe(
      rowFor('Teks Deterministik Uji').proposedCanonicalPrice,
    );
  });

  it('TXT-04: a price held in the workbook SHARED-STRING table normalizes identically', async () => {
    // WHAT THE FILE ACTUALLY CONTAINS, not what the enum is called. ExcelJS
    // writes every plain string into `xl/sharedStrings.xml` and emits `t="s"`,
    // then RESOLVES it back to ValueType.String when reading — so a shared
    // string is exactly what this fixture's text prices already are, and
    // ValueType.SharedString is not something this reader surfaces.
    const sheet = await JSZip.loadAsync(bytes).then((zip) =>
      zip.file('xl/worksheets/sheet1.xml')!.async('string'),
    );
    const rowNumber = rowNumberOfCase('Teks Deterministik Uji');
    const priceCell = new RegExp(`<c r="C${rowNumber}"[^>]*t="s"[^>]*>`).test(
      sheet,
    );
    expect(priceCell).toBe(true);
    const shared = await JSZip.loadAsync(bytes).then((zip) =>
      zip.file('xl/sharedStrings.xml')!.async('string'),
    );
    expect(shared).toContain('153.000,00');

    // ...and it normalized.
    expect(rowFor('Teks Deterministik Uji').proposedCanonicalPrice).toBe(
      '153000.00',
    );

    // The domain treats SHARED_STRING and STRING as one case, so no gap exists
    // if a future reader does surface the distinct type.
    expect(SPREADSHEET_VALUE_TYPE.SHARED_STRING).not.toBe(
      SPREADSHEET_VALUE_TYPE.STRING,
    );
  });

  it('TXT-05: a genuine decimal fraction keeps its fraction', () => {
    const row = rowFor('Teks Desimal Uji');
    expect(row.proposedCanonicalPrice).toBe('17250.50');
    expect(row.rawPriceTextValue).toBe('17.250,50');
    expect(row.warnings).toContain(PRICE_NORMALIZED_FROM_TEXT_REASON);
  });

  it('TXT-06: an UNDECIDABLE literal is refused, and says it was undecidable', () => {
    const row = rowFor('Teks Ambigu Uji');
    // "125.000" is 125000 in Jakarta and 125.0 in New York, and the string
    // carries no evidence for either. SIMPROK does not pick.
    expect(row.proposedCanonicalPrice).toBeNull();
    expect(row.canonicalRoundingMode).toBeNull();
    expect(row.rawPriceTextValue).toBe('125.000');
    expect(row.warnings).not.toContain(PRICE_NORMALIZED_FROM_TEXT_REASON);
    // AMBIGUITY IS RETAINED AS A DISTINCT FACT (§16). "This is not a number"
    // and "this is a number nobody can pin down" call for different human
    // actions, and must be countable apart.
    expect(row.errors).toContain(
      PRICE_LITERAL_REASONS.SEPARATOR_ROLE_AMBIGUOUS,
    );
    expect(row.errors).toContain('PRICE_CELL_IS_TEXT_NOT_NUMBER');
  });

  // TXT-07 / TXT-08 / TXT-09 — the OCR-damaged literals, one test each, because
  // each is a different temptation to guess.
  const DAMAGED: ReadonlyArray<[string, string, string]> = [
    ['TXT-07', 'Teks Rusak T Uji', 'T73.000,00'],
    ['TXT-08', 'Teks Rusak O Uji', '3Ö10.000,00'],
    ['TXT-09', 'Teks Rusak Huruf Uji', 's.ooo,oo'],
    ['TXT-09', 'Teks Rusak Ribuan Uji', '314.ooo,oo'],
  ];
  for (const [id, caseName, literal] of DAMAGED) {
    it(`${id}: ${JSON.stringify(literal)} is never repaired into a number`, () => {
      const row = rowFor(caseName);
      expect(row.proposedCanonicalPrice).toBeNull();
      expect(row.canonicalRoundingMode).toBeNull();
      // The damage survives verbatim, so a human can see WHAT was refused.
      expect(row.rawPriceTextValue).toBe(literal);
      expect(row.warnings).not.toContain(PRICE_NORMALIZED_FROM_TEXT_REASON);
      // And it is NOT filed as merely undecidable: it is not numeric at all.
      expect(row.errors).not.toContain(
        PRICE_LITERAL_REASONS.SEPARATOR_ROLE_AMBIGUOUS,
      );
    });
  }

  it('NO OCR substitution table exists anywhere in the reading path', () => {
    // The obvious "helpful" repairs, refused at the source of truth itself.
    for (const damaged of [
      'T73.000,00',
      'T.477.000,00',
      '3Ö10.000,00',
      's.ooo,oo',
      '314.ooo,oo',
    ]) {
      const reading = interpretPriceLiteral(damaged);
      expect(reading.outcome).toBe('NOT_NUMERIC');
      expect(reading.canonicalSourceString).toBeNull();
    }
  });

  it('TXT-10: a blank price cell states no price, and says exactly that', () => {
    const row = rowFor('Harga Kosong Uji');
    expect(row.proposedCanonicalPrice).toBeNull();
    expect(row.rawPriceTextValue).toBeNull();
    expect(row.rawPriceDisplayText).toBeNull();
    expect(row.errors).toContain('PRICE_CELL_EMPTY');
    expect(row.warnings).not.toContain(PRICE_NORMALIZED_FROM_TEXT_REASON);
  });

  it('TXT-11: formula behaviour is untouched in all three of its shapes', () => {
    // No cached result — SIMPROK does not evaluate spreadsheets.
    const uncached = rowFor('Formula Tanpa Hasil Uji');
    expect(uncached.proposedCanonicalPrice).toBeNull();
    expect(uncached.errors).toContain('FORMULA_NO_CACHED_RESULT');
    expect(uncached.rawPriceFormulaText).toBe('D2*2');

    // A cached NUMERIC result is trusted exactly as before.
    const numeric = rowFor('Formula Hasil Angka Uji');
    expect(numeric.proposedCanonicalPrice).toBe('500000.00');
    expect(numeric.warnings).not.toContain(PRICE_NORMALIZED_FROM_TEXT_REASON);

    // A cached TEXT result stays refused even though the text READS cleanly.
    // R3B normalizes source text CELLS; formula semantics are locked, and a
    // formula's cached string is a computed value, not what the source stated.
    const text = rowFor('Formula Hasil Teks Uji');
    expect(text.proposedCanonicalPrice).toBeNull();
    expect(text.errors).toContain('FORMULA_RESULT_IS_TEXT_NOT_NUMBER');
    expect(text.warnings).not.toContain(PRICE_NORMALIZED_FROM_TEXT_REASON);
  });

  it('TXT-13: raw evidence is identical whether a row normalized or was refused', () => {
    // The evidence fields are a function of the SOURCE CELL alone. If
    // normalization had reached into them, a normalized row would be missing
    // something a refused row keeps.
    for (const testCase of TEXT_PRICE_CASES) {
      const row = rowFor(testCase.name);
      const isTextShaped =
        row.rawPriceCellType === SPREADSHEET_VALUE_TYPE.STRING ||
        row.rawPriceCellType === SPREADSHEET_VALUE_TYPE.RICH_TEXT;
      if (!isTextShaped) continue;
      // Text-shaped cells ALL keep their text, normalized or not...
      expect(row.rawPriceTextValue).not.toBeNull();
      expect(row.rawPriceDisplayText).toBe(row.rawPriceTextValue);
      // ...and NONE of them acquires a native numeric round-trip they never had.
      expect(row.rawPriceNumericRoundTripString).toBeNull();
      expect(row.rawPriceCachedResultRoundTripString).toBeNull();
      // The cell address is the source's own, in the source's own dialect.
      expect(row.sourcePriceCellAddress).toBe(
        `${String.fromCharCode(64 + TEXT_PRICE_COLUMN)}${rowNumberOfCase(testCase.name)}`,
      );
    }
  });

  it('TXT-14: normalization is NOT resolution — every row is still unresolved', () => {
    // §12 — "SIMPROK can read this literal" says nothing about whether the
    // price is correct, the source trusted, or the row publishable. Resource
    // identity and unit resolution remain the separate human steps they were.
    for (const row of knowledge.rows) {
      expect(row.sourceSectionProvenance).toBe('UPLOADER_DECLARED');
    }
    const normalized = knowledge.rows.filter((row) =>
      row.warnings.includes(PRICE_NORMALIZED_FROM_TEXT_REASON),
    );
    expect(normalized.length).toBeGreaterThan(0);
    // The adapter produces CANDIDATES only — it has no submission concept at
    // all, which is what makes "normalization cannot promote a row" structural
    // rather than a rule someone has to remember.
    for (const row of normalized) {
      expect(Object.keys(row)).not.toContain('resolutionStatus');
      expect(Object.keys(row)).not.toContain('status');
    }
  });

  it('TXT-15: the delimited-text path is untouched', async () => {
    // CSV has no typed cells, so every price there has ALWAYS been read from
    // text. Its behaviour must not shift, and its rows must not suddenly start
    // claiming a normalized-from-text provenance that was never news there.
    const csv = await adapter.parse(
      testEnvelope(buildAdversarialCsv(), 'adversarial.csv'),
      { declaredSection: 'MATERIAL' },
    );
    const byName = (fragment: string) =>
      csv.rows.find((row) => row.rawResourceNameText.includes(fragment))!;

    expect(byName('Besi Beton').proposedCanonicalPrice).toBe('17250.55');
    expect(byName('Kayu Balok').proposedCanonicalPrice).toBe('1250.50');
    // Still refused: undecidable, and currency-annotated.
    expect(byName('Cat Tembok').proposedCanonicalPrice).toBeNull();
    expect(byName('Paku Uji').proposedCanonicalPrice).toBeNull();
    // No spreadsheet facts invented, and no XLSX-only marker leaking across.
    for (const row of csv.rows) {
      expect(row.rawPriceCellType).toBeNull();
      expect(row.warnings).not.toContain(PRICE_NORMALIZED_FROM_TEXT_REASON);
    }
    // Separator provenance is still emitted for the delimited path, once.
    expect(byName('Besi Beton').warnings).toContain(
      'PRICE_TEXT_DECIMAL_SEPARATOR_COMMA',
    );
    expect(
      byName('Besi Beton').warnings.filter(
        (warning) => warning === 'PRICE_TEXT_DECIMAL_SEPARATOR_COMMA',
      ),
    ).toHaveLength(1);
  });
});

/**
 * USI-01R3B §17 — A SECOND WAY TO PRODUCE A NUMBER IS A SECOND WAY TO LEAK ONE.
 *
 * Before R3B a jurisdiction column could only yield a price from its own native
 * number. Now it can also yield one from its own TEXT — and every new source of
 * a value is a new opportunity for the wrong column to answer. Each row here
 * therefore mixes shapes across the three jurisdictions, so any borrowing shows
 * up as a value that provably belongs to a neighbour.
 */
describe('USI-01R3B — normalization does not leak across jurisdictions', () => {
  const adapter = new BasicPriceUniversalIntakeAdapter();
  const byRegion = new Map<string, Awaited<ReturnType<typeof adapter.parse>>>();

  beforeAll(async () => {
    const bytes = await buildRegionalTextPriceXlsx();
    for (const region of REGIONAL_TEXT_REGIONS) {
      byRegion.set(
        region,
        await adapter.parse(testEnvelope(bytes, 'regional-text.xlsx'), {
          declaredSection: 'MATERIAL',
          selectedRegionLabel: region,
        }),
      );
    }
  }, 60_000);

  it('every jurisdiction reads its OWN cell, by address and by value', () => {
    let checked = 0;
    for (const region of REGIONAL_TEXT_REGIONS) {
      const knowledge = byRegion.get(region)!;
      const column = REGIONAL_TEXT_COLUMNS[region];

      for (const source of REGIONAL_TEXT_ROWS) {
        const row = knowledge.rows.find(
          (r) => r.sourceRowNumber === source.rowNumber,
        )!;
        expect(row).toBeDefined();
        // By address...
        expect(row.sourcePriceCellAddress).toBe(
          `${String.fromCharCode(64 + column)}${source.rowNumber}`,
        );
        // ...and by value, against what the fixture DECLARES this cell means.
        expect(row.proposedCanonicalPrice).toBe(source.expected[region]);

        // ZERO LEAKAGE: no sibling's distinct value ever became this one's.
        for (const sibling of REGIONAL_TEXT_REGIONS) {
          if (sibling === region) continue;
          const siblingValue = source.expected[sibling];
          if (
            siblingValue !== null &&
            siblingValue !== source.expected[region]
          ) {
            expect(row.proposedCanonicalPrice).not.toBe(siblingValue);
          }
        }
        checked += 1;
      }
    }
    expect(checked).toBe(
      REGIONAL_TEXT_ROWS.length * REGIONAL_TEXT_REGIONS.length,
    );
  });

  it('a DAMAGED cell stays unresolved even when a clean sibling sits beside it', () => {
    // Row 2: Sirimau normalizes "153.000,00", Teluk Ambon has a native 200000,
    // and Baguala holds "314.ooo,oo". Baguala must go home empty.
    const baguala = byRegion
      .get('BAGUALA')!
      .rows.find((row) => row.sourceRowNumber === 2)!;
    expect(baguala.proposedCanonicalPrice).toBeNull();
    expect(baguala.rawPriceTextValue).toBe('314.ooo,oo');
    expect(baguala.proposedCanonicalPrice).not.toBe('153000.00');
    expect(baguala.proposedCanonicalPrice).not.toBe('200000.00');
    // ...while the jurisdiction that CAN be read is unaffected by its neighbour.
    expect(
      byRegion.get('SIRIMAU')!.rows.find((row) => row.sourceRowNumber === 2)!
        .proposedCanonicalPrice,
    ).toBe('153000.00');
  });

  it('an UNDECIDABLE cell stays unresolved even when both siblings are clean', () => {
    // Row 5: Baguala holds "125.000" between two native numbers. The easiest
    // possible place to "help" by copying a neighbour.
    const baguala = byRegion
      .get('BAGUALA')!
      .rows.find((row) => row.sourceRowNumber === 5)!;
    expect(baguala.proposedCanonicalPrice).toBeNull();
    expect(baguala.errors).toContain(
      PRICE_LITERAL_REASONS.SEPARATOR_ROLE_AMBIGUOUS,
    );
  });

  it('the candidate row set is identical for all three jurisdictions', () => {
    // R3A LAW G still holds: normalization changed which PRICES resolve, never
    // which ROWS exist.
    const sets = REGIONAL_TEXT_REGIONS.map((region) =>
      byRegion.get(region)!.rows.map((row) => row.sourceRowNumber),
    );
    expect(sets[1]).toEqual(sets[0]);
    expect(sets[2]).toEqual(sets[0]);
    expect(sets[0]).toEqual(REGIONAL_TEXT_ROWS.map((row) => row.rowNumber));
  });

  it('siblings survive as raw context, never as this jurisdiction’s price', () => {
    const sirimau = byRegion.get('SIRIMAU')!;
    for (const row of sirimau.rows) {
      const context = row.rawSourceContext ?? {};
      // The two non-selected jurisdictions are kept verbatim under the source's
      // own header text...
      expect(Object.keys(context)).toContain('TELUK AMBON');
      // ...and the selected column is never repeated into raw context.
      expect(context).not.toHaveProperty('SIRIMAU');
    }
  });
});
