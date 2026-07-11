import { Injectable, Optional } from '@nestjs/common';
import { AiProviderConfigService } from './ai-provider.config';
import { DisabledIntelligenceProvider } from './disabled-intelligence.provider';
import { OpenAiIntelligenceProvider } from './openai-intelligence.provider';
import { SimprokIntelligenceProvider } from './simprok-intelligence-provider';

export interface IntelligenceProviderRegistry {
  resolve(providerId?: string): SimprokIntelligenceProvider;
}

/** Thrown when the configured/requested provider id has no registration. Fail closed -- no fallback to another provider. */
export class UnknownIntelligenceProviderError extends Error {
  constructor(readonly providerId: string) {
    super(`Unknown intelligence provider: ${providerId}`);
    this.name = 'UnknownIntelligenceProviderError';
  }
}

/**
 * Server-configuration-driven provider selection. Only the server decides
 * which provider id is the default (via AiProviderConfigService); callers
 * may resolve an explicit id (used by tests), but there is never a silent
 * fallback to a different provider than what was requested or configured.
 */
@Injectable()
export class IntelligenceProviderRegistryService implements IntelligenceProviderRegistry {
  private readonly providers = new Map<string, SimprokIntelligenceProvider>();

  constructor(
    private readonly config: AiProviderConfigService,
    disabledProvider: DisabledIntelligenceProvider,
    @Optional() openAiProvider?: OpenAiIntelligenceProvider,
  ) {
    this.register(disabledProvider);
    if (openAiProvider) {
      this.register(openAiProvider);
    }
  }

  register(provider: SimprokIntelligenceProvider): void {
    this.providers.set(provider.providerId, provider);
  }

  resolve(providerId?: string): SimprokIntelligenceProvider {
    const id = providerId ?? this.config.providerId;
    const provider = this.providers.get(id);
    if (!provider) {
      throw new UnknownIntelligenceProviderError(id);
    }
    return provider;
  }
}
