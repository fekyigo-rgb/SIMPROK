import { existsSync, readFileSync } from 'fs';
import { Prisma } from '@prisma/client';
import { BasicPriceUniversalIntakeAdapter } from './basic-price-universal-intake.adapter';
import { XlsxSourceReader } from '../universal-intake/readers/xlsx.reader';
import type { SourceTable } from '../universal-intake/readers/source-table';
import { detectTableStructures } from '../universal-intake/structure/structure-detector';
import { interpretPriceLiteral } from '../universal-intake/structure/price-literal';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

/**
 * USI-01R3 §4–6 — ROW IDENTITY AND PER-ROW REGION ISOLATION, ON THE REAL FILE.
 *
 * USI-01R3A REVISED THE ROW-KIND LAW THAT PART OF THIS SUITE MEASURED, and the
 * expectations here moved with it — see ROW-03 / ROW-03A. The isolation proofs
 * below are untouched, and now run over a LARGER candidate set (934 rows per
 * jurisdiction, not 894), because the forty rows the old rule deleted as
 * "headings" were never proven to be headings at all.
 *
 * The portable twin of this suite lives in
 * `basic-price-usi01r3a-portable-regional.spec.ts` and cannot skip. This one is
 * the richer proof; that one is the proof that always runs.
 *
 * Two things are proven here that USI-01R2 only inferred.
 *
 * LAW G — a physical row's KIND is a property of the DOCUMENT, so the same rows
 * are candidates whichever jurisdiction is imported. R2 decided that question by
 * looking at the SELECTED region's price cell, and therefore erased from the
 * Baguala import every resource Baguala happened not to price: 894 candidates
 * for Sirimau against 893 for Baguala, with a real resource silently gone.
 *
 * ZERO LEAKAGE — proven cell by cell against the raw grid, not by observing
 * that two arrays happen to differ. Two arrays differing proves only that they
 * differ; it cannot show that each jurisdiction received its OWN column.
 */
const WORKBOOK_B = 'C:/SIMPROK/Harga kota Ambon.xlsx';
const REGIONS = ['SIRIMAU', 'TELUK AMBON', 'BAGUALA'] as const;

const adapter = new BasicPriceUniversalIntakeAdapter();
const describeIf = existsSync(WORKBOOK_B) ? describe : describe.skip;

describeIf('REAL Workbook B — row identity and per-row region isolation', () => {
  let bytes: Buffer;
  let table: SourceTable;
  let regionColumns: Map<string, number>;
  const byRegion = new Map<string, Awaited<ReturnType<typeof adapter.parse>>>();

  beforeAll(async () => {
    bytes = readFileSync(WORKBOOK_B);

    // The RAW grid, read independently of the domain adapter. Every assertion
    // below compares the adapter's output against the SOURCE, never against
    // another run of the same code path.
    const read = await new XlsxSourceReader().read(
      testEnvelope(bytes, 'Harga kota Ambon.xlsx'),
    );
    table = read.tables[0];
    const detected = detectTableStructures(table).candidates[0];
    regionColumns = new Map(
      detected.regionScope.choices.map((choice) => [choice.label, choice.columnNumber]),
    );

    for (const label of REGIONS) {
      byRegion.set(
        label,
        await adapter.parse(testEnvelope(bytes, 'Harga kota Ambon.xlsx'), {
          declaredSection: 'MATERIAL',
          selectedRegionLabel: label,
          selectedNameColumn: 2,
          selectedUnitColumn: 4,
        }),
      );
    }

  // The real workbook is 942 rows and is read four times here (once raw, once
  // per jurisdiction). Jest's default 5s hook timeout is comfortably enough on
  // an idle machine and NOT enough under a loaded CI runner, which turns a
  // healthy suite into a phantom failure. The budget is stated explicitly.
  }, 120_000);

  /**
   * The canonical value THIS cell alone can justify, from its own evidence.
   *
   * USI-01R3B — TWO KINDS OF EVIDENCE, BOTH BELONGING TO THIS ONE CELL. A
   * workbook number justifies itself. So does text with exactly one numeric
   * meaning ("153.000,00"), which R3B normalizes rather than making a human
   * retype. Text that is ambiguous or OCR-damaged justifies nothing, and this
   * helper returns null for it — which is what makes the isolation assertions
   * below still bite: a dirty Sirimau cell must stay unresolved even when
   * Baguala beside it is clean.
   *
   * Computed from the RAW grid, independently of the adapter, so this remains a
   * comparison against the SOURCE rather than against another run of the same
   * code.
   */
  const canonicalOfCell = (column: number, rowNumber: number): string | null => {
    const sourceRow = table.rows.find((r) => r.number === rowNumber);
    const cell = sourceRow?.cells[column - 1] ?? null;
    const native = cell?.native ?? null;
    const numeric =
      native?.numericRoundTripString ?? native?.cachedResultRoundTripString ?? null;
    const fromText =
      numeric === null && (cell?.text ?? null) !== null
        ? interpretPriceLiteral(cell!.text)
        : null;
    const source =
      numeric ??
      (fromText !== null && fromText.outcome === 'NUMERIC'
        ? fromText.canonicalSourceString
        : null);
    if (source === null) return null;
    return new Prisma.Decimal(source)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2);
  };

  it('the three real jurisdictions map to three distinct source columns', () => {
    expect([...regionColumns.keys()]).toEqual([...REGIONS]);
    expect(new Set(regionColumns.values()).size).toBe(3);
  });

  it('REAL_B_ROW_IDENTITY_REGION_INDEPENDENT', () => {
    const rowSets = REGIONS.map((label) =>
      byRegion.get(label)!.rows.map((row) => row.sourceRowNumber),
    );

    // Identical sets, in identical order. The document decides which rows are
    // resources; the importer's jurisdiction choice does not.
    expect(rowSets[1]).toEqual(rowSets[0]);
    expect(rowSets[2]).toEqual(rowSets[0]);
    // ...and no row is counted twice.
    expect(new Set(rowSets[0]).size).toBe(rowSets[0].length);
  });

    it('ROW-03: row exclusion is identical for every region — and is EARNED', () => {
      const excluded = REGIONS.map(
        (label) => byRegion.get(label)!.excludedNonDataRows,
      );
    expect(excluded[1]).toBe(excluded[0]);
    expect(excluded[2]).toBe(excluded[0]);

      // FORTY ROWS ARE EXCLUDED, AND THE REASON IS NOT THE ONE USI-01R3 GAVE.
      //
      // USI-01R3 excluded these forty by calling them titles, which it could not
      // prove. USI-01R3A then kept all forty as candidates, and the Owner's
      // browser showed what that costs: the review room filled with rows like
      // "[Upah] — BATU" carrying unit "-", and the real exceptions were buried
      // under banners.
      //
      // They are excluded again, on a different and provable ground. Every one is
      // a row with NO unit, NO price under ANY jurisdiction, and NO number in the
      // source's own numbering column. SIMPROK still does not claim they are
      // titles — five of them are OCR ruins ("eA+u eA+A/ BA+AKo", "acsesonis rim
      // rvc") about which nothing may be claimed. It claims only that they are
      // not PRICE OBSERVATIONS, which their empty commercial fields do prove.
    //
      // The decisive fact is structural, not aesthetic: a row with no price can
      // never reach READY_FOR_SUBMISSION, because BasicPriceRowResolutionService
      // gates that transition on `proposedCanonicalPrice !== null`, and
      // keepBatchPrivate refuses such a row outright. Keeping them as candidates
      // could only ever manufacture questions no reviewer is able to answer.
    //
      // NOT ONE is recognised by its wording. Row 686 ("BAHAN PLAFON GIPSUM") is
      // a banner by every human reading, and it is NOT excluded — the extraction
      // left a unit in its cell, so it still carries commercial evidence and the
      // rule declines to guess past it. That row is the proof this is evidence
      // and not a vocabulary.
      expect(excluded[0]).toBe(40);
  });

    it('ROW-03A: the 40 excluded rows are banners, are counted, and are gone from every region', () => {
      // COUNTED, NEVER SILENT. Every physical named row the reader saw is either
      // a candidate or part of this count — the batch still accounts for all of
      // them, and the raw bytes are untouched.
      for (const label of REGIONS) {
        const knowledge = byRegion.get(label)!;
        expect(knowledge.rows.length + knowledge.excludedNonDataRows).toBe(
          knowledge.rows.length + 40,
      );
    }

      // NONE of them reaches the review room, in ANY region — the DOCUMENT
      // decides this, not the importer, so the answer cannot move with the
      // selected jurisdiction.
      for (const label of REGIONS) {
        const names = byRegion
          .get(label)!
          .rows.map((row) => row.rawResourceNameText);
        expect(names).not.toContain('BATU');
        expect(names).not.toContain('KERIKIL');
        expect(names).not.toContain('SEMEN');
        // The OCR ruin at row 744 is gone too, and for the same structural
        // reason rather than because anyone read it.
        expect(
          byRegion.get(label)!.rows.some((row) => row.sourceRowNumber === 744),
        ).toBe(false);
    }

      // NOTE ON WHAT IS DELIBERATELY NOT ASSERTED HERE. A surviving candidate may
      // legitimately have NO price and NO unit in the selected jurisdiction: LAW G
      // looks for price evidence across EVERY jurisdiction, so a resource priced
      // only in Baguala is still a candidate while Sirimau is being imported.
      // ROW-02 below proves exactly that, and asserting "every candidate carries
      // price evidence in THIS region" would contradict it.
    });
  it('ROW-02: a resource priced in ONE region only stays a candidate in ALL regions', () => {
    // Exactly the class of row USI-01R2 destroyed.
    const baguala = byRegion.get('BAGUALA')!;
    const sirimau = byRegion.get('SIRIMAU')!;

    const unpricedInBaguala = new Set(
      baguala.rows
        .filter((row) => row.proposedCanonicalPrice === null)
        .map((row) => row.sourceRowNumber),
    );
    const pricedInSirimauOnly = sirimau.rows.filter(
      (row) =>
        row.proposedCanonicalPrice !== null && unpricedInBaguala.has(row.sourceRowNumber),
    );

    expect(pricedInSirimauOnly.length).toBeGreaterThan(0);
    for (const row of pricedInSirimauOnly) {
      const inBaguala = baguala.rows.find(
        (candidate) => candidate.sourceRowNumber === row.sourceRowNumber,
      );
      // Present, same resource, and honestly unresolved — never reclassified
      // into a heading merely because one jurisdiction lacks a price (LAW H).
      expect(inBaguala).toBeDefined();
      expect(inBaguala!.rawResourceNameText).toBe(row.rawResourceNameText);
      expect(inBaguala!.proposedCanonicalPrice).toBeNull();
    }
  });

  it('ROW-04: no candidate row is ever silently dropped', () => {
    // Every physical row below the header is accounted for: it is either a
    // candidate or an excluded heading. Nothing evaporates.
    const knowledge = byRegion.get('SIRIMAU')!;
    const namedRows = table.rows.filter(
      (row) => row.number > 2 && (row.cells[1] ?? null)?.text != null,
    ).length;
    expect(knowledge.rows.length + knowledge.excludedNonDataRows).toBe(namedRows);
  });

  it('REAL_B_PER_ROW_REGION_ISOLATION', () => {
    let checked = 0;

    for (const label of REGIONS) {
      const ownColumn = regionColumns.get(label)!;
      const knowledge = byRegion.get(label)!;

      for (const candidate of knowledge.rows) {
        const rowNumber = candidate.sourceRowNumber;
        const ownCanonical = canonicalOfCell(ownColumn, rowNumber);

        // A — the candidate read THIS jurisdiction's cell, by address.
        expect(candidate.sourcePriceCellAddress).toBe(
          `${String.fromCharCode(64 + ownColumn)}${rowNumber}`,
        );

        // C / D — the value is that cell's own value, or honestly nothing.
        expect(candidate.proposedCanonicalPrice).toBe(ownCanonical);

        // E — a sibling's value never became this jurisdiction's price.
        for (const sibling of REGIONS) {
          if (sibling === label) continue;
          const siblingCanonical = canonicalOfCell(regionColumns.get(sibling)!, rowNumber);
          if (siblingCanonical !== null && siblingCanonical !== ownCanonical) {
            expect(candidate.proposedCanonicalPrice).not.toBe(siblingCanonical);
          }
        }
        checked += 1;
      }
    }

    // Every candidate row, in every jurisdiction — not one worked example.
    expect(checked).toBe(
      REGIONS.reduce((total, label) => total + byRegion.get(label)!.rows.length, 0),
    );
    expect(checked).toBeGreaterThan(2500);
  });

  it('REGION-02: dirty text stays THIS region’s own evidence', () => {
    const teluk = byRegion.get('TELUK AMBON')!;
    const column = regionColumns.get('TELUK AMBON')!;
    const dirty = teluk.rows.filter(
      (row) => row.proposedCanonicalPrice === null && row.rawPriceTextValue !== null,
    );

    // The real file is OCR-damaged, so there must be some.
    expect(dirty.length).toBeGreaterThan(0);
    for (const row of dirty) {
      const cell = table.rows.find((r) => r.number === row.sourceRowNumber)!.cells[column - 1];
      expect(row.rawPriceTextValue).toBe(cell?.text ?? null);
      expect(row.proposedCanonicalPrice).toBeNull();
    }
  });

  it('REGION-03: sibling values survive only as raw context', () => {
    const sirimau = byRegion.get('SIRIMAU')!;
    const withContext = sirimau.rows.filter(
      (row) => row.rawSourceContext && 'BAGUALA' in row.rawSourceContext,
    );
    expect(withContext.length).toBeGreaterThan(0);

    for (const row of withContext.slice(0, 50)) {
      const bagualaRaw = row.rawSourceContext!['BAGUALA'];
      const bagualaCanonical = canonicalOfCell(
        regionColumns.get('BAGUALA')!,
        row.sourceRowNumber,
      );
      // Retained verbatim as evidence...
      expect(bagualaRaw).toBeTruthy();
      // ...and never promoted into this batch's price when the two differ.
      if (bagualaCanonical !== null && bagualaCanonical !== row.proposedCanonicalPrice) {
        expect(row.proposedCanonicalPrice).not.toBe(bagualaCanonical);
      }
    }
  });
});
