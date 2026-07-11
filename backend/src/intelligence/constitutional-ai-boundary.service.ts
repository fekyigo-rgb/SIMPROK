import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  RabIntelligenceProposal,
  RabIntelligenceProposalItem,
  RabIntelligenceRequest,
} from './simprok-intelligence.port';
import { IntelligenceEvidenceService } from './intelligence-evidence.service';
import { isAllowedIntelligenceTool } from './simprok-intelligence-tools';

export const P8A_POLICY_VERSION = 'P8A-1';

const FORBIDDEN_ACTIONS = new Set([
  'APPROVE',
  'LOCK',
  'PUBLISH',
  'DELETE',
  'UNLOCK',
  'ALTER_SCHEMA',
  'RUN_MIGRATION',
  'GRANT_PERMISSION',
  'CHANGE_AUTHORITY',
  'WRITE_CANONICAL_KNOWLEDGE',
  'AUTO_LEARN_PUBLISHED',
]);

const FORBIDDEN_MONEY_FIELDS = new Set([
  'unitPrice',
  'unit_price',
  'hargaSatuan',
  'subtotal',
  'lineTotal',
  'ppn',
  'taxAmount',
  'grandTotal',
  'totalBaseCost',
  'totalFinalCost',
  'finalCost',
]);

export type IntelligenceEvidenceRecord = {
  requestId: string;
  workspaceId: string;
  organizationId: string;
  projectId: string;
  accountId: string;
  providerIdentifier: string;
  modelIdentifier: string;
  policyVersion: string;
  promptInputHash: string;
  status: 'READY' | 'PARTIAL' | 'NEEDS_REVIEW' | 'REJECTED_BY_POLICY' | 'PROVIDER_UNAVAILABLE';
  sourceReferences: string[];
  toolsRequested: string[];
  toolsAllowed: string[];
  toolsDenied: string[];
  ahspCandidates: string[];
  selectedAhspIds: string[];
  selectedBasicPriceIds: string[];
  efPermission: RabIntelligenceRequest['efPermission'];
  efReferences: string[];
  confidence: number[];
  reasonCodes: string[];
  policyRejections: string[];
  timestamp: string;
};

export type ConstitutionalEvaluationContext = {
  providerIdentifier?: string;
  modelIdentifier?: string;
  promptInputHash?: string;
  toolsRequested?: string[];
  selectedExecutionFactorRefsByBoqItemRef?: Record<string, string[]>;
  /** Optional vendor-neutral failure classification (e.g. OPENAI_AUTH_FAILED) surfaced by providerUnavailable(). */
  reasonCode?: string;
};

export type ConstitutionalEvaluationResult = {
  proposal: RabIntelligenceProposal;
  evidence: IntelligenceEvidenceRecord;
  rejected: boolean;
};

@Injectable()
export class ConstitutionalAiBoundaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evidenceService: IntelligenceEvidenceService,
  ) {}

  async evaluateRabProposal(
    request: RabIntelligenceRequest,
    rawProposal: RabIntelligenceProposal & Record<string, unknown>,
    context: ConstitutionalEvaluationContext = {},
  ): Promise<ConstitutionalEvaluationResult> {
    const rejections = new Set<string>();
    const toolsRequested = [
      ...(context.toolsRequested ?? []),
      ...this.stringArray(rawProposal.toolsRequested),
      ...this.stringArray(rawProposal.tools),
    ];
    const toolsAllowed = toolsRequested.filter(isAllowedIntelligenceTool);
    const toolsDenied = toolsRequested.filter((tool) => !isAllowedIntelligenceTool(tool));
    toolsDenied.forEach(() => rejections.add('TOOL_NOT_ALLOWED'));

    this.detectForbiddenActions(rawProposal).forEach((reason) => rejections.add(reason));
    if (this.containsForbiddenMoney(rawProposal)) {
      rejections.add('MODEL_MONEY_REJECTED');
    }
    if (rawProposal.requestId !== request.requestId) {
      rejections.add('REQUEST_ID_MISMATCH');
    }

    const sanitizedItems: RabIntelligenceProposalItem[] = [];
    for (const item of rawProposal.items ?? []) {
      const itemRejections = await this.evaluateItem(request, item, context);
      itemRejections.forEach((reason) => rejections.add(reason));
      sanitizedItems.push({
        boqItemRef: item.boqItemRef,
        selectedAhspId: itemRejections.includes('AHSP_NOT_CANONICAL')
          ? null
          : item.selectedAhspId,
        selectedBasicPriceIds: item.selectedBasicPriceIds.filter(
          (priceId) => !itemRejections.includes(`BASIC_PRICE_NOT_CANONICAL:${priceId}`),
        ),
        executionFactorRefs: this.allowedExecutionFactorRefs(request, item, context, itemRejections),
        confidence: item.confidence,
        reasonCodes: [...new Set([...item.reasonCodes, ...itemRejections.map((reason) => reason.split(':')[0])])],
        evidenceRefs: item.evidenceRefs,
      });
    }

    const criticalRejected = [...rejections].some((reason) =>
      [
        'AHSP_NOT_CANONICAL',
        'BASIC_PRICE_NOT_CANONICAL',
        'CROSS_TENANT_REFERENCE',
        'FORBIDDEN_AUTHORITY_ACTION',
        'MODEL_MONEY_REJECTED',
        'INVALID_CONFIDENCE',
        'TOOL_NOT_ALLOWED',
        'REQUEST_ID_MISMATCH',
      ].includes(reason.split(':')[0]),
    );

    const proposal: RabIntelligenceProposal = {
      requestId: request.requestId,
      status: criticalRejected
        ? 'REJECTED_BY_POLICY'
        : rejections.size > 0
          ? 'NEEDS_REVIEW'
          : rawProposal.status,
      items: sanitizedItems,
      warnings: [...new Set([...rawProposal.warnings, ...rejections])],
    };

    const result = {
      proposal,
      rejected: proposal.status === 'REJECTED_BY_POLICY',
      evidence: this.buildEvidence(request, proposal, {
        status: proposal.status,
        providerIdentifier: context.providerIdentifier ?? 'UNCONNECTED_PROVIDER',
        modelIdentifier: context.modelIdentifier ?? 'UNCONNECTED_MODEL',
        promptInputHash: context.promptInputHash ?? 'NO_RAW_PROMPT_STORED',
        toolsRequested,
        toolsAllowed,
        toolsDenied,
        policyRejections: [...rejections],
      }),
    };

    await this.persistEvidence(result.evidence);
    return result;
  }

  async providerUnavailable(
    request: RabIntelligenceRequest,
    context: ConstitutionalEvaluationContext = {},
  ): Promise<ConstitutionalEvaluationResult> {
    const extraReasons = context.reasonCode ? [context.reasonCode] : [];
    const proposal: RabIntelligenceProposal = {
      requestId: request.requestId,
      status: 'NEEDS_REVIEW',
      items: [],
      warnings: ['PROVIDER_UNAVAILABLE', 'MANUAL_REVIEW_AVAILABLE', ...extraReasons],
    };

    const result = {
      proposal,
      rejected: false,
      evidence: this.buildEvidence(request, proposal, {
        status: 'PROVIDER_UNAVAILABLE',
        providerIdentifier: context.providerIdentifier ?? 'UNCONNECTED_PROVIDER',
        modelIdentifier: context.modelIdentifier ?? 'UNCONNECTED_MODEL',
        promptInputHash: context.promptInputHash ?? 'NO_RAW_PROMPT_STORED',
        toolsRequested: context.toolsRequested ?? [],
        toolsAllowed: [],
        toolsDenied: [],
        policyRejections: ['PROVIDER_UNAVAILABLE', ...extraReasons],
      }),
    };

    await this.persistEvidence(result.evidence);
    return result;
  }

  private async evaluateItem(
    request: RabIntelligenceRequest,
    item: RabIntelligenceProposalItem & Record<string, unknown>,
    context: ConstitutionalEvaluationContext,
  ): Promise<string[]> {
    const rejections: string[] = [];
    if (item.confidence < 0 || item.confidence > 1 || !Number.isFinite(item.confidence)) {
      rejections.push('INVALID_CONFIDENCE');
    }

    if (item.selectedAhspId) {
      const ahsp = await this.prisma.aHSP.findFirst({
        where: {
          id: item.selectedAhspId,
          deletedAt: null,
          OR: [{ workspaceId: request.workspaceId }, { workspaceId: null }],
        },
        select: { id: true, workspaceId: true },
      });
      if (!ahsp) rejections.push('AHSP_NOT_CANONICAL');
    }

    for (const priceId of item.selectedBasicPriceIds) {
      const price = await this.prisma.basicPrice.findFirst({
        where: {
          id: priceId,
          status: 'PUBLISHED',
          OR: [
            { workspaceId: request.workspaceId },
            { workspaceId: null, organizationId: null },
            { organizationId: request.organizationId },
          ],
        },
        include: { resource: { select: { id: true, baseUnit: true } } },
      });
      if (!price || !price.resource?.baseUnit) {
        rejections.push(`BASIC_PRICE_NOT_CANONICAL:${priceId}`);
      }
    }

    if (request.efPermission === 'NOT_ALLOWED' && item.executionFactorRefs.length > 0) {
      rejections.push('EF_NOT_ALLOWED');
    }
    if (request.efPermission === 'SELECTED_ITEMS_ONLY') {
      const allowedRefs =
        context.selectedExecutionFactorRefsByBoqItemRef?.[item.boqItemRef] ?? [];
      const illegalRefs = item.executionFactorRefs.filter((ref) => !allowedRefs.includes(ref));
      if (illegalRefs.length > 0) rejections.push('EF_NOT_SELECTED_FOR_ITEM');
    }
    if (this.containsForbiddenMoney(item)) {
      rejections.push('MODEL_MONEY_REJECTED');
    }
    return rejections;
  }

  private allowedExecutionFactorRefs(
    request: RabIntelligenceRequest,
    item: RabIntelligenceProposalItem,
    context: ConstitutionalEvaluationContext,
    itemRejections: string[],
  ): string[] {
    if (request.efPermission === 'NOT_ALLOWED') return [];
    if (itemRejections.includes('EF_NOT_SELECTED_FOR_ITEM')) {
      const allowedRefs =
        context.selectedExecutionFactorRefsByBoqItemRef?.[item.boqItemRef] ?? [];
      return item.executionFactorRefs.filter((ref) => allowedRefs.includes(ref));
    }
    return item.executionFactorRefs;
  }

  private detectForbiddenActions(source: Record<string, unknown>): string[] {
    const actionValues = [
      ...this.stringArray(source.action),
      ...this.stringArray(source.actions),
      ...this.stringArray(source.requestedAction),
      ...this.stringArray(source.requestedActions),
    ];
    return actionValues.some((action) => FORBIDDEN_ACTIONS.has(action))
      ? ['FORBIDDEN_AUTHORITY_ACTION']
      : [];
  }

  private containsForbiddenMoney(source: unknown): boolean {
    if (!source || typeof source !== 'object') return false;
    if (Array.isArray(source)) return source.some((entry) => this.containsForbiddenMoney(entry));
    return Object.entries(source as Record<string, unknown>).some(([key, value]) => {
      if (FORBIDDEN_MONEY_FIELDS.has(key)) return true;
      if (key === 'items') return false;
      return this.containsForbiddenMoney(value);
    });
  }

  private stringArray(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
    return [];
  }

  private buildEvidence(
    request: RabIntelligenceRequest,
    proposal: RabIntelligenceProposal,
    params: {
      status: IntelligenceEvidenceRecord['status'];
      providerIdentifier: string;
      modelIdentifier: string;
      promptInputHash: string;
      toolsRequested: string[];
      toolsAllowed: string[];
      toolsDenied: string[];
      policyRejections: string[];
    },
  ): IntelligenceEvidenceRecord {
    return {
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      organizationId: request.organizationId,
      projectId: request.projectId,
      accountId: request.accountId,
      providerIdentifier: params.providerIdentifier,
      modelIdentifier: params.modelIdentifier,
      policyVersion: P8A_POLICY_VERSION,
      promptInputHash: params.promptInputHash,
      status: params.status,
      sourceReferences: [
        request.boqSourceRef,
        request.projectContextRef,
        request.mainMaterialSpecRef,
      ].filter((ref): ref is string => typeof ref === 'string' && ref.length > 0),
      toolsRequested: params.toolsRequested,
      toolsAllowed: params.toolsAllowed,
      toolsDenied: params.toolsDenied,
      ahspCandidates: proposal.items
        .map((item) => item.selectedAhspId)
        .filter((id): id is string => id !== null),
      selectedAhspIds: proposal.items
        .map((item) => item.selectedAhspId)
        .filter((id): id is string => id !== null),
      selectedBasicPriceIds: proposal.items.flatMap((item) => item.selectedBasicPriceIds),
      efPermission: request.efPermission,
      efReferences: proposal.items.flatMap((item) => item.executionFactorRefs),
      confidence: proposal.items.map((item) => item.confidence),
      reasonCodes: [
        ...new Set(proposal.items.flatMap((item) => item.reasonCodes)),
      ],
      policyRejections: params.policyRejections,
      timestamp: new Date().toISOString(),
    };
  }

  private async persistEvidence(record: IntelligenceEvidenceRecord) {
    try {
      await this.evidenceService.append(record);
    } catch (error) {
      throw new InternalServerErrorException({
        code: 'INTELLIGENCE_EVIDENCE_PERSISTENCE_FAILED',
        message: 'Intelligence evidence could not be persisted',
      });
    }
  }
}
