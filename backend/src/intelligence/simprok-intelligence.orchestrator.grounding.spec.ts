import { AiProviderConfigService } from './ai-provider.config';
import { ConstitutionalAiBoundaryService } from './constitutional-ai-boundary.service';
import { DisabledIntelligenceProvider } from './disabled-intelligence.provider';
import { IntelligenceProviderRegistryService } from './intelligence-provider-registry';
import {
  ProviderIntelligenceRequest,
  ProviderIntelligenceResponse,
  SimprokIntelligenceProvider,
} from './simprok-intelligence-provider';
import { RabIntelligenceRequest } from './simprok-intelligence.port';
import { SimprokIntelligenceOrchestrator } from './simprok-intelligence.orchestrator';

const SHA256_HEX = /^[a-f0-9]{64}$/;
const SENSITIVE_SPEC_TEXT = 'RAHASIA-SPEC-Beton-K-300-jangan-bocor-ke-evidence';

function fakeRegistryConfig(providerId: string): AiProviderConfigService {
  return { providerId } as AiProviderConfigService;
}

class CapturingProvider implements SimprokIntelligenceProvider {
  readonly providerId = 'capturing-grounding-provider';
  lastRequest?: ProviderIntelligenceRequest;

  constructor(private readonly response: ProviderIntelligenceResponse) {}

  async generateProposal(
    request: ProviderIntelligenceRequest,
  ): Promise<ProviderIntelligenceResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

const baseRequest: RabIntelligenceRequest = {
  requestId: 'req-grounding-1',
  workspaceId: 'workspace-a',
  organizationId: 'org-a',
  projectId: 'project-a',
  accountId: 'account-a',
  boqItemRefs: ['boq-item-1'],
  boqItems: [
    { boqItemRef: 'boq-item-1', wbsCode: '1.1', name: 'Galian tanah', unit: 'm3', quantity: '10' },
  ],
  ahspCandidates: [{ id: 'ahsp-offered', label: 'Pekerjaan Tanah - Manual' }],
  basicPriceCandidates: [],
  // Stable, content-free references only.
  projectContextRef: 'project:project-a',
  mainMaterialSpecRef: 'project:project-a:main-material-spec',
  mainMaterialSpecContext: SENSITIVE_SPEC_TEXT,
  efPermission: 'ALLOWED',
  requestedAction: 'GENERATE_DRAFT_RAB',
};

function envelope(overrides: Partial<ProviderIntelligenceResponse['items'][number]> = {}): ProviderIntelligenceResponse {
  return {
    providerId: 'capturing-grounding-provider',
    modelId: 'test-model',
    status: 'READY',
    items: [
      {
        boqItemRef: 'boq-item-1',
        selectedAhspId: 'ahsp-offered',
        selectedBasicPriceIds: [],
        executionFactorRefs: [],
        confidence: 0.8,
        reasonCodes: ['MATCHED_WORK_TYPE'],
        evidenceRefs: [],
        ...overrides,
      },
    ],
    requestedTools: [],
    warnings: [],
  };
}

function createHarness(provider: SimprokIntelligenceProvider, options?: { ahspFound?: boolean }) {
  const prisma = {
    aHSP: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          options?.ahspFound === false ? null : { id: 'ahsp-offered', workspaceId: baseRequest.workspaceId },
        ),
    },
    basicPrice: {
      findFirst: jest.fn().mockResolvedValue({ id: 'price-x', resource: { id: 'r', baseUnit: 'm3' } }),
    },
  };
  const evidence = { append: jest.fn().mockResolvedValue(undefined) };

  const constitutionalBoundary = new ConstitutionalAiBoundaryService(prisma as any, evidence as any);
  const registry = new IntelligenceProviderRegistryService(
    fakeRegistryConfig(provider.providerId),
    new DisabledIntelligenceProvider(),
  );
  registry.register(provider);
  const orchestrator = new SimprokIntelligenceOrchestrator(registry, constitutionalBoundary);

  return { orchestrator, prisma, evidence };
}

describe('SimprokIntelligenceOrchestrator grounding / candidate allowlist', () => {
  it('forwards boqItems and ahspCandidates to the provider so it can make a grounded choice', async () => {
    const provider = new CapturingProvider(envelope());
    const { orchestrator } = createHarness(provider);

    await orchestrator.proposeRabDraft(baseRequest);

    expect(provider.lastRequest?.boqItems).toEqual(baseRequest.boqItems);
    expect(provider.lastRequest?.ahspCandidates).toEqual(baseRequest.ahspCandidates);
    expect(provider.lastRequest?.basicPriceCandidates).toEqual([]);
    expect(provider.lastRequest?.mainMaterialSpecContext).toBe(SENSITIVE_SPEC_TEXT);
  });

  it('a real canonical AHSP within the offered candidate set is accepted but stays NEEDS_REVIEW (no applicability guard yet)', async () => {
    const provider = new CapturingProvider(envelope());
    const { orchestrator, evidence } = createHarness(provider, { ahspFound: true });

    const proposal = await orchestrator.proposeRabDraft(baseRequest);

    expect(proposal.status).toBe('NEEDS_REVIEW');
    expect(proposal.items[0].selectedAhspId).toBe('ahsp-offered');
    expect(proposal.items[0].reasonCodes).toContain('AHSP_APPLICABILITY_UNVERIFIED');
    expect(evidence.append).toHaveBeenCalledTimes(1);
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'NEEDS_REVIEW',
        reasonCodes: expect.arrayContaining(['AHSP_APPLICABILITY_UNVERIFIED']),
      }),
    );
  });

  it('BOQ-ITEM-COMPLETENESS-01 null selectedAhspId on a requested item must never read as READY', async () => {
    const provider = new CapturingProvider(envelope({ selectedAhspId: null }));
    const { orchestrator, evidence } = createHarness(provider);

    const proposal = await orchestrator.proposeRabDraft(baseRequest);

    expect(proposal.status).toBe('NEEDS_REVIEW');
    expect(proposal.items[0].reasonCodes).toContain('BOQ_ITEM_AHSP_MISSING');
    // This is a coverage/completeness gap, not an applicability question --
    // there is no selection to be unverified about.
    expect(proposal.items[0].reasonCodes).not.toContain('AHSP_APPLICABILITY_UNVERIFIED');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'NEEDS_REVIEW',
        reasonCodes: expect.arrayContaining(['BOQ_ITEM_AHSP_MISSING']),
      }),
    );
  });

  it('rejects an AHSP id the provider picked outside the offered candidate set and never returns READY', async () => {
    const provider = new CapturingProvider(envelope({ selectedAhspId: 'ahsp-not-offered' }));
    const { orchestrator, evidence } = createHarness(provider);

    const proposal = await orchestrator.proposeRabDraft(baseRequest);

    expect(proposal.status).not.toBe('READY');
    expect(proposal.items[0].selectedAhspId).toBeNull();
    expect(proposal.items[0].reasonCodes).toContain('AHSP_NOT_IN_CANDIDATE_SET');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: proposal.status,
        selectedAhspIds: [],
        reasonCodes: expect.arrayContaining(['AHSP_NOT_IN_CANDIDATE_SET']),
      }),
    );
  });

  it('rejects a fabricated AHSP id that does not exist canonically even if candidates were offered', async () => {
    const provider = new CapturingProvider(envelope());
    const { orchestrator, evidence } = createHarness(provider, { ahspFound: false });

    const proposal = await orchestrator.proposeRabDraft(baseRequest);

    expect(proposal.status).toBe('REJECTED_BY_POLICY');
    expect(proposal.items[0].selectedAhspId).toBeNull();
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({ policyRejections: expect.arrayContaining(['AHSP_NOT_CANONICAL']) }),
    );
  });

  it('always strips any Basic Price id when basicPriceCandidates is an explicit empty array and never returns READY', async () => {
    const provider = new CapturingProvider(envelope({ selectedBasicPriceIds: ['price-x'] }));
    const { orchestrator, evidence } = createHarness(provider);

    const proposal = await orchestrator.proposeRabDraft(baseRequest);

    expect(proposal.status).not.toBe('READY');
    expect(proposal.items[0].selectedBasicPriceIds).toEqual([]);
    expect(proposal.items[0].reasonCodes).toContain('BASIC_PRICE_NOT_IN_CANDIDATE_SET');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: proposal.status,
        selectedBasicPriceIds: [],
        reasonCodes: expect.arrayContaining(['BASIC_PRICE_NOT_IN_CANDIDATE_SET']),
      }),
    );
  });

  it('records exactly one append-only evidence entry per request regardless of rejections', async () => {
    const provider = new CapturingProvider(
      envelope({ selectedAhspId: 'ahsp-not-offered', selectedBasicPriceIds: ['price-x'] }),
    );
    const { orchestrator, evidence } = createHarness(provider);

    await orchestrator.proposeRabDraft(baseRequest);

    expect(evidence.append).toHaveBeenCalledTimes(1);
  });

  it('does not attempt any RAB/AHSP/Basic Price/baseline mutation (fakes only expose read methods)', async () => {
    const provider = new CapturingProvider(envelope());
    const { orchestrator, prisma } = createHarness(provider);

    await orchestrator.proposeRabDraft(baseRequest);

    // The fakes only stub findFirst -- if orchestrator/boundary ever called
    // a write method (create/update/delete) it would throw as "not a
    // function", which would fail this test.
    expect(Object.keys(prisma.aHSP)).toEqual(['findFirst']);
    expect(Object.keys(prisma.basicPrice)).toEqual(['findFirst']);
  });

  it('is backward compatible: callers that never set candidate lists skip the allowlist entirely', async () => {
    const provider = new CapturingProvider(
      envelope({ selectedAhspId: 'any-id-at-all', selectedBasicPriceIds: ['any-price'] }),
    );
    const { orchestrator, evidence, prisma } = createHarness(provider, { ahspFound: true });
    prisma.basicPrice.findFirst.mockResolvedValue({ id: 'any-price', resource: { id: 'r', baseUnit: 'm3' } });

    const { ahspCandidates, basicPriceCandidates, ...withoutCandidates } = baseRequest;
    const proposal = await orchestrator.proposeRabDraft(withoutCandidates as RabIntelligenceRequest);

    // No candidate lists supplied -> allowlist is a no-op -> falls through
    // to the existing, unmodified canonical DB validation only.
    expect(proposal.items[0].reasonCodes).not.toContain('AHSP_NOT_IN_CANDIDATE_SET');
    expect(proposal.items[0].reasonCodes).not.toContain('BASIC_PRICE_NOT_IN_CANDIDATE_SET');
    expect(evidence.append).toHaveBeenCalledTimes(1);
  });

  describe('result completeness / boqItemRefs coverage (P8A-3 PM final narrow revise)', () => {
    const twoItemRequest: RabIntelligenceRequest = {
      ...baseRequest,
      boqItemRefs: ['boq-item-1', 'boq-item-2'],
      boqItems: [
        ...baseRequest.boqItems!,
        { boqItemRef: 'boq-item-2', wbsCode: '1.2', name: 'Urugan pasir', unit: 'm3', quantity: '5' },
      ],
    };

    it('an empty items array from the provider is never READY -- the requested ref gets a safe placeholder', async () => {
      const provider = new CapturingProvider({
        providerId: 'capturing-grounding-provider',
        modelId: 'test-model',
        status: 'READY',
        items: [],
        requestedTools: [],
        warnings: [],
      });
      const { orchestrator, evidence } = createHarness(provider);

      const proposal = await orchestrator.proposeRabDraft(baseRequest);

      expect(proposal.status).toBe('NEEDS_REVIEW');
      expect(proposal.items).toHaveLength(1);
      expect(proposal.items[0]).toMatchObject({
        boqItemRef: 'boq-item-1',
        selectedAhspId: null,
        selectedBasicPriceIds: [],
        executionFactorRefs: [],
        confidence: 0,
      });
      expect(proposal.items[0].reasonCodes).toContain('BOQ_ITEM_PROPOSAL_MISSING');
      expect(evidence.append).toHaveBeenCalledTimes(1);
      expect(evidence.append).toHaveBeenCalledWith(expect.objectContaining({ status: 'NEEDS_REVIEW' }));
    });

    it('two requested items, provider returns only one -- the missing one gets a placeholder and status floors to NEEDS_REVIEW', async () => {
      const provider = new CapturingProvider(envelope()); // only returns boq-item-1
      const { orchestrator, evidence } = createHarness(provider, { ahspFound: true });

      const proposal = await orchestrator.proposeRabDraft(twoItemRequest);

      expect(proposal.status).toBe('NEEDS_REVIEW');
      expect(proposal.items).toHaveLength(2);
      const missing = proposal.items.find((item) => item.boqItemRef === 'boq-item-2');
      expect(missing).toMatchObject({
        selectedAhspId: null,
        selectedBasicPriceIds: [],
        executionFactorRefs: [],
        confidence: 0,
        evidenceRefs: [],
      });
      expect(missing?.reasonCodes).toContain('BOQ_ITEM_PROPOSAL_MISSING');
      expect(evidence.append).toHaveBeenCalledTimes(1);
    });

    it('a foreign boqItemRef the provider was never asked about never reaches the response or evidence', async () => {
      const foreignResponse: ProviderIntelligenceResponse = {
        providerId: 'capturing-grounding-provider',
        modelId: 'test-model',
        status: 'READY',
        items: [
          {
            boqItemRef: 'boq-item-1',
            selectedAhspId: 'ahsp-offered',
            selectedBasicPriceIds: [],
            executionFactorRefs: [],
            confidence: 0.8,
            reasonCodes: [],
            evidenceRefs: [],
          },
          {
            boqItemRef: 'boq-item-FOREIGN-not-requested',
            selectedAhspId: 'ahsp-offered',
            selectedBasicPriceIds: [],
            executionFactorRefs: [],
            confidence: 0.9,
            reasonCodes: [],
            evidenceRefs: [],
          },
        ],
        requestedTools: [],
        warnings: [],
      };
      const provider = new CapturingProvider(foreignResponse);
      const { orchestrator, evidence } = createHarness(provider, { ahspFound: true });

      const proposal = await orchestrator.proposeRabDraft(baseRequest);

      expect(proposal.status).not.toBe('READY');
      expect(proposal.items).toHaveLength(1);
      expect(proposal.items.some((item) => item.boqItemRef === 'boq-item-FOREIGN-not-requested')).toBe(false);
      expect(proposal.warnings).toContain('BOQ_ITEM_FOREIGN_REF_DROPPED');

      const record = evidence.append.mock.calls[0][0];
      expect(JSON.stringify(record)).not.toContain('boq-item-FOREIGN-not-requested');
      expect(record.reasonCodes).toContain('BOQ_ITEM_FOREIGN_REF_DROPPED');
    });

    it('a duplicate provider boqItemRef is collapsed deterministically (first kept) and never returns READY', async () => {
      const duplicateResponse: ProviderIntelligenceResponse = {
        providerId: 'capturing-grounding-provider',
        modelId: 'test-model',
        status: 'READY',
        items: [
          {
            boqItemRef: 'boq-item-1',
            selectedAhspId: 'ahsp-offered',
            selectedBasicPriceIds: [],
            executionFactorRefs: [],
            confidence: 0.8,
            reasonCodes: ['FIRST_OCCURRENCE'],
            evidenceRefs: [],
          },
          {
            boqItemRef: 'boq-item-1',
            selectedAhspId: 'ahsp-offered',
            selectedBasicPriceIds: [],
            executionFactorRefs: [],
            confidence: 0.5,
            reasonCodes: ['SECOND_OCCURRENCE'],
            evidenceRefs: [],
          },
        ],
        requestedTools: [],
        warnings: [],
      };
      const provider = new CapturingProvider(duplicateResponse);
      const { orchestrator, evidence } = createHarness(provider, { ahspFound: true });

      const proposal = await orchestrator.proposeRabDraft(baseRequest);

      expect(proposal.status).not.toBe('READY');
      expect(proposal.items).toHaveLength(1);
      expect(proposal.items[0].reasonCodes).toContain('FIRST_OCCURRENCE');
      expect(proposal.items[0].reasonCodes).not.toContain('SECOND_OCCURRENCE');
      expect(proposal.warnings).toContain('BOQ_ITEM_DUPLICATE_REF_DROPPED');
      expect(evidence.append).toHaveBeenCalledTimes(1);

      const record = evidence.append.mock.calls[0][0];
      expect(record.reasonCodes).toContain('BOQ_ITEM_DUPLICATE_REF_DROPPED');
    });
  });

  describe('evidence privacy and integrity (promptInputHash)', () => {
    it('records a real SHA-256 hex digest, never the literal placeholder or raw packet', async () => {
      const provider = new CapturingProvider(envelope());
      const { orchestrator, evidence } = createHarness(provider);

      await orchestrator.proposeRabDraft(baseRequest);

      const record = evidence.append.mock.calls[0][0];
      expect(record.promptInputHash).toMatch(SHA256_HEX);
      expect(record.promptInputHash).not.toBe('NO_RAW_PROMPT_STORED');
    });

    it('produces a stable hash for an identical request and a different hash for a changed request', async () => {
      const providerA = new CapturingProvider(envelope());
      const { orchestrator: orchestratorA, evidence: evidenceA } = createHarness(providerA);
      await orchestratorA.proposeRabDraft(baseRequest);
      const hashA = evidenceA.append.mock.calls[0][0].promptInputHash;

      const providerB = new CapturingProvider(envelope());
      const { orchestrator: orchestratorB, evidence: evidenceB } = createHarness(providerB);
      await orchestratorB.proposeRabDraft(baseRequest);
      const hashB = evidenceB.append.mock.calls[0][0].promptInputHash;

      expect(hashA).toBe(hashB);

      const providerC = new CapturingProvider(envelope());
      const { orchestrator: orchestratorC, evidence: evidenceC } = createHarness(providerC);
      await orchestratorC.proposeRabDraft({
        ...baseRequest,
        mainMaterialSpecContext: 'a different spec entirely',
      });
      const hashC = evidenceC.append.mock.calls[0][0].promptInputHash;

      expect(hashC).not.toBe(hashA);
    });

    it('never persists the project name or raw mainMaterialSpec content in evidence', async () => {
      const provider = new CapturingProvider(envelope());
      const { orchestrator, evidence } = createHarness(provider);

      await orchestrator.proposeRabDraft(baseRequest);

      const record = evidence.append.mock.calls[0][0];
      const serialized = JSON.stringify(record);
      expect(serialized).not.toContain(SENSITIVE_SPEC_TEXT);
      expect(record.sourceReferences).toEqual([
        'project:project-a',
        'project:project-a:main-material-spec',
      ]);
    });
  });

  describe('C3 server-assigned origin label', () => {
    it('a valid provider selection is labeled PROVIDER_PROPOSAL', async () => {
      const provider = new CapturingProvider(envelope());
      const { orchestrator } = createHarness(provider, { ahspFound: true });

      const proposal = await orchestrator.proposeRabDraft(baseRequest);

      expect(proposal.items[0].origin).toBe('PROVIDER_PROPOSAL');
    });

    it('a BOQ_ITEM_PROPOSAL_MISSING placeholder (provider returned nothing for the ref) is labeled NOT_AVAILABLE', async () => {
      const provider = new CapturingProvider({
        providerId: 'capturing-grounding-provider',
        modelId: 'test-model',
        status: 'READY',
        items: [],
        requestedTools: [],
        warnings: [],
      });
      const { orchestrator } = createHarness(provider);

      const proposal = await orchestrator.proposeRabDraft(baseRequest);

      expect(proposal.items[0].reasonCodes).toContain('BOQ_ITEM_PROPOSAL_MISSING');
      expect(proposal.items[0].origin).toBe('NOT_AVAILABLE');
    });

    it('a BOQ_ITEM_AHSP_MISSING item (null selectedAhspId) is labeled NOT_AVAILABLE', async () => {
      const provider = new CapturingProvider(envelope({ selectedAhspId: null }));
      const { orchestrator } = createHarness(provider);

      const proposal = await orchestrator.proposeRabDraft(baseRequest);

      expect(proposal.items[0].reasonCodes).toContain('BOQ_ITEM_AHSP_MISSING');
      expect(proposal.items[0].origin).toBe('NOT_AVAILABLE');
    });

    it('the provider cannot set or override origin -- a smuggled origin field on the raw item is ignored and always server-recomputed', async () => {
      const provider = new CapturingProvider(
        envelope({ ...( { origin: 'PROVIDER_PROPOSAL' } as any) , selectedAhspId: null }),
      );
      const { orchestrator } = createHarness(provider);

      const proposal = await orchestrator.proposeRabDraft(baseRequest);

      // Even though the raw item smuggled origin: 'PROVIDER_PROPOSAL', the
      // server recomputes it from reasonCodes -- selectedAhspId is null
      // (BOQ_ITEM_AHSP_MISSING), so the true origin must be NOT_AVAILABLE.
      expect(proposal.items[0].origin).toBe('NOT_AVAILABLE');
    });

    it('evidence still carries the correct completeness reason code alongside the origin label on the response', async () => {
      const provider = new CapturingProvider(envelope({ selectedAhspId: null }));
      const { orchestrator, evidence } = createHarness(provider);

      const proposal = await orchestrator.proposeRabDraft(baseRequest);

      expect(proposal.items[0].origin).toBe('NOT_AVAILABLE');
      expect(evidence.append).toHaveBeenCalledWith(
        expect.objectContaining({
          reasonCodes: expect.arrayContaining(['BOQ_ITEM_AHSP_MISSING']),
        }),
      );
      // origin is a response-only provenance label -- it is not part of the
      // IntelligenceEvidenceRecord shape at all.
      const record = evidence.append.mock.calls[0][0];
      expect(record.origin).toBeUndefined();
    });

    it('a NOT_AVAILABLE placeholder item has no canonical selection and cannot cause a canonical/BOQ write', async () => {
      const provider = new CapturingProvider({
        providerId: 'capturing-grounding-provider',
        modelId: 'test-model',
        status: 'READY',
        items: [],
        requestedTools: [],
        warnings: [],
      });
      const { orchestrator, prisma } = createHarness(provider);

      const proposal = await orchestrator.proposeRabDraft(baseRequest);

      expect(proposal.items[0].origin).toBe('NOT_AVAILABLE');
      expect(proposal.items[0].selectedAhspId).toBeNull();
      expect(proposal.items[0].selectedBasicPriceIds).toEqual([]);
      // The fakes only stub findFirst (read) -- no create/update/delete
      // exists to call, so no canonical write is structurally possible.
      expect(Object.keys(prisma.aHSP)).toEqual(['findFirst']);
      expect(Object.keys(prisma.basicPrice)).toEqual(['findFirst']);
    });
  });
});
