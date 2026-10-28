import { AhspDocumentCanonicalizationService } from './ahsp-document-canonicalization.service';
import { classifyAhspIdentity } from '../document/ahsp-identity-classifier';

/**
 * Reconciliation proof: these are reproducible behavior discrepancies against
 * the CURRENT main baseline, not an invitation to merge PR197 wholesale.
 * Never connects to the permanent database.
 */
describe('AHSP Import one-truth reconciliation — missing behavior proof', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const resource = { resourceId: '33333333-3333-4333-8333-333333333333', resourceType: 'LABOR', baseUnit: 'OH', coefficient: '1' };
  const existing = {
    ahspId: '22222222-2222-4222-8222-222222222222',
    workspaceId,
    workType: 'A.1',
    methodName: 'Galian tanah',
    code: 'A.1',
    deletedAt: null,
    context: {
      classificationLeafNodeIds: ['leaf-a'],
      classificationComplete: true,
      outputUnitCode: 'M3',
      formulaComplete: true,
      resources: [resource],
      versionId: 'version-1',
    },
  };
  const norm = { name: (x: string) => x.trim().toLowerCase(), code: (x: string) => x.trim().toLowerCase() };

  it('the existing classifier correctly sees changed canonical coefficient as revision evidence', () => {
    const result = classifyAhspIdentity({
      workspaceId, workType: 'A.1', methodName: 'Galian tanah',
      context: { ...existing.context, resources: [{ ...resource, coefficient: '2' }] },
    }, [existing], norm);
    expect(result.verdict).toBe('POSSIBLY_IDENTICAL');
    expect(result.possibleMatches[0]).toMatchObject({
      signal: 'EXACT_PARENT', formulaSame: false, classificationCovered: true,
    });
  });

  it('Import must not erase already-proven formula and classification before asking the classifier', async () => {
    const svc = Object.create(AhspDocumentCanonicalizationService.prototype) as any;
    svc.norm = { normalizeName: norm.name, normalizeCode: norm.code };
    svc.ahspService = { loadIdentitySurface: jest.fn().mockResolvedValue([existing]) };
    svc.units = { resolve: jest.fn().mockImplementation(async (raw: string) => ({
      status: 'RESOLVED', sourceUnitDefinition: { code: raw },
    })) };
    const item = {
      workType: { raw: 'A.1' }, methodName: { raw: 'Galian tanah' },
      resolvedOutputUnit: 'M3',
      resources: [{ resolvedResourceCatalogId: resource.resourceId, group: 'LABOR', resolvedBaseUnit: 'OH', coefficient: 2 }],
      admission: 'PROVEN',
    };
    const evaluated = await svc.refineKnowledgeIdentityForCommit(
      { workItems: [item] }, workspaceId,
      { jenisPengadaanRootId: 'root-1', paths: [{ leafNodeId: 'leaf-a', provenanceHint: 'FROM_USER' }],
        pendingPaths: [], dasarAcuan: null, penerbit: null },
    );
    const result = evaluated.workItems[0];
    expect(result.identityVerdict).toBe('POSSIBLY_IDENTICAL');
    expect(result.identityMatches[0]).toMatchObject({
      signal: 'EXACT_PARENT', formulaSame: false, classificationCovered: true,
    });
  });

  it('an explicit USE_EXISTING revision must not silently turn into ALREADY_PRESENT with no new version', async () => {
    const svc = Object.create(AhspDocumentCanonicalizationService.prototype) as any;
    svc.journal = { settleOrThrow: jest.fn().mockResolvedValue(undefined) };
    svc.recordUseExisting = jest.fn().mockResolvedValue(existing.ahspId);
    svc.audit = { logAction: jest.fn().mockResolvedValue(undefined) };
    svc.assistedClassification = { applyToAhsp: jest.fn().mockResolvedValue({ applied: 1 }) };
    svc.writeItem = jest.fn().mockResolvedValue({
      ahspId: existing.ahspId, versionId: 'version-2',
      admission: 'PROVEN', identityPendingResources: 0, linkedResources: [],
    });
    const item = {
      workType: { raw: 'A.1' }, methodName: { raw: 'Galian tanah' },
      admission: 'PROVEN', identityVerdict: 'POSSIBLY_IDENTICAL',
      identityMatches: [{
        ahspId: existing.ahspId, deleted: false, signal: 'EXACT_PARENT',
        formulaSame: false, classificationCovered: true, currentVersionId: 'version-1',
      }],
      reasonCodes: [], resources: [],
    };
    const tx = {
      aHSP: { findFirst: jest.fn().mockResolvedValue({ id: existing.ahspId }) },
      aHSPVersion: { findFirst: jest.fn().mockResolvedValue({ id: 'version-1' }) },
    };
    const answer = await svc.settleHeldItem(
      item, { source: { contentDigestSha256: 'abc' } },
      { workspaceId, userId: 'owner-1', lineId: 'line-1', decision: 'USE_EXISTING',
        assistedClassification: { jenisPengadaanRootId: null, paths: [], dasarAcuan: null, penerbit: null } },
      tx as any,
    );
    expect(answer.kind).toBe('WRITTEN');
    expect(svc.writeItem).toHaveBeenCalledTimes(1);
  });
});
