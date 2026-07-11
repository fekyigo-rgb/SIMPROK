const mockResponsesCreate = jest.fn();

jest.mock('openai', () => {
  const actual = jest.requireActual('openai');
  return {
    ...actual,
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      responses: { create: mockResponsesCreate },
    })),
  };
});

import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  AuthenticationError,
  RateLimitError,
} from 'openai';
import { OpenAiIntelligenceProvider, OpenAiProviderError } from './openai-intelligence.provider';
import { OpenAiProviderConfig, OpenAiProviderConfigService } from './openai-provider.config';
import { ProviderIntelligenceRequest } from './simprok-intelligence-provider';

function fakeConfig(value: OpenAiProviderConfig): OpenAiProviderConfigService {
  return { get: () => value } as OpenAiProviderConfigService;
}

const CONFIGURED = {
  configured: true as const,
  apiKey: 'sk-test-key-should-never-leak',
  model: 'gpt-test-model',
  timeoutMs: 5000,
};

const request: ProviderIntelligenceRequest = {
  requestId: 'req-openai-1',
  workspaceId: 'workspace-a',
  organizationId: 'org-a',
  projectId: 'project-a',
  accountId: 'account-a',
  action: 'GENERATE_DRAFT_RAB',
  boqItemRefs: ['boq-item-1'],
  projectContextRef: 'project-context:project-a',
  mainMaterialSpecRef: 'project:mainMaterialSpec',
  efPermission: 'ALLOWED',
  allowedToolNames: ['READ_PROJECT_CONTEXT', 'SEARCH_AHSP'],
  policyVersion: 'P8A-1',
};

function validEnvelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    providerId: 'openai',
    modelId: 'gpt-test-model',
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
      },
    ],
    requestedTools: ['READ_PROJECT_CONTEXT'],
    warnings: [],
    ...overrides,
  };
}

describe('OpenAiIntelligenceProvider', () => {
  beforeEach(() => {
    mockResponsesCreate.mockReset();
  });

  it('PASS-01 parses a valid strict response into the provider contract', async () => {
    mockResponsesCreate.mockResolvedValue({ output_text: JSON.stringify(validEnvelope()) });
    const provider = new OpenAiIntelligenceProvider(fakeConfig(CONFIGURED));

    const response = await provider.generateProposal(request);

    expect(response.status).toBe('READY');
    expect(response.items[0]).toMatchObject({ boqItemRef: 'boq-item-1', selectedAhspId: 'ahsp-a' });
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
  });

  it('does not send the API key or any credential inside the request payload', async () => {
    mockResponsesCreate.mockResolvedValue({ output_text: JSON.stringify(validEnvelope()) });
    const provider = new OpenAiIntelligenceProvider(fakeConfig(CONFIGURED));

    await provider.generateProposal(request);

    const callArgs = mockResponsesCreate.mock.calls[0][0];
    expect(JSON.stringify(callArgs)).not.toContain(CONFIGURED.apiKey);
  });

  it('BLOCK-01 missing API key fails closed as OPENAI_NOT_CONFIGURED with no network call', async () => {
    const provider = new OpenAiIntelligenceProvider(fakeConfig({ configured: false }));

    await expect(provider.generateProposal(request)).rejects.toMatchObject({
      reasonCode: 'OPENAI_NOT_CONFIGURED',
    });
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  it('BLOCK-02 missing model fails closed as OPENAI_NOT_CONFIGURED with no network call', async () => {
    // Server config never lets the client pick a model; an unset model is
    // treated the same as an unset key -- both mean "not configured".
    const provider = new OpenAiIntelligenceProvider(fakeConfig({ configured: false }));

    await expect(provider.generateProposal(request)).rejects.toBeInstanceOf(OpenAiProviderError);
    expect(mockResponsesCreate).not.toHaveBeenCalled();
  });

  it('BLOCK-03 authentication error maps to OPENAI_AUTH_FAILED without leaking the key', async () => {
    mockResponsesCreate.mockRejectedValue(
      new AuthenticationError(
        401,
        { error: { message: `Incorrect API key provided: ${CONFIGURED.apiKey}` } },
        `Incorrect API key provided: ${CONFIGURED.apiKey}`,
        new Headers(),
      ),
    );
    const provider = new OpenAiIntelligenceProvider(fakeConfig(CONFIGURED));

    let caught: unknown;
    try {
      await provider.generateProposal(request);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ reasonCode: 'OPENAI_AUTH_FAILED' });
    expect((caught as Error).message).not.toContain(CONFIGURED.apiKey);
  });

  it('BLOCK-04 timeout/abort maps to OPENAI_TIMEOUT', async () => {
    mockResponsesCreate.mockRejectedValue(new APIConnectionTimeoutError());
    const provider = new OpenAiIntelligenceProvider(fakeConfig(CONFIGURED));

    await expect(provider.generateProposal(request)).rejects.toMatchObject({
      reasonCode: 'OPENAI_TIMEOUT',
    });
  });

  it('BLOCK-04b explicit abort also maps to OPENAI_TIMEOUT', async () => {
    mockResponsesCreate.mockRejectedValue(new APIUserAbortError());
    const provider = new OpenAiIntelligenceProvider(fakeConfig(CONFIGURED));

    await expect(provider.generateProposal(request)).rejects.toMatchObject({
      reasonCode: 'OPENAI_TIMEOUT',
    });
  });

  it('BLOCK-05 rate limit maps to OPENAI_RATE_LIMITED (no silent fallback provider)', async () => {
    mockResponsesCreate.mockRejectedValue(new RateLimitError(429, {}, 'Rate limit reached', new Headers()));
    const provider = new OpenAiIntelligenceProvider(fakeConfig(CONFIGURED));

    await expect(provider.generateProposal(request)).rejects.toMatchObject({
      reasonCode: 'OPENAI_RATE_LIMITED',
    });
    // Only ever calls the configured client once -- no retry, no fallback.
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
  });

  it('network failure maps to OPENAI_NETWORK_ERROR', async () => {
    mockResponsesCreate.mockRejectedValue(new APIConnectionError({ message: 'fetch failed' }));
    const provider = new OpenAiIntelligenceProvider(fakeConfig(CONFIGURED));

    await expect(provider.generateProposal(request)).rejects.toMatchObject({
      reasonCode: 'OPENAI_NETWORK_ERROR',
    });
  });

  it('BLOCK-06 malformed JSON output fails closed as OPENAI_MALFORMED_RESPONSE', async () => {
    mockResponsesCreate.mockResolvedValue({ output_text: '{not valid json' });
    const provider = new OpenAiIntelligenceProvider(fakeConfig(CONFIGURED));

    await expect(provider.generateProposal(request)).rejects.toMatchObject({
      reasonCode: 'OPENAI_MALFORMED_RESPONSE',
    });
  });

  it('missing output_text fails closed as OPENAI_MALFORMED_RESPONSE', async () => {
    mockResponsesCreate.mockResolvedValue({});
    const provider = new OpenAiIntelligenceProvider(fakeConfig(CONFIGURED));

    await expect(provider.generateProposal(request)).rejects.toMatchObject({
      reasonCode: 'OPENAI_MALFORMED_RESPONSE',
    });
  });

  it('BLOCK-07 extra money field on an item is rejected before any business result', async () => {
    mockResponsesCreate.mockResolvedValue({
      output_text: JSON.stringify(
        validEnvelope({
          items: [
            {
              boqItemRef: 'boq-item-1',
              selectedAhspId: 'ahsp-a',
              selectedBasicPriceIds: ['price-a'],
              executionFactorRefs: [],
              confidence: 0.8,
              reasonCodes: [],
              evidenceRefs: [],
              subtotal: 1_000_000,
            },
          ],
        }),
      ),
    });
    const provider = new OpenAiIntelligenceProvider(fakeConfig(CONFIGURED));

    await expect(provider.generateProposal(request)).rejects.toMatchObject({
      reasonCode: 'OPENAI_MALFORMED_RESPONSE',
    });
  });

  it('BLOCK-08 forbidden authority field at the top level is rejected before any business result', async () => {
    mockResponsesCreate.mockResolvedValue({
      output_text: JSON.stringify(validEnvelope({ requestedActions: ['APPROVE', 'PUBLISH'] })),
    });
    const provider = new OpenAiIntelligenceProvider(fakeConfig(CONFIGURED));

    await expect(provider.generateProposal(request)).rejects.toMatchObject({
      reasonCode: 'OPENAI_MALFORMED_RESPONSE',
    });
  });
});
