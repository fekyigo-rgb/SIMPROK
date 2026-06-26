import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeviationType, SeverityLevel, TrendDirection } from '@prisma/client';

@Injectable()
export class DeviationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Computes deviations for a specific progress report and persists them.
   * Supresses CPI/SPI generation due to lack of time-phased PV and unitPrice EV.
   * Focuses on Quantity Variance which is verifiable.
   */
  async computeAndPersist(projectId: string, reportId: string, entries: any[]) {
    // We only compute Quantity Variance for now
    let totalPlannedQty = 0;
    let totalInstalledQty = 0;

    for (const entry of entries) {
      if (entry.boqItem) {
        totalPlannedQty += Number(entry.boqItem.quantity) || 0;
        totalInstalledQty += Number(entry.installedQuantity) || 0;
      }
    }

    if (totalPlannedQty > 0) {
      const quantityVariance = totalInstalledQty - totalPlannedQty;
      
      // We only generate a signal if there's a negative variance (shortfall),
      // OR if we want to show positive variance too. Let's show it if variance != 0,
      // or just show the current state of quantity.
      // The user wants: "Why is actual execution different from planned execution?"
      
      // Let's create a signal for Quantity Deviation
      const severity = quantityVariance < 0 ? SeverityLevel.WARNING : SeverityLevel.NORMAL;
      
      const description = quantityVariance < 0 
        ? `Observed signal indicates total installed quantity (${totalInstalledQty}) is below total planned quantity (${totalPlannedQty}). Variance: ${quantityVariance}.`
        : `Observed signal indicates total installed quantity (${totalInstalledQty}) meets or exceeds total planned quantity (${totalPlannedQty}).`;

      // Prevent Duplicates
      const existing = await this.prisma.deviationSignal.findFirst({
        where: {
          progressReportId: reportId,
          type: DeviationType.QUANTITY
        }
      });

      if (existing) {
        await this.prisma.deviationSignal.update({
          where: { id: existing.id },
          data: {
            severity,
            description,
            // SPI and CPI are explicitly null
            cpi: null,
            spi: null,
            trend: TrendDirection.STABLE
          }
        });
      } else {
        await this.prisma.deviationSignal.create({
          data: {
            projectId,
            progressReportId: reportId,
            type: DeviationType.QUANTITY,
            severity,
            description,
            cpi: null,
            spi: null,
            trend: TrendDirection.STABLE
          }
        });
      }
    }

    // Return the active signals for this report
    return await this.prisma.deviationSignal.findMany({
      where: { progressReportId: reportId }
    });
  }
}
