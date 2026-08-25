import { readFileSync } from 'fs';
import { Prisma } from '@prisma/client';
import {
  BasicPriceUniversalIntakeAdapter,
  affirmativeHeadingEvidence,
  classifyPhysicalRow,
} from './basic-price-universal-intake.adapter';
import { XlsxSourceReader } from '../universal-intake/readers/xlsx.reader';
import type { SourceTable } from '../universal-intake/readers/source-table';
import { detectTableStructures } from '../universal-intake/structure/structure-detector';
import {
  PORTABLE_COLUMNS,
  PORTABLE_HEADER_ROW,
  PORTABLE_REGIONS,
  PORTABLE_ROWS,
  PortableRegion,
  buildPortableRegionalMatrixXlsx,
} from '../../test/fixtures/usi01r3a-portable-regional.fixture';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

/**
 * USI-01R3A §10–§12 — PER-ROW REGION ISOLATION, PROVEN WITHOUT OWNER DATA.
 *
 * The real Ambon workbook proves this invariant beautifully and proves it only
 * where it exists. It is Owner business data, it is not in the repository, and
 * its suite therefore SKIPS on every CI runner and every fresh clone — so the
 * single most dangerous defect USI-01R2 ever shipped (a resource erased from
 * one jurisdiction's import because that jurisdiction happened not to price it)
 * would have been guarded on exactly one machine.
 *
 * This suite closes that hole. It builds its own small workbook in memory, it
 * touches no Owner path, and it CANNOT skip: there is no existence probe here
 * and nothing to be absent. The real-file rehearsal remains, and remains the
 * richer proof — this is the one that runs everywhere.
 */
describe('USI-01R3A — PORTABLE regional regression (no Owner files)', () => {
  const adapter = new BasicPriceUniversalIntakeAdapter();
  const byRegion = new Map<string, Awaited<ReturnType<typeof adapter.parse>>>();
  let table: SourceTable;
  let regionColumns: Map<string, number>;

  beforeAll(async () => {
    const bytes = await buildPortableRegionalMatrixXlsx();

    // The RAW grid, read independently of the domain adapter. Every assertion
    // below compares the adapter's output against the SOURCE, never against
    // another run of the same code path — two runs agreeing proves only that
    // the code is deterministic, not that it is right.
    const read = await new XlsxSourceReader().read(
      testEnvelope(bytes, 'portable-regional.xlsx'),
    );
    table = read.tables[0];
    const detected = detectTableStructures(table).candidates[0];
    regionColumns = new Map(
      detected.regionScope.choices.map((choice) => [
        choice.label,
        choice.columnNumber,
      ]),
    );

    for (const label of PORTABLE_REGIONS) {
      byRegion.set(
        label,
        await adapter.parse(testEnvelope(bytes, 'portable-regional.xlsx'), {
          declaredSection: 'MATERIAL',
          selectedRegionLabel: label,
        }),
      );
    }
  }, 60_000);

  /** The canonical value THIS cell alone can justify, from its own evidence. */
  const canonicalOfCell = (
    column: number,
    rowNumber: number,
  ): string | null => {
    const sourceRow = table.rows.find((r) => r.number === rowNumber);
    const native = (sourceRow?.cells[column - 1] ?? null)?.native ?? null;
    const numeric =
      native?.numericRoundTripString ??
      native?.cachedResultRoundTripString ??
      null;
    if (numeric === null) return null;
    return new Prisma.Decimal(numeric)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2);
  };

  const candidateAt = (label: PortableRegion, rowNumber: number) =>
    byRegion.get(label)!.rows.find((row) => row.sourceRowNumber === rowNumber);

  it('REGPORT-10: this suite reads no path and cannot skip', () => {
    // The guard is the test itself: the source of the fixture and of this file
    // must contain no existence probe against an Owner directory.
    const fixture = readFileSync(
      require.resolve('../../test/fixtures/usi01r3a-portable-regional.fixture'),
      'utf8',
    );
    const self = readFileSync(__filename, 'utf8');

    // ASSEMBLED AT RUNTIME, so this guard does not trip over its own source
    // text. Spelling the tokens as literals would fail the very file that
    // performs the check, and the usual escape — exempting this file — would
    // exempt exactly the file most worth checking.
    const forbidden = [
      'exists' + 'Sync',
      'C:' + '/SIMPROK',
      'describe' + '.skip',
    ];
    for (const source of [fixture, self]) {
      for (const token of forbidden) expect(source).not.toContain(token);
    }
    // And the fixture really did produce the three jurisdictions.
    expect([...regionColumns.keys()]).toEqual([...PORTABLE_REGIONS]);
    expect(new Set(regionColumns.values()).size).toBe(3);
    expect(regionColumns.get('SIRIMAU')).toBe(PORTABLE_COLUMNS.SIRIMAU);
    expect(regionColumns.get('TELUK AMBON')).toBe(
      PORTABLE_COLUMNS['TELUK AMBON'],
    );
    expect(regionColumns.get('BAGUALA')).toBe(PORTABLE_COLUMNS.BAGUALA);
  });

  it('REGPORT-01: candidate physical row identity is region-independent', () => {
    const rowSets = PORTABLE_REGIONS.map((label) =>
      byRegion.get(label)!.rows.map((row) => row.sourceRowNumber),
    );
    expect(rowSets[1]).toEqual(rowSets[0]);
    expect(rowSets[2]).toEqual(rowSets[0]);
    expect(new Set(rowSets[0]).size).toBe(rowSets[0].length);

    // The candidate set is exactly "every row that could carry a price" —
    // stated against the fixture's own declared intent. Two kinds are outside
    // it, for two different and separately earned reasons: a PROVEN title, and
    // a row whose commercial fields are all empty under every jurisdiction.
    expect(rowSets[0]).toEqual(
      PORTABLE_ROWS.filter(
        (row) =>
          row.expectedKind !== 'STRUCTURAL_HEADING' &&
          row.expectedKind !== 'NO_COMMERCIAL_EVIDENCE',
      ).map((row) => row.rowNumber),
    );
  });

  it('REGPORT-02: Resource A stays a candidate in BAGUALA though Baguala prices it not at all', () => {
    // Exactly the class of row USI-01R2 destroyed.
    const source = PORTABLE_ROWS.find((row) => row.name === 'Resource A Uji')!;
    expect(source.prices.BAGUALA).toBeNull();

    const inBaguala = candidateAt('BAGUALA', source.rowNumber);
    expect(inBaguala).toBeDefined();
    expect(inBaguala!.rawResourceNameText).toBe(source.name);
    // Present, and HONESTLY unresolved — never reclassified into a heading and
    // never handed a sibling's number.
    expect(inBaguala!.proposedCanonicalPrice).toBeNull();
    // ...while the jurisdiction that DOES price it resolves normally.
    expect(
      candidateAt('SIRIMAU', source.rowNumber)!.proposedCanonicalPrice,
    ).toBe('100000.00');
  });

  it('REGPORT-03: Resource B stays a candidate in SIRIMAU though Sirimau prices it not at all', () => {
    const source = PORTABLE_ROWS.find((row) => row.name === 'Resource B Uji')!;
    expect(source.prices.SIRIMAU).toBeNull();

    const inSirimau = candidateAt('SIRIMAU', source.rowNumber);
    expect(inSirimau).toBeDefined();
    expect(inSirimau!.rawResourceNameText).toBe(source.name);
    expect(inSirimau!.proposedCanonicalPrice).toBeNull();
    expect(
      candidateAt('BAGUALA', source.rowNumber)!.proposedCanonicalPrice,
    ).toBe('210000.00');
  });

  // REGPORT-04/05/06 — one law, proven once per jurisdiction against the raw
  // grid: the selected price is THIS column's own cell, by address and by
  // value, for every candidate row.
  for (const label of PORTABLE_REGIONS) {
    it(`REGPORT-0${PORTABLE_REGIONS.indexOf(label) + 4}: every ${label} price comes ONLY from the ${label} source cell`, () => {
      const ownColumn = regionColumns.get(label)!;
      const knowledge = byRegion.get(label)!;
      let checked = 0;

      for (const candidate of knowledge.rows) {
        const rowNumber = candidate.sourceRowNumber;
        const ownCanonical = canonicalOfCell(ownColumn, rowNumber);

        // A — the candidate read THIS jurisdiction's cell, by address.
        expect(candidate.sourcePriceCellAddress).toBe(
          `${String.fromCharCode(64 + ownColumn)}${rowNumber}`,
        );
        // B — the value is that cell's own value, or honestly nothing.
        expect(candidate.proposedCanonicalPrice).toBe(ownCanonical);

        // C — no sibling's value ever became this jurisdiction's price.
        for (const sibling of PORTABLE_REGIONS) {
          if (sibling === label) continue;
          const siblingCanonical = canonicalOfCell(
            regionColumns.get(sibling)!,
            rowNumber,
          );
          if (siblingCanonical !== null && siblingCanonical !== ownCanonical) {
            expect(candidate.proposedCanonicalPrice).not.toBe(siblingCanonical);
          }
        }
        checked += 1;
      }

      // Every candidate row, not one worked example.
      expect(checked).toBe(knowledge.rows.length);
      expect(checked).toBeGreaterThan(0);
    });
  }

  it('REGPORT-07: dirty selected-region text stays raw evidence and borrows no sibling price', () => {
    const source = PORTABLE_ROWS.find((row) => row.name === 'Resource C Uji')!;
    expect(typeof source.prices.SIRIMAU).toBe('string');

    const dirty = candidateAt('SIRIMAU', source.rowNumber)!;
    const cell = table.rows.find((r) => r.number === source.rowNumber)!.cells[
      regionColumns.get('SIRIMAU')! - 1
    ];

    // The source's own text, verbatim...
    expect(dirty.rawPriceTextValue).toBe(cell?.text ?? null);
    expect(dirty.rawPriceTextValue).toBe(source.prices.SIRIMAU);
    // ...unresolved, because no machine can honestly read a price from it...
    expect(dirty.proposedCanonicalPrice).toBeNull();
    // ...and emphatically NOT the number sitting one column to its right.
    expect(dirty.proposedCanonicalPrice).not.toBe('300000.00');
    // The siblings that CAN be read still resolve, from their own cells.
    expect(
      candidateAt('TELUK AMBON', source.rowNumber)!.proposedCanonicalPrice,
    ).toBe('300000.00');
    expect(
      candidateAt('BAGUALA', source.rowNumber)!.proposedCanonicalPrice,
    ).toBe('310000.00');
  });

  it('REGPORT-08: sibling prices survive as rawSourceContext evidence, never as the selected price', () => {
    const knowledge = byRegion.get('SIRIMAU')!;
    let withSiblingContext = 0;

    for (const candidate of knowledge.rows) {
      const context = candidate.rawSourceContext ?? {};
      for (const sibling of PORTABLE_REGIONS) {
        if (sibling === 'SIRIMAU') continue;
        const siblingCanonical = canonicalOfCell(
          regionColumns.get(sibling)!,
          candidate.sourceRowNumber,
        );
        if (siblingCanonical === null) continue;

        // Retained verbatim under the source's OWN header text...
        expect(context[sibling]).toBeTruthy();
        withSiblingContext += 1;
        // ...and never promoted into this batch's price.
        if (siblingCanonical !== candidate.proposedCanonicalPrice) {
          expect(candidate.proposedCanonicalPrice).not.toBe(siblingCanonical);
        }
      }
      // The SELECTED column is consumed as the price, so it is never repeated
      // into raw context — one fact, one place.
      expect(context).not.toHaveProperty('SIRIMAU');
    }

    expect(withSiblingContext).toBeGreaterThan(0);
  });

  it('REGPORT-09: the name-only row is excluded in every region, and never as a title', () => {
    const source = PORTABLE_ROWS.find(
      (row) => row.expectedKind === 'NO_COMMERCIAL_EVIDENCE',
    )!;

    for (const label of PORTABLE_REGIONS) {
      // NOT a candidate: no unit, no price under ANY jurisdiction, no number.
      // There is no price here to observe, and a priceless row could never
      // reach READY_FOR_SUBMISSION however a reviewer answered it.
      expect(candidateAt(label, source.rowNumber)).toBeUndefined();
    }

    // AND THE CLAIM IS STILL THE NARROW ONE. SIMPROK does not say this row is a
    // title — nothing said so, and the classifier proves it by refusing that
    // verdict for exactly these facts.
    expect(
      classifyPhysicalRow({
        hasName: true,
        hasUnitEvidence: false,
        hasPriceEvidenceInAnyJurisdiction: false,
        hasRowNumberEvidence: false,
        headingEvidence: affirmativeHeadingEvidence(source.name),
      }),
    ).toBe('NO_COMMERCIAL_EVIDENCE');

    // Region-independent, because the DOCUMENT decides it.
    const excluded = PORTABLE_REGIONS.map(
      (label) => byRegion.get(label)!.excludedNonDataRows,
    );
    expect(new Set(excluded).size).toBe(1);
  });

  it('the header, and only the header, sits above the data', () => {
    // A guard on the fixture itself: if detection ever started reading the
    // title block or the header as data, the proofs above would silently be
    // measuring the wrong rows.
    const detected = detectTableStructures(table).candidates[0];
    expect(detected.structure).toBe('REGIONAL_MATRIX');
    expect(detected.headerRowNumber).toBe(PORTABLE_HEADER_ROW);
    expect(
      byRegion
        .get('SIRIMAU')!
        .rows.every((row) => row.sourceRowNumber > PORTABLE_HEADER_ROW),
    ).toBe(true);
  });
});
