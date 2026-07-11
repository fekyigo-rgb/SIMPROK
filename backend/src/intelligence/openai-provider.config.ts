import { Injectable } from '@nestjs/common';

const DEFAULT_TIMEOUT_MS = 30000;

export type OpenAiProviderConfig =
  | { configured: true; apiKey: string; model: string; timeoutMs: number }
  | { configured: false };

/**
 * OPENAI_API_KEY has no default -- absence always means unconfigured.
 * SIMPROK_OPENAI_MODEL must be explicit server config, never client-chosen.
 * Both must be present or the provider is fail-closed (never partially live).
 */
@Injectable()
export class OpenAiProviderConfigService {
  private readonly value: OpenAiProviderConfig;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const model = process.env.SIMPROK_OPENAI_MODEL?.trim();
    const timeoutRaw = Number(process.env.SIMPROK_OPENAI_TIMEOUT_MS);
    const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS;

    this.value =
      apiKey && apiKey.length > 0 && model && model.length > 0
        ? { configured: true, apiKey, model, timeoutMs }
        : { configured: false };
  }

  get(): OpenAiProviderConfig {
    return this.value;
  }
}
