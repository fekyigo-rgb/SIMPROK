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
 * AI Execution Factor hard lock (server-side, provider-path only). The AI
 * path never activates EF regardless of what a caller requests -- EF has no
 * Execution Factor Engine / occurrence model behind it yet (see occurrence
 * check, P8A-2B PR #9 pre-merge lock), so the AI path is not permitted to
 * assess or apply it at all. This does not change manual/user-controlled EF
 * behavior anywhere else in SIMPROK.
 */
const AI_EF_EFFECTIVE_PERMISSION: RabIntelligenceRequest['efPermission'] = 'NOT_ALLOWED';
const EF_AI_PATH_LOCKED_REASON = 'EF_AI_PATH_LOCKED';

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
    // Never trust or forward the caller's ALLOWED / SELECTED_ITEMS_ONLY into
    // the provider or the Constitutional Boundary on the AI path.
    const lockedRequest: RabIntelligenceRequest = {
      ...request,
      efPermission: AI_EF_EFFECTIVE_PERMISSION,
    };

    let resolvedProviderId: string | undefined;
    let response: ProviderIntelligenceResponse;

    try {
      const provider = this.registry.resolve();
      resolvedProviderId = provider.providerId;
      response = await provider.generateProposal(this.buildProviderRequest(lockedRequest));
    } catch (error) {
      const result = await this.constitutionalBoundary.providerUnavailable(lockedRequest, {
        providerIdentifier: resolvedProviderId ?? 'UNRESOLVED_PROVIDER',
        reasonCode: getProviderReasonCode(error),
      });
      return result.proposal;
    }

    if (!this.isWellFormedResponse(response)) {
      const result = await this.constitutionalBoundary.providerUnavailable(lockedRequest, {
        providerIdentifier: response?.providerId ?? resolvedProviderId ?? 'UNRESOLVED_PROVIDER',
        modelIdentifier: response?.modelId,
      });
      return result.proposal;
    }

    // A provider response containing any non-empty executionFactorRefs must
    // never be accepted silently. The Constitutional Boundary already strips
    // EF and records EF_NOT_ALLOWED for any NOT_ALLOWED request (defense in
    // depth, unmodified locked logic); this adds one explicit, stable,
    // vendor-neutral marker specifically for the AI-path hard lock so it is
    // auditable as distinct from a normal user-configured NOT_ALLOWED case.
    const efLockTriggered = response.items.some((item) => item.executionFactorRefs.length > 0);

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
      lockedRequest,
      rawProposal,
      {
        providerIdentifier: response.providerId,
        modelIdentifier: response.modelId,
        promptInputHash: 'NO_RAW_PROMPT_STORED',
        toolsRequested: response.requestedTools,
        reasonCode: efLockTriggered ? EF_AI_PATH_LOCKED_REASON : undefined,
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
