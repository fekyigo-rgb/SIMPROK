import { readFileSync } from 'fs';
import { join } from 'path';
import { BasicPriceUniversalIntakeAdapter } from './basic-price-universal-intake.adapter';
import { resolveResourceIdentity } from '../resource-catalog/resource-identity-resolution.kernel';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';

/**
 * BP ACCEPTANCE IDENTITY SPECIMEN
 *
 * A small deterministic source — not production prices, not a national Region
 * dump, not a second identity engine. The four rows are the SAME spellings the
 * golden kernel cases already use (D3 / D3c / H2). The file exists so Owner
 * browser review can upload one short list instead of 898 OCR rows, and so the
 * intake → kernel contract is pinned without inventing Kemendagri data.
 *
 * Region is intentionally ABSENT from this file. The reviewer picks the
 * existing live fixture Wilayah (Kecamatan Teluk Ambon Baguala) as metadata.
 * That is existing reference data, not a fabricated master.
 */
const SPECIMEN = join(
  __dirname,
  '../../test/fixtures/bp-acceptance-identity-specimen.csv',
);

const CATALOG_BATU_PECAH_5_7 = {
  id: 'cat-batu-pecah-5-7',
  code: null,
  name: 'Batu Pecah 5/7',
  type: 'MATERIAL' as const,
  baseUnit: 'M³',
  status: 'ACTIVE' as const,
};

const adapter = new BasicPriceUniversalIntakeAdapter();

const parseSpecimen = () =>
  adapter.parse(testEnvelope(readFileSync(SPECIMEN), 'bp-acceptance-identity-specimen.csv'));

describe('BP acceptance identity specimen', () => {
  it('reads exactly four material rows from the committed specimen', async () => {
    const knowledge = await parseSpecimen();
    expect(knowledge.rows).toHaveLength(4);
    expect(knowledge.rows.map((row) => row.rawResourceNameText)).toEqual([
      'Batu Pecah 5/7',
      'Batu Pecah 5–7 cm (Makadam)',
      'Geotextile Woven Grade X',
      'Batu Pecah 2–3 cm',
    ]);
    expect(new Set(knowledge.rows.map((row) => row.sourceSection))).toEqual(
      new Set(['MATERIAL']),
    );
  });

  it('EXACT: identical catalog wording is machine-proven, not a human guess', async () => {
    const knowledge = await parseSpecimen();
    const row = knowledge.rows[0];
    const result = resolveResourceIdentity({
      catalogCandidates: [CATALOG_BATU_PECAH_5_7],
      sourceSightings: [],
      reviewedMappings: [],
      reference: {
        rawName: row.rawResourceNameText,
        rawCode: row.rawResourceCodeText,
        rawUnit: row.rawUnitText,
        resourceType: row.sourceSection ?? 'MATERIAL',
      },
    });
    expect(result.status).toBe('RESOLVED');
    expect(result.resolvedResourceCatalogId).toBe(CATALOG_BATU_PECAH_5_7.id);
  });

  it('WORDING: 5–7 vs 5/7 nominates the same identity and does not auto-assert it', async () => {
    const knowledge = await parseSpecimen();
    const row = knowledge.rows[1];
    const result = resolveResourceIdentity({
      catalogCandidates: [CATALOG_BATU_PECAH_5_7],
      sourceSightings: [],
      reviewedMappings: [],
      reference: {
        rawName: row.rawResourceNameText,
        rawCode: row.rawResourceCodeText,
        rawUnit: row.rawUnitText,
        resourceType: row.sourceSection ?? 'MATERIAL',
      },
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.candidates.map((c) => c.name)).toContain('Batu Pecah 5/7');
    expect(result.resolvedResourceCatalogId).toBeNull();
    expect(result.reasonCodes).not.toContain('RESOURCE_NOT_FOUND');
  });

  it('NEW: a designation absent from this catalog is UNRESOLVED and admissible, not rejected', async () => {
    const knowledge = await parseSpecimen();
    const row = knowledge.rows[2];
    const result = resolveResourceIdentity({
      catalogCandidates: [CATALOG_BATU_PECAH_5_7],
      sourceSightings: [],
      reviewedMappings: [],
      reference: {
        rawName: row.rawResourceNameText,
        rawCode: row.rawResourceCodeText,
        rawUnit: row.rawUnitText,
        resourceType: row.sourceSection ?? 'MATERIAL',
      },
    });
    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toEqual(['RESOURCE_NOT_FOUND']);
    expect(result.candidates).toHaveLength(0);
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('SPEC CONFLICT: a disjoint size is not a new identity and not a silent merge', async () => {
    const knowledge = await parseSpecimen();
    const row = knowledge.rows[3];
    const result = resolveResourceIdentity({
      catalogCandidates: [CATALOG_BATU_PECAH_5_7],
      sourceSightings: [],
      reviewedMappings: [],
      reference: {
        rawName: row.rawResourceNameText,
        rawCode: row.rawResourceCodeText,
        rawUnit: row.rawUnitText,
        resourceType: row.sourceSection ?? 'MATERIAL',
      },
    });
    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toContain('SPECIFICATION_CONFLICT');
    expect(result.reasonCodes).not.toContain('RESOURCE_NOT_FOUND');
    expect(result.resolvedResourceCatalogId).toBeNull();
  });
});
