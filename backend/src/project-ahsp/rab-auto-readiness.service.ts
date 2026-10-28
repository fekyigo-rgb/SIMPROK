import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WORKING_DRAFT_STRUCTURE_NAME } from '../project/rab-lifecycle-policy.service';
import { ProjectAhspService } from './project-ahsp.service';

/**
 * RAB-AUTO-02: a read-only, one-BOQ orchestration gate.
 *
 * Reuses the existing AHSP eligibility/currentness/unit-preference path;
 * DOES NOT create a second matcher, select an AHSP, resolve prices, write a
 * BOQ row, or ask an LLM to create pricing authority. A ranked candidate
 * is a suggestion, not canonical BOQ-to-AHSP equivalence.
 */
@Injectable()
export class RabAutoReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ahsp: ProjectAhspService,
  ) {}

  async assess(input: {
    workspaceId: string;
    projectId: string;
    boqItemId: string;
    businessPricingAsOfDate: string;
  }) {
    const item = await this.prisma.boqItem.findFirst({
      where: {
        id: input.boqItemId,
        itemType: 'WORK_ITEM',
        boqStructure: {
          projectId: input.projectId,
          name: WORKING_DRAFT_STRUCTURE_NAME,
          status: 'DRAFT',
          project: { workspaceId: input.workspaceId },
        },
      },
      select: {
        id: true,
        name: true,
        unit: true,
        ahspVersionId: true,
        workingOccurrenceId: true,
        priceOrigin: true,
        calculationOccurrenceId: true,
        unitPrice: true,
        lineTotal: true,
      },
    });
    if (!item) throw new NotFoundException('BOQ_ITEM_NOT_FOUND');

    // Successful canonical persistence deliberately clears the WORKING
    // occurrence pointer. It is not an incomplete AHSP link. Read the frozen
    // calculation lineage instead, and never try to re-bind or re-price it.
    if (item.priceOrigin === 'SERVER_COST_KERNEL') {
      return {
        kind:
          item.ahspVersionId &&
          item.calculationOccurrenceId &&
          item.unitPrice != null &&
          item.lineTotal != null
            ? ('PERSISTED_CALCULATION_REPROOF_REQUIRED' as const)
            : ('INCONSISTENT_PERSISTENCE_REQUIRES_REVIEW' as const),
        boqItemId: item.id,
        calculationOccurrenceId: item.calculationOccurrenceId,
        priceStatus: 'READ_EXISTING_PERSISTED_CALCULATION' as const,
        mutationPerformed: false,
      };
    }
    if (item.priceOrigin === 'MANUAL_CLIENT') {
      return {
        kind: 'MANUAL_PRICE_PRESERVED' as const,
        boqItemId: item.id,
        priceStatus: 'MANUAL' as const,
        mutationPerformed: false,
      };
    }
    // Current, authoritative working relations take precedence over fresh
    // proposals. Never re-rank an already linked AHSP.
    if (item.ahspVersionId && item.workingOccurrenceId) {
      return {
        kind: 'ALREADY_LINKED' as const,
        boqItemId: item.id,
        ahspVersionId: item.ahspVersionId,
        occurrenceId: item.workingOccurrenceId,
        priceStatus: 'READ_EXISTING_OCCURRENCE' as const,
        mutationPerformed: false,
      };
    }
    if (item.ahspVersionId || item.workingOccurrenceId) {
      return {
        kind: 'INCOMPLETE_LINK_REQUIRES_REVIEW' as const,
        boqItemId: item.id,
        priceStatus: 'UNPRICED' as const,
        mutationPerformed: false,
      };
    }

    // Existing server-side eligibility, latest-version, classification and
    // Unit Kernel preference; query without lexical filter to avoid claiming
    // no candidate solely because of a partial BOQ search term.
    const catalog = await this.ahsp.searchEligibleVersions(
      input.workspaceId,
      input.businessPricingAsOfDate,
      { projectId: input.projectId, boqItemId: item.id },
      { q: '', page: '1', limit: '50' },
    );
    const recommendedCount = catalog.items.filter(
      (v) => 'preference' in v && v.preference?.recommended === true,
    ).length;

    let kind:
      | 'NO_ELIGIBLE_AHSP'
      | 'CANDIDATE_UNIVERSE_INCOMPLETE'
      | 'NO_PROVEN_MATCH'
      | 'MULTIPLE_RECOMMENDATIONS'
      | 'CANDIDATE_REQUIRES_IDENTITY_PROOF';

    if (catalog.hasNext) kind = 'CANDIDATE_UNIVERSE_INCOMPLETE';
    else if (catalog.items.length === 0) kind = 'NO_ELIGIBLE_AHSP';
    else if (recommendedCount === 0) kind = 'NO_PROVEN_MATCH';
    else if (recommendedCount > 1) kind = 'MULTIPLE_RECOMMENDATIONS';
    else kind = 'CANDIDATE_REQUIRES_IDENTITY_PROOF';

    // Even exactly ONE recommendation is NOT an authority to bind: the
    // current ranking explicitly uses name/classification recall, not a
    // canonical specification-association proof. The existing selectForBoqItem
    // transaction remains the only permitted BOQ/AHSP write path.
    return {
      kind,
      boqItemId: item.id,
      searched: { query: '', firstPageSize: 50, hasNext: catalog.hasNext },
      eligibleSeen: catalog.items.length,
      recommendedCount,
      requiredBeforeAutomaticBind: [
        'CANONICAL_AHSP_BOQ_ASSOCIATION_PROOF',
        'AUTHORIZED_PRICE_REGION',
        'CURRENT_ELIGIBILITY_AND_UNIT_REVALIDATION',
      ] as const,
      priceStatus: 'UNPRICED' as const,
      mutationPerformed: false,
    };
  }

  /**
   * One bounded, read-only RAB walk. Per-item failure stays an exception;
   * it may not erase other lawful rows or be translated into a zero price.
   * The existing single-item readiness service remains the only evaluator.
   */
  async assessDraft(input: {
    workspaceId: string;
    projectId: string;
    businessPricingAsOfDate: string;
    page?: string;
    limit?: string;
  }) {
    const page = input.page == null ? 1 : Number(input.page);
    const limit = input.limit == null ? 25 : Number(input.limit);
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > 10000 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 25
    ) {
      throw new BadRequestException('RAB_AUTO_PAGE_INVALID');
    }
    const found = await this.prisma.boqItem.findMany({
      where: {
        itemType: 'WORK_ITEM',
        boqStructure: {
          projectId: input.projectId,
          name: WORKING_DRAFT_STRUCTURE_NAME,
          status: 'DRAFT',
          project: { workspaceId: input.workspaceId },
        },
      },
      select: { id: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit + 1,
    });
    const hasNext = found.length > limit;
    const items = found.slice(0, limit);
    const results: Array<{
      boqItemId: string;
      kind: string;
      mutationPerformed: false;
    }> = [];
    // Limit parallel project/resource reads; no speculative transactions.
    for (let start = 0; start < items.length; start += 3) {
      const group = await Promise.all(
        items.slice(start, start + 3).map(async (row) => {
          try {
            const verdict = await this.assess({ ...input, boqItemId: row.id });
            return {
              boqItemId: row.id,
              kind: verdict.kind,
              mutationPerformed: false as const,
            };
          } catch {
            return {
              boqItemId: row.id,
              kind: 'READINESS_UNAVAILABLE_REQUIRES_REVIEW',
              mutationPerformed: false as const,
            };
          }
        }),
      );
      results.push(...group);
    }
    const summary: Record<string, number> = {};
    for (const verdict of results) {
      summary[verdict.kind] = (summary[verdict.kind] ?? 0) + 1;
    }
    return {
      projectId: input.projectId,
      page,
      limit,
      hasNext,
      rowsChecked: results.length,
      results,
      summary,
      mutationPerformed: false as const,
      automaticBindingPerformed: false as const,
    };
  }
}
