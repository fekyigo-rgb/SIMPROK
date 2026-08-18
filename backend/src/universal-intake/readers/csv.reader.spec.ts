import { INTAKE_ERRORS } from '../intake-errors';
import { CsvSourceReader, detectDelimiter } from './csv.reader';
import { formatLocator, textAt } from './source-table';
import {
  buildAdversarialCsv,
  buildBasicPriceCsv,
} from '../../../test/fixtures/usi01-source-shapes.fixture';
import { testEnvelope } from '../../../test/fixtures/source-envelope.fixture';

describe('CsvSourceReader — USI-01 §4 technical parsing only', () => {
  const reader = new CsvSourceReader();
  const readCsv = (bytes: Buffer, name = 'harga.csv') =>
    reader.read(testEnvelope(bytes, name));

  it('TEST C1/C2: a valid CSV is read, and a quoted comma does not corrupt columns', async () => {
    const read = await readCsv(buildBasicPriceCsv());
    const table = read.tables[0];

    expect(table.columnCount).toBe(4);
    const quotedRow = table.rows.find(
      (row) => textAt(row, 1) === 'Batu Belah, Uji CSV',
    );
    // The comma lives INSIDE field 1. If quoting were mishandled it would have
    // split into two fields and shifted the price column by one — the classic
    // way a CSV import silently reads a price out of the wrong column.
    expect(quotedRow).toBeDefined();
    expect(textAt(quotedRow!, 2)).toBe('M3');
    expect(textAt(quotedRow!, 3)).toBe('344000');
  });

  it('TEST C3: UTF-8 names survive intact, with or without a BOM', async () => {
    for (const withBom of [false, true]) {
      const read = await readCsv(buildAdversarialCsv({ withBom }));
      const table = read.tables[0];
      const names = table.rows.map((row) => textAt(row, 1));
      expect(names).toContain('Semen Grésik Ünicode');
      // A BOM must not become part of the first header cell.
      expect(textAt(table.rows[0], 1)).toBe('resource_name');
    }
  });

  it('TEST C4: raw strings are preserved exactly, separately from the trimmed reading', async () => {
    const read = await readCsv(
      Buffer.from('resource_name,source_unit,harga\n  Pasir Uji  ,M3,  398000  \n', 'utf8'),
    );
    const dataRow = read.tables[0].rows[1];
    expect(dataRow.cells[0]!.rawText).toBe('  Pasir Uji  ');
    expect(dataRow.cells[0]!.text).toBe('Pasir Uji');
  });

  it('TEST C6: a CSV field is NEVER given a spreadsheet cell address or cell type', async () => {
    const read = await readCsv(buildBasicPriceCsv());
    const table = read.tables[0];

    expect(table.locatorDialect).toBe('CSV_RC');
    // R2C3, not "C2". Structurally unmistakable for A1 notation.
    expect(formatLocator(table.locatorDialect, 2, 3)).toBe('R2C3');
    expect(formatLocator(table.locatorDialect, 2, 3)).not.toMatch(/^[A-Z]+\d+$/);
    // A delimited file has no typed cells, so there is no native evidence to
    // report — and none is invented.
    for (const row of table.rows) {
      for (const cell of row.cells) {
        if (cell) expect(cell.native).toBeNull();
      }
    }
  });

  it('numbers reach the domain as TEXT — the reader interprets nothing', async () => {
    const read = await readCsv(buildAdversarialCsv());
    const ambiguous = read.tables[0].rows.find(
      (row) => textAt(row, 1) === 'Cat Tembok Uji',
    )!;
    // "125.000" is still exactly "125.000" here. Deciding whether that is
    // 125000 or 125.0 is emphatically not a reader's business (§4).
    expect(textAt(ambiguous, 3)).toBe('125.000');
  });

  describe('deterministic delimiter detection (§4 bounded rules)', () => {
    it('picks the delimiter the most lines agree on, over the widest table', () => {
      const commaCsv = buildBasicPriceCsv().toString('utf8');
      expect(detectDelimiter(commaCsv).delimiter).toBe(',');

      const semicolonCsv = buildAdversarialCsv({ semicolonDelimited: true }).toString(
        'utf8',
      );
      expect(detectDelimiter(semicolonCsv).delimiter).toBe(';');
    });

    it('is a pure function of the bytes — the same text always detects the same way', () => {
      const text = buildAdversarialCsv({ semicolonDelimited: true }).toString('utf8');
      expect(detectDelimiter(text)).toEqual(detectDelimiter(text));
    });

    it('reports every candidate’s score, so the choice is auditable', () => {
      const detection = detectDelimiter(buildBasicPriceCsv().toString('utf8'));
      expect(detection.scores.map((score) => score.delimiter)).toEqual([
        ',',
        ';',
        '\t',
        '|',
      ]);
    });

    it('a single-column file is read honestly as one column, never forced wider', () => {
      const detection = detectDelimiter('hanya satu kolom\nbaris kedua\n');
      expect(detection.modalFieldCount).toBe(1);
    });
  });

  it('handles CRLF, LF and a missing trailing newline identically', async () => {
    const rows = ['a,b,c', '1,2,3'];
    const crlf = await readCsv(Buffer.from(rows.join('\r\n') + '\r\n', 'utf8'));
    const lf = await readCsv(Buffer.from(rows.join('\n'), 'utf8'));
    expect(crlf.tables[0].rows.length).toBe(2);
    expect(lf.tables[0].rows.length).toBe(2);
    expect(textAt(lf.tables[0].rows[1], 3)).toBe('3');
  });

  it('a newline inside a quoted field stays inside that field', async () => {
    const read = await readCsv(
      Buffer.from('resource_name,unit\n"Pasir\nHalus",M3\n', 'utf8'),
    );
    expect(textAt(read.tables[0].rows[1], 1)).toBe('Pasir\nHalus');
  });

  it('an unsupported encoding is named, not misread into mojibake (§17)', async () => {
    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('a,b\n1,2\n', 'utf16le'),
    ]);
    await expect(readCsv(utf16)).rejects.toMatchObject({
      code: INTAKE_ERRORS.SOURCE_UNREADABLE,
      details: expect.objectContaining({ reason: 'CSV_ENCODING_NOT_UTF8' }),
    });
  });
});
