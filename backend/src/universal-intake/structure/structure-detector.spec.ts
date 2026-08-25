import { CsvSourceReader } from '../readers/csv.reader';
import { XlsxSourceReader } from '../readers/xlsx.reader';
import { SourceTable } from '../readers/source-table';
import { detectTableStructures } from './structure-detector';
import { buildBasicPriceXlsx } from '../../../test/fixtures/basic-price-xlsx.fixture';
import {
  REGION_COLUMN_LABELS,
  buildAdversarialCsv,
  buildBasicPriceCsv,
  buildFlatRegionColumnCsv,
  buildNonPriceCsv,
  buildRegionalMatrixXlsx,
  buildSemanticHeaderXlsx,
} from '../../../test/fixtures/usi01-source-shapes.fixture';
import { testEnvelope } from '../../../test/fixtures/source-envelope.fixture';

const xlsx = new XlsxSourceReader();
const csv = new CsvSourceReader();

const readXlsxTables = async (bytes: Buffer): Promise<SourceTable[]> =>
  (await xlsx.read(testEnvelope(bytes, 'shape.xlsx'))).tables;
const readCsvTable = async (bytes: Buffer): Promise<SourceTable> =>
  (await csv.read(testEnvelope(bytes, 'shape.csv'))).tables[0];

describe('structure detection — USI-01 §5 FORMAT != TABLE SHAPE', () => {
  describe('TEST A4: the same shape is recognized regardless of the format it arrived in', () => {
    it('a semantic header table is recognized in XLSX and in CSV alike', async () => {
      const fromXlsx = detectTableStructures((await readXlsxTables(await buildSemanticHeaderXlsx()))[0]);
      const fromCsv = detectTableStructures(await readCsvTable(buildBasicPriceCsv()));

      expect(fromXlsx.candidates.map((c) => c.structure)).toEqual([
        'SEMANTIC_HEADER_TABLE',
      ]);
      expect(fromCsv.candidates.map((c) => c.structure)).toEqual([
        'SEMANTIC_HEADER_TABLE',
      ]);
    });
  });

  describe('TEST X3: the SIMPROK-READY shape (Owner workbook A)', () => {
    it('finds the header row by evidence, not by position, and maps every role', async () => {
      const [table] = await readXlsxTables(await buildSemanticHeaderXlsx());
      const [candidate] = detectTableStructures(table).candidates;

      // The header is on row 4, under a two-row title block.
      expect(candidate.headerRowNumber).toBe(4);
      expect(candidate.roleColumns).toMatchObject({
        RESOURCE_NAME: 1,
        SOURCE_UNIT: 2,
        SIMPROK_UNIT_CANDIDATE: 3,
        PRICE: 4,
      });
      expect(candidate.regionScope.required).toBe(false);
    });

    it('LAW 6: the source’s own header words are preserved next to the role', async () => {
      const [table] = await readXlsxTables(await buildSemanticHeaderXlsx());
      const [candidate] = detectTableStructures(table).candidates;
      expect(candidate.columns).toEqual(
        expect.arrayContaining([
          { columnNumber: 4, headerText: 'selected_price_2024', role: 'PRICE' },
          { columnNumber: 5, headerText: 'sumber', role: 'NOTE' },
        ]),
      );
    });

    it('TEST X2: detection never depends on a sheet name', async () => {
      for (const sheetName of ['Sheet1', 'DATA HARGA 2024', 'lembar-3']) {
        const [table] = await readXlsxTables(await buildSemanticHeaderXlsx({ sheetName }));
        expect(detectTableStructures(table).candidates).toHaveLength(1);
      }
    });

    it('reads a price header in other languages without erasing its wording', async () => {
      const table = await readCsvTable(
        Buffer.from('Désignation,Unité,Prix unitaire\nSable,M3,398000\nGravier,M3,275000\n', 'utf8'),
      );
      const [candidate] = detectTableStructures(table).candidates;
      expect(candidate.roleColumns).toMatchObject({
        RESOURCE_NAME: 1,
        SOURCE_UNIT: 2,
        PRICE: 3,
      });
      expect(candidate.columns[2].headerText).toBe('Prix unitaire');
    });
  });

  describe('TEST X4: the regional matrix (Owner workbook B)', () => {
    it('recognizes parallel jurisdiction columns and never resolves their labels', async () => {
      const [table] = await readXlsxTables(await buildRegionalMatrixXlsx());
      const [candidate] = detectTableStructures(table).candidates;

      expect(candidate.structure).toBe('REGIONAL_MATRIX');
      expect(candidate.regionScope.required).toBe(true);
      expect(candidate.regionScope.kind).toBe('COLUMN');
      // The labels are the source's OWN words. SIMPROK offers them; it does not
      // map them to canonical Regions, because §18 forbids guessing a region.
      expect(candidate.regionScope.choices.map((choice) => choice.label)).toEqual([
        ...REGION_COLUMN_LABELS,
      ]);
    });

    it('a matrix has NO price-role column — that is precisely what identifies it', async () => {
      const [table] = await readXlsxTables(await buildRegionalMatrixXlsx());
      const [candidate] = detectTableStructures(table).candidates;
      expect(candidate.roleColumns.PRICE).toBeUndefined();
      expect(candidate.evidence).toContain('PARALLEL_NUMERIC_COLUMNS:3');
    });
  });

  describe('§5 FLAT PRICE TABLE with a per-row Region column', () => {
    it('offers each distinct jurisdiction VALUE as a scope choice', async () => {
      const table = await readCsvTable(buildFlatRegionColumnCsv());
      const [candidate] = detectTableStructures(table).candidates;

      expect(candidate.structure).toBe('SEMANTIC_HEADER_TABLE');
      expect(candidate.regionScope.kind).toBe('ROW_VALUE');
      expect(candidate.regionScope.required).toBe(true);
      expect(candidate.regionScope.choices.map((c) => c.label)).toEqual([
        'BAGUALA',
        'SIRIMAU',
        'TELUK AMBON',
      ]);
    });
  });

  describe('precedence and refusal', () => {
    it('a document that DECLARES its own sections is a sectioned list, and nothing else', async () => {
      // The legacy workbook's header row also says "TENAGA KERJA / SATUAN /
      // HARGA", which the semantic vocabulary recognizes. Without a precedence
      // rule that would read as a second plausible structure and would have
      // turned every existing import into an ambiguity prompt. A document
      // stating its own organization is the more specific evidence, and wins.
      const [table] = await readXlsxTables(await buildBasicPriceXlsx());
      const detection = detectTableStructures(table);
      expect(detection.candidates.map((c) => c.structure)).toEqual([
        'SECTIONED_PRICE_LIST',
      ]);
      expect(detection.candidates[0].evidence).toContain(
        'SECTION_TITLES_PRESENT:EQUIPMENT,LABOR,MATERIAL',
      );
    });

    it('readable text that is not a price table is refused with the reason (§17)', async () => {
      const detection = detectTableStructures(await readCsvTable(buildNonPriceCsv()));
      expect(detection.candidates).toHaveLength(0);
      expect(detection.rejections).toContain('NO_HEADER_ROW_WITH_A_RESOURCE_NAME_COLUMN');
    });

    it('a price table with no unit column is refused rather than imported dead', async () => {
      const table = await readCsvTable(
        Buffer.from('resource_name,harga\nPasir,398000\nBatu,344000\n', 'utf8'),
      );
      const detection = detectTableStructures(table);
      expect(detection.candidates).toHaveLength(0);
      expect(detection.rejections).toContain('NO_UNIT_COLUMN');
    });

    it('two columns both claiming one role is a real ambiguity, not a leftmost-wins', async () => {
      const table = await readCsvTable(
        Buffer.from('nama,satuan,unit,harga\nPasir,M3,m3,398000\nBatu,M3,m3,344000\n', 'utf8'),
      );
      const detection = detectTableStructures(table);
      expect(detection.candidates).toHaveLength(0);
      expect(detection.rejections).toContain('HEADER_ROLE_DUPLICATED:SOURCE_UNIT');
    });

    it('a numeric-shaped but undecidable column still counts as a jurisdiction column', async () => {
      // Structure detection asks "is this column numbers?", never "are these
      // numbers believable?". Those are different questions (LAW 4), and the
      // second is answered later, per row.
      const table = await readCsvTable(
        Buffer.from(
          'uraian,satuan,SIRIMAU,BAGUALA\nPasir,M3,125.000,344.000\nBatu,M3,285.000,262.000\n',
          'utf8',
        ),
      );
      const [candidate] = detectTableStructures(table).candidates;
      expect(candidate.structure).toBe('REGIONAL_MATRIX');
      expect(candidate.regionScope.choices).toHaveLength(2);
    });

    it('a resource-family WORD inside a NAME is not proof about the column', async () => {
      // USI-01R2 §10 — the elimination that decides which columns a human is
      // offered must PROVE, not lean. "Pekerja", "Pekerja biasa" and "Pekerja
      // terampil" are three labour resources by NAME, and a rule that reads a
      // family from a value's leading word calls all three LABOR and strikes
      // the one right answer off the list. Naming a family is not being one.
      const table = await readCsvTable(
        Buffer.from(
          ',,SIRIMAU,BAGUALA\n' +
            'Pekerja,OH,120000,110000\n' +
            'Pekerja biasa,OH,130000,115000\n' +
            'Pekerja terampil,OH,150000,140000\n',
          'utf8',
        ),
      );
      const [candidate] = detectTableStructures(table).candidates;

      expect(candidate.structure).toBe('REGIONAL_MATRIX');
      expect(candidate.columnRoles?.required).toBe(true);
      expect(
        candidate.columnRoles?.nameCandidates.map((c) => c.columnNumber),
      ).toContain(1);
    });

    it('a column that IS a family and nothing else is still disproven as a name', async () => {
      // The other half of the same law: narrowing the proof must not disarm it.
      // A column stating ALAT/BAHAN/UPAH answers "which family", and a family
      // is not a name — so it is never offered as one.
      const table = await readCsvTable(
        Buffer.from(
          ',,SIRIMAU,BAGUALA\n' +
            'UPAH,OH,120000,110000\n' +
            'BAHAN,M3,130000,115000\n' +
            'ALAT,JAM,150000,140000\n',
          'utf8',
        ),
      );
      const [candidate] = detectTableStructures(table).candidates;

      expect(candidate.structure).toBe('REGIONAL_MATRIX');
      expect(
        candidate.columnRoles?.nameCandidates.map((c) => c.columnNumber),
      ).not.toContain(1);
    });

    it('the adversarial CSV is still recognized as one clean semantic table', async () => {
      const detection = detectTableStructures(await readCsvTable(buildAdversarialCsv()));
      expect(detection.candidates.map((c) => c.structure)).toEqual([
        'SEMANTIC_HEADER_TABLE',
      ]);
    });
  });
});
