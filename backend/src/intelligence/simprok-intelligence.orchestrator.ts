import { Injectable } from '@nestjs/common';
import {
  ConstitutionalAiBoundaryService,
  P8A_POLICY_VERSION,
} from './constitutional-ai-boundary.service';
import { IntelligenceProviderRegistryService } from './intelligence-provider-registry';
import {
  RabIntelligenceProposal,
  RabIntelligenceRequest,
  SimprokIntelligencePort,
} from './simprok-intelligence.port';
import {
  getProviderReasonCode,
  ProviderIntelligenceProposalItem,
  ProviderIntelligenceRequest,
  ProviderIntelligenceResponse,
} from './simprok-intelligence-provider';
import { SIMPROK_INTELLIGENCE_TOOL_ALLOWLIST } from './simprok-intelligence-tools';

const VALID_PROVIDER_STATUSES = new Set<ProviderIntelligenceResponse['status']>([
  'READY',
  'PARTIAL',
  'NEEDS_REVIEW',
]);

/**
 * Business Service -> SimprokIntelligencePort -> Provider Registry ->
 * Selected Provider Adapter -> Constitutional AI Boundary -> Intelligence
 * Evidence -> Draft result only.
 *
 * Any failure (unresolvable provider, provider error, malformed response,
 * constitutional rejection, evidence persistence failure) fails closed:
 * no accepted proposal, no RAB/canonical mutation.
 */
@Injectable()
export class SimprokIntelligenceOrchestrator implements SimprokIntelligencePort {
  constructor(
    private readonly registry: IntelligenceProviderRegistryService,
    private readonly constitutionalBoundary: ConstitutionalAiBoundaryService,
  ) {}

  async proposeRabDraft(request: RabIntelligenceRequest): Promise<RabIntelligenceProposal> {
    let resolvedProviderId: string | undefined;
    let response: ProviderIntelligenceResponse;

    try {
      const provider = this.registry.resolve();
      resolvedProviderId = provider.providerId;
      response = await provider.generateProposal(this.buildProviderRequest(request));
    } catch (error) {
      const result = await this.constitutionalBoundary.providerUnavailable(request, {
        providerIdentifier: resolvedProviderId ?? 'UNRESOLVED_PROVIDER',
        reasonCode: getProviderReasonCode(error),
      });
      return result.proposal;
    }

    if (!this.isWellFormedResponse(response)) {
      const result = await this.constitutionalBoundary.providerUnavailable(request, {
        providerIdentifier: response?.providerId ?? resolvedProviderId ?? 'UNRESOLVED_PROVIDER',
        modelIdentifier: response?.modelId,
      });
      return result.proposal;
    }

    // Spread the full raw response (not just the known-good fields) so the
    // Constitutional Boundary can detect and reject any rogue field a
    // misbehaving provider smuggles in outside the typed contract (e.g. a
    // forbidden `requestedActions`/money field never declared here).
    const rawProposal = {
      ...response,
      requestId: request.requestId,
      status: response.status,
      items: response.items,
      warnings: response.warnings,
    } as RabIntelligenceProposal & Record<string, unknown>;

    const evaluation = await this.constitutionalBoundary.evaluateRabProposal(
      request,
      rawProposal,
      {
        providerIdentifier: response.providerId,
        modelIdentifier: response.modelId,
        promptInputHash: 'NO_RAW_PROMPT_STORED',
        toolsRequested: response.requestedTools,
      },
    );

    return evaluation.proposal;
  }

  private buildProviderRequest(request: RabIntelligenceRequest): ProviderIntelligenceRequest {
    return {
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      organizationId: request.organizationId,
      projectId: request.projectId,
      accountId: request.accountId,
      action: request.requestedAction,
      boqItemRefs: request.boqItemRefs ?? [],
      projectContextRef: request.projectContextRef,
      mainMaterialSpecRef: request.mainMaterialSpecRef,
      efPermission: request.efPermission,
      allowedToolNames: SIMPROK_INTELLIGENCE_TOOL_ALLOWLIST,
      policyVersion: P8A_POLICY_VERSION,
    };
  }

  private isWellFormedResponse(response: ProviderIntelligenceResponse): boolean {
    if (!response || typeof response !== 'object') return false;
    if (typeof response.providerId !== 'string' || response.providerId.length === 0) return false;
    if (!VALID_PROVIDER_STATUSES.has(response.status)) return false;
    if (!Array.isArray(response.items)) return false;
    if (!Array.isArray(response.requestedTools)) return false;
    if (!Array.isArray(response.warnings)) return false;
    return response.items.every((item) => this.isWellFormedItem(item));
  }

  private isWellFormedItem(item: ProviderIntelligenceProposalItem): boolean {
    return (
      !!item &&
      typeof item.boqItemRef === 'string' &&
      (item.selectedAhspId === null || typeof item.selectedAhspId === 'string') &&
      Array.isArray(item.selectedBasicPriceIds) &&
      Array.isArray(item.executionFactorRefs) &&
      typeof item.confidence === 'number' &&
      Array.isArray(item.reasonCodes) &&
      Array.isArray(item.evidenceRefs)
    );
  }
}
