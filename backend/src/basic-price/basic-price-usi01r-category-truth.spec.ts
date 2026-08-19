import { INTAKE_ERRORS } from '../universal-intake/intake-errors';
import { resourceFamilyOfCategoryText } from '../universal-intake/structure/header-vocabulary';
import {
  BasicPriceUniversalIntakeAdapter,
  SECTION_DECLARED_BY_UPLOADER_REASON,
  SOURCE_CATEGORY_CONFLICT_REASON,
  SOURCE_CATEGORY_UNRECOGNIZED_REASON,
} from './basic-price-universal-intake.adapter';
import {
  EQUIPMENT_ROWS,
  buildSemanticHeaderXlsx,
} from '../../test/fixtures/usi01-source-shapes.fixture';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';
import { buildBasicPriceXlsx } from '../../test/fixtures/basic-price-xlsx.fixture';

const adapter = new BasicPriceUniversalIntakeAdapter();

/**
 * USI-01R GAP B / LAW 2.8 — ROW-LEVEL CATEGORY TRUTH.
 *
 * The defect these tests exist to prevent is concrete and was real: the Owner's
 * IKK workbook states `category_name = ALAT` on rows holding a Buldozer, an
 * Excavator and a Genset. A single global `declaredSection = MATERIAL` would
 * have filed all three as building materials, and every downstream Unit Kernel
 * and ResourceCatalog decision would then have been made in the wrong context.
 */
describe('USI-01R row-level category truth', () => {
  let categorised: Buffer;
  beforeAll(async () => {
    // One buffer, reused: ExcelJS stamps a fresh creation time per generated
    // workbook, so rebuilding it would change the bytes between assertions.
    categorised = await buildSemanticHeaderXlsx({ includeRowCategories: true });
  });

  const parse = (bytes: Buffer, selection = {}) =>
    adapter.parse(testEnvelope(bytes, 'ikk-shape.xlsx'), selection);

  const rowNamed = (
    knowledge: Awaited<ReturnType<typeof adapter.parse>>,
    name: string,
  ) => knowledge.rows.find((row) => row.rawResourceNameText === name)!;

  describe('CAT-01 — the source’s own per-row category is detected and used', () => {
    it('reads a category column pair without being told it exists', async () => {
      const knowledge = await parse(categorised);
      expect(knowledge.sectionProvenance).toBe('SOURCE_ROW_CATEGORY');
      for (const row of knowledge.rows) {
        expect(row.sourceSectionProvenance).toBe('SOURCE_ROW_CATEGORY');
      }
    });

    it('LAW 2.8 — it does NOT ask a human for something the source already said', async () => {
      // No declaredSection is supplied here, and none is demanded. Asking would
      // be both redundant and dangerous: whatever the human picked would then
      // sit next to contradicting row evidence.
      await expect(parse(categorised)).resolves.toBeDefined();
    });

    it('still asks when the source is genuinely silent about its rows', async () => {
      const uncategorised = await buildSemanticHeaderXlsx();
      await expect(parse(uncategorised)).rejects.toMatchObject({
        code: INTAKE_ERRORS.SECTION_DECLARATION_REQUIRED,
      });
    });
  });

  describe('CAT-02 — ALAT becomes EQUIPMENT, and a bulldozer is never a material', () => {
    it.each(EQUIPMENT_ROWS.map((row) => row.name))(
      '%s is EQUIPMENT on the source’s authority',
      async (name) => {
        const knowledge = await parse(categorised);
        const row = rowNamed(knowledge, name);
        expect(row.sourceSection).toBe('EQUIPMENT');
        expect(row.sourceSectionProvenance).toBe('SOURCE_ROW_CATEGORY');
        expect(row.rawSourceCategoryName).toBe('ALAT');
      },
    );

    it('THE REGRESSION THAT MATTERS: a global MATERIAL declaration cannot convert them', async () => {
      const knowledge = await parse(categorised, { declaredSection: 'MATERIAL' });
      for (const { name } of EQUIPMENT_ROWS) {
        const row = rowNamed(knowledge, name);
        expect(row.sourceSection).toBe('EQUIPMENT');
        expect(row.sourceSection).not.toBe('MATERIAL');
      }
    });
  });

  describe('CAT-03 / CAT-04 — the other two families', () => {
    it('BAHAN becomes MATERIAL', async () => {
      const knowledge = await parse(categorised);
      const row = rowNamed(knowledge, 'Pasir Uji Struktur');
      expect(row).toMatchObject({
        sourceSection: 'MATERIAL',
        rawSourceCategoryName: 'BAHAN',
      });
    });

    it('TENAGA KERJA becomes LABOR', async () => {
      const knowledge = await parse(categorised);
      const row = rowNamed(knowledge, 'Pekerja Uji Struktur');
      expect(row).toMatchObject({
        sourceSection: 'LABOR',
        rawSourceCategoryName: 'TENAGA KERJA',
      });
    });

    it('one reading can legitimately hold all three families at once', async () => {
      const knowledge = await parse(categorised);
      const families = new Set(knowledge.rows.map((row) => row.sourceSection));
      expect([...families].sort()).toEqual(['EQUIPMENT', 'LABOR', 'MATERIAL']);
    });

    it('the vocabulary reads meaning from WORDS, never from a bare code letter', () => {
      // "F" means equipment in the IKK workbook only because those rows also say
      // ALAT. Teaching SIMPROK that F is universally equipment would invent a
      // law out of one document's private shorthand.
      expect(resourceFamilyOfCategoryText('ALAT')).toBe('EQUIPMENT');
      expect(resourceFamilyOfCategoryText('alat')).toBe('EQUIPMENT');
      expect(resourceFamilyOfCategoryText('Peralatan')).toBe('EQUIPMENT');
      expect(resourceFamilyOfCategoryText('F')).toBeNull();
      expect(resourceFamilyOfCategoryText('B')).toBeNull();
    });
  });

  describe('CAT-05 — source vs uploader conflict is flagged, never silent', () => {
    it('the source wins and the disagreement is recorded on the row', async () => {
      const knowledge = await parse(categorised, { declaredSection: 'MATERIAL' });
      const bulldozer = rowNamed(knowledge, 'Buldozer');

      expect(bulldozer.sourceSection).toBe('EQUIPMENT');
      expect(bulldozer.warnings).toContain(SOURCE_CATEGORY_CONFLICT_REASON);
      // ...and a row the human happened to agree with carries no conflict.
      expect(rowNamed(knowledge, 'Pasir Uji Struktur').warnings).not.toContain(
        SOURCE_CATEGORY_CONFLICT_REASON,
      );
    });

    it('a row decided by the source is never labelled as uploader-declared', async () => {
      const knowledge = await parse(categorised, { declaredSection: 'MATERIAL' });
      for (const row of knowledge.rows) {
        expect(row.warnings).not.toContain(SECTION_DECLARED_BY_UPLOADER_REASON);
      }
    });
  });

  describe('CAT-06 — the source’s own words are retained either way', () => {
    it('both the code and the name survive verbatim', async () => {
      const knowledge = await parse(categorised);
      expect(rowNamed(knowledge, 'Excavator')).toMatchObject({
        rawSourceCategoryCode: 'F',
        rawSourceCategoryName: 'ALAT',
      });
    });

    it('category columns are not duplicated into the generic raw context blob', async () => {
      const knowledge = await parse(categorised);
      const row = rowNamed(knowledge, 'Pasir Uji Struktur');
      expect(Object.keys(row.rawSourceContext ?? {})).not.toEqual(
        expect.arrayContaining(['category_code', 'category_name']),
      );
    });
  });

  describe('CAT-07 — an unmappable category stays unresolved, never guessed', () => {
    it('SIMPROK refuses to file an unknown family as anything', async () => {
      const bytes = await buildSemanticHeaderXlsx({
        includeRowCategories: true,
        includeUnmappableCategory: true,
      });
      const knowledge = await parse(bytes, { declaredSection: 'MATERIAL' });
      const unknown = rowNamed(knowledge, 'Sumber Daya Tak Dikenal');

      expect(unknown.sourceSection).toBeNull();
      expect(unknown.sourceSectionProvenance).toBeNull();
      expect(unknown.errors).toContain(SOURCE_CATEGORY_UNRECOGNIZED_REASON);
      // LAW 2.2 — and the words SIMPROK could not read are still on the record.
      expect(unknown.rawSourceCategoryName).toBe('JASA PIHAK KETIGA');
      expect(unknown.rawSourceCategoryCode).toBe('Z');
    });

    it('the uploader’s blanket answer does NOT rescue an unknown category', async () => {
      // Falling back to declaredSection here is exactly how an unrecognized
      // family gets silently absorbed into MATERIAL.
      const bytes = await buildSemanticHeaderXlsx({
        includeRowCategories: true,
        includeUnmappableCategory: true,
      });
      const knowledge = await parse(bytes, { declaredSection: 'MATERIAL' });
      expect(rowNamed(knowledge, 'Sumber Daya Tak Dikenal').sourceSection).not.toBe(
        'MATERIAL',
      );
    });

    it('§15 — one unresolved row does not cancel its healthy siblings', async () => {
      const bytes = await buildSemanticHeaderXlsx({
        includeRowCategories: true,
        includeUnmappableCategory: true,
      });
      const knowledge = await parse(bytes);
      const resolved = knowledge.rows.filter((row) => row.sourceSection !== null);
      expect(resolved.length).toBe(knowledge.rows.length - 1);
      expect(resolved.length).toBeGreaterThan(5);
    });
  });

  describe('the sectioned RM-02 workbook keeps its own provenance', () => {
    it('a section TITLE is source evidence, distinct from a per-row category', async () => {
      const knowledge = await adapter.parse(
        testEnvelope(await buildBasicPriceXlsx(), 'legacy.xlsx'),
      );
      expect(knowledge.sectionProvenance).toBe('SOURCE_SECTION_TITLE');
      for (const row of knowledge.rows) {
        expect(row.sourceSectionProvenance).toBe('SOURCE_SECTION_TITLE');
        expect(row.rawSourceCategoryName).toBeNull();
      }
    });
  });
});
