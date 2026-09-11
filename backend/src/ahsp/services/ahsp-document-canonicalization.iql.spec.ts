import { buildAhspAnalisaXlsx } from '../document/ahsp-analisa-xlsx.fixture';
import { UNIT_RESOLUTION_STATUS } from '../../unit-kernel/unit-kernel.contracts';
import { identicalQuestionKey } from '../../resource-catalog/identical-question-key';
import { AhspDocumentCanonicalizationService } from './ahsp-document-canonicalization.service';
import { RealityNormalizationEngine } from './reality-normalization.engine';

/**
 * IQL-01 — the AHSP document import consumes APPROVED exact-question answers
 * through the existing resolver, and nothing else changes:
 *   - it asks the resolver about exactly the questions the document states;
 *   - a reading settled by an exact-question answer is NEVER written into the
 *     case-insensitive sighting memory (it would leak to variants and outlive
 *     a REVOKE);
 *   - a committed analysis records WHICH approval it relied on;
 *   - with no exact-question answer involved, output is byte-for-byte as before.
 */
describe('AhspDocumentCanonicalizationService — IQL-01', () => {
  const WORKSPACE = '11111111-1111-4111-8111-111111111111';
  const ahspService = { create: jest.fn(), loadIdentitySurface: jest.fn() };
  const versionService = { createVersion: jest.fn() };
  const units = { resolve: jest.fn() };
  const identity = { loadEvidence: jest.fn(), resolve: jest.fn() };
  const sightings = { createMany: jest.fn() };
  const prisma = { resourceSourceIdentity: sightings };
  const observations = { observeMany: jest.fn() };
  const audit = { logAction: jest.fn() };
  let service: AhspDocumentCanonicalizationService;

  // The fixture analysis states two LABOR components: Pekerja (L.01, OH) and Mandor (L.04, OH).
  const PEKERJA_KEY = identicalQuestionKey({
    workspaceId: WORKSPACE,
    resourceType: 'LABOR',
    rawName: 'Pekerja',
    rawCode: 'L.01',
    rawUnit: 'OH',
  });

  const evidenceWithApproval = {
    catalogCandidates: [],
    sourceSightings: [],
    reviewedMappings: [],
    identicalQuestionScope: { workspaceId: WORKSPACE },
    identicalQuestionDecisions: new Map([[PEKERJA_KEY, { id: 'approval-7' }]]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    units.resolve.mockResolvedValue({
      status: UNIT_RESOLUTION_STATUS.RESOLVED,
      sourceUnitDefinition: { id: 'unit-1' },
    });
    ahspService.create.mockResolvedValue({ id: 'ahsp-1' });
    ahspService.loadIdentitySurface.mockResolvedValue([]);
    versionService.createVersion.mockResolvedValue({ id: 'ver-1' });
    observations.observeMany.mockResolvedValue(undefined);
    audit.logAction.mockResolvedValue(undefined);
    sightings.createMany.mockResolvedValue(undefined);
    service = new AhspDocumentCanonicalizationService(
      ahspService as any,
      versionService as any,
      units as any,
      identity as any,
      prisma as any,
      observations as any,
      new RealityNormalizationEngine(),
      audit as any,
    );
  });

  const envelope = async () =>
    service.sealUpload({
      bytes: await buildAhspAnalisaXlsx(),
      fileName: 'analisa.xlsx',
      mediaType: null,
      workspaceId: WORKSPACE,
      organizationId: '22222222-2222-4222-8222-222222222222',
      actorAccountId: '33333333-3333-4333-8333-333333333333',
    });

  it('asks the resolver about exactly the questions the document states — exact tuple, one preload', async () => {
    identity.loadEvidence.mockResolvedValue({
      catalogCandidates: [],
      sourceSightings: [],
      reviewedMappings: [],
    });
    identity.resolve.mockResolvedValue({
      status: 'RESOLVED',
      authority: 'EXACT_CANONICAL_MATCH',
      resolvedResourceCatalogId: 'cat-x',
    });
    await service.preview(await envelope());
    expect(identity.loadEvidence).toHaveBeenCalledTimes(1);
    const options = identity.loadEvidence.mock.calls[0][3];
    expect(options.identicalQuestionKeys).toEqual(
      expect.arrayContaining([
        PEKERJA_KEY,
        identicalQuestionKey({
          workspaceId: WORKSPACE,
          resourceType: 'LABOR',
          rawName: 'Mandor',
          rawCode: 'L.04',
          rawUnit: 'OH',
        }),
      ]),
    );
  });

  it('a reading settled by an APPROVED exact-question answer is marked, kept out of sightings, and audited on commit', async () => {
    identity.loadEvidence.mockResolvedValue(evidenceWithApproval);
    identity.resolve.mockImplementation(
      (_evidence: unknown, reference: { rawName: string }) =>
        Promise.resolve(
          reference.rawName === 'Pekerja'
            ? {
                status: 'RESOLVED',
                authority: 'VERIFIED_IDENTICAL_QUESTION_REUSED',
                resolvedResourceCatalogId: 'cat-pekerja',
              }
            : {
                status: 'RESOLVED',
                authority: 'EXACT_CANONICAL_MATCH',
                resolvedResourceCatalogId: 'cat-mandor',
              },
        ),
    );

    const result = await service.commit(await envelope(), 'user-1');

    const resources = result.knowledge.workItems[0].resources;
    const pekerja = resources.find(
      (resource) => resource.rawName === 'Pekerja',
    );
    const mandor = resources.find((resource) => resource.rawName === 'Mandor');
    expect(pekerja?.identicalQuestionDecisionId).toBe('approval-7');
    expect(mandor).not.toHaveProperty('identicalQuestionDecisionId');

    // The sighting memory records only the machine-proven reading.
    const written = sightings.createMany.mock.calls[0][0].data as Array<{
      rawName: string;
    }>;
    expect(written.map((row) => row.rawName)).toEqual(['Mandor']);

    // The committed analysis says which governed answer it relied on.
    const reuse = audit.logAction.mock.calls.find(
      ([entry]) => entry.action === 'AHSPImportIdentityFromQuestionDecision',
    );
    expect(reuse?.[0]).toMatchObject({
      ahspId: 'ahsp-1',
      ahspVersionId: 'ver-1',
      who: 'user-1',
      after: {
        resources: [
          expect.objectContaining({
            rawName: 'Pekerja',
            resourceCatalogId: 'cat-pekerja',
            approvalDecisionId: 'approval-7',
          }),
        ],
      },
    });
  });

  it('with no exact-question answer involved, knowledge, sightings and audit are exactly as before', async () => {
    identity.loadEvidence.mockResolvedValue({
      catalogCandidates: [],
      sourceSightings: [],
      reviewedMappings: [],
    });
    identity.resolve.mockResolvedValue({
      status: 'RESOLVED',
      authority: 'EXACT_CANONICAL_MATCH',
      resolvedResourceCatalogId: 'cat-x',
    });
    const result = await service.commit(await envelope(), 'user-1');
    for (const resource of result.knowledge.workItems[0].resources) {
      expect(resource).not.toHaveProperty('identicalQuestionDecisionId');
    }
    const written = sightings.createMany.mock.calls[0][0].data as Array<{
      rawName: string;
    }>;
    expect(written.map((row) => row.rawName).sort()).toEqual([
      'Mandor',
      'Pekerja',
    ]);
    expect(
      audit.logAction.mock.calls.some(
        ([entry]) => entry.action === 'AHSPImportIdentityFromQuestionDecision',
      ),
    ).toBe(false);
  });
});
