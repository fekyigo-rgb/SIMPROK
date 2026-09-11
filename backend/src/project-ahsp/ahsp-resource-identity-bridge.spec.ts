import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveResourceIdentity } from '../resource-catalog/resource-identity-resolution.kernel';

/**
 * RESOURCE IDENTITY → AHSP BRIDGE PROOF
 *
 * AHSP already consumes ResourceIdentityResolutionService and stores the
 * catalog id that authority proved. This file does not add a second resolver.
 * It pins the existing seam and re-runs the wording cases against the SAME
 * kernel AHSP's identity service wraps.
 */
const orchestrator = readFileSync(
  join(__dirname, 'ahsp-resource-resolution.orchestrator.ts'),
  'utf8',
);

const CATALOG = {
  id: 'cat-batu-pecah-5-7',
  code: null,
  name: 'Batu Pecah 5/7',
  type: 'MATERIAL' as const,
  baseUnit: 'M³',
  status: 'ACTIVE' as const,
};

describe('AHSP / RAB Resource Identity bridge', () => {
  it('uses the existing Resource Identity authority, not a second resolver', () => {
    expect(orchestrator).toContain(
      "import { ResourceIdentityResolutionService } from '../resource-catalog/resource-identity-resolution.service'",
    );
    expect(orchestrator).toMatch(
      /resourceCatalogId:\s*resolved\s*\?\s*result\.resolvedResourceCatalogId\s*:\s*null/,
    );
    expect(orchestrator).not.toContain('resolveResourceIdentity(');
  });

  it('A. different Basic Price wording nominates the same canonical catalog id', () => {
    const result = resolveResourceIdentity({
      catalogCandidates: [CATALOG],
      sourceSightings: [],
      reviewedMappings: [],
      reference: {
        rawName: 'Batu Pecah 5–7 cm (Makadam)',
        rawCode: null,
        rawUnit: 'm3',
        resourceType: 'MATERIAL',
      },
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.candidates[0].resourceCatalogId).toBe(CATALOG.id);
    expect(result.resolvedResourceCatalogId).toBeNull();
  });

  it('B. different AHSP wording nominates the same canonical catalog id', () => {
    const result = resolveResourceIdentity({
      catalogCandidates: [CATALOG],
      sourceSightings: [],
      reviewedMappings: [],
      reference: {
        rawName: 'Batu Pecah ukuran 5-7',
        rawCode: null,
        rawUnit: 'm3',
        resourceType: 'MATERIAL',
      },
    });
    expect(result.status).toBe('NEEDS_REVIEW');
    expect(result.candidates[0].resourceCatalogId).toBe(CATALOG.id);
  });

  it('C. specification conflict is not RESOURCE_NOT_FOUND and is not admission', () => {
    const result = resolveResourceIdentity({
      catalogCandidates: [CATALOG],
      sourceSightings: [],
      reviewedMappings: [],
      reference: {
        rawName: 'Batu Pecah 2–3 cm',
        rawCode: null,
        rawUnit: 'm3',
        resourceType: 'MATERIAL',
      },
    });
    expect(result.reasonCodes).toContain('SPECIFICATION_CONFLICT');
    expect(result.reasonCodes).not.toContain('RESOURCE_NOT_FOUND');
  });

  it('D. a truly new resource stays UNRESOLVED with zero candidates', () => {
    const result = resolveResourceIdentity({
      catalogCandidates: [CATALOG],
      sourceSightings: [],
      reviewedMappings: [],
      reference: {
        rawName: 'Geotextile Woven Grade X',
        rawCode: null,
        rawUnit: 'M²',
        resourceType: 'MATERIAL',
      },
    });
    expect(result.status).toBe('UNRESOLVED');
    expect(result.reasonCodes).toEqual(['RESOURCE_NOT_FOUND']);
    expect(result.candidates).toHaveLength(0);
  });
});
