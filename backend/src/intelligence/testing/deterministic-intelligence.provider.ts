import {
  ProviderIntelligenceProposalItem,
  ProviderIntelligenceRequest,
  ProviderIntelligenceResponse,
  SimprokIntelligenceProvider,
} from '../simprok-intelligence-provider';

export const DETERMINISTIC_TEST_PROVIDER_ID = 'deterministic-test';

export type DeterministicIntelligenceScenario =
  | 'VALID'
  | 'FABRICATED_AHSP'
  | 'FABRICATED_BASIC_PRICE'
  | 'CROSS_TENANT_REFERENCE'
  | 'EF_VIOLATION'
  | 'INVALID_CONFIDENCE'
  | 'FORBIDDEN_MONEY'
  | 'FORBIDDEN_ACTION'
  | 'PROVIDER_FAILURE'
  | 'MALFORMED';

/**
 * Test-only fake. Fully deterministic, no network I/O. Never register this
 * as a production/default provider -- it exists solely so unit tests can
 * drive every path of provider -> constitutional guard -> evidence without
 * a live vendor.
 */
export class DeterministicTestIntelligenceProvider implements SimprokIntelligenceProvider {
  readonly providerId = DETERMINISTIC_TEST_PROVIDER_ID;

  constructor(private readonly scenario: DeterministicIntelligenceScenario) {}

  async generateProposal(
    request: ProviderIntelligenceRequest,
  ): Promise<ProviderIntelligenceResponse> {
    if (this.scenario === 'PROVIDER_FAILURE') {
      throw new Error('Deterministic test provider forced failure');
    }

    if (this.scenario === 'MALFORMED') {
      return { providerId: this.providerId } as unknown as ProviderIntelligenceResponse;
    }

    const boqItemRef = request.boqItemRefs[0] ?? 'boq-item-1';
    const baseItem: ProviderIntelligenceProposalItem = {
      boqItemRef,
      selectedAhspId: 'ahsp-a',
      selectedBasicPriceIds: ['price-a'],
      executionFactorRefs: [],
      confidence: 0.8,
      reasonCodes: ['DETERMINISTIC_TEST_MATCH'],
      evidenceRefs: ['deterministic-test:evidence-1'],
    };

    switch (this.scenario) {
      case 'FABRICATED_AHSP':
        return this.envelope([{ ...baseItem, selectedAhspId: 'ahsp-fabricated' }]);
      case 'FABRICATED_BASIC_PRICE':
        return this.envelope([{ ...baseItem, selectedBasicPriceIds: ['price-fabricated'] }]);
      case 'CROSS_TENANT_REFERENCE':
        return this.envelope([{ ...baseItem, selectedAhspId: 'ahsp-workspace-b-only' }]);
      case 'EF_VIOLATION':
        return this.envelope([{ ...baseItem, executionFactorRefs: ['ef-not-allowed'] }]);
      case 'INVALID_CONFIDENCE':
        return this.envelope([{ ...baseItem, confidence: 1.7 }]);
      case 'FORBIDDEN_MONEY':
        return this.envelope([{ ...baseItem, subtotal: 1_000_000 } as unknown as ProviderIntelligenceProposalItem]);
      case 'FORBIDDEN_ACTION':
        return {
          ...this.envelope([baseItem]),
          requestedActions: ['APPROVE', 'PUBLISH'],
        } as unknown as ProviderIntelligenceResponse;
      case 'VALID':
      default:
        return this.envelope([baseItem]);
    }
  }

  private envelope(items: ProviderIntelligenceProposalItem[]): ProviderIntelligenceResponse {
    return {
      providerId: this.providerId,
      modelId: 'deterministic-test-model',
      status: 'READY',
      items,
      requestedTools: ['READ_PROJECT_CONTEXT', 'SEARCH_AHSP', 'SEARCH_BASIC_PRICE'],
      warnings: [],
    };
  }
}
