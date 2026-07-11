export type EfPermission = 'ALLOWED' | 'NOT_ALLOWED' | 'SELECTED_ITEMS_ONLY';

/**
 * Minimal, sanitized BOQ item context -- no raw documents, no pricing.
 * `quantity` is a canonical decimal string (e.g. "10.25"), never a JS
 * number, so large/precise values are never lossy-converted.
 */
export type RabIntelligenceBoqItemContext = {
  boqItemRef: string;
  wbsCode: string;
  name: string;
  unit: string;
  quantity: string;
};

/** A canonical candidate a provider MAY choose from -- id plus a short, non-sensitive label. */
export type RabIntelligenceCanonicalCandidate = {
  id: string;
  label: string;
};

export type RabIntelligenceRequest = {
  requestId: string;
  workspaceId: string;
  organizationId: string;
  projectId: string;
  accountId: string;
  boqSourceRef?: string;
  boqItemRefs?: string[];
  /** Bounded, sanitized grounding context for the requested boqItemRefs. */
  boqItems?: RabIntelligenceBoqItemContext[];
  /** Bounded pool of canonical AHSP candidates the provider may select from. */
  ahspCandidates?: RabIntelligenceCanonicalCandidate[];
  /**
   * Bounded pool of canonical Basic Price candidates the provider may select
   * from. When grounding is not yet safe (no relational link exists to
   * disambiguate relevance), callers must pass an explicit empty array so
   * the orchestrator strips any selection rather than skipping the check.
   */
  basicPriceCandidates?: RabIntelligenceCanonicalCandidate[];
  /**
   * Stable, content-free reference (e.g. `project:<projectId>`). Recorded in
   * IntelligenceEvidence.sourceReferences. Never the project name or any
   * free-text content.
   */
  projectContextRef: string;
  /**
   * Stable, content-free reference (e.g. `project:<projectId>:main-material-spec`).
   * Recorded in IntelligenceEvidence.sourceReferences. Never the raw
   * mainMaterialSpec text -- see `mainMaterialSpecContext` for that.
   */
  mainMaterialSpecRef?: string;
  /**
   * Bounded, sanitized main material spec content actually sent to the
   * provider for grounding. This is provider-grounding-only: it is never
   * read by evidence-building, never logged, and never echoed in an API
   * error.
   */
  mainMaterialSpecContext?: string;
  efPermission: EfPermission;
  requestedAction: 'GENERATE_DRAFT_RAB';
};

/**
 * Server-assigned provenance label only -- the AI provider never sends or
 * influences this value (it does not exist in the provider-level contract
 * at all; it is attached by the orchestrator strictly after the
 * Constitutional Boundary has evaluated and persisted evidence). It carries
 * no write authority: it never causes a canonical/BOQ write, and a
 * 'NOT_AVAILABLE' placeholder item is never persisted as canonical BOQ data.
 * Optional on the shared type (not required) so this stays a purely additive
 * change -- ConstitutionalAiBoundaryService, which builds proposal items
 * before origin is known, is not touched by this contract.
 */
export type RabIntelligenceProposalItemOrigin = 'PROVIDER_PROPOSAL' | 'NOT_AVAILABLE';

export type RabIntelligenceProposalItem = {
  boqItemRef: string;
  selectedAhspId: string | null;
  selectedBasicPriceIds: string[];
  executionFactorRefs: string[];
  confidence: number;
  reasonCodes: string[];
  evidenceRefs: string[];
  origin?: RabIntelligenceProposalItemOrigin;
};

export type RabIntelligenceProposal = {
  requestId: string;
  status: 'READY' | 'PARTIAL' | 'NEEDS_REVIEW' | 'REJECTED_BY_POLICY';
  items: RabIntelligenceProposalItem[];
  warnings: string[];
};

export interface SimprokIntelligencePort {
  proposeRabDraft(
    request: RabIntelligenceRequest,
  ): Promise<RabIntelligenceProposal>;
}
