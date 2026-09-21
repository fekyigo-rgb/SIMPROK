import { existsSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { ReaderRegistry } from '../../universal-intake/readers/reader-registry';
import { testEnvelope } from '../../../test/fixtures/source-envelope.fixture';
import { textAt } from '../../universal-intake/readers/source-table';
import { AHSP_DOCUMENT_REASON } from './ahsp-document-knowledge';
import { understandAhspDocument } from './ahsp-document-understanding';

const OFFICIAL_PATHS = [
  'C:/SIMPROK/data/first-real-input/AHSP BINA MARGA.xlsx',
  'C:/SIMPROK/AHSP BINA MARGA.xlsx',
];
const OFFICIAL_SHA256 =
  'ca64e1b5a09a4f4314a8e401f6058527714a803e2f0a84f46a551719e6e61c11';

const TRANSCRIPTION_PATHS = [
  'C:/SIMPROK/data/first-real-input/AHSP Bina Marga 2026 B1-B12.xlsx',
  'C:/SIMPROK-WT/AHSP Bina Marga 2026 B1-B12.xlsx',
];
const TRANSCRIPTION_SHA256 =
  'dd42f718145b53733fb27a35470e59e481aa233c2e0e67555ad2fdc1493cd1ce';

function firstExisting(paths: string[]): string {
  return paths.find((path) => existsSync(path)) ?? '';
}

function countReasons(
  items: ReadonlyArray<{ reasonCodes: readonly string[] }>,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const code of item.reasonCodes) {
      counts[code] = (counts[code] ?? 0) + 1;
    }
  }
  return counts;
}

const officialPath = firstExisting(OFFICIAL_PATHS);
const describeOfficial = officialPath ? describe : describe.skip;

describeOfficial('AHSP BINA MARGA.xlsx — official real source', () => {
  it('reads B.13 through the existing reader and meaning layer, without inventing unit, date, or price', async () => {
    const bytes = readFileSync(officialPath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(OFFICIAL_SHA256);
    const envelope = testEnvelope(bytes, 'AHSP BINA MARGA.xlsx');
    const read = await ReaderRegistry.default().read(envelope);
    expect(read.readerId).toBe('XLSX_EXCELJS');
    expect(read.tables).toHaveLength(1);
    expect(read.tables[0].name).toBe('Sheet1');
    expect(read.tables[0].scannedRowCount).toBe(2522);
    const knowledge = understandAhspDocument(read, envelope);
    expect(knowledge.document.effectiveDate).toBeNull();
    expect(knowledge.document.authorityProven).toBe(false);
    expect(knowledge.reasonCodes).toEqual(
      expect.arrayContaining([
        AHSP_DOCUMENT_REASON.AUTHORITY_UNPROVEN,
        AHSP_DOCUMENT_REASON.CURRENTNESS_UNPROVEN,
      ]),
    );
    const first = knowledge.workItems.find((item) => item.workType?.raw === 'B.13');
    expect(first).toBeDefined();
    expect(first?.methodName?.raw).toMatch(/^Gorong-gorong\s+pipa beton bertulang/i);
    expect(first?.sheetName).toBe('Sheet1');
    const pekerja = first?.resources.find((row) => row.rawName === 'Pekerja');
    expect(pekerja).toMatchObject({
      group: 'LABOR',
      rawCode: 'L01',
      rawUnit: 'Jam',
      coefficient: 0.0607,
      status: 'READY',
    });
    expect(pekerja?.coefficient).not.toBe(27643.54);
    const bahan = first?.resources.find((row) => row.rawName === "Beton fc' 30 MPa");
    expect(bahan).toMatchObject({
      group: 'MATERIAL',
      rawCode: 'M59',
      rawUnit: 'M3',
      coefficient: 0.072,
    });
    const alat = first?.resources.find((row) => row.rawName === 'Mini Excavator');
    expect(alat).toMatchObject({
      group: 'EQUIPMENT',
      rawCode: 'E10a',
      coefficient: 0.0389,
    });
    expect(first?.outputUnitRaw).toBeNull();
    expect(first?.reasonCodes).toEqual([AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT]);
    expect(first?.status).toBe('UNRESOLVED');
    expect(first?.workType?.locator).toBe('B3');
    const hsp = read.tables[0].rows.find(
      (row) => textAt(row, 3) === 'HARGA SATUAN PEKERJAAN (D + E)',
    );
    expect(hsp?.number).toBe(32);
    expect(textAt(hsp!, 5)).toBeNull();
    expect(first?.resources.some((row) => row.rawUnit === 'bh/M')).toBe(true);
    expect(first?.resources.find((row) => row.rawUnit === 'bh/M')?.rawName).toMatch(/Cetakan/);
  });

  it('reports batch totals without forcing unresolved rows into canonical form', async () => {
    const bytes = readFileSync(officialPath);
    const envelope = testEnvelope(bytes, 'AHSP BINA MARGA.xlsx');
    const read = await ReaderRegistry.default().read(envelope);
    const knowledge = understandAhspDocument(read, envelope);
    const resourceRows = knowledge.workItems.flatMap((item) => item.resources);
    expect(knowledge.workItems).toHaveLength(71);
    expect(resourceRows.length).toBeGreaterThan(1000);
    expect(knowledge.workItems.filter((item) => item.outputUnitRaw !== null)).toHaveLength(0);
    expect(knowledge.workItems.filter((item) => item.status === 'READY')).toHaveLength(0);
    expect(resourceRows.filter((row) => row.status === 'READY').length).toBeGreaterThan(1000);
    expect(resourceRows.some((row) => row.rawCode === 'L01')).toBe(true);
    expect(resourceRows.some((row) => row.rawUnit === "M'")).toBe(true);
    expect(countReasons(knowledge.workItems)[AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT]).toBe(71);
    expect(countReasons(knowledge.workItems)[AHSP_DOCUMENT_REASON.MISSING_UNIT]).toBeUndefined();
    expect(resourceRows.filter((row) => row.rawName === 'MATERIAL')).toHaveLength(0);
  });
});

/**
 * IMPORT-SEAM B8 — Owner WORKING-COPY verification (mutable external evidence).
 *
 * Three responsibilities stay separate:
 *   A. Official stable source (ca64…) — above; unchanged.
 *   B. Explicit external byte-identity verification — opt-in path+SHA only;
 *      then generic lawful reader/understanding invariants for THAT identity.
 *   C. Historical 5A847 semantic fixtures — only when the verified bytes are
 *      actually SHA 5A847. Different bytes = different source identity.
 *      Never apply 5A847 counts/units to 260C (or any other identity).
 *
 * Historical working-copy byte identity (provenance pin; do not overwrite):
 *   5a847e832da61905587b43308a31eaf0fc5c438242f5415d9f50fcb96036e02f
 *
 * Opt-in follows the existing REQUEST-gated pattern used by
 * `B1B12_GOLDEN_WORKBOOK_PATH` (see b1b12-golden-unit-coverage.spec.ts):
 *   SIMPROK_AHSP_WORKING_COPY_PATH=<absolute path>
 *   SIMPROK_AHSP_WORKING_COPY_SHA256=<expected sha256>
 * Both required. Once requested, missing file or SHA mismatch FAILS — never
 * silently skipped, and never weakened.
 */
const HISTORICAL_WORKING_COPY_SHA256 =
  '5a847e832da61905587b43308a31eaf0fc5c438242f5415d9f50fcb96036e02f';
const WORKING_COPY_PATH_ENV = 'SIMPROK_AHSP_WORKING_COPY_PATH';
const WORKING_COPY_SHA_ENV = 'SIMPROK_AHSP_WORKING_COPY_SHA256';
const WORKING_COPY_PATH = (process.env[WORKING_COPY_PATH_ENV] ?? '').trim();
const WORKING_COPY_SHA256 = (process.env[WORKING_COPY_SHA_ENV] ?? '').trim();
const workingCopyPathSet = WORKING_COPY_PATH !== '';
const workingCopyShaSet = WORKING_COPY_SHA256 !== '';
const workingCopyRequested = workingCopyPathSet && workingCopyShaSet;
const describeWorkingCopy = workingCopyRequested ? describe : describe.skip;
/** Historical 5A847 semantic fixtures run only for that exact byte identity. */
const describeHistoricalWorkingCopySemantics =
  workingCopyRequested &&
  WORKING_COPY_SHA256 === HISTORICAL_WORKING_COPY_SHA256
    ? describe
    : describe.skip;

describe('AHSP BINA MARGA working-copy opt-in gate', () => {
  it('preserves the historical working-copy provenance pin as its own identity', () => {
    expect(HISTORICAL_WORKING_COPY_SHA256).toBe(
      '5a847e832da61905587b43308a31eaf0fc5c438242f5415d9f50fcb96036e02f',
    );
    expect(HISTORICAL_WORKING_COPY_SHA256).not.toBe(OFFICIAL_SHA256);
  });

  it('requires both path and expected SHA env vars, or neither', () => {
    expect(workingCopyPathSet).toBe(workingCopyShaSet);
  });
});

describeWorkingCopy(
  'AHSP BINA MARGA.xlsx — explicit external working-copy identity',
  () => {
    it('verifies exact byte identity and generic lawful read invariants for the named source', async () => {
      if (!existsSync(WORKING_COPY_PATH)) {
        throw new Error(
          `AHSP_WORKING_COPY_NOT_FOUND: ${WORKING_COPY_PATH_ENV} was set to ` +
            `"${WORKING_COPY_PATH}", but no file exists there. An explicitly ` +
            `requested working-copy verification is never skipped.`,
        );
      }
      const bytes = readFileSync(WORKING_COPY_PATH);
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      expect(actualSha).toBe(WORKING_COPY_SHA256);

      const envelope = testEnvelope(bytes, 'AHSP BINA MARGA.xlsx');
      const read = await ReaderRegistry.default().read(envelope);
      expect(read.readerId).toBe('XLSX_EXCELJS');
      expect(read.tables.length).toBeGreaterThan(0);

      const knowledge = understandAhspDocument(read, envelope);
      expect(knowledge.workItems).toHaveLength(71);
      expect(knowledge.workItems.every((item) => item.workType !== null)).toBe(
        true,
      );
      expect(
        countReasons(knowledge.workItems)[
          AHSP_DOCUMENT_REASON.MISSING_WORK_ITEM
        ],
      ).toBeUndefined();
      // Identity-specific fixtures (e.g. historical 5A847 unit-row counts)
      // live in the historical-only block below — never applied here.
    });
  },
);

describeHistoricalWorkingCopySemantics(
  'AHSP BINA MARGA.xlsx — historical 5A847 working-copy semantics',
  () => {
    it('reads every stated work identity and output unit, and leaves the one unstated unit missing', async () => {
      if (!existsSync(WORKING_COPY_PATH)) {
        throw new Error(
          `AHSP_WORKING_COPY_NOT_FOUND: historical 5A847 semantics were ` +
            `requested via ${WORKING_COPY_PATH_ENV}="${WORKING_COPY_PATH}", ` +
            `but no file exists there.`,
        );
      }
      const bytes = readFileSync(WORKING_COPY_PATH);
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      expect(actualSha).toBe(HISTORICAL_WORKING_COPY_SHA256);

      const envelope = testEnvelope(bytes, 'AHSP BINA MARGA.xlsx');
      const knowledge = understandAhspDocument(
        await ReaderRegistry.default().read(envelope),
        envelope,
      );

      const units = knowledge.workItems.map(
        (item) => item.outputUnitRaw?.raw ?? null,
      );
      expect(units.filter((unit) => unit === 'm')).toHaveLength(69);
      expect(units.filter((unit) => unit === 'm3')).toHaveLength(1);

      const first = knowledge.workItems.find(
        (item) => item.workType?.raw === 'B.13',
      );
      expect(first?.workType?.locator).toBe('B3');
      expect(first?.outputUnitRaw).toMatchObject({ raw: 'm', locator: 'B4' });

      // B.83 states no unit anywhere in its block. It is NOT given its siblings' "m".
      const unstated = knowledge.workItems.find(
        (item) => item.workType?.raw === 'B.83',
      );
      expect(unstated?.outputUnitRaw).toBeNull();
      expect(unstated?.reasonCodes).toEqual([
        AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT,
      ]);
      expect(
        countReasons(knowledge.workItems)[
          AHSP_DOCUMENT_REASON.MISSING_OUTPUT_UNIT
        ],
      ).toBe(1);
    });
  },
);

const transcriptionPath = firstExisting(TRANSCRIPTION_PATHS);
const describeTranscription = transcriptionPath ? describe : describe.skip;

describeTranscription('AHSP Bina Marga 2026 transcription — regression source, not current proof', () => {
  it('still reads B.1 without inventing unit or date', async () => {
    const bytes = readFileSync(transcriptionPath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(TRANSCRIPTION_SHA256);
    const envelope = testEnvelope(bytes, 'AHSP Bina Marga 2026 B1-B12.xlsx');
    const read = await ReaderRegistry.default().read(envelope);
    const knowledge = understandAhspDocument(read, envelope);
    expect(knowledge.document.effectiveDate).toBeNull();
    expect(knowledge.reasonCodes).toContain(AHSP_DOCUMENT_REASON.CURRENTNESS_UNPROVEN);
    const first = knowledge.workItems.find((item) => item.workType?.raw === 'B.1 (2.1.(1))');
    expect(first?.methodName?.raw).toBe('Galian untuk Selokan Drainase dan Saluran Air');
    expect(first?.outputUnitRaw).toBeNull();
    expect(first?.status).toBe('UNRESOLVED');
  });
});

/**
 * CLOSEOUT TASK 4 — the rows this transcription prints that are not components
 * ("Nota :" notes below each closing total, the next block's title, the
 * "B. | BANAN" heading) are never read as components; a text coefficient is
 * never read as a number; and all twelve blocks are still read, and held.
 */
describeTranscription(
  'AHSP Bina Marga 2026 transcription — rows that are not components',
  () => {
    it('reads no note, title or unreadable heading as a component, and holds all twelve blocks', async () => {
      const bytes = readFileSync(transcriptionPath);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        TRANSCRIPTION_SHA256,
      );
      const envelope = testEnvelope(bytes, 'AHSP Bina Marga 2026 B1-B12.xlsx');
      const knowledge = understandAhspDocument(
        await ReaderRegistry.default().read(envelope),
        envelope,
      );
      const items = knowledge.workItems;
      const byCode = (code: string) =>
        items.find((item) => item.workType?.raw === code);
      expect(items).toHaveLength(12);
      expect(
        items.every(
          (item) => item.workType !== null && item.methodName !== null,
        ),
      ).toBe(true);
      expect(items.every((item) => item.status === 'UNRESOLVED')).toBe(true);

      const components = items.flatMap((item) => item.resources);
      // 184 before: 20 note rows, 3 next-block titles and 2 "BANAN" headings.
      expect(components).toHaveLength(159);
      const notes =
        /^(Satuan dapat berdasarkan|Kuantitas satuan adalah|Biaya satuan sudah termasuk|yang dibayar dari kontrak)/;
      expect(
        components.filter((r) => notes.test(r.rawName ?? '')),
      ).toHaveLength(0);
      const titles = new Set(items.map((item) => item.methodName?.raw));
      expect(
        components.filter((r) => titles.has(r.rawName ?? '')),
      ).toHaveLength(0);
      expect(components.filter((r) => r.rawName === 'BANAN')).toHaveLength(0);

      // Pasir in B.3 and B.6 holds its quantity as text; it stays unread.
      for (const code of ['B.3', 'B.6']) {
        const pasir = byCode(code)?.resources.filter(
          (r) => r.rawName === 'Pasir',
        );
        expect(pasir).toHaveLength(1);
        expect(pasir?.[0].coefficient).toBeNull();
        expect(pasir?.[0].reasonCodes).toContain(
          AHSP_DOCUMENT_REASON.INVALID_COEFFICIENT,
        );
      }

      // The materials under "B. | BANAN" are not filed as labour, nor guessed as bahan.
      for (const code of ['B.9 (2.3.(1))', 'B.10 (2.3.(2))']) {
        const item = byCode(code);
        expect(item?.reasonCodes).toContain(
          AHSP_DOCUMENT_REASON.SEMANTIC_AMBIGUITY,
        );
        const beton = item?.resources.find(
          (r) => r.rawName === 'Beton f* c 15 MPa',
        );
        expect(beton?.group).toBeNull();
        expect(beton?.status).toBe('UNRESOLVED');
        expect(
          item?.resources
            .filter((r) => r.group === 'LABOR')
            .map((r) => r.rawName),
        ).toEqual(['Pekerja', 'Tukang', 'Mandor']);
      }
    });
  },
);
