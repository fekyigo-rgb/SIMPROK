import ExcelJS from 'exceljs';
import JSZip from 'jszip';

/**
 * USI-01R3 §10 — A PORTABLE REPRODUCTION OF THE REAL OOXML DIALECT DEFECT.
 *
 * The Owner's real IKK workbook is valid OOXML that ExcelJS cannot read, for
 * two mechanical reasons that have nothing to do with its contents:
 *
 *   1. its generator puts the SpreadsheetML namespace on an `x:` PREFIX
 *      (`<x:workbook>`, `<x:sheet>`) instead of making it the default, so
 *      ExcelJS — which matches unprefixed local names — sees zero sheets;
 *   2. it carries Excel Table (ListObject) parts whose model ExcelJS then
 *      fails to build.
 *
 * CI must be able to protect that repair forever, and the Owner's workbook is
 * real business data that will never be committed. So this builds a TINY
 * workbook — three invented cells, no prices, no resources, nothing of the
 * Owner's — and rewrites it into the same dialect.
 *
 * The technical defect is reproduced. The business data is not.
 */

export const DIALECT_FIXTURE_SHEET = 'DIALECT_PROBE';
export const DIALECT_FIXTURE_CELLS = [
  ['probe_label', 'probe_value'],
  ['alpha', 'satu'],
  ['beta', 'dua'],
] as const;

/** An ordinary, well-formed workbook that ExcelJS reads without help. */
export async function buildPlainDialectXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(DIALECT_FIXTURE_SHEET);
  DIALECT_FIXTURE_CELLS.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      sheet.getCell(rowIndex + 1, columnIndex + 1).value = value;
    });
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * The SAME workbook, rewritten into the prefixed-namespace dialect and given a
 * table part — i.e. the exact shape ExcelJS chokes on.
 *
 * This is the INVERSE of the reader's normalization, applied deliberately, so
 * the fixture reproduces the disease rather than asserting the cure against
 * itself.
 */
export async function buildPrefixedDialectXlsx(): Promise<Buffer> {
  const plain = await buildPlainDialectXlsx();
  const source = await JSZip.loadAsync(plain);
  const out = new JSZip();

  const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

  for (const name of Object.keys(source.files)) {
    const entry = source.files[name];
    if (entry.dir) continue;

    if (name.endsWith('.xml') && !name.endsWith('.rels')) {
      let xml = await entry.async('string');
      if (xml.includes(MAIN_NS)) {
        // Default namespace -> "x:" prefix on every element.
        xml = xml
          .split(`xmlns="${MAIN_NS}"`)
          .join(`xmlns:x="${MAIN_NS}"`)
          .replace(/<([a-zA-Z][a-zA-Z0-9]*)(\s|\/|>)/g, '<x:$1$2')
          .replace(/<\/([a-zA-Z][a-zA-Z0-9]*)>/g, '</x:$1>')
          // The XML declaration must not acquire a prefix.
          .replace(/<x:\?xml/g, '<?xml');
      }
      out.file(name, xml);
    } else {
      out.file(name, await entry.async('nodebuffer'));
    }
  }

  // A table part in the same dialect, referenced from the worksheet — the
  // second half of the real failure.
  const tableXml =
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<x:table xmlns:x="${MAIN_NS}" id="1" name="ProbeTable" displayName="ProbeTable" ` +
    `ref="A1:B3" headerRowCount="1"><x:tableColumns count="2">` +
    `<x:tableColumn id="1" name="probe_label" /><x:tableColumn id="2" name="probe_value" />` +
    `</x:tableColumns></x:table>`;
  out.file('xl/tables/table1.xml', tableXml);
  out.file(
    'xl/worksheets/_rels/sheet1.xml.rels',
    `<?xml version="1.0" encoding="utf-8"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" ` +
      `Target="/xl/tables/table1.xml" Id="Rtable1" /></Relationships>`,
  );

  return out.generateAsync({ type: 'nodebuffer' });
}
