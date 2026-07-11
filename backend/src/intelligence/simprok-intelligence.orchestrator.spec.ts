import { AiProviderConfigService } from './ai-provider.config';
import { ConstitutionalAiBoundaryService } from './constitutional-ai-boundary.service';
import { DisabledIntelligenceProvider } from './disabled-intelligence.provider';
import { IntelligenceProviderRegistryService } from './intelligence-provider-registry';
import { RabIntelligenceRequest } from './simprok-intelligence.port';
import { SimprokIntelligenceOrchestrator } from './simprok-intelligence.orchestrator';
import { DeterministicTestIntelligenceProvider } from './testing/deterministic-intelligence.provider';

const request: RabIntelligenceRequest = {
  requestId: 'req-orchestrator-1',
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

function config(providerId: string): AiProviderConfigService {
  return { providerId } as AiProviderConfigService;
}

function createHarness(options?: {
  providerId?: string;
  ahspFound?: boolean;
  basicPriceFound?: boolean;
  evidenceAppendRejects?: boolean;
}) {
  const prisma = {
    aHSP: {
      findFirst: jest.fn().mockResolvedValue(
        options?.ahspFound === false
          ? null
          : { id: 'ahsp-a', workspaceId: request.workspaceId },
      ),
    },
    basicPrice: {
      findFirst: jest.fn().mockResolvedValue(
        options?.basicPriceFound === false
          ? null
          : { id: 'price-a', resource: { id: 'resource-a', baseUnit: 'm3' } },
      ),
    },
  };
  const evidence = {
    append: jest.fn(
      options?.evidenceAppendRejects
        ? () => Promise.reject(new Error('append failed'))
        : () => Promise.resolve(),
    ),
  };

  const constitutionalBoundary = new ConstitutionalAiBoundaryService(
    prisma as any,
    evidence as any,
  );
  const registry = new IntelligenceProviderRegistryService(
    config(options?.providerId ?? 'disabled'),
    new DisabledIntelligenceProvider(),
  );
  const orchestrator = new SimprokIntelligenceOrchestrator(registry, constitutionalBoundary);

  return { orchestrator, registry, prisma, evidence };
}

describe('SimprokIntelligenceOrchestrator', () => {
  it('PASS-01 disabled default: no network call, provider-unavailable result, evidence recorded', async () => {
    const { orchestrator, prisma, evidence } = createHarness();

    const proposal = await orchestrator.proposeRabDraft(request);

    expect(proposal.status).toBe('NEEDS_REVIEW');
    expect(proposal.items).toEqual([]);
    expect(proposal.warnings).toEqual(
      expect.arrayContaining(['PROVIDER_UNAVAILABLE', 'MANUAL_REVIEW_AVAILABLE']),
    );
    expect(evidence.append).toHaveBeenCalledTimes(1);
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PROVIDER_UNAVAILABLE', providerIdentifier: 'disabled' }),
    );
    // No canonical lookups were attempted -> proves no business/canonical mutation path was entered.
    expect(prisma.aHSP.findFirst).not.toHaveBeenCalled();
    expect(prisma.basicPrice.findFirst).not.toHaveBeenCalled();
  });

  it('PASS-02 deterministic valid provider: canonical proposal passes the guard and is recorded', async () => {
    const { orchestrator, registry, evidence } = createHarness({ providerId: 'deterministic-test' });
    registry.register(new DeterministicTestIntelligenceProvider('VALID'));

    const proposal = await orchestrator.proposeRabDraft(request);

    expect(proposal.status).toBe('READY');
    expect(proposal.items[0]).toMatchObject({
      boqItemRef: 'boq-item-1',
      selectedAhspId: 'ahsp-a',
      selectedBasicPriceIds: ['price-a'],
    });
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'READY',
        providerIdentifier: 'deterministic-test',
        selectedAhspIds: ['ahsp-a'],
        selectedBasicPriceIds: ['price-a'],
      }),
    );
  });

  it('BLOCK-01 unknown configured provider fails closed without silent fallback', async () => {
    const { orchestrator, evidence } = createHarness({ providerId: 'vendor-unknown' });

    const proposal = await orchestrator.proposeRabDraft(request);

    expect(proposal.status).toBe('NEEDS_REVIEW');
    expect(proposal.warnings).toContain('PROVIDER_UNAVAILABLE');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PROVIDER_UNAVAILABLE',
        providerIdentifier: 'UNRESOLVED_PROVIDER',
      }),
    );
  });

  it('BLOCK-02 malformed provider response is rejected, not trusted', async () => {
    const { orchestrator, registry, prisma, evidence } = createHarness({
      providerId: 'deterministic-test',
    });
    registry.register(new DeterministicTestIntelligenceProvider('MALFORMED'));

    const proposal = await orchestrator.proposeRabDraft(request);

    expect(proposal.status).toBe('NEEDS_REVIEW');
    expect(proposal.items).toEqual([]);
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PROVIDER_UNAVAILABLE' }),
    );
    expect(prisma.aHSP.findFirst).not.toHaveBeenCalled();
  });

  it('BLOCK-03 AI-generated money fields are rejected, never passed through', async () => {
    const { orchestrator, registry, evidence } = createHarness({ providerId: 'deterministic-test' });
    registry.register(new DeterministicTestIntelligenceProvider('FORBIDDEN_MONEY'));

    const proposal = await orchestrator.proposeRabDraft(request);

    expect(proposal.status).toBe('REJECTED_BY_POLICY');
    expect(proposal.warnings).toContain('MODEL_MONEY_REJECTED');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({ policyRejections: expect.arrayContaining(['MODEL_MONEY_REJECTED']) }),
    );
  });

  it('BLOCK-04 forbidden authority actions (approve/publish/lock) are rejected', async () => {
    const { orchestrator, registry, evidence } = createHarness({ providerId: 'deterministic-test' });
    registry.register(new DeterministicTestIntelligenceProvider('FORBIDDEN_ACTION'));

    const proposal = await orchestrator.proposeRabDraft(request);

    expect(proposal.status).toBe('REJECTED_BY_POLICY');
    expect(proposal.warnings).toContain('FORBIDDEN_AUTHORITY_ACTION');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        policyRejections: expect.arrayContaining(['FORBIDDEN_AUTHORITY_ACTION']),
      }),
    );
  });

  it('BLOCK-05 EF violation under NOT_ALLOWED is stripped and recorded', async () => {
    const { orchestrator, registry, evidence } = createHarness({ providerId: 'deterministic-test' });
    registry.register(new DeterministicTestIntelligenceProvider('EF_VIOLATION'));

    const proposal = await orchestrator.proposeRabDraft({ ...request, efPermission: 'NOT_ALLOWED' });

    expect(proposal.items[0].executionFactorRefs).toEqual([]);
    expect(proposal.warnings).toContain('EF_NOT_ALLOWED');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        efPermission: 'NOT_ALLOWED',
        efReferences: [],
        policyRejections: expect.arrayContaining(['EF_NOT_ALLOWED']),
      }),
    );
  });

  it('BLOCK-06 fabricated canonical AHSP/Basic Price is rejected, evidence append-only recorded', async () => {
    const { orchestrator, registry, evidence } = createHarness({
      providerId: 'deterministic-test',
      ahspFound: false,
    });
    registry.register(new DeterministicTestIntelligenceProvider('FABRICATED_AHSP'));

    const proposal = await orchestrator.proposeRabDraft(request);

    expect(proposal.status).toBe('REJECTED_BY_POLICY');
    expect(proposal.items[0].selectedAhspId).toBeNull();
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'REJECTED_BY_POLICY',
        policyRejections: expect.arrayContaining(['AHSP_NOT_CANONICAL']),
      }),
    );
  });

  it('BLOCK-07 provider failure yields no mutation and a structured unavailable result', async () => {
    const { orchestrator, registry, prisma, evidence } = createHarness({
      providerId: 'deterministic-test',
    });
    registry.register(new DeterministicTestIntelligenceProvider('PROVIDER_FAILURE'));

    const proposal = await orchestrator.proposeRabDraft(request);

    expect(proposal.status).toBe('NEEDS_REVIEW');
    expect(proposal.warnings).toContain('PROVIDER_UNAVAILABLE');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'PROVIDER_UNAVAILABLE',
        providerIdentifier: 'deterministic-test',
      }),
    );
    expect(prisma.aHSP.findFirst).not.toHaveBeenCalled();
  });

  it('BLOCK-08 evidence persistence failure prevents any accepted proposal from being returned', async () => {
    const { orchestrator, registry, evidence } = createHarness({
      providerId: 'deterministic-test',
      evidenceAppendRejects: true,
    });
    registry.register(new DeterministicTestIntelligenceProvider('VALID'));

    await expect(orchestrator.proposeRabDraft(request)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INTELLIGENCE_EVIDENCE_PERSISTENCE_FAILED' }),
    });
    expect(evidence.append).toHaveBeenCalledTimes(1);
  });

  it('ISOLATION-01 workspace A cannot resolve a canonical reference private to workspace B', async () => {
    const { orchestrator, registry, prisma, evidence } = createHarness({
      providerId: 'deterministic-test',
      ahspFound: false,
    });
    registry.register(new DeterministicTestIntelligenceProvider('CROSS_TENANT_REFERENCE'));

    const proposal = await orchestrator.proposeRabDraft(request);

    expect(prisma.aHSP.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'ahsp-workspace-b-only',
          OR: [{ workspaceId: request.workspaceId }, { workspaceId: null }],
        }),
      }),
    );
    expect(proposal.status).toBe('REJECTED_BY_POLICY');
    expect(proposal.items[0].selectedAhspId).toBeNull();
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: request.workspaceId,
        policyRejections: expect.arrayContaining(['AHSP_NOT_CANONICAL']),
      }),
    );
  });

  it('invalid confidence from a provider is rejected by the constitutional boundary', async () => {
    const { orchestrator, registry, evidence } = createHarness({ providerId: 'deterministic-test' });
    registry.register(new DeterministicTestIntelligenceProvider('INVALID_CONFIDENCE'));

    const proposal = await orchestrator.proposeRabDraft(request);

    expect(proposal.status).toBe('REJECTED_BY_POLICY');
    expect(evidence.append).toHaveBeenCalledWith(
      expect.objectContaining({
        policyRejections: expect.arrayContaining(['INVALID_CONFIDENCE']),
      }),
    );
  });
});
