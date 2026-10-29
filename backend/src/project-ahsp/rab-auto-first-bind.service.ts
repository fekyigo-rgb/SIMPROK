import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseDateOnlyUtc } from '../common/date-only.util';
import { WORKING_DRAFT_STRUCTURE_NAME } from '../project/rab-lifecycle-policy.service';
import { ProjectAhspService } from './project-ahsp.service';
import { explicitAhspSourceProof } from './rab-auto-first-source-reference';
import { createHash } from 'crypto';

/**
 * RAB-AUTO-05: first association ONLY from a human-approved BOQ source's
 * EXPLICIT "Kode AHSP" column, with exact full description, eligible current
 * formula, Unit Kernel/classification recommendation, and ONE selected
 * project price region. Reuse the existing official selectForBoqItem writer;
 * no source reference => NO autonomous first identity.
 */
@Injectable()
export class RabAutoFirstBindService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ahsp: ProjectAhspService,
  ) {}

  async execute(input: {
    projectId: string;
    workspaceId: string;
    accountId: string;
    businessPricingAsOfDate: string;
    page?: string;
    limit?: string;
  }) {
    parseDateOnlyUtc(input.businessPricingAsOfDate, 'businessPricingAsOfDate');
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

    const drafts = await this.prisma.boqStructure.findMany({
      where: {
        projectId: input.projectId,
        name: WORKING_DRAFT_STRUCTURE_NAME,
        status: 'DRAFT',
        project: { workspaceId: input.workspaceId },
      },
      select: { id: true },
      take: 2,
    });
    if (drafts.length !== 1) {
      return {
        projectId: input.projectId,
        page,
        limit,
        hasNext: false,
        results: [],
        summary: { WORKING_DRAFT_NOT_UNIQUE: 1 },
        automaticBindingPerformed: false,
      };
    }

    const [sourceApproval, chosenRegions, rows] = await Promise.all([
      this.prisma.boqBusinessUseEvent.findFirst({
        where: {
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          boqStructureId: drafts[0].id,
        },
        orderBy: { usedAt: 'desc' },
        select: { usedAt: true },
      }),
      this.prisma.projectRegionSelection.findMany({
        where: {
          projectId: input.projectId,
          project: { workspaceId: input.workspaceId },
        },
        select: { regionId: true },
      }),
      this.prisma.boqItem.findMany({
        where: {
          boqStructureId: drafts[0].id,
          itemType: 'WORK_ITEM',
        },
        select: {
          id: true,
          name: true,
          sourceAhspCode: true,
          updatedAt: true,
          ahspVersionId: true,
          workingOccurrenceId: true,
          calculationOccurrenceId: true,
          priceOrigin: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit + 1,
      }),
    ]);
    const hasNext = rows.length > limit;
    const results: Array<{ boqItemId: string; kind: string }> = [];
    const uniqueRegionId =
      chosenRegions.length === 1 ? chosenRegions[0].regionId : null;

    for (const row of rows.slice(0, limit)) {
      if (
        row.ahspVersionId ||
        row.workingOccurrenceId ||
        row.calculationOccurrenceId ||
        row.priceOrigin
      ) {
        results.push({ boqItemId: row.id, kind: 'ALREADY_DECIDED' });
        continue;
      }
      if (!row.sourceAhspCode) {
        results.push({
          boqItemId: row.id,
          kind: 'EXPLICIT_SOURCE_REFERENCE_MISSING',
        });
        continue;
      }
      if (!sourceApproval || row.updatedAt > sourceApproval.usedAt) {
        results.push({
          boqItemId: row.id,
          kind: 'SOURCE_APPROVAL_NOT_CURRENT',
        });
        continue;
      }
      if (!uniqueRegionId) {
        results.push({ boqItemId: row.id, kind: 'PRICE_REGION_NOT_UNIQUE' });
        continue;
      }
      if (
        row.sourceAhspCode.trim().length < 2 ||
        row.sourceAhspCode.trim().length > 120
      ) {
        results.push({
          boqItemId: row.id,
          kind: 'SOURCE_REFERENCE_NOT_SEARCHABLE',
        });
        continue;
      }

      try {
        const catalog = await this.ahsp.searchEligibleVersions(
          input.workspaceId,
          input.businessPricingAsOfDate,
          { projectId: input.projectId, boqItemId: row.id },
          { q: row.sourceAhspCode, page: '1', limit: '50' },
        );
        if (catalog.hasNext) {
          results.push({
            boqItemId: row.id,
            kind: 'CANDIDATE_UNIVERSE_INCOMPLETE',
          });
          continue;
        }
        const matches = catalog.items.filter((candidate) =>
          explicitAhspSourceProof(row, candidate.ahsp),
        );
        if (matches.length !== 1) {
          results.push({
            boqItemId: row.id,
            kind:
              matches.length > 1
                ? 'AMBIGUOUS_REFERENCED_AHSP'
                : 'REFERENCE_NOT_PROVEN',
          });
          continue;
        }
        const chosen = matches[0];
        const recommended =
          'preference' in chosen &&
          chosen.preference != null &&
          typeof chosen.preference === 'object' &&
          'recommended' in chosen.preference &&
          chosen.preference.recommended === true;
        if (!recommended) {
          results.push({
            boqItemId: row.id,
            kind: 'CLASSIFICATION_OR_UNIT_NOT_PROVEN',
          });
          continue;
        }
        const idempotencyKey =
          'rab-auto-05-' +
          createHash('sha256')
            .update(
              [
                input.projectId,
                row.id,
                chosen.id,
                input.businessPricingAsOfDate,
                uniqueRegionId,
                row.sourceAhspCode,
              ].join('|'),
            )
            .digest('hex');
        await this.ahsp.selectForBoqItem({
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          boqItemId: row.id,
          ahspVersionId: chosen.id,
          referenceRegionId: uniqueRegionId,
          businessPricingAsOfDate: input.businessPricingAsOfDate,
          idempotencyKey,
          firstSourceAhspCode: row.sourceAhspCode,
        });
        results.push({
          boqItemId: row.id,
          kind: 'FIRST_ASSOCIATION_PROVEN_AND_LINKED',
        });
      } catch {
        results.push({ boqItemId: row.id, kind: 'BIND_REVALIDATION_REQUIRED' });
      }
    }

    const summary: Record<string, number> = {};
    for (const row of results) summary[row.kind] = (summary[row.kind] ?? 0) + 1;
    return {
      projectId: input.projectId,
      page,
      limit,
      hasNext,
      results,
      summary,
      automaticBindingPerformed: results.some(
        (r) => r.kind === 'FIRST_ASSOCIATION_PROVEN_AND_LINKED',
      ),
      rabApproved: false,
      rabLocked: false,
    };
  }
}
