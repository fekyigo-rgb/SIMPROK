import {
  BasicPriceUniversalIntakeAdapter,
  affirmativeHeadingEvidence,
  classifyPhysicalRow,
} from './basic-price-universal-intake.adapter';
import { XlsxSourceReader } from '../universal-intake/readers/xlsx.reader';
import { detectTableStructures } from '../universal-intake/structure/structure-detector';
import { INTAKE_ERRORS } from '../universal-intake/intake-errors';
import {
  COLLISION_COLUMNS,
  COLLISION_HEADER_ROW,
  COLLISION_REGIONS,
  COLLISION_ROWS,
  buildUnheadedRegionalMatrixXlsx,
} from '../../test/fixtures/column-role-collision.fixture';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

/**
 * ONE COLUMN CANNOT HOLD TWO ROLES.
 *
 * The Owner's real 934-row Ambon batch was created from an answer that named
 * column 2 as the resource name AND as the unit. Pool membership was the only
 * thing the intake checked, and a column legitimately sits in both pools: the
 * name question prunes what the document disproves, and the unit question keeps
 * the full list because no structural fact can disprove a unit column.
 *
 * SO THE CONTRADICTION WAS ACCEPTED, AND IT WAS NOT A LOCAL MISTAKE. Every row
 * carried its own resource name as its unit; `classifyPhysicalRow` reads
 * `hasUnitEvidence` from the unit column, so 40 category banners looked
 * commercial and entered the review room; and the Unit authority, asked whether
 * a resource name is a unit of measure, truthfully refused for all 934 rows, so
 * not one identity pair could close. One contradictory answer at one door
 * became 934 review problems.
 *
 * THIS SUITE CANNOT SKIP. It builds its own workbook in memory, touches no
 * Owner path, and is the reason the real-file rehearsal is no longer the only
 * guard. Every prior test of this door supplied the honest answer, which is
 * exactly why the collision shipped.
 */
describe('COLUMN-ROLE COLLISION — one column cannot hold two roles', () => {
  const adapter = new BasicPriceUniversalIntakeAdapter();
  let bytes: Buffer;
  let degenerateBytes: Buffer;

  const FILE = 'unheaded-regional-uji.xlsx';

  const parse = (
    source: Buffer,
    selection: Record<string, unknown>,
  ): Promise<Awaited<ReturnType<typeof adapter.parse>>> =>
    adapter.parse(testEnvelope(source, FILE), {
      declaredSection: 'MATERIAL',
      selectedRegionLabel: COLLISION_REGIONS[0],
      ...selection,
    });

  /** The refusal itself, so its OFFERED OPTIONS can be asserted, not just its code. */
  const refusalOf = async (
    source: Buffer,
    selection: Record<string, unknown>,
  ): Promise<{ code: string; details: Record<string, any> }> => {
    try {
      await parse(source, selection);
    } catch (error) {
      const refusal = error as { code: string; details?: Record<string, any> };
      return { code: refusal.code, details: refusal.details ?? {} };
    }
    throw new Error('expected a refusal; the parse was accepted');
  };

  const columnNumbers = (candidates: unknown): number[] =>
    (Array.isArray(candidates) ? candidates : []).map(
      (candidate: { columnNumber: number }) => candidate.columnNumber,
    );

  beforeAll(async () => {
    bytes = await buildUnheadedRegionalMatrixXlsx();
    degenerateBytes = await buildUnheadedRegionalMatrixXlsx({
      withUnitColumn: false,
    });
  }, 60_000);

  it('COLLIDE-00: the collision surface is real — one column sits in BOTH pools', async () => {
    // A guard on the fixture itself. If this shape ever stopped asking the
    // column question, every assertion below would be proving nothing.
    const read = await new XlsxSourceReader().read(testEnvelope(bytes, FILE));
    const detected = detectTableStructures(read.tables[0]).candidates[0];

    expect(detected.structure).toBe('REGIONAL_MATRIX');
    expect(detected.headerRowNumber).toBe(COLLISION_HEADER_ROW);
    expect(detected.columnRoles.required).toBe(true);

    // The name column is offered for BOTH roles, which is not a defect in
    // either list — it is why the answer has to be checked against itself.
    expect(columnNumbers(detected.columnRoles.nameCandidates)).toContain(
      COLLISION_COLUMNS.NAME,
    );
    expect(columnNumbers(detected.columnRoles.unitCandidates)).toContain(
      COLLISION_COLUMNS.NAME,
    );
    expect(columnNumbers(detected.columnRoles.unitCandidates)).toContain(
      COLLISION_COLUMNS.UNIT,
    );
  });

  it('COLLIDE-01: naming ONE column for both roles is refused, and nothing is parsed', async () => {
    await expect(
      parse(bytes, {
        selectedNameColumn: COLLISION_COLUMNS.NAME,
        selectedUnitColumn: COLLISION_COLUMNS.NAME,
      }),
    ).rejects.toMatchObject({
      code: INTAKE_ERRORS.COLUMN_ROLE_SELECTION_REQUIRED,
    });
  });

  it('COLLIDE-02: the question is asked again WITHOUT the impossible option', async () => {
    const { code, details } = await refusalOf(bytes, {
      selectedNameColumn: COLLISION_COLUMNS.NAME,
      selectedUnitColumn: COLLISION_COLUMNS.NAME,
    });

    expect(code).toBe(INTAKE_ERRORS.COLUMN_ROLE_SELECTION_REQUIRED);
    // The column just named as the resource name is gone from the unit
    // options: a button that cannot lead anywhere is not drawn.
    expect(columnNumbers(details.unitCandidates)).not.toContain(
      COLLISION_COLUMNS.NAME,
    );
    // ...and the real unit column is still there, so the question is answerable.
    expect(columnNumbers(details.unitCandidates)).toContain(
      COLLISION_COLUMNS.UNIT,
    );
    expect(columnNumbers(details.unitCandidates).length).toBeGreaterThan(0);
  });

  it('COLLIDE-03: the honest answer is accepted, and no row wears its own name as a unit', async () => {
    const knowledge = await parse(bytes, {
      selectedNameColumn: COLLISION_COLUMNS.NAME,
      selectedUnitColumn: COLLISION_COLUMNS.UNIT,
    });

    const commercial = COLLISION_ROWS.filter(
      (row) => row.expectedKind === 'RESOURCE_ROW',
    );
    expect(knowledge.rows.map((row) => row.sourceRowNumber)).toEqual(
      commercial.map((row) => row.rowNumber),
    );

    for (const row of knowledge.rows) {
      // THE SHAPE OF THE OWNER'S DEFECT, ASSERTED AWAY ROW BY ROW.
      expect(row.sourceUnitCellAddress).not.toBe(row.sourceNameCellAddress);
      expect(row.rawUnitText).not.toBe(row.rawResourceNameText);
      // And the unit read is the source's own unit, from the unit column.
      const source = COLLISION_ROWS.find(
        (candidate) => candidate.rowNumber === row.sourceRowNumber,
      )!;
      expect(row.rawUnitText).toBe(source.unit);
      expect(row.rawResourceNameText).toBe(source.name);
    }
  });

  it('COLLIDE-04: the banner stays out — and the collision is what would have let it in', async () => {
    const knowledge = await parse(bytes, {
      selectedNameColumn: COLLISION_COLUMNS.NAME,
      selectedUnitColumn: COLLISION_COLUMNS.UNIT,
    });
    const banner = COLLISION_ROWS.find(
      (row) => row.expectedKind === 'NO_COMMERCIAL_EVIDENCE',
    )!;

    expect(
      knowledge.rows.find((row) => row.sourceRowNumber === banner.rowNumber),
    ).toBeUndefined();
    expect(knowledge.excludedNonDataRows).toBe(1);

    // WHY THE REPAIR BELONGS UPSTREAM, PROVEN WITHOUT ACCEPTING THE COLLISION.
    // The classifier is not at fault and is not touched: fed the truth it
    // excludes the banner, and fed a name column masquerading as unit evidence
    // it correctly calls the same row a resource. The lie was in the input.
    const asItself = {
      hasName: true,
      hasPriceEvidenceInAnyJurisdiction: false,
      hasRowNumberEvidence: false,
      headingEvidence: affirmativeHeadingEvidence(banner.name),
    };
    expect(classifyPhysicalRow({ ...asItself, hasUnitEvidence: false })).toBe(
      'NO_COMMERCIAL_EVIDENCE',
    );
    expect(classifyPhysicalRow({ ...asItself, hasUnitEvidence: true })).toBe(
      'RESOURCE_ROW',
    );
  });

  it('COLLIDE-05: before the name column is answered there is nothing to filter by', async () => {
    // The first half of the question must offer the full unit list. Narrowing
    // it against an answer nobody has given yet would hide a real option.
    const { details } = await refusalOf(bytes, {});
    expect(columnNumbers(details.unitCandidates)).toContain(
      COLLISION_COLUMNS.NAME,
    );
    expect(columnNumbers(details.unitCandidates)).toContain(
      COLLISION_COLUMNS.UNIT,
    );
  });

  it('COLLIDE-06: a column outside the offered pool is still refused', async () => {
    // The pre-existing guard, kept intact rather than replaced.
    await expect(
      parse(bytes, {
        selectedNameColumn: 99,
        selectedUnitColumn: COLLISION_COLUMNS.UNIT,
      }),
    ).rejects.toMatchObject({
      code: INTAKE_ERRORS.COLUMN_ROLE_SELECTION_REQUIRED,
    });
    await expect(
      parse(bytes, {
        selectedNameColumn: COLLISION_COLUMNS.NAME,
        selectedUnitColumn: 99,
      }),
    ).rejects.toMatchObject({
      code: INTAKE_ERRORS.COLUMN_ROLE_SELECTION_REQUIRED,
    });
  });

  it('COLLIDE-07: THE FALLBACK NEVER REINTRODUCES THE NAMED COLUMN, even when that empties the list', async () => {
    /**
     * THE FAIL-OPEN TRAP, CLOSED.
     *
     * The first form of this repair fell back to the unpruned list whenever
     * filtering emptied it. That sounds safe and is not: it put the named
     * column back on screen in the ONE document where it was the only thing
     * left — precisely the case most likely to be clicked — and the guard
     * would then refuse the click. The person would be offered a button whose
     * only possible outcome was a refusal.
     *
     * So the removal is unconditional. A source with a single
     * non-jurisdiction text column states NO unit column, an empty option
     * list is the truthful way to say that, and `IntakeQuestionPanel` already
     * has an honest sentence for a question it cannot assemble options for.
     * Nothing new was invented to hold this case.
     */
    const { code, details } = await refusalOf(degenerateBytes, {
      selectedNameColumn: COLLISION_COLUMNS.NAME,
      selectedUnitColumn: COLLISION_COLUMNS.NAME,
    });

    expect(code).toBe(INTAKE_ERRORS.COLUMN_ROLE_SELECTION_REQUIRED);
    expect(columnNumbers(details.unitCandidates)).not.toContain(
      COLLISION_COLUMNS.NAME,
    );
    expect(columnNumbers(details.unitCandidates)).toEqual([]);
  });

  it('COLLIDE-08: the named column is absent from the unit options on EVERY refusal that knows it', async () => {
    // The invariant stated once over every reachable refusal shape, so a
    // future edit cannot restore the option through some other branch.
    for (const selection of [
      { selectedNameColumn: COLLISION_COLUMNS.NAME },
      {
        selectedNameColumn: COLLISION_COLUMNS.NAME,
        selectedUnitColumn: COLLISION_COLUMNS.NAME,
      },
      { selectedNameColumn: COLLISION_COLUMNS.NAME, selectedUnitColumn: 99 },
      {
        selectedNameColumn: COLLISION_COLUMNS.UNIT,
        selectedUnitColumn: COLLISION_COLUMNS.UNIT,
      },
    ]) {
      for (const source of [bytes, degenerateBytes]) {
        const { details } = await refusalOf(source, selection);
        expect(columnNumbers(details.unitCandidates)).not.toContain(
          selection.selectedNameColumn,
        );
      }
    }
  });
});
