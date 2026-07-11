export type EfPermission = 'ALLOWED' | 'NOT_ALLOWED' | 'SELECTED_ITEMS_ONLY';

export type RabIntelligenceRequest = {
  requestId: string;
  workspaceId: string;
  organizationId: string;
  projectId: string;
  accountId: string;
  boqSourceRef?: string;
  projectContextRef: string;
  mainMaterialSpecRef?: string;
  efPermission: EfPermission;
  requestedAction: 'GENERATE_DRAFT_RAB';
};

export type RabIntelligenceProposalItem = {
  boqItemRef: string;
  selectedAhspId: string | null;
  selectedBasicPriceIds: string[];
  executionFactorRefs: string[];
  confidence: number;
  reasonCodes: string[];
  evidenceRefs: string[];
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
