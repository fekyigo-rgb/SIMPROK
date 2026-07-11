import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  ConstitutionalAiBoundaryService,
  P8A_POLICY_VERSION,
} from './constitutional-ai-boundary.service';
import { IntelligenceProviderRegistryService } from './intelligence-provider-registry';
import {
  RabIntelligenceProposal,
  RabIntelligenceProposalItem,
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
const AHSP_NOT_IN_CANDIDATE_SET_REASON = 'AHSP_NOT_IN_CANDIDATE_SET';
const BASIC_PRICE_NOT_IN_CANDIDATE_SET_REASON = 'BASIC_PRICE_NOT_IN_CANDIDATE_SET';
/**
 * No deterministic domain/applicability guard exists yet to prove a
 * selected AHSP genuinely fits the BOQ item's work type (see P8A-3 PM
 * revise: bounded canonical candidate window is not proof of relevance).
 * Any surviving AHSP selection therefore keeps the proposal at NEEDS_REVIEW
 * at most -- it is never allowed to read as READY.
 */
const AHSP_APPLICABILITY_UNVERIFIED_REASON = 'AHSP_APPLICABILITY_UNVERIFIED';
/**
 * Result-completeness markers (P8A-3 PM final narrow revise). When a caller
 * supplies explicit boqItemRefs, the response must cover exactly that set --
 * one item per requested ref, no more, no less -- before it can ever read
 * as READY.
 */
const BOQ_ITEM_PROPOSAL_MISSING_REASON = 'BOQ_ITEM_PROPOSAL_MISSING';
const BOQ_ITEM_AHSP_MISSING_REASON = 'BOQ_ITEM_AHSP_MISSING';
const BOQ_ITEM_FOREIGN_REF_DROPPED_REASON = 'BOQ_ITEM_FOREIGN_REF_DROPPED';
const BOQ_ITEM_DUPLICATE_REF_DROPPED_REASON = 'BOQ_ITEM_DUPLICATE_REF_DROPPED';
/**
 * origin is a read-only, server-assigned provenance label (C3). The AI
 * provider contract has no such field at all, so a provider cannot send or
 * influence it; it is computed here, strictly after the Constitutional
 * Boundary has already evaluated and persisted evidence, from the reason
 * codes already on the final item. It never causes a canonical/BOQ write.
 */
const ORIGIN_NOT_AVAILABLE = 'NOT_AVAILABLE';
const ORIGIN_PROVIDER_PROPOSAL = 'PROVIDER_PROPOSAL';

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

    // Built once, used both to call the provider and to hash exactly what
    // was actually sent (never the raw packet itself is stored -- see
    // hashProviderRequest).
    const providerRequest = this.buildProviderRequest(lockedRequest);
    const promptInputHash = this.hashProviderRequest(providerRequest);

    let resolvedProviderId: string | undefined;
    let response: ProviderIntelligenceResponse;

    try {
      const provider = this.registry.resolve();
      resolvedProviderId = provider.providerId;
      response = await provider.generateProposal(providerRequest);
    } catch (error) {
      const result = await this.constitutionalBoundary.providerUnavailable(lockedRequest, {
        providerIdentifier: resolvedProviderId ?? 'UNRESOLVED_PROVIDER',
        reasonCode: getProviderReasonCode(error),
        promptInputHash,
      });
      return this.attachOrigin(result.proposal);
    }

    if (!this.isWellFormedResponse(response)) {
      const result = await this.constitutionalBoundary.providerUnavailable(lockedRequest, {
        providerIdentifier: response?.providerId ?? resolvedProviderId ?? 'UNRESOLVED_PROVIDER',
        modelIdentifier: response?.modelId,
        promptInputHash,
      });
      return this.attachOrigin(result.proposal);
    }

    // When the caller supplied explicit boqItemRefs, the response must cover
    // exactly that set -- foreign refs are dropped (never forwarded to
    // response/evidence), duplicates are collapsed deterministically (first
    // occurrence kept), and any requested ref the provider never returned
    // gets a safe, honest placeholder. Runs before every other check so
    // everything downstream (EF lock, candidate allowlist, applicability,
    // evidence) only ever sees the normalized, honest item set.
    const { response: refNormalized, violated: coverageViolated } = this.normalizeAgainstRequestedRefs(
      response,
      lockedRequest.boqItemRefs ?? [],
    );

    // A provider response containing any non-empty executionFactorRefs must
    // never be accepted silently. The Constitutional Boundary already strips
    // EF and records EF_NOT_ALLOWED for any NOT_ALLOWED request (defense in
    // depth, unmodified locked logic); this adds one explicit, stable,
    // vendor-neutral marker specifically for the AI-path hard lock so it is
    // auditable as distinct from a normal user-configured NOT_ALLOWED case.
    const efLockTriggered = refNormalized.items.some((item) => item.executionFactorRefs.length > 0);

    // A provider may only return AHSP/Basic Price IDs that were actually
    // offered as candidates in this request. This runs *before* the
    // Constitutional Boundary so evidence always reflects the truthful
    // final selection -- never a value that gets silently discarded later.
    const { response: candidateFiltered, stripped: candidateStripped } = this.applyCandidateAllowlist(
      refNormalized,
      lockedRequest,
    );

    // No deterministic domain/applicability guard exists yet to prove a
    // surviving AHSP selection genuinely fits the BOQ item. Mark every item
    // that still has one, so the status floor below and evidence both stay
    // honest about that gap. Scoped to callers that opted into the
    // candidate-grounded contract (ahspCandidates !== undefined) -- callers
    // that never supply candidates at all are a different, older path this
    // guard does not apply to.
    const ahspApplicabilityGuardActive = lockedRequest.ahspCandidates !== undefined;
    const itemsWithApplicabilityNote = ahspApplicabilityGuardActive
      ? candidateFiltered.items.map((item) =>
          item.selectedAhspId !== null
            ? { ...item, reasonCodes: [...item.reasonCodes, AHSP_APPLICABILITY_UNVERIFIED_REASON] }
            : item,
        )
      : candidateFiltered.items;
    const attemptedAhspSelection =
      ahspApplicabilityGuardActive && itemsWithApplicabilityNote.some((item) => item.selectedAhspId !== null);

    // A provider response is never allowed to read as READY when we already
    // know it needed sanitizing (candidate stripped), contains an AHSP
    // selection whose applicability to this BOQ item is unverified, or
    // failed to honestly cover every requested boqItemRef. This sets the
    // *input* status the Constitutional Boundary falls back to when it
    // detects no other rejection reason of its own -- so evidence and the
    // returned proposal are always consistent with each other.
    const statusFloorApplies = candidateStripped || attemptedAhspSelection || coverageViolated;
    const flooredStatus =
      statusFloorApplies && candidateFiltered.status === 'READY' ? 'NEEDS_REVIEW' : candidateFiltered.status;

    // Spread the full raw response (not just the known-good fields) so the
    // Constitutional Boundary can detect and reject any rogue field a
    // misbehaving provider smuggles in outside the typed contract (e.g. a
    // forbidden `requestedActions`/money field never declared here).
    const rawProposal = {
      ...candidateFiltered,
      requestId: request.requestId,
      status: flooredStatus,
      items: itemsWithApplicabilityNote,
      warnings: candidateFiltered.warnings,
    } as RabIntelligenceProposal & Record<string, unknown>;

    const evaluation = await this.constitutionalBoundary.evaluateRabProposal(
      lockedRequest,
      rawProposal,
      {
        providerIdentifier: candidateFiltered.providerId,
        modelIdentifier: candidateFiltered.modelId,
        promptInputHash,
        toolsRequested: candidateFiltered.requestedTools,
        reasonCode: efLockTriggered ? EF_AI_PATH_LOCKED_REASON : undefined,
      },
    );

    return this.attachOrigin(evaluation.proposal);
  }

  /**
   * Attaches the server-assigned `origin` label to every item of a final,
   * already-evaluated (and already evidence-persisted) proposal. Purely a
   * read-only provenance label on the in-memory response -- there is no
   * code path from here to any canonical/BOQ write.
   */
  private attachOrigin(proposal: RabIntelligenceProposal): RabIntelligenceProposal {
    return {
      ...proposal,
      items: proposal.items.map((item) => ({
        ...item,
        origin: this.resolveItemOrigin(item),
      })),
    };
  }

  private resolveItemOrigin(
    item: RabIntelligenceProposalItem,
  ): RabIntelligenceProposalItem['origin'] {
    return item.reasonCodes.includes(BOQ_ITEM_PROPOSAL_MISSING_REASON) ||
      item.reasonCodes.includes(BOQ_ITEM_AHSP_MISSING_REASON)
      ? ORIGIN_NOT_AVAILABLE
      : ORIGIN_PROVIDER_PROPOSAL;
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
      boqItems: request.boqItems ?? [],
      ahspCandidates: request.ahspCandidates ?? [],
      basicPriceCandidates: request.basicPriceCandidates ?? [],
      projectContextRef: request.projectContextRef,
      mainMaterialSpecRef: request.mainMaterialSpecRef,
      mainMaterialSpecContext: request.mainMaterialSpecContext,
      efPermission: request.efPermission,
      allowedToolNames: SIMPROK_INTELLIGENCE_TOOL_ALLOWLIST,
      policyVersion: P8A_POLICY_VERSION,
    };
  }

  /**
   * SHA-256 of exactly the sanitized packet handed to the provider -- never
   * the packet itself is persisted, only this fingerprint. Deterministic:
   * `buildProviderRequest` always constructs keys in the same order, so
   * identical input always yields an identical hash.
   */
  private hashProviderRequest(providerRequest: ProviderIntelligenceRequest): string {
    return createHash('sha256').update(JSON.stringify(providerRequest)).digest('hex');
  }

  /**
   * Normalizes a provider's response against the exact set of requested
   * boqItemRefs. No-op when the caller supplied no explicit refs at all
   * (`requestedRefs.length === 0`). Otherwise:
   *  - items whose boqItemRef was never requested are dropped and never
   *    reach the response/evidence (only a stable top-level warning notes
   *    it happened);
   *  - a duplicate boqItemRef is collapsed deterministically -- the first
   *    occurrence is kept, the rest are dropped with a warning;
   *  - any requested ref the provider never returned gets a safe placeholder
   *    (`BOQ_ITEM_PROPOSAL_MISSING`, confidence 0, nothing selected);
   *  - a returned item with `selectedAhspId: null` is marked
   *    `BOQ_ITEM_AHSP_MISSING`.
   * `violated` is true whenever any of the above occurred, so the caller can
   * floor the resulting status below READY.
   */
  private normalizeAgainstRequestedRefs(
    response: ProviderIntelligenceResponse,
    requestedRefs: string[],
  ): { response: ProviderIntelligenceResponse; violated: boolean } {
    if (requestedRefs.length === 0) {
      return { response, violated: false };
    }

    const requestedSet = new Set(requestedRefs);
    const firstByRef = new Map<string, ProviderIntelligenceProposalItem>();
    const extraWarnings: string[] = [];
    let violated = false;

    for (const item of response.items) {
      if (!requestedSet.has(item.boqItemRef)) {
        violated = true;
        if (!extraWarnings.includes(BOQ_ITEM_FOREIGN_REF_DROPPED_REASON)) {
          extraWarnings.push(BOQ_ITEM_FOREIGN_REF_DROPPED_REASON);
        }
        continue;
      }
      if (firstByRef.has(item.boqItemRef)) {
        violated = true;
        if (!extraWarnings.includes(BOQ_ITEM_DUPLICATE_REF_DROPPED_REASON)) {
          extraWarnings.push(BOQ_ITEM_DUPLICATE_REF_DROPPED_REASON);
        }
        continue;
      }
      firstByRef.set(item.boqItemRef, item);
    }

    const items = requestedRefs.map((ref) => {
      const existing = firstByRef.get(ref);
      if (!existing) {
        violated = true;
        return {
          boqItemRef: ref,
          selectedAhspId: null,
          selectedBasicPriceIds: [],
          executionFactorRefs: [],
          confidence: 0,
          reasonCodes: [BOQ_ITEM_PROPOSAL_MISSING_REASON],
          evidenceRefs: [],
        };
      }
      if (existing.selectedAhspId === null) {
        violated = true;
        return { ...existing, reasonCodes: [...existing.reasonCodes, BOQ_ITEM_AHSP_MISSING_REASON] };
      }
      return existing;
    });

    // extraWarnings (foreign/duplicate ref) apply to the request as a whole,
    // not to any one item -- but IntelligenceEvidence.reasonCodes is built
    // only from item.reasonCodes (ConstitutionalAiBoundaryService.buildEvidence
    // never reads proposal.warnings), so a warning-only marker would never
    // reach evidence. requestedRefs is always non-empty on this path, so
    // `items[0]` is always the first requested item/placeholder -- attach
    // any coverage warnings that actually occurred there too,
    // deterministically and deduplicated, so they persist into evidence as
    // well as proposal.warnings.
    if (extraWarnings.length > 0) {
      items[0] = {
        ...items[0],
        reasonCodes: [...new Set([...items[0].reasonCodes, ...extraWarnings])],
      };
    }

    return {
      response: { ...response, items, warnings: [...response.warnings, ...extraWarnings] },
      violated,
    };
  }

  /**
   * A provider may only return AHSP/Basic Price IDs that were actually
   * offered as candidates on this request. Opt-in per field: if a caller
   * never supplies `ahspCandidates`/`basicPriceCandidates` at all (existing
   * callers/tests), this is a no-op -- fully backward compatible. When a
   * caller supplies an (even empty) candidate list, any selection outside
   * it is stripped and marked, never silently passed through.
   */
  private applyCandidateAllowlist(
    response: ProviderIntelligenceResponse,
    request: RabIntelligenceRequest,
  ): { response: ProviderIntelligenceResponse; stripped: boolean } {
    const ahspCandidatesProvided = request.ahspCandidates !== undefined;
    const basicPriceCandidatesProvided = request.basicPriceCandidates !== undefined;
    if (!ahspCandidatesProvided && !basicPriceCandidatesProvided) {
      return { response, stripped: false };
    }

    const allowedAhspIds = new Set((request.ahspCandidates ?? []).map((c) => c.id));
    const allowedBasicPriceIds = new Set((request.basicPriceCandidates ?? []).map((c) => c.id));
    let stripped = false;

    const items = response.items.map((item) => {
      let selectedAhspId = item.selectedAhspId;
      let selectedBasicPriceIds = item.selectedBasicPriceIds;
      const reasonCodes = [...item.reasonCodes];

      if (ahspCandidatesProvided && selectedAhspId !== null && !allowedAhspIds.has(selectedAhspId)) {
        selectedAhspId = null;
        reasonCodes.push(AHSP_NOT_IN_CANDIDATE_SET_REASON);
        stripped = true;
      }

      if (basicPriceCandidatesProvided) {
        const filtered = selectedBasicPriceIds.filter((id) => allowedBasicPriceIds.has(id));
        if (filtered.length !== selectedBasicPriceIds.length) {
          reasonCodes.push(BASIC_PRICE_NOT_IN_CANDIDATE_SET_REASON);
          stripped = true;
        }
        selectedBasicPriceIds = filtered;
      }

      return { ...item, selectedAhspId, selectedBasicPriceIds, reasonCodes };
    });

    return { response: { ...response, items }, stripped };
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
