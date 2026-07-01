import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { InitiateProjectDto } from './dto/initiate-project.dto';
import { DeviationService } from './deviation.service';

@Injectable()
export class ProjectService {
  constructor(
    private prisma: PrismaService,
    private deviationService: DeviationService
  ) {}

  async create(data: CreateProjectDto) {
    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: data.workspaceId },
        select: { organizationId: true },
      });

      if (!workspace) {
        throw new NotFoundException('Workspace not found');
      }

      return await this.prisma.project.create({
        data: {
          name: data.name,
          code: data.code,
          description: data.description,
          workspace: {
            connect: { id: data.workspaceId },
          },
          organization: {
            connect: { id: workspace.organizationId },
          },
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      console.error('ProjectService Error:', error);
      throw new InternalServerErrorException('Gagal membuat proyek. Pastikan Workspace ID valid dan data lengkap.');
    }
  }

  async initiateSetup(projectId: string, data: InitiateProjectDto) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('Project not found');

    return await this.prisma.$transaction(async (tx) => {
      // 1. Create BoqStructure
      const boqStructure = await tx.boqStructure.create({
        data: {
          projectId,
          name: 'Main BOQ',
          version: 1,
        }
      });

      let totalCost = 0;

      // 2. Create BoqItems
      for (const item of data.items) {
        await tx.boqItem.create({
          data: {
            boqStructureId: boqStructure.id,
            wbsCode: item.wbsCode,
            name: item.name,
            quantity: item.quantity,
            unit: item.unit,
          }
        });
        totalCost += item.plannedCost;
      }

      // 3. Create RabDocument
      const rab = await tx.rabDocument.create({
        data: {
          projectId,
          boqStructureId: boqStructure.id,
          name: 'Initial RAB',
          version: 1,
          totalBaseCost: totalCost,
          totalFinalCost: totalCost,
          status: 'APPROVED',
        }
      });

      // 4. Activate ProjectBaseline
      const baseline = await tx.projectBaseline.create({
        data: {
          projectId,
          rabDocumentId: rab.id,
          versionNumber: 1,
          status: 'ACTIVE',
          approvedAt: new Date(),
        }
      });

      // 5. Create initial ProgressReport to open field entry
      await tx.progressReport.create({
        data: {
          projectId,
          baselineId: baseline.id,
          periodStartDate: new Date(),
          periodEndDate: new Date(),
          status: 'SUBMITTED',
        }
      });

      // Update project status to ACTIVE
      await tx.project.update({
        where: { id: projectId },
        data: { status: 'ACTIVE' }
      });

      return { message: 'Project setup completed successfully' };
    });
  }

  async findAllGlobal() {
    return await this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllByWorkspace(workspaceId: string) {
    return await this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
    });
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  async getReality(projectId: string) {
    // Return latest progress reports and deviations
    const reports = await this.prisma.progressReport.findMany({
      where: { projectId },
      orderBy: { periodEndDate: 'desc' },
      take: 1,
      include: {
        entries: {
          include: {
            boqItem: true
          }
        },
      }
    });

    const report = reports[0];
    if (!report) return null;

    // Fetch baseline to get total planned cost
    const baseline = await this.prisma.projectBaseline.findFirst({
      where: { projectId, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
    });

    let overallPlannedCost = 0;
    if (baseline && baseline.rabDocumentId) {
      const rab = await this.prisma.rabDocument.findUnique({
        where: { id: baseline.rabDocumentId }
      });
      if (rab) {
        overallPlannedCost = Number(rab.totalBaseCost) || 0;
      }
    }

    // Calculate Actual Progress and Cost
    let totalActualProgressPct = 0;
    let entryCount = 0;
    let overallActualCost = 0;

    for (const entry of report.entries) {
      const installedQty = Number(entry.installedQuantity) || 0;
      const plannedQty = Number(entry.boqItem.quantity) || 1; // prevent div/0
      
      const itemProgressPct = Math.min((installedQty / plannedQty) * 100, 100);
      totalActualProgressPct += itemProgressPct;
      entryCount++;

      // Since BoqItem doesn't store unitPrice directly in the schema, 
      // we derive a proportional actual cost from the overall planned cost for verification.
      // In a real scenario, this would use AHSP snapshot resource calculations.
      overallActualCost += Number(entry.actualCost) || 0;
    }

    const overallActualProgress = entryCount > 0 ? (totalActualProgressPct / entryCount) : 0;
    const overallPlannedProgress = null; // Truthful: no time-phased schedule model exists

    // NOTE: No actualCost fallback. If actualCost is 0, it means field did not record it.
    // SIMPROK must not invent evidence. 0 = NOT YET RECORDED. The UI must display this honestly.

    // PHASE 01: DEVIATION INTELLIGENCE
    // Generate verified deviations based strictly on known foundations
    const deviationSignals = await this.deviationService.computeAndPersist(projectId, report.id, report.entries);

    return {
      ...report,
      overallPlannedProgress,
      overallActualProgress,
      overallPlannedCost,
      overallActualCost,
      deviationSignals
    };
  }

  async getHorizon(projectId: string) {
    // Return latest forecast
    const forecasts = await this.prisma.projectForecast.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    return forecasts[0] || null;
  }

  async getStorm(projectId: string) {
    // Return active risks
    return await this.prisma.projectRisk.findMany({
      where: { 
        projectId,
        status: { in: ['IDENTIFIED', 'MITIGATING'] } // Assuming these statuses
      },
      orderBy: { riskScore: 'desc' },
    });
  }

  async getWisdom(projectId: string) {
    // Return recommendations
    return await this.prisma.recommendation.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        options: true,
      }
    });
  }

  async getAuthority(projectId: string) {
    // Return formal decisions
    return await this.prisma.formalDecision.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        recommendation: true,
      }
    });
  }

  async getBoq(projectId: string) {
    const baseline = await this.prisma.projectBaseline.findFirst({
      where: { projectId, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
    });
    
    if (!baseline) return [];

    const rab = await this.prisma.rabDocument.findUnique({
      where: { id: baseline.rabDocumentId },
    });

    if (!rab || !rab.boqStructureId) return [];

    return await this.prisma.boqItem.findMany({
      where: { boqStructureId: rab.boqStructureId },
      orderBy: { wbsCode: 'asc' },
    });
  }
}
