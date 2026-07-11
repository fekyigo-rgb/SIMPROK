import { Injectable } from '@nestjs/common';

export const DEFAULT_AI_PROVIDER_ID = 'disabled';

/**
 * Reads SIMPROK_AI_PROVIDER once at construction. Unset/blank always falls
 * back to the disabled provider id -- never to a live provider.
 */
@Injectable()
export class AiProviderConfigService {
  readonly providerId: string;

  constructor() {
    const raw = process.env.SIMPROK_AI_PROVIDER?.trim();
    this.providerId = raw && raw.length > 0 ? raw : DEFAULT_AI_PROVIDER_ID;
  }
}
