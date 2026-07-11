import { EfPermission } from './simprok-intelligence.port';
import { SimprokIntelligenceTool } from './simprok-intelligence-tools';

export type ProviderIntelligenceRequest = {
  requestId: string;
  workspaceId: string;
  organizationId: string;
  projectId: string;
  accountId: string;

  action: 'GENERATE_DRAFT_RAB';

  boqItemRefs: string[];
  projectContextRef: string;
  mainMaterialSpecRef?: string;

  efPermission: EfPermission;

  allowedToolNames: readonly SimprokIntelligenceTool[];

  policyVersion: string;
};

export type ProviderIntelligenceProposalItem = {
  boqItemRef: string;
  selectedAhspId: string | null;
  selectedBasicPriceIds: string[];
  executionFactorRefs: string[];
  confidence: number;
  reasonCodes: string[];
  evidenceRefs: string[];
};

export type ProviderIntelligenceResponseStatus = 'READY' | 'PARTIAL' | 'NEEDS_REVIEW';

export type ProviderIntelligenceResponse = {
  providerId: string;
  modelId?: string;

  status: ProviderIntelligenceResponseStatus;

  items: ProviderIntelligenceProposalItem[];

  requestedTools: SimprokIntelligenceTool[];
  warnings: string[];
};

/**
 * Provider-level contract only. Providers never receive PrismaService, a raw
 * database client, shell/filesystem access, arbitrary URLs, controllers, or
 * API keys. Tenant/actor context is always server-supplied via the request.
 */
export interface SimprokIntelligenceProvider {
  readonly providerId: string;

  generateProposal(
    request: ProviderIntelligenceRequest,
  ): Promise<ProviderIntelligenceResponse>;
}

/**
 * Optional, vendor-neutral failure classification any provider error MAY
 * carry (structurally, not by inheritance) so the orchestrator can surface
 * *why* a provider failed in evidence without importing a vendor SDK/type.
 */
export interface ProviderFailureReason {
  readonly reasonCode: string;
}

export function getProviderReasonCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'reasonCode' in error) {
    const code = (error as { reasonCode?: unknown }).reasonCode;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}
