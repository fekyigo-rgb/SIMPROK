import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseDateOnlyUtc } from '../common/date-only.util';
import { WORKING_DRAFT_STRUCTURE_NAME } from '../project/rab-lifecycle-policy.service';
import { ProjectAhspService } from './project-ahsp.service';
import { buildProvenContextRefreshKey, findGovernedUnindexedSourceIds, hasGovernedUnindexedSource, samePreviouslyDecidedUnindexedWorkFact, sameProvenBoqSourceFact } from './rab-auto-source-proof';

/**
 * RAB-AUTO-04. Reuses one already-human-proven AHSP association for an
 * IDENTICAL canonical source row inside the SAME Working Draft and project.
 * Also refreshes an EXISTING, previously authorized working association when
 * its frozen price region/date became stale; this preserves the original AHSP
 * identity and appends a NEW occurrence using the SAME official writer.
 * Does not construct a first association from AI, lexical similarity or
 * category preference. Unit/resource/price/lifecycle gates are re-run inside
 * ProjectAhspService.selectForBoqItem's transaction.
 */
@Injectable()
export class RabAutoProvenReuseService {
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
    const asOf = parseDateOnlyUtc(
      input.businessPricingAsOfDate,
      'businessPricingAsOfDate',
    );
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
    const current = await this.prisma.boqItem.findMany({
      where: {
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
        boqStructureId: true,
        parentId: true,
        wbsNodeId: true,
        wbsCode: true,
        name: true,
        unit: true,
        ahspVersionId: true,
        workingOccurrenceId: true,
        updatedAt: true,
        calculationOccurrenceId: true,
        priceOrigin: true,
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit + 1,
    });
    const selectedRegions = await this.prisma.projectRegionSelection.findMany({
      where: {
        projectId: input.projectId,
        project: { workspaceId: input.workspaceId },
      },
      select: { regionId: true },
    });
    const permittedRegions = new Set(selectedRegions.map((r) => r.regionId));
    const hasNext = current.length > limit;
    // One bounded read for existing frozen occurrences: avoid per-line N+1.
    const linkedOccurrenceIds = current.slice(0, limit)
      .filter((row) => !row.priceOrigin && !row.calculationOccurrenceId &&
        row.ahspVersionId && row.workingOccurrenceId)
      .map((row) => row.workingOccurrenceId!);
    const frozen = linkedOccurrenceIds.length > 0
      ? await this.prisma.projectAhspOccurrence.findMany({
          where: {
            id: { in: linkedOccurrenceIds },
            projectId: input.projectId,
            workspaceId: input.workspaceId,
          },
          select: {
            id: true,
            ahspVersionId: true,
            createdByAccountId: true,
            referenceRegionId: true,
            businessPricingAsOfDate: true,
          },
        })
      : [];
    const frozenById = new Map(frozen.map((row) => [row.id, row]));
    const results: Array<{ boqItemId: string; kind: string }> = [];
    for (const item of current.slice(0, limit)) {
      if (
        !item.priceOrigin && !item.calculationOccurrenceId &&
        item.ahspVersionId && item.workingOccurrenceId
      ) {
        const original = frozenById.get(item.workingOccurrenceId);
        if (!original || !original.createdByAccountId ||
            !original.referenceRegionId || !original.businessPricingAsOfDate ||
            original.ahspVersionId !== item.ahspVersionId) {
          results.push({ boqItemId: item.id, kind: 'CONTEXT_REFRESH_REQUIRES_REVIEW' });
          continue;
        }
        if (permittedRegions.has(original.referenceRegionId) &&
            original.businessPricingAsOfDate?.getTime() === asOf.getTime()) {
          results.push({ boqItemId: item.id, kind: 'ALREADY_DECIDED' });
          continue;
        }
        if (selectedRegions.length !== 1) {
          results.push({ boqItemId: item.id, kind: 'CONTEXT_REFRESH_REGION_NOT_UNIQUE' });
          continue;
        }
        const currentRegionId = selectedRegions[0].regionId;
        // The existing canonical source-proof helper binds the item, its
        // prior occurrence and BOQ revision to this internal-only action.
        const idempotencyKey = buildProvenContextRefreshKey({
          projectId: input.projectId,
          boqItemId: item.id,
          previousOccurrenceId: item.workingOccurrenceId,
          ahspVersionId: item.ahspVersionId,
          referenceRegionId: currentRegionId,
          businessPricingAsOfDate: input.businessPricingAsOfDate,
          boqUpdatedAt: item.updatedAt.toISOString(),
        });
        try {
          // The official writer re-locks and rechecks exact BOQ revision,
          // original occurrence identity, selected region, current AHSP
          // version, Unit Kernel and Basic Price; never edit old history.
          const refreshed = await this.ahsp.selectForBoqItem({
            projectId: input.projectId,
            workspaceId: input.workspaceId,
            accountId: input.accountId,
            boqItemId: item.id,
            ahspVersionId: item.ahspVersionId,
            referenceRegionId: currentRegionId,
            businessPricingAsOfDate: input.businessPricingAsOfDate,
            idempotencyKey,
            refreshSourceOccurrenceId: item.workingOccurrenceId,
            refreshExpectedBoqUpdatedAt: item.updatedAt.toISOString(),
          });
          results.push({ boqItemId: item.id, kind:
            refreshed.id && refreshed.id !== item.workingOccurrenceId
              ? 'PROVEN_CONTEXT_REFRESHED'
              : 'CONTEXT_REFRESH_REVALIDATION_REQUIRED' });
        } catch {
          results.push({ boqItemId: item.id,
            kind: 'CONTEXT_REFRESH_REVALIDATION_REQUIRED' });
        }
        continue;
      }
      if (
        item.priceOrigin ||
        item.ahspVersionId ||
        item.workingOccurrenceId ||
        item.calculationOccurrenceId
      ) {
        results.push({ boqItemId: item.id, kind: 'ALREADY_DECIDED' });
        continue;
      }
      // Unindexed legacy BOQ: reuse only one previously governed exact work
      // decision. The original WBS-node gate below stays untouched.
      if (item.wbsNodeId === null && item.wbsCode.trim() &&
          item.name.trim() && item.unit.trim()) {
        results.push(await this.tryUnindexedReuse(item, input, asOf, permittedRegions));
        continue;
      }
      if (
        !item.wbsNodeId ||
        !item.wbsCode.trim() ||
        !item.name.trim() ||
        !item.unit.trim()
      ) {
        results.push({
          boqItemId: item.id,
          kind: 'SOURCE_IDENTITY_NOT_ESTABLISHED',
        });
        continue;
      }
      try {
        // At most TWO source rows are read: zero proves no remembered decision;
        // two proves ambiguity; only exactly ONE can be reused.
        const sources = await this.prisma.boqItem.findMany({
          where: {
            id: { not: item.id },
            itemType: 'WORK_ITEM',
            wbsNodeId: item.wbsNodeId,
            wbsCode: item.wbsCode,
            name: item.name,
            unit: item.unit,
            boqStructure: {
              projectId: input.projectId,
              name: WORKING_DRAFT_STRUCTURE_NAME,
              status: 'DRAFT',
              project: { workspaceId: input.workspaceId },
            },
            OR: [
              { workingOccurrenceId: { not: null } },
              { calculationOccurrenceId: { not: null } },
            ],
          },
          include: { workingOccurrence: true, calculationOccurrence: true },
          take: 2,
        });
        if (
          sources.length !== 1 ||
          !sameProvenBoqSourceFact(item, sources[0])
        ) {
          results.push({
            boqItemId: item.id,
            kind:
              sources.length > 1
                ? 'MULTIPLE_SOURCE_DECISIONS'
                : 'NO_PROVEN_ASSOCIATION',
          });
          continue;
        }
        const source = sources[0];
        const occurrence =
          source.workingOccurrence ?? source.calculationOccurrence;
        if (
          !source.ahspVersionId ||
          source.priceOrigin === 'MANUAL_CLIENT' ||
          !occurrence ||
          occurrence.createdByAccountId == null ||
          occurrence.idempotencyKey.startsWith('rab-auto-04-') ||
          occurrence.projectId !== input.projectId ||
          occurrence.workspaceId !== input.workspaceId ||
          occurrence.ahspVersionId !== source.ahspVersionId ||
          occurrence.businessPricingAsOfDate?.getTime() !== asOf.getTime() ||
          !occurrence.referenceRegionId ||
          !permittedRegions.has(occurrence.referenceRegionId)
        ) {
          results.push({
            boqItemId: item.id,
            kind: 'SOURCE_CONTEXT_NOT_AUTHORIZED',
          });
          continue;
        }
        // EXISTING writer re-locks the project, re-proves this source fact and
        // rechecks current AHSP version, Unit Kernel, price/resource resolution.
        // An idempotent replay cannot silently select a different version.
        const idempotencyKey = [
          'rab-auto-04',
          item.id,
          source.id,
          source.ahspVersionId,
          input.businessPricingAsOfDate,
          occurrence.referenceRegionId,
        ].join('-');
        const selected = await this.ahsp.selectForBoqItem({
          projectId: input.projectId,
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          boqItemId: item.id,
          ahspVersionId: source.ahspVersionId,
          referenceRegionId: occurrence.referenceRegionId,
          businessPricingAsOfDate: input.businessPricingAsOfDate,
          idempotencyKey,
          reuseSourceBoqItemId: source.id,
        });
        results.push({
          boqItemId: item.id,
          kind: selected.id
            ? 'PROVEN_ASSOCIATION_REUSED'
            : 'REUSE_REVALIDATION_REQUIRED',
        });
      } catch {
        // A concurrent change, revalidation failure or missing resource is
        // not a successful link. Other rows remain independent.
        results.push({
          boqItemId: item.id,
          kind: 'REUSE_REVALIDATION_REQUIRED',
        });
      }
    }
    const summary = Object.fromEntries(
      [...new Set(results.map((row) => row.kind))].map((kind) => [
        kind,
        results.filter((row) => row.kind === kind).length,
      ]),
    );
    return {
      projectId: input.projectId,
      page,
      limit,
      hasNext,
      rowsChecked: results.length,
      results,
      summary,
      automaticBindingPerformed: results.some(
        (r) => r.kind === 'PROVEN_ASSOCIATION_REUSED' ||
          r.kind === 'PROVEN_CONTEXT_REFRESHED',
      ),
      rabApproved: false,
      rabLocked: false,
    };
  }

  /**
   * One bounded governed reuse for legacy BOQ rows without WBS node ids.
   * A lexical query merely fetches possible prior decisions. The exact
   * canonical fact and persisted human provenance decide; the official writer
   * rechecks both inside the project transaction before any mutation.
   */
  private async tryUnindexedReuse(
    item: {
      id: string;
      boqStructureId: string;
      parentId: string | null;
      wbsNodeId: string | null;
      wbsCode: string;
      name: string;
      unit: string;
    },
    input: {
      projectId: string;
      workspaceId: string;
      accountId: string;
      businessPricingAsOfDate: string;
    },
    asOf: Date,
    permittedRegions: ReadonlySet<string>,
  ): Promise<{ boqItemId: string; kind: string }> {
    const result = (kind: string) => ({ boqItemId: item.id, kind });
    if (!item.name.trim()) return result('SOURCE_IDENTITY_NOT_ESTABLISHED');
    try {
      const sourceIds = await findGovernedUnindexedSourceIds(this.prisma, item);
      if (sourceIds.length !== 1) {
        return result(sourceIds.length > 1
          ? 'MULTIPLE_SOURCE_DECISIONS'
          : 'NO_PROVEN_ASSOCIATION');
      }
      const sources = await this.prisma.boqItem.findMany({
        where: {
          id: { in: sourceIds },
          boqStructure: {
            projectId: input.projectId,
            name: WORKING_DRAFT_STRUCTURE_NAME,
            status: 'DRAFT',
            project: { workspaceId: input.workspaceId },
          },
        },
        include: {
          workingOccurrence: { include: { previousOccurrence: true } },
          calculationOccurrence: { include: { previousOccurrence: true } },
        },
      });
      if (sources.length !== 1) {
        return result(sources.length > 1
          ? 'MULTIPLE_SOURCE_DECISIONS'
          : 'NO_PROVEN_ASSOCIATION');
      }
      const source = sources[0];
      const occurrence = source.workingOccurrence ?? source.calculationOccurrence;
      if (!samePreviouslyDecidedUnindexedWorkFact(item, source) ||
          !source.ahspVersionId || source.priceOrigin === 'MANUAL_CLIENT' ||
          !occurrence || occurrence.projectId !== input.projectId ||
          occurrence.workspaceId !== input.workspaceId ||
          occurrence.ahspVersionId !== source.ahspVersionId ||
          occurrence.businessPricingAsOfDate?.getTime() !== asOf.getTime() ||
          !occurrence.referenceRegionId ||
          !permittedRegions.has(occurrence.referenceRegionId) ||
          !hasGovernedUnindexedSource(source.id, occurrence, input.projectId)) {
        return result('SOURCE_CONTEXT_NOT_AUTHORIZED');
      }
      const idempotencyKey = [
        'rab-auto-04-unindexed', item.id, source.id,
        source.ahspVersionId, input.businessPricingAsOfDate,
        occurrence.referenceRegionId,
      ].join('-');
      const selected = await this.ahsp.selectForBoqItem({
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        accountId: input.accountId,
        boqItemId: item.id,
        ahspVersionId: source.ahspVersionId,
        referenceRegionId: occurrence.referenceRegionId,
        businessPricingAsOfDate: input.businessPricingAsOfDate,
        idempotencyKey,
        reuseSourceBoqItemId: source.id,
      });
      return result(selected.id
        ? 'PROVEN_ASSOCIATION_REUSED'
        : 'REUSE_REVALIDATION_REQUIRED');
    } catch {
      return result('REUSE_REVALIDATION_REQUIRED');
    }
  }
}
