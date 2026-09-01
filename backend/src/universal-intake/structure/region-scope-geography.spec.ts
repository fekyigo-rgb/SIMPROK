import { XlsxSourceReader } from '../readers/xlsx.reader';
import { SourceTable } from '../readers/source-table';
import { detectTableStructures } from './structure-detector';
import { testEnvelope } from '../../../test/fixtures/source-envelope.fixture';
import {
  GEO_BANNER_WORD,
  GEO_SCOPE_LABELS,
  NON_GEO_SCOPE_LABELS,
  ROW_VALUE_REGION_HEADER,
  buildGeographicScopeMatrixXlsx,
  buildNonGeographicScopeMatrixXlsx,
  buildRowValueRegionTableXlsx,
} from '../../../test/fixtures/bp-region-truth-07s.fixture';
import { buildUnknownUnitVocabularyXlsx } from '../../../test/fixtures/unknown-unit-vocabulary.fixture';

/**
 * BP-REGION-TRUTH-07S §5/§6/§9 — WHEN DOES A SOURCE CLAIM ITS PRICE SCOPE IS A
 * PLACE?
 *
 * The whole repair rests on one distinction, and these are the pins that hold
 * it: a source column matrix is not geographic BECAUSE it is a matrix, and it
 * is not geographic because its labels LOOK like place names. It is geographic
 * only when the source itself writes a region word over it.
 *
 * Every assertion below reads the DETECTOR alone — no database, no service, no
 * canonical Region. That is deliberate: this is a fact about a document, and it
 * must be provable from the document.
 */
describe('BP-REGION-TRUTH-07S — positive geographic source evidence', () => {
  const xlsx = new XlsxSourceReader();
  const readTables = async (bytes: Buffer): Promise<SourceTable[]> =>
    (await xlsx.read(testEnvelope(bytes, 'scope.xlsx'))).tables;
  const detectOnly = async (bytes: Buffer) => {
    const tables = await readTables(bytes);
    const detection = detectTableStructures(tables[0]);
    expect(detection.candidates.length).toBeGreaterThan(0);
    return detection.candidates[0];
  };

  it('SOURCE-GEO-01: an Owner-shaped KECAMATAN banner is retained as positive geographic evidence', async () => {
    const structure = await detectOnly(await buildGeographicScopeMatrixXlsx());

    // The scope question is asked, as it always was...
    expect(structure.regionScope.required).toBe(true);
    expect(structure.regionScope.kind).toBe('COLUMN');
    expect(structure.regionScope.choices.map((choice) => choice.label)).toEqual(
      expect.arrayContaining([...GEO_SCOPE_LABELS]),
    );
    // ...and the source's OWN word for what those columns ARE now survives the
    // reading instead of being recognised and thrown away.
    expect(structure.regionScope.geographicEvidence).toBe(GEO_BANNER_WORD);
  });

  it('SOURCE-NONGEO-01: parallel trade-term columns claim no geography at all', async () => {
    const structure = await detectOnly(
      await buildNonGeographicScopeMatrixXlsx(),
    );

    // SAME SHAPE, SAME QUESTION. "Which column do I read?" is a question about
    // structure and is unchanged here — that is the point of the control.
    expect(structure.regionScope.required).toBe(true);
    expect(structure.regionScope.kind).toBe('COLUMN');
    expect(structure.regionScope.choices.map((choice) => choice.label)).toEqual(
      expect.arrayContaining([...NON_GEO_SCOPE_LABELS]),
    );
    // But NOTHING here says these columns are places, so SIMPROK says nothing.
    // This is the pin that stops one workbook's ambiguity from making the
    // product noisy about every workbook.
    expect(structure.regionScope.geographicEvidence).toBeNull();
  });

  it('SOURCE-GEO-01b: place-LOOKING labels prove nothing on their own', async () => {
    // The same three Ambon jurisdiction names as the Owner's file, with NO
    // banner over them. A spelling comparison would call this geographic; the
    // source has not said so, so neither does SIMPROK.
    const structure = await detectOnly(await buildUnknownUnitVocabularyXlsx());

    expect(structure.regionScope.kind).toBe('COLUMN');
    expect(structure.regionScope.choices.length).toBeGreaterThan(1);
    expect(structure.regionScope.geographicEvidence).toBeNull();
  });

  it('ROWVALUE-01: a per-row WILAYAH column is geographic, and still reads as ROW_VALUE', async () => {
    const structure = await detectOnly(await buildRowValueRegionTableXlsx());

    // The pre-existing ROW_VALUE behaviour is intact...
    expect(structure.regionScope.kind).toBe('ROW_VALUE');
    expect(structure.regionScope.required).toBe(true);
    // ...and its geography needs no new vocabulary: the column's own header is
    // already a REGION_LABEL, which is exactly what makes this scope a place.
    expect(structure.regionScope.geographicEvidence).toBe(
      ROW_VALUE_REGION_HEADER,
    );
  });

  it('SOURCE-GEO-03: evidence is verbatim source text, never a canonical Region name', async () => {
    const structure = await detectOnly(await buildGeographicScopeMatrixXlsx());

    // It is the SOURCE'S word. Nothing here has consulted, matched or invented
    // a Region, and the evidence must never read as one.
    expect(structure.regionScope.geographicEvidence).toBe(GEO_BANNER_WORD);
    expect(structure.regionScope.choices).not.toContainEqual(
      expect.objectContaining({ label: GEO_BANNER_WORD }),
    );
  });
});
