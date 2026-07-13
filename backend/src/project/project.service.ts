import { ConflictException, Injectable, InternalServerErrorException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { InitiateProjectDto } from './dto/initiate-project.dto';
import { SaveDraftBoqDto } from './dto/save-draft-boq.dto';
import { UpdateProjectIntakeContextDto } from './dto/update-project-intake-context.dto';
import { DeviationService } from './deviation.service';
import { detectIntakeMode } from './intake-mode.kernel';

@Injectable()
export class ProjectService {
  constructor(
    private prisma: PrismaService,
    private deviationService: DeviationService
  ) {}

  private buildDraftRecap(
    subtotal: Prisma.Decimal,
    marginPercentInput?: number | Prisma.Decimal | null,
    taxPercentInput?: number | Prisma.Decimal | null,
  ) {
    const marginPercent = new Prisma.Decimal(marginPercentInput ?? 10);
    const taxPercent = new Prisma.Decimal(taxPercentInput ?? 11);
    const marginAmount = subtotal.mul(marginPercent).div(100);
    const taxAmount = subtotal.add(marginAmount).mul(taxPercent).div(100);
    const grandTotal = subtotal.add(marginAmount).add(taxAmount);

    return {
      subtotal,
      marginPercent,
      marginAmount,
      taxPercent,
      taxAmount,
      grandTotal,
    };
  }

  private serializeDraftRecap(recap: ReturnType<ProjectService['buildDraftRecap']>) {
    return {
      subtotal: Number(recap.subtotal),
      marginPercent: Number(recap.marginPercent),
      marginAmount: Number(recap.marginAmount),
      taxPercent: Number(recap.taxPercent),
      ppnPercent: Number(recap.taxPercent),
      taxAmount: Number(recap.taxAmount),
      grandTotal: Number(recap.grandTotal),
    };
  }

  private serializeDecimalString(value: Prisma.Decimal | number | string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    return new Prisma.Decimal(value).toFixed(2);
  }

  private normalizeOptionalText(value: string | null | undefined): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private decimalOrNull(value: string | null | undefined): Prisma.Decimal | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return new Prisma.Decimal(value);
  }

  async create(
    data: CreateProjectDto,
    workspaceId: string,
    creatorAccountId?: string,
  ) {
    try {
      const workspace = await this.prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { organizationId: true },
      });

      if (!workspace) {
        throw new NotFoundException('Workspace not found');
      }

      return await this.prisma.$transaction(async (tx) => {
        const project = await tx.project.create({
          data: {
            name: data.name,
            code: data.code,
            description: data.description,
            budgetBaseline: this.decimalOrNull(data.budgetBaseline),
            mainMaterialSpec: this.normalizeOptionalText(data.mainMaterialSpec),
            workspace: {
              connect: { id: workspaceId },
            },
            organization: {
              connect: { id: workspace.organizationId },
            },
          },
        });

        if (creatorAccountId) {
          const membership = await tx.workspaceMembership.findUnique({
            where: {
              accountId_workspaceId: {
                accountId: creatorAccountId,
                workspaceId,
              }
            }
          });

          if (membership) {
            await tx.projectAssignment.create({
              data: {
                projectId: project.id,
                workspaceMembershipId: membership.id,
                roleInProject: 'OWNER',
                isPrimaryAssignment: true,
                status: 'ASSIGNED'
              }
            });
          }
        }

        return project;
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes('workspaceId') &&
        error.meta.target.includes('code')
      ) {
        throw new ConflictException('Kode proyek sudah dipakai di workspace ini. Gunakan kode lain.');
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

      let totalCost = new Prisma.Decimal(0);
      const tempIdMap = new Map<string, string>();
      const folderSet = new Set<string>();

      // 2. Create BoqItems
      let orderCounter = 0;
      for (const item of data.items) {
        let parentId: string | undefined = undefined;
        if (item.parentTempId) {
          if (!tempIdMap.has(item.parentTempId)) {
            throw new BadRequestException(`Parent reference ${item.parentTempId} not found in preceding items.`);
          }
          parentId = tempIdMap.get(item.parentTempId);
          if (!folderSet.has(parentId!)) {
            throw new BadRequestException(`Parent of ${item.name} must be a FOLDER.`);
          }
        }

        const isFolder = item.itemType === 'FOLDER';
        const isNote = item.itemType === 'NOTE';
        
        let unitPrice: Prisma.Decimal | null = null;
        let lineTotal: Prisma.Decimal | null = null;
        let quantity = new Prisma.Decimal(0);
        let unit = '';

        if (!isFolder && !isNote) {
          quantity = new Prisma.Decimal(item.quantity || 0);
          unitPrice = new Prisma.Decimal(item.unitPrice || 0);
          lineTotal = quantity.mul(unitPrice);
          totalCost = totalCost.add(lineTotal);
          unit = item.unit || '';
        }

        const createdItem = await tx.boqItem.create({
          data: {
            boqStructureId: boqStructure.id,
            parentId,
            wbsCode: item.wbsCode,
            name: item.name,
            quantity,
            unit,
            itemType: isFolder ? 'FOLDER' : (isNote ? 'NOTE' : 'WORK_ITEM'),
            unitPrice,
            lineTotal,
            sortOrder: item.sortOrder ?? orderCounter++,
          }
        });

        if (item.tempId) {
          tempIdMap.set(item.tempId, createdItem.id);
        }
        if (isFolder) {
          folderSet.add(createdItem.id);
        }
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
    if (!report) return { available: false, status: 'UNAVAILABLE', message: 'Data realitas belum tersedia', data: null };

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
    return forecasts[0] || { available: false, status: 'UNAVAILABLE', message: 'Data proyeksi belum tersedia', data: null };
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

  async getIntakeMode(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        budgetBaseline: true,
        mainMaterialSpec: true,
      },
    });

    if (!project) throw new NotFoundException('Project not found');

    const baselineWorkItemCount = await this.prisma.boqItem.count({
      where: {
        itemType: 'WORK_ITEM',
        boqStructure: {
          projectId,
          rabs: {
            some: {
              baselines: { some: { status: 'ACTIVE' } },
            },
          },
        },
      },
    });

    const draftWorkItemCount = await this.prisma.boqItem.count({
      where: {
        itemType: 'WORK_ITEM',
        boqStructure: {
          projectId,
          status: 'DRAFT',
        },
      },
    });

    return detectIntakeMode({
      boqDraftWorkItemCount: draftWorkItemCount,
      boqBaselineWorkItemCount: baselineWorkItemCount,
      budgetBaseline: this.serializeDecimalString(project.budgetBaseline),
      mainMaterialSpec: project.mainMaterialSpec,
    });
  }

  async updateIntakeContext(projectId: string, dto: UpdateProjectIntakeContextDto) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) throw new NotFoundException('Project not found');

    const activeBaselineCount = await this.prisma.projectBaseline.count({
      where: { projectId, status: 'ACTIVE' },
    });

    if (activeBaselineCount > 0) {
      throw new ConflictException('Data proyek telah menjadi bagian dari baseline resmi. Gunakan mekanisme perubahan resmi.');
    }

    const data: Prisma.ProjectUpdateInput = {};

    if (Object.prototype.hasOwnProperty.call(dto, 'budgetBaseline')) {
      data.budgetBaseline = dto.budgetBaseline == null
        ? null
        : new Prisma.Decimal(dto.budgetBaseline);
    }

    if (Object.prototype.hasOwnProperty.call(dto, 'mainMaterialSpec')) {
      data.mainMaterialSpec = this.normalizeOptionalText(dto.mainMaterialSpec) ?? null;
    }

    return await this.prisma.project.update({
      where: { id: projectId },
      data,
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
      orderBy: { sortOrder: 'asc' },
    });
  }

  async getDraftBoq(projectId: string): Promise<{ structureId: string | null; items: object[]; recap: object }> {
    const structure = await this.prisma.boqStructure.findFirst({
      where: { projectId, name: 'Working Draft', status: 'DRAFT' },
      orderBy: { createdAt: 'desc' },
    });
    if (!structure) {
      return {
        structureId: null,
        items: [],
        recap: this.serializeDraftRecap(this.buildDraftRecap(new Prisma.Decimal(0))),
      };
    }
    const items = await this.prisma.boqItem.findMany({
      where: { boqStructureId: structure.id },
      orderBy: { sortOrder: 'asc' },
    });
    const rab = await this.prisma.rabDocument.findFirst({
      where: { projectId, boqStructureId: structure.id, status: 'DRAFT' },
      orderBy: { updatedAt: 'desc' },
    });
    const subtotal = rab
      ? new Prisma.Decimal(rab.totalBaseCost)
      : items.reduce(
        (sum, item) => sum.add(item.itemType === 'WORK_ITEM' && item.lineTotal ? item.lineTotal : 0),
        new Prisma.Decimal(0),
      );
    const recap = this.buildDraftRecap(subtotal, rab?.profitPercent, rab?.taxPercent);
    return { structureId: structure.id, items, recap: this.serializeDraftRecap(recap) };
  }

  async saveDraftBoq(projectId: string, dto: SaveDraftBoqDto): Promise<{ structureId: string; items: object[]; recap: object }> {
    return await this.prisma.$transaction(async (tx) => {
      let structure = await tx.boqStructure.findFirst({
        where: { projectId, name: 'Working Draft', status: 'DRAFT' },
        orderBy: { createdAt: 'desc' },
      });
      if (!structure) {
        structure = await tx.boqStructure.create({
          data: { projectId, name: 'Working Draft', version: 1, status: 'DRAFT' },
        });
      }

      // Safe full-replace: nullify parent refs first to avoid self-FK conflict, then delete.
      await tx.boqItem.updateMany({ where: { boqStructureId: structure.id }, data: { parentId: null } });
      await tx.boqItem.deleteMany({ where: { boqStructureId: structure.id } });

      const tempIdMap = new Map<string, string>();
      const insertedItems: object[] = [];
      let subtotal = new Prisma.Decimal(0);

      for (const [index, row] of dto.rows.entries()) {
        const parentId = row.parentTempId ? (tempIdMap.get(row.parentTempId) ?? null) : null;
        const isFolder = row.itemType === 'FOLDER';
        const isNote = row.itemType === 'NOTE';
        const quantity = (!isFolder && !isNote) ? new Prisma.Decimal(row.quantity ?? 0) : new Prisma.Decimal(0);
        const unitPrice = (!isFolder && !isNote) ? new Prisma.Decimal(row.unitPrice ?? 0) : null;
        const lineTotal = (unitPrice !== null) ? quantity.mul(unitPrice) : null;
        if (row.itemType === 'WORK_ITEM' && lineTotal !== null) {
          subtotal = subtotal.add(lineTotal);
        }

        const created = await tx.boqItem.create({
          data: {
            boqStructureId: structure.id,
            parentId,
            wbsCode: row.wbsCode ?? '',
            name: row.name,
            itemType: isFolder ? 'FOLDER' : isNote ? 'NOTE' : 'WORK_ITEM',
            quantity,
            unit: (!isFolder && !isNote) ? (row.unit ?? '') : '',
            unitPrice,
            lineTotal,
            sortOrder: row.sortOrder ?? index,
          },
        });
        tempIdMap.set(row.tempId, created.id);
        insertedItems.push(created);
      }

      const taxPercent = dto.taxPercent ?? dto.ppnPercent ?? 0;
      const recap = this.buildDraftRecap(subtotal, dto.marginPercent ?? 0, taxPercent);
      const rabData = {
        overheadPercent: new Prisma.Decimal(0),
        profitPercent: recap.marginPercent,
        taxPercent: recap.taxPercent,
        totalBaseCost: recap.subtotal,
        totalFinalCost: recap.grandTotal,
      };

      const updatedDraftRabs = await tx.rabDocument.updateMany({
        where: { projectId, boqStructureId: structure.id, status: 'DRAFT' },
        data: rabData,
      });

      if (updatedDraftRabs.count === 0) {
        await tx.rabDocument.create({
          data: {
            projectId,
            boqStructureId: structure.id,
            name: 'Working Draft RAB',
            version: 1,
            status: 'DRAFT',
            ...rabData,
          },
        });
      }

      const persistedRab = await tx.rabDocument.findFirst({
        where: { projectId, boqStructureId: structure.id, status: 'DRAFT' },
        orderBy: { updatedAt: 'desc' },
      });
      const persistedRecap = persistedRab
        ? this.buildDraftRecap(new Prisma.Decimal(persistedRab.totalBaseCost), persistedRab.profitPercent, persistedRab.taxPercent)
        : recap;

      return { structureId: structure.id, items: insertedItems, recap: this.serializeDraftRecap(persistedRecap) };
    });
  }

  async getAhspSnapshot(projectId: string) {
    const boqItems = await this.getBoq(projectId);
    if (!boqItems.length) return [];

    const snapshotIds = boqItems
      .map(item => item.ahspSnapshotId)
      .filter((id): id is string => id !== null);

    if (!snapshotIds.length) return [];

    return await this.prisma.aHSPSnapshot.findMany({
      where: {
        id: { in: snapshotIds }
      },
      include: {
        resources: true,
      }
    });
  }
}
