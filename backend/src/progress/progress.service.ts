import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitFieldProgressDto } from './dto/create-progress.dto';

@Injectable()
export class ProgressService {
  constructor(private prisma: PrismaService) {}


  /**
   * MON-02A — read-only truth surface.
   * Uses only the ACTIVE baseline, its governed BOQ, and SUBMITTED
   * ProgressEntry records. No totals are inferred from repeated entries.
   */
  async getMonitoring(projectId: string) {
    const unavailable = [
      'plannedStart',
      'plannedFinish',
      'plannedDuration',
      'plannedWeight',
    ] as const;

    const baseline = await this.prisma.projectBaseline.findFirst({
      where: { projectId, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
      include: { rabDocument: true },
    });

    if (!baseline?.rabDocument?.boqStructureId) {
      return {
        projectId,
        baseline: baseline
          ? {
              id: baseline.id,
              versionNumber: baseline.versionNumber,
              approvedAt: baseline.approvedAt,
            }
          : null,
        items: [],
        unavailable,
      };
    }

    const items = await this.prisma.boqItem.findMany({
      where: { boqStructureId: baseline.rabDocument.boqStructureId },
      orderBy: { sortOrder: 'asc' },
    });

    const workItemIds = items
      .filter((item) => item.itemType === 'WORK_ITEM')
      .map((item) => item.id);

    const entries =
      workItemIds.length === 0
        ? []
        : await this.prisma.progressEntry.findMany({
            where: {
              boqItemId: { in: workItemIds },
              progressReport: {
                is: {
                  projectId,
                  baselineId: baseline.id,
                  status: 'SUBMITTED',
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              boqItemId: true,
              installedQuantity: true,
              workDate: true,
              notes: true,
              photoUrl: true,
              createdAt: true,
            },
          });

    const latestByBoqItem = new Map<
      string,
      (typeof entries)[number]
    >();

    for (const entry of entries) {
      if (!latestByBoqItem.has(entry.boqItemId)) {
        latestByBoqItem.set(entry.boqItemId, entry);
      }
    }

    return {
      projectId,
      baseline: {
        id: baseline.id,
        versionNumber: baseline.versionNumber,
        approvedAt: baseline.approvedAt,
      },
      items: items.map((item) => {
        const latest = latestByBoqItem.get(item.id);

        return {
          id: item.id,
          parentId: item.parentId,
          wbsNodeId: item.wbsNodeId,
          wbsCode: item.wbsCode,
          name: item.name,
          itemType: item.itemType,
          sortOrder: item.sortOrder,
          planned: {
            quantity: item.quantity.toString(),
            unit: item.unit,
          },
          actual:
            item.itemType !== 'WORK_ITEM'
              ? null
              : latest
                ? {
                    state: 'RECORDED' as const,
                    latestRecord: {
                      id: latest.id,
                      installedQuantity:
                        latest.installedQuantity.toString(),
                      workDate: latest.workDate,
                      notes: latest.notes,
                      photoUrl: latest.photoUrl,
                      recordedAt: latest.createdAt,
                    },
                  }
                : {
                    state: 'NOT_YET_RECORDED' as const,
                    latestRecord: null,
                  },
        };
      }),
      unavailable,
    };
  }

  async submitFieldProgress(dto: SubmitFieldProgressDto, user: any) {
    // 1. Find ACTIVE baseline for the project
    const baseline = await this.prisma.projectBaseline.findFirst({
      where: { projectId: dto.projectId, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
      include: { rabDocument: true },
    });

    if (!baseline || !baseline.rabDocument) {
      throw new BadRequestException('No active baseline found for this project');
    }

    // 2. Create ProgressReport
    // For field terminal, we create a new ProgressReport per submission.
    // In a full implementation, multiple entries might be batched.
    const today = new Date();
    
    return this.prisma.$transaction(async (tx) => {
      // 2.5. Validate all BoqItems
      for (const entry of dto.entries) {
        const boqItem = await tx.boqItem.findUnique({
          where: { id: entry.boqItemId },
        });

        if (!boqItem) {
          throw new BadRequestException(`BoqItem ${entry.boqItemId} not found`);
        }
        if (boqItem.itemType !== 'WORK_ITEM') {
          throw new BadRequestException(`Cannot submit progress for non-WORK_ITEM ${boqItem.name}`);
        }
        if (boqItem.boqStructureId !== baseline.rabDocument.boqStructureId) {
          throw new BadRequestException(`BoqItem ${entry.boqItemId} does not belong to the active baseline`);
        }
      }

      const report = await tx.progressReport.create({
        data: {
          projectId: dto.projectId,
          baselineId: baseline.id,
          periodStartDate: today,
          periodEndDate: today,
          status: 'SUBMITTED', // Directly submitted to Intelligence Chain
        },
      });

      // 3. Create ProgressEntries
      const entriesToCreate = dto.entries.map((entry) => {
        // Parse date if valid, else fallback to today
        const workDate = entry.workDate ? new Date(entry.workDate) : today;
        
        return {
          progressReportId: report.id,
          boqItemId: entry.boqItemId,
          installedQuantity: entry.installedQuantity,
          actualCost: 0, // Recalculated later by Intelligence Chain
          earnedValue: 0, // Recalculated later by Intelligence Chain
          workDate: workDate,
          notes: entry.notes || null,
          photoUrl: entry.photoUrl || null,
        };
      });

      await tx.progressEntry.createMany({
        data: entriesToCreate,
      });

      return {
        message: 'Progress submitted successfully to SIMPROK Intelligence Chain',
        progressReportId: report.id,
      };
    });
  }
}
