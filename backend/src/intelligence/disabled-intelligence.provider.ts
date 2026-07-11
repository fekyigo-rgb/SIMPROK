import { Injectable } from '@nestjs/common';
import {
  ProviderIntelligenceRequest,
  ProviderIntelligenceResponse,
  SimprokIntelligenceProvider,
} from './simprok-intelligence-provider';

export const DISABLED_PROVIDER_ID = 'disabled';

/**
 * Thrown by any provider that cannot produce a proposal (disabled, timeout,
 * runtime failure). The orchestrator turns this into a structured
 * provider-unavailable result -- never into a fabricated proposal.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly providerId: string,
    message = 'Intelligence provider is unavailable',
  ) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/**
 * Production-safe default. Makes no network call and never fabricates a
 * proposal; it always fails closed into the provider-unavailable path so a
 * human keeps manual control until a real provider is authorized.
 */
@Injectable()
export class DisabledIntelligenceProvider implements SimprokIntelligenceProvider {
  readonly providerId = DISABLED_PROVIDER_ID;

  async generateProposal(
    _request: ProviderIntelligenceRequest,
  ): Promise<ProviderIntelligenceResponse> {
    throw new ProviderUnavailableError(this.providerId);
  }
}
