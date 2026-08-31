import { INTAKE_ERRORS } from '../universal-intake/intake-errors';
import {
  BasicPriceUniversalIntakeAdapter,
  SECTION_DECLARED_BY_UPLOADER_REASON,
} from './basic-price-universal-intake.adapter';
import {
  classifyReimport,
  interpretationsDiffer,
} from './basic-price-reimport.law';
import {
  EQUIPMENT_ROWS,
  buildSemanticHeaderXlsx,
} from '../../test/fixtures/usi01-source-shapes.fixture';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

/**
 * BP-VISUAL-USABILITY-05 — Owner category matrix + reuse causality pins.
 *
 * Document > section title > weak uploader hint is already covered by
 * `basic-price-usi01r-category-truth.spec.ts`. Resolve override for
 * UPLOADER_DECLARED Batu Kali / Batu Belah is covered by
 * `basic-price-row-resolution.service.spec.ts`. This file pins the remaining
 * mission-facing claims without inventing a second category engine.
 */
describe('BP-VISUAL-USABILITY-05 category truth', () => {
  const adapter = new BasicPriceUniversalIntakeAdapter();

  const parse = (bytes: Buffer, selection = {}) =>
    adapter.parse(testEnvelope(bytes, 'bp-visual-05.xlsx'), selection);

  describe('CAT-01 — mixed workbook may hold all three families', () => {
    it('one reading preserves MATERIAL, LABOR and EQUIPMENT together', async () => {
      const bytes = await buildSemanticHeaderXlsx({ includeRowCategories: true });
      const knowledge = await parse(bytes);
      const families = new Set(knowledge.rows.map((row) => row.sourceSection));
      expect([...families].sort()).toEqual(['EQUIPMENT', 'LABOR', 'MATERIAL']);
    });
  });

  describe('CAT-04 / CAT-05 — labor and equipment names keep their families', () => {
    it('Pekerja remains LABOR on source authority', async () => {
      const bytes = await buildSemanticHeaderXlsx({ includeRowCategories: true });
      const row = (await parse(bytes)).rows.find(
        (candidate) => candidate.rawResourceNameText === 'Pekerja Uji Struktur',
      )!;
      expect(row.sourceSection).toBe('LABOR');
    });

    it.each(EQUIPMENT_ROWS.map((row) => row.name))(
      '%s remains EQUIPMENT',
      async (name) => {
        const bytes = await buildSemanticHeaderXlsx({
          includeRowCategories: true,
        });
        const row = (await parse(bytes)).rows.find(
          (candidate) => candidate.rawResourceNameText === name,
        )!;
        expect(row.sourceSection).toBe('EQUIPMENT');
      },
    );
  });

  describe('CAT-06 — document-proven category beats weak batch hint', () => {
    it('declaredSection MATERIAL cannot convert ALAT rows to Bahan', async () => {
      const bytes = await buildSemanticHeaderXlsx({ includeRowCategories: true });
      const knowledge = await parse(bytes, { declaredSection: 'MATERIAL' });
      for (const { name } of EQUIPMENT_ROWS) {
        const row = knowledge.rows.find(
          (candidate) => candidate.rawResourceNameText === name,
        )!;
        expect(row.sourceSection).toBe('EQUIPMENT');
        expect(row.sourceSection).not.toBe('MATERIAL');
      }
    });
  });

  describe('CAT-07 / CAT-08 — ambiguous / unknown category is isolated', () => {
    it('unknown category stays null and does not fail-stop other rows', async () => {
      const bytes = await buildSemanticHeaderXlsx({
        includeRowCategories: true,
        includeUnmappableCategory: true,
      });
      const knowledge = await parse(bytes, { declaredSection: 'MATERIAL' });
      const unknown = knowledge.rows.find(
        (row) => row.rawResourceNameText === 'Sumber Daya Tak Dikenal',
      )!;
      expect(unknown.sourceSection).toBeNull();
      const known = knowledge.rows.filter(
        (row) => row.rawResourceNameText !== 'Sumber Daya Tak Dikenal',
      );
      expect(known.length).toBeGreaterThan(0);
      expect(known.every((row) => row.sourceSection !== null)).toBe(true);
    });
  });

  describe('silent workbook + weak batch hint', () => {
    it('FRESH-BATCH — silent sheet still requires a contextual category hint', async () => {
      const bytes = await buildSemanticHeaderXlsx();
      await expect(parse(bytes)).rejects.toMatchObject({
        code: INTAKE_ERRORS.SECTION_DECLARATION_REQUIRED,
      });
    });

    it('FRESH-BATCH — declaredSection stamps silent rows as UPLOADER_DECLARED only', async () => {
      const bytes = await buildSemanticHeaderXlsx();
      const knowledge = await parse(bytes, { declaredSection: 'LABOR' });
      expect(
        knowledge.rows.every(
          (row) =>
            row.sourceSection === 'LABOR' &&
            row.sourceSectionProvenance === 'UPLOADER_DECLARED',
        ),
      ).toBe(true);
      expect(
        knowledge.rows.every((row) =>
          row.warnings.includes(SECTION_DECLARED_BY_UPLOADER_REASON),
        ),
      ).toBe(true);
    });
  });

  describe('duplicate / reused-batch causality', () => {
    it('exact owned replay does not mutate the existing batch', () => {
      const relation = classifyReimport({
        exactOwnedBatchId: 'existing-batch',
        interpretationSiblingId: null,
        sourceStreamSiblingId: null,
        incomingBatchId: 'incoming-batch',
      });
      expect(relation.classification).toBe('EXACT_EXISTING');
      expect(relation.existingBatchId).toBe('existing-batch');
      expect(relation.updateBatchId).toBeNull();
    });

    it('changing declaredSection is a different interpretation, not a silent rewrite', () => {
      const prior = {
        resourceNameColumn: 1,
        sourceUnitColumn: 2,
        declaredSection: 'LABOR',
      };
      const next = { ...prior, declaredSection: 'MATERIAL' };
      expect(interpretationsDiffer(prior, next)).toBe(true);
      const relation = classifyReimport({
        exactOwnedBatchId: null,
        interpretationSiblingId: 'prior-batch',
        sourceStreamSiblingId: null,
        incomingBatchId: 'fresh-batch',
      });
      expect(relation.classification).toBe('INTERPRETATION_UPDATE');
      expect(relation.existingBatchId).not.toBe(relation.updateBatchId);
    });
  });
});
