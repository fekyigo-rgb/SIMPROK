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

function fakeRegistryConfig(providerId: string): AiProviderConfigService {
  return { providerId } as AiProviderConfigService;
}

/** Test-only capturing provider: records exactly what request it received. */
class CapturingProvider implements SimprokIntelligenceProvider {
  readonly providerId = 'capturing-test-provider';
  lastRequest?: ProviderIntelligenceRequest;

  constructor(private readonly response: ProviderIntelligenceResponse) {}

  async generateProposal(
    request: ProviderIntelligenceRequest,
  ): Promise<ProviderIntelligenceResponse> {
    this.lastRequest = request;
    return this.response;
  }
}

class ThrowingProvider implements SimprokIntelligenceProvider {
  readonly providerId = 'throwing-test-provider';
  lastRequest?: ProviderIntelligenceRequest;

  async generateProposal(request: ProviderIntelligenceRequest): Promise<ProviderIntelligenceResponse> {
    this.lastRequest = request;
    throw new Error('forced failure');
  }
}

const baseRequest: RabIntelligenceRequest = {
  requestId: 'req-ef-lock-1',
  workspaceId: 'workspace-a',
  organizationId: 'org-a',
  projectId: 'project-a',
  accountId: 'account-a',
  boqSourceRef: 'boq:draft:1',
  boqItemRefs: ['boq-item-1'],
  projectContextRef: 'project-context:project-a',
  mainMaterialSpecRef: 'project:mainMaterialSpec',
  efPermission: 'ALLOWED',
  requestedAction: 'GENERATE_DRAFT_RAB',
};

function validEnvelope(overrides: Partial<ProviderIntelligenceResponse['items'][number]> = {}): ProviderIntelligenceResponse {
  return {
    providerId: 'capturing-test-provider',
    modelId: 'test-model',
    status: 'READY',
    items: [
      {
        boqItemRef: 'boq-item-1',
        selectedAhspId: 'ahsp-a',
        selectedBasicPriceIds: ['price-a'],
        executionFactorRefs: [],
        confidence: 0.8,
        reasonCodes: ['MATCHED_WORK_TYPE'],
        evidenceRefs: ['evidence-1'],
        ...overrides,
      },
    ],
    requestedTools: ['READ_PROJECT_CONTEXT'],
    warnings: [],
  };
}

function createHarness(provider: SimprokIntelligenceProvider) {
  const prisma = {
    aHSP: {
      findFirst: jest.fn().mockResolvedValue({ id: 'ahsp-a', workspaceId: baseRequest.workspaceId }),
    },
    basicPrice: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ id: 'price-a', resource: { id: 'resource-a', baseUnit: 'm3' } }),
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

describe('SimprokIntelligenceOrchestrator AI EF hard lock', () => {
  it('PASS-EF-LOCK-01 caller sends ALLOWED, provider receives NOT_ALLOWED', async () => {
    const provider = new CapturingProvider(validEnvelope());
    const { orchestrator } = createHarness(provider);

    await orchestrator.proposeRabDraft({ ...baseRequest, efPermission: 'ALLOWED' });

    expect(provider.lastRequest?.efPermission).toBe('NOT_ALLOWED');
  });

  it('PASS-EF-LOCK-02 caller sends SELECTED_ITEMS_ONLY, boundary/evidence still use NOT_ALLOWED', async () => {
    const provider = new CapturingProvider(validEnvelope());
    const { orchestrator, evidence } = createHarness(provider);

    const proposal = await orchestrator.proposeRabDraft({
      ...baseRequest,
      efPermission: 'SELECTED_ITEMS_ONLY',
    });

    expect(provider.lastRequest?.efPermission).toBe('NOT_ALLOWED');
    expect(proposal.status).toBe('READY');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({ efPermission: 'NOT_ALLOWED', efReferences: [] }),
    );
  });

  it('PASS-EF-LOCK-03 valid proposal with empty executionFactorRefs proceeds through the existing guarded path', async () => {
    const provider = new CapturingProvider(validEnvelope());
    const { orchestrator, evidence } = createHarness(provider);

    const proposal = await orchestrator.proposeRabDraft({ ...baseRequest, efPermission: 'ALLOWED' });

    expect(proposal.status).toBe('READY');
    expect(proposal.items[0].selectedAhspId).toBe('ahsp-a');
    expect(proposal.warnings).not.toContain('EF_AI_PATH_LOCKED');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'READY',
        efPermission: 'NOT_ALLOWED',
        efReferences: [],
        policyRejections: [],
      }),
    );
  });

  it('BLOCK-EF-LOCK-01 non-empty executionFactorRefs from the provider is not accepted', async () => {
    const provider = new CapturingProvider(validEnvelope({ executionFactorRefs: ['ef-should-be-blocked'] }));
    const { orchestrator, evidence } = createHarness(provider);

    const proposal = await orchestrator.proposeRabDraft({ ...baseRequest, efPermission: 'ALLOWED' });

    expect(proposal.items[0].executionFactorRefs).toEqual([]);
    expect(proposal.warnings).toContain('EF_AI_PATH_LOCKED');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        efReferences: [],
        policyRejections: expect.arrayContaining(['EF_AI_PATH_LOCKED']),
      }),
    );
    // The rest of a valid AHSP/Basic Price proposal still proceeds -- only
    // EF was rejected, not the whole business result.
    expect(proposal.items[0].selectedAhspId).toBe('ahsp-a');
  });

  it('EVIDENCE-EF-LOCK-01 accepted path always persists efPermission=NOT_ALLOWED and efReferences=[]', async () => {
    const provider = new CapturingProvider(validEnvelope({ executionFactorRefs: ['ef-x'] }));
    const { orchestrator, evidence } = createHarness(provider);

    await orchestrator.proposeRabDraft({ ...baseRequest, efPermission: 'ALLOWED' });

    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({ efPermission: 'NOT_ALLOWED', efReferences: [] }),
    );
  });

  it('EVIDENCE-EF-LOCK-01 provider-failure path always persists efPermission=NOT_ALLOWED and efReferences=[]', async () => {
    const provider = new ThrowingProvider();
    const { orchestrator, evidence } = createHarness(provider);

    await orchestrator.proposeRabDraft({ ...baseRequest, efPermission: 'ALLOWED' });

    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PROVIDER_UNAVAILABLE',
        efPermission: 'NOT_ALLOWED',
        efReferences: [],
      }),
    );
  });
});
