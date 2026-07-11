import { AiProviderConfigService } from './ai-provider.config';
import { DisabledIntelligenceProvider } from './disabled-intelligence.provider';
import {
  IntelligenceProviderRegistryService,
  UnknownIntelligenceProviderError,
} from './intelligence-provider-registry';
import { DeterministicTestIntelligenceProvider } from './testing/deterministic-intelligence.provider';

function config(providerId: string): AiProviderConfigService {
  return { providerId } as AiProviderConfigService;
}

describe('IntelligenceProviderRegistryService', () => {
  it('resolves the disabled provider by default when no provider is configured', () => {
    const registry = new IntelligenceProviderRegistryService(
      config('disabled'),
      new DisabledIntelligenceProvider(),
    );

    const provider = registry.resolve();

    expect(provider.providerId).toBe('disabled');
  });

  it('BLOCK-01 fails closed on an unknown configured provider without silent fallback', () => {
    const registry = new IntelligenceProviderRegistryService(
      config('vendor-unknown'),
      new DisabledIntelligenceProvider(),
    );

    expect(() => registry.resolve()).toThrow(UnknownIntelligenceProviderError);
    // Does not silently fall back to the registered disabled provider.
    expect(() => registry.resolve()).not.toThrow(expect.objectContaining({ providerId: 'disabled' }));
  });

  it('resolves an explicitly registered provider only by its own id, never as the default', () => {
    const registry = new IntelligenceProviderRegistryService(
      config('disabled'),
      new DisabledIntelligenceProvider(),
    );
    registry.register(new DeterministicTestIntelligenceProvider('VALID'));

    expect(registry.resolve().providerId).toBe('disabled');
    expect(registry.resolve('deterministic-test').providerId).toBe('deterministic-test');
  });

  it('never resolves an id that was not explicitly registered', () => {
    const registry = new IntelligenceProviderRegistryService(
      config('disabled'),
      new DisabledIntelligenceProvider(),
    );

    expect(() => registry.resolve('openai')).toThrow(UnknownIntelligenceProviderError);
  });
});
