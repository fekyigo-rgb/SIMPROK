import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  CanonicalPricePoint,
  KnowledgeEvent,
  PriceSourceOrigin,
  PriceSourceType,
  ResourceCatalog,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type SubscriptionEvent = KnowledgeEvent & {
  canonicalPricePoint: (CanonicalPricePoint & {
    resourceCatalog: ResourceCatalog | null;
  }) | null;
};

interface ClaimRow {
  id: string;
}

export type BusinessSubscriptionResult =
  | { processed: false; reason: 'NO_EVENT' }
  | {
      processed: true;
      knowledgeEventId: string;
      status:
        | 'SUBMITTED'
        | 'SKIPPED_ALREADY_SUBMITTED'
        | 'SKIPPED_RESOURCE_NOT_LINKED'
        | 'SKIPPED_UNIT_MISMATCH'
        | 'SKIPPED_INVALID_EVENT';
      priceSubmissionId?: string;
      priceSubmissionRevisionId?: string;
    };

const SOURCE_TYPE_BY_ORIGIN: Record<PriceSourceOrigin, PriceSourceType> = {
  GOVERNMENT: 'REGULATION',
  SUPPLIER: 'VENDOR_QUOTE',
  STORE: 'VENDOR_QUOTE',
  DISTRIBUTOR: 'VENDOR_QUOTE',
  FIELD_REPORT: 'MARKET_SURVEY',
  COMMUNITY_REPORT: 'MARKET_SURVEY',
};

@Injectable()
export class BusinessSubscriptionService
  implements OnModuleInit, OnModuleDestroy
{
  private interval: NodeJS.Timeout | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.assertSourceOriginMappingComplete();

    if (process.env.INTAKE_BUSINESS_SUBSCRIPTION_WORKER_ENABLED !== 'true') {
      return;
    }

    this.interval = setInterval(() => {
      void this.processOnce().catch((error) => {
        console.error('reality-intake.business-subscription.worker_error', {
          errorCode: 'BUSINESS_SUBSCRIPTION_PROCESS_ONCE_FAILED',
          reason: error instanceof Error ? error.message : String(error),
          stage: 'BUSINESS_SUBSCRIPTION',
        });
      });
    }, Number(process.env.INTAKE_BUSINESS_SUBSCRIPTION_WORKER_INTERVAL_MS ?? 5000));
  }

  onModuleDestroy() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async processOnce(): Promise<BusinessSubscriptionResult> {
    const event = await this.claimNextEvent();
    if (!event) {
      return { processed: false, reason: 'NO_EVENT' };
    }

    const existingSubmission = await this.findExistingSubmission(event.id);
    if (existingSubmission) {
      console.log('reality-intake.business-subscription.skipped', {
        knowledgeEventId: event.id,
        reason: 'SKIPPED_ALREADY_SUBMITTED',
        priceSubmissionId: existingSubmission.submissionId,
        stage: 'BUSINESS_SUBSCRIPTION',
      });
      return {
        processed: true,
        knowledgeEventId: event.id,
        status: 'SKIPPED_ALREADY_SUBMITTED',
        priceSubmissionId: existingSubmission.submissionId,
      };
    }

    if (event.knowledgeType !== 'PRICE_POINT' || !event.canonicalPricePointId) {
      return this.skip(event, 'SKIPPED_INVALID_EVENT');
    }

    const canonical = event.canonicalPricePoint;
    if (!canonical) {
      return this.skip(event, 'SKIPPED_INVALID_EVENT');
    }

    if (!canonical.resourceCatalogId || !canonical.resourceCatalog) {
      return this.skip(event, 'SKIPPED_RESOURCE_NOT_LINKED');
    }

    const resourceCatalogId = canonical.resourceCatalogId;
    const resourceCatalog = canonical.resourceCatalog;

    if (!this.unitsMatch(canonical.unit, resourceCatalog.baseUnit)) {
      return this.skip(event, 'SKIPPED_UNIT_MISMATCH');
    }

    const sourceType = SOURCE_TYPE_BY_ORIGIN[canonical.sourceOrigin];
    if (!sourceType) {
      throw new Error(`Unmapped PriceSourceOrigin: ${canonical.sourceOrigin}`);
    }

    return this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.priceSubmissionAudit.findFirst({
        where: { reason: { contains: this.eventReasonToken(event.id) } },
        select: { submissionId: true },
      });

      if (duplicate) {
        console.log('reality-intake.business-subscription.skipped', {
          knowledgeEventId: event.id,
          reason: 'SKIPPED_ALREADY_SUBMITTED',
          priceSubmissionId: duplicate.submissionId,
          stage: 'BUSINESS_SUBSCRIPTION',
        });
        return {
          processed: true,
          knowledgeEventId: event.id,
          status: 'SKIPPED_ALREADY_SUBMITTED',
          priceSubmissionId: duplicate.submissionId,
        };
      }

      const submission = await tx.priceSubmission.create({
        data: {
          workspaceId: event.workspaceId,
          organizationId: event.organizationId,
          resourceId: resourceCatalogId,
          regionId: null,
          reportedByAccountId: null,
          sourceOrigin: canonical.sourceOrigin,
          sourceType,
          status: 'SUBMITTED',
        },
      });

      const note = [
        `knowledgeEventId:${event.id}`,
        `canonicalPricePointId:${canonical.id}`,
        `canonicalUnit:${canonical.unit}`,
        `resourceCatalogBaseUnit:${resourceCatalog.baseUnit}`,
        `sourceType:${sourceType}`,
      ].join('; ');

      const revision = await tx.priceSubmissionRevision.create({
        data: {
          submissionId: submission.id,
          revisionNumber: 1,
          value: canonical.value,
          effectiveDate: canonical.effectiveDate,
          validUntil: null,
          validationPassed: false,
          validationMessage: null,
          note,
        },
      });

      await tx.priceSubmission.update({
        where: { id: submission.id },
        data: { currentRevisionId: revision.id },
      });

      await tx.priceSubmissionAudit.create({
        data: {
          submissionId: submission.id,
          fromStatus: null,
          toStatus: 'SUBMITTED',
          actorType: 'SYSTEM',
          actorAccountId: null,
          reason: [
            'STEP-2.6a',
            `knowledgeEventId:${event.id}`,
            `canonicalPricePointId:${canonical.id}`,
            `sourceType:${sourceType}`,
            `unitResolved:${canonical.unit}->${resourceCatalog.baseUnit}`,
            `resourceCatalogId:${resourceCatalogId}`,
          ].join('; '),
        },
      });

      return {
        processed: true,
        knowledgeEventId: event.id,
        status: 'SUBMITTED',
        priceSubmissionId: submission.id,
        priceSubmissionRevisionId: revision.id,
      };
    });
  }

  async listPendingResourceLinks(workspaceId: string, organizationId: string) {
    return this.prisma.knowledgeEvent.findMany({
      where: {
        knowledgeType: 'PRICE_POINT',
        workspaceId,
        organizationId,
        canonicalPricePointId: { not: null },
        canonicalPricePoint: { resourceCatalogId: null },
        NOT: {
          id: {
            in: await this.processedKnowledgeEventIds(),
          },
        },
      },
      include: { canonicalPricePoint: true },
      orderBy: { sequence: 'asc' },
    });
  }

  async listPendingUnitAdjustments(workspaceId: string, organizationId: string) {
    const events = await this.prisma.knowledgeEvent.findMany({
      where: {
        knowledgeType: 'PRICE_POINT',
        workspaceId,
        organizationId,
        canonicalPricePointId: { not: null },
        canonicalPricePoint: {
          resourceCatalogId: { not: null },
        },
        NOT: {
          id: {
            in: await this.processedKnowledgeEventIds(),
          },
        },
      },
      include: {
        canonicalPricePoint: { include: { resourceCatalog: true } },
      },
      orderBy: { sequence: 'asc' },
    });

    return events.filter((event) => {
      const canonical = event.canonicalPricePoint;
      return (
        canonical?.resourceCatalog &&
        !this.unitsMatch(canonical.unit, canonical.resourceCatalog.baseUnit)
      );
    });
  }

  private async claimNextEvent(): Promise<SubscriptionEvent | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimRow[]>`
        SELECT e.id
        FROM knowledge_events e
        WHERE e."knowledgeType" = 'PRICE_POINT'
          AND e."canonicalPricePointId" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM price_submission_audits a
            WHERE a.reason LIKE '%' || e.id::text || '%'
          )
        ORDER BY e.sequence ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      const row = rows[0];
      if (!row) {
        return null;
      }

      return tx.knowledgeEvent.findUnique({
        where: { id: row.id },
        include: {
          canonicalPricePoint: {
            include: { resourceCatalog: true },
          },
        },
      });
    });
  }

  private async findExistingSubmission(knowledgeEventId: string) {
    return this.prisma.priceSubmissionAudit.findFirst({
      where: { reason: { contains: this.eventReasonToken(knowledgeEventId) } },
      select: { submissionId: true },
    });
  }

  private skip(
    event: KnowledgeEvent,
    status: Exclude<
      BusinessSubscriptionResult,
      { processed: false }
    >['status'],
  ): BusinessSubscriptionResult {
    console.log('reality-intake.business-subscription.skipped', {
      knowledgeEventId: event.id,
      reason: status,
      stage: 'BUSINESS_SUBSCRIPTION',
    });

    return {
      processed: true,
      knowledgeEventId: event.id,
      status,
    };
  }

  private unitsMatch(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
  }

  private eventReasonToken(knowledgeEventId: string): string {
    return `knowledgeEventId:${knowledgeEventId}`;
  }

  private async processedKnowledgeEventIds(): Promise<string[]> {
    const audits = await this.prisma.priceSubmissionAudit.findMany({
      where: { reason: { contains: 'knowledgeEventId:' } },
      select: { reason: true },
    });

    return audits
      .map((audit) => audit.reason?.match(/knowledgeEventId:([0-9a-f-]+)/i)?.[1])
      .filter((id): id is string => Boolean(id));
  }

  private assertSourceOriginMappingComplete() {
    const unmapped = Object.values(PriceSourceOrigin).filter(
      (origin) => !SOURCE_TYPE_BY_ORIGIN[origin],
    );
    if (unmapped.length > 0) {
      throw new Error(
        `Unmapped PriceSourceOrigin values: ${unmapped.join(', ')}`,
      );
    }
  }
}
