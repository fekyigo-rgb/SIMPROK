import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseDateOnlyUtc } from '../common/date-only.util';
import { WORKING_DRAFT_STRUCTURE_NAME } from '../project/rab-lifecycle-policy.service';
import { ProjectAhspService } from './project-ahsp.service';
import { sameProvenBoqSourceFact } from './rab-auto-source-proof';

/**
 * RAB-AUTO-04. Reuses one already-human-proven AHSP association for an
 * IDENTICAL canonical source row inside the SAME Working Draft and project.
 * Does not construct new associations from AI, codes, lexical similarity or
 * category preference. Authoritative unit/resource/price and lifecycle gates
 * are re-run inside ProjectAhspService.selectForBoqItem's transaction.
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
        wbsNodeId: true,
        wbsCode: true,
        name: true,
        unit: true,
        ahspVersionId: true,
        workingOccurrenceId: true,
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
    const results: Array<{ boqItemId: string; kind: string }> = [];
    for (const item of current.slice(0, limit)) {
      if (
        item.priceOrigin ||
        item.ahspVersionId ||
        item.workingOccurrenceId ||
        item.calculationOccurrenceId
      ) {
        results.push({ boqItemId: item.id, kind: 'ALREADY_DECIDED' });
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
        (r) => r.kind === 'PROVEN_ASSOCIATION_REUSED',
      ),
      rabApproved: false,
      rabLocked: false,
    };
  }
}
