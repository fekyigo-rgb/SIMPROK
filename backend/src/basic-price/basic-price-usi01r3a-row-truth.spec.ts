import {
  BasicPriceUniversalIntakeAdapter,
  ROW_KIND_AMBIGUOUS_REASON,
  affirmativeHeadingEvidence,
  classifyPhysicalRow,
} from './basic-price-universal-intake.adapter';
import {
  PORTABLE_ROWS,
  PORTABLE_REGIONS,
  buildPortableRegionalMatrixXlsx,
} from '../../test/fixtures/usi01r3a-portable-regional.fixture';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

/**
 * USI-01R3A §5–§9 — WHAT A PHYSICAL ROW IS, PROVEN RATHER THAN ASSUMED.
 *
 * USI-01R3 classified a name-only row as STRUCTURAL_HEADING and DELETED it.
 * The reasoning was "no unit, no price, no number, so it must be a title" —
 * negative inference, and the row paid for it with its existence. A name-only
 * row is equally consistent with an incomplete resource, an OCR-damaged
 * extraction, or an item whose commercial fields were simply left blank.
 *
 * These tests hold the line at the exact place the old rule crossed it: SIMPROK
 * may call a row a heading only when the source AFFIRMATIVELY says so.
 */

/** Nothing proven, so each case below states only what it changes. */
const noEvidence = {
  hasName: true,
  hasUnitEvidence: false,
  hasPriceEvidenceInAnyJurisdiction: false,
  hasRowNumberEvidence: false,
  headingEvidence: null,
} as const;

describe('USI-01R3A — ROW TRUTH: a heading must be proven', () => {
  it('ROWTRUTH-01: name + unit is a RESOURCE_ROW', () => {
    expect(classifyPhysicalRow({ ...noEvidence, hasUnitEvidence: true })).toBe(
      'RESOURCE_ROW',
    );
  });

  it('ROWTRUTH-02: name + a price in ANY jurisdiction is a RESOURCE_ROW', () => {
    // "Any", not "the selected one" — LAW G. A resource priced only in Sirimau
    // is still a resource when Baguala is the batch being imported.
    expect(
      classifyPhysicalRow({
        ...noEvidence,
        hasPriceEvidenceInAnyJurisdiction: true,
      }),
    ).toBe('RESOURCE_ROW');
  });

  it('ROWTRUTH-03: a source-NUMBERED name with no unit and no price is AMBIGUOUS', () => {
    // The document counts this row as an item, which contradicts "title"
    // without proving "resource". Undecided, and therefore kept.
    expect(
      classifyPhysicalRow({ ...noEvidence, hasRowNumberEvidence: true }),
    ).toBe('ROW_KIND_AMBIGUOUS');
  });

  it('ROWTRUTH-04: a name with NO affirmative heading evidence is AMBIGUOUS, never a heading', () => {
    // THE CENTRAL CASE. This is precisely the row USI-01R3 deleted.
    const kind = classifyPhysicalRow(noEvidence);
    expect(kind).toBe('ROW_KIND_AMBIGUOUS');
    expect(kind).not.toBe('STRUCTURAL_HEADING');
  });

  it('ROWTRUTH-05: a row with AFFIRMATIVE heading evidence is a STRUCTURAL_HEADING', () => {
    // The evidence channel is not invented for this test: it is the controlled
    // section-title grammar that has decided SECTIONED_PRICE_LIST since RM-02.
    expect(affirmativeHeadingEvidence('DAFTAR HARGA SATUAN BAHAN')).toBe(
      'SOURCE_SECTION_TITLE_GRAMMAR',
    );
    expect(
      classifyPhysicalRow({
        ...noEvidence,
        headingEvidence: affirmativeHeadingEvidence(
          'DAFTAR HARGA SATUAN BAHAN',
        ),
      }),
    ).toBe('STRUCTURAL_HEADING');
  });

  it('a shouty, short, unpriced name proves NOTHING', () => {
    // Every signal the old rule effectively leaned on, named and refused:
    // capitalization, brevity, and the absence of commercial fields. These are
    // real strings from the Owner's workbook, and not one of them is proof.
    for (const text of [
      'BATU',
      'SEMEN',
      'KERIKIL',
      'BAHAN BESI POLOS',
      'PERALATAN TUKANG',
    ]) {
      expect(affirmativeHeadingEvidence(text)).toBeNull();
      expect(
        classifyPhysicalRow({
          ...noEvidence,
          headingEvidence: affirmativeHeadingEvidence(text),
        }),
      ).toBe('ROW_KIND_AMBIGUOUS');
    }
  });

  it('a stated title that is ALSO priced does not decide — it stays AMBIGUOUS', () => {
    // Two proofs pointing opposite ways. Choosing a winner would be preference.
    expect(
      classifyPhysicalRow({
        ...noEvidence,
        hasUnitEvidence: true,
        headingEvidence: 'SOURCE_SECTION_TITLE_GRAMMAR',
      }),
    ).toBe('ROW_KIND_AMBIGUOUS');
  });

  it('a stated title the document NUMBERED as an item stays AMBIGUOUS', () => {
    expect(
      classifyPhysicalRow({
        ...noEvidence,
        hasRowNumberEvidence: true,
        headingEvidence: 'SOURCE_SECTION_TITLE_GRAMMAR',
      }),
    ).toBe('ROW_KIND_AMBIGUOUS');
  });

  it('EXHAUSTIVE: no input whatsoever yields a heading without affirmative evidence', () => {
    // THE LAW, ENFORCED RATHER THAN ILLUSTRATED. Every case above is an
    // example; this is the whole space. All 32 combinations of the five inputs
    // are enumerated, and the single forbidden outcome — STRUCTURAL_HEADING
    // reached without affirmative heading evidence — is proven unreachable.
    //
    // This is what makes negative inference impossible to reintroduce by
    // accident: any future edit that resurrects "nothing else fit, so it is a
    // title" fails here, whatever shape it takes.
    const flags = [false, true];
    const evidences = [null, 'SOURCE_SECTION_TITLE_GRAMMAR'] as const;
    let cases = 0;
    let headings = 0;

    for (const hasName of flags) {
      for (const hasUnitEvidence of flags) {
        for (const hasPriceEvidenceInAnyJurisdiction of flags) {
          for (const hasRowNumberEvidence of flags) {
            for (const headingEvidence of evidences) {
              const input = {
                hasName,
                hasUnitEvidence,
                hasPriceEvidenceInAnyJurisdiction,
                hasRowNumberEvidence,
                headingEvidence,
              };
              const kind = classifyPhysicalRow(input);
              cases += 1;

              if (kind === 'STRUCTURAL_HEADING') {
                headings += 1;
                // A heading is only ever reached WITH proof, and only when
                // nothing contradicts it.
                expect(headingEvidence).not.toBeNull();
                expect(hasRowNumberEvidence).toBe(false);
                expect(hasUnitEvidence).toBe(false);
                expect(hasPriceEvidenceInAnyJurisdiction).toBe(false);
                expect(hasName).toBe(true);
              }

              // A named row is NEVER classified NON_DATA, and an unnamed row is
              // ALWAYS NON_DATA — so "no name" can never be confused with
              // "nothing proved anything".
              expect(kind === 'NON_DATA').toBe(!hasName);
            }
          }
        }
      }
    }

    expect(cases).toBe(32);
    // Exactly one combination in the whole space is a heading: named, proven,
    // unnumbered, unpriced, unitless.
    expect(headings).toBe(1);
  });

  it('no name at all is NON_DATA', () => {
    expect(classifyPhysicalRow({ ...noEvidence, hasName: false })).toBe(
      'NON_DATA',
    );
  });
});

describe('USI-01R3A — ROW TRUTH through the real domain projection', () => {
  const adapter = new BasicPriceUniversalIntakeAdapter();
  const byRegion = new Map<string, Awaited<ReturnType<typeof adapter.parse>>>();

  beforeAll(async () => {
    const bytes = await buildPortableRegionalMatrixXlsx();
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

  const sourceRowsOfKind = (kind: string) =>
    PORTABLE_ROWS.filter((row) => row.expectedKind === kind);

  it('ROWTRUTH-06: an AMBIGUOUS row survives projection, keeps its reason, and its siblings continue', () => {
    const knowledge = byRegion.get('SIRIMAU')!;
    const ambiguous = sourceRowsOfKind('ROW_KIND_AMBIGUOUS');
    expect(ambiguous.length).toBeGreaterThan(0);

    for (const source of ambiguous) {
      const row = knowledge.rows.find(
        (r) => r.sourceRowNumber === source.rowNumber,
      );
      // VISIBLE — it did not evaporate...
      expect(row).toBeDefined();
      expect(row!.rawResourceNameText).toBe(source.name);
      // ...it SAYS why it is unresolved...
      expect(row!.warnings).toContain(ROW_KIND_AMBIGUOUS_REASON);
      // ...and it never acquired a price it could not justify.
      expect(row!.proposedCanonicalPrice).toBeNull();
    }

    // HEALTHY SIBLINGS CONTINUE. One undecidable row does not fail the batch,
    // and does not contaminate the rows around it.
    for (const source of sourceRowsOfKind('RESOURCE_ROW')) {
      const row = knowledge.rows.find(
        (r) => r.sourceRowNumber === source.rowNumber,
      );
      expect(row).toBeDefined();
      expect(row!.warnings).not.toContain(ROW_KIND_AMBIGUOUS_REASON);
    }
  });

  it('ROWTRUTH-05: only the PROVEN title is excluded, and it is the ONLY exclusion', () => {
    const knowledge = byRegion.get('SIRIMAU')!;
    const headings = sourceRowsOfKind('STRUCTURAL_HEADING');
    expect(headings.length).toBeGreaterThan(0);
    expect(knowledge.excludedNonDataRows).toBe(headings.length);

    for (const source of headings) {
      expect(
        knowledge.rows.some((r) => r.sourceRowNumber === source.rowNumber),
      ).toBe(false);
    }
  });

  it('ROWTRUTH-07: changing the selected region never changes a physical row kind', () => {
    const rowSets = PORTABLE_REGIONS.map((label) =>
      byRegion.get(label)!.rows.map((row) => row.sourceRowNumber),
    );
    expect(rowSets[1]).toEqual(rowSets[0]);
    expect(rowSets[2]).toEqual(rowSets[0]);

    const excluded = PORTABLE_REGIONS.map(
      (label) => byRegion.get(label)!.excludedNonDataRows,
    );
    expect(new Set(excluded).size).toBe(1);

    // And the AMBIGUOUS verdict itself is region-independent — not merely the
    // row's presence. A row that is undecidable in Sirimau is undecidable
    // everywhere, because the document, not the importer, decides.
    const ambiguousPerRegion = PORTABLE_REGIONS.map((label) =>
      byRegion
        .get(label)!
        .rows.filter((row) => row.warnings.includes(ROW_KIND_AMBIGUOUS_REASON))
        .map((row) => row.sourceRowNumber),
    );
    expect(ambiguousPerRegion[0].length).toBeGreaterThan(0);
    expect(ambiguousPerRegion[1]).toEqual(ambiguousPerRegion[0]);
    expect(ambiguousPerRegion[2]).toEqual(ambiguousPerRegion[0]);
  });

  it('nothing is silently dropped: every named row is a candidate or a proven heading', () => {
    const knowledge = byRegion.get('SIRIMAU')!;
    expect(knowledge.rows.length + knowledge.excludedNonDataRows).toBe(
      PORTABLE_ROWS.length,
    );
  });
});
