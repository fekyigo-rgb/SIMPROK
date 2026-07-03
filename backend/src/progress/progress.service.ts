import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SubmitFieldProgressDto } from './dto/create-progress.dto';

@Injectable()
export class ProgressService {
  constructor(private prisma: PrismaService) {}

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
