import { BadRequestException, Injectable } from '@nestjs/common';
import {
  IntelligenceEfPermission,
  IntelligenceEvidenceStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { IntelligenceEvidenceRecord } from './constitutional-ai-boundary.service';

const EVIDENCE_STATUSES = new Set<string>(Object.values(IntelligenceEvidenceStatus));
const EF_PERMISSIONS = new Set<string>(Object.values(IntelligenceEfPermission));

@Injectable()
export class IntelligenceEvidenceService {
  constructor(private readonly prisma: PrismaService) {}

  async append(record: IntelligenceEvidenceRecord): Promise<void> {
    this.assertRecord(record);

    const [project, membership] = await Promise.all([
      this.prisma.project.findFirst({
        where: {
          id: record.projectId,
          workspaceId: record.workspaceId,
          organizationId: record.organizationId,
          deletedAt: null,
        },
        select: { id: true },
      }),
      this.prisma.workspaceMembership.findFirst({
        where: {
          accountId: record.accountId,
          workspaceId: record.workspaceId,
        },
        select: { id: true },
      }),
    ]);

    if (!project || !membership) {
      throw new BadRequestException('Invalid intelligence evidence tenant context');
    }

    await this.prisma.intelligenceEvidence.create({
      data: {
        requestId: record.requestId,
        workspaceId: record.workspaceId,
        organizationId: record.organizationId,
        projectId: record.projectId,
        accountId: record.accountId,
        providerIdentifier: record.providerIdentifier || null,
        modelIdentifier: record.modelIdentifier || null,
        policyVersion: record.policyVersion,
        inputHash: record.promptInputHash,
        status: record.status,
        sourceReferences: this.cleanStringArray(record.sourceReferences),
        toolsRequested: this.cleanStringArray(record.toolsRequested),
        toolsAllowed: this.cleanStringArray(record.toolsAllowed),
        toolsDenied: this.cleanStringArray(record.toolsDenied),
        selectedAhspIds: this.cleanStringArray(record.selectedAhspIds),
        selectedBasicPriceIds: this.cleanStringArray(record.selectedBasicPriceIds),
        efPermission: record.efPermission,
        efReferences: this.cleanStringArray(record.efReferences),
        confidence: this.averageConfidence(record.confidence),
        reasonCodes: this.cleanStringArray(record.reasonCodes),
        policyRejections: this.cleanStringArray(record.policyRejections),
      },
    });
  }

  private assertRecord(record: IntelligenceEvidenceRecord) {
    if (!EVIDENCE_STATUSES.has(record.status)) {
      throw new BadRequestException('Unsupported intelligence evidence status');
    }
    if (!EF_PERMISSIONS.has(record.efPermission)) {
      throw new BadRequestException('Unsupported intelligence EF permission');
    }
    const confidence = record.confidence ?? [];
    if (
      confidence.some(
        (value) => !Number.isFinite(value) || value < 0 || value > 1,
      )
    ) {
      throw new BadRequestException('Invalid intelligence evidence confidence');
    }
  }

  private cleanStringArray(values: string[]): string[] {
    return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))];
  }

  private averageConfidence(values: number[]): number | null {
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
}
