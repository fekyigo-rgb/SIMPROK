import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma, ProgressAuditOutcome, ProjectStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { InitiateProjectDto } from './dto/initiate-project.dto';
import { SaveDraftBoqDto } from './dto/save-draft-boq.dto';
import { UpdateProjectIntakeContextDto } from './dto/update-project-intake-context.dto';
import { UpdateProjectTimeZoneDto } from './dto/update-project-time-zone.dto';
import { DeviationService } from './deviation.service';
import { detectIntakeMode } from './intake-mode.kernel';
import {
  RabLifecyclePolicyService,
  WORKING_DRAFT_STRUCTURE_NAME,
} from './rab-lifecycle-policy.service';
import {
  buildDraftRecap,
  hasIncompletePricing,
  incompletePricingRecap,
  serializeDraftRecap,
  RAB_DRAFT_DEFAULT_MARGIN_PERCENT,
  RAB_DRAFT_DEFAULT_TAX_PERCENT,
} from './rab-draft-recap';
import { SERVER_ROW_PROTECTION_REASON } from './rab-kernel-persistence.contracts';
import {
  RAB_STRUCTURE_REASON,
  validateAndOrderRabStructure,
} from './rab-structure-preflight';

/**
 * RAB-TRACE-01 — what an AHSP actually is in this domain. There is no AHSP
 * code column anywhere; identity is work type, method and version.
 */
export interface AhspIdentityProjection {
  workType: string;
  methodName: string;
  versionNumber: number;
  outputUnit: string | null;
  /** Which truth answered: the row's frozen snapshot, or the live version. */
  source: 'SNAPSHOT' | 'LIVE';
}

/**
 * RAB-TRUTH-CLOSEOUT-01 — the persisted facts that decide whether a calculated
 * price may be called SIMPROK's own. Counts, not opinions: the reader applies
 * the rule, this only reports what the sources actually are.
 */
export interface PriceSourceAuthority {
  ahspOwnership: string | null;
  /**
   * THREE STATES: `true` authoritative, `false` proven user asset, `null` the
   * historical ownership was never proven. Collapsing null into false would
   * claim user data without evidence.
   */
  ahspAuthoritative: boolean | null;
  privateBasicPriceCount: number;
  catalogBasicPriceCount: number;
}

@Injectable()
export class ProjectService {
  constructor(
    private prisma: PrismaService,
    private deviationService: DeviationService,
    private rabLifecyclePolicy: RabLifecyclePolicyService,
  ) {}

  private buildDraftRecap = buildDraftRecap;
  private serializeDraftRecap = serializeDraftRecap;
  private incompletePricingRecap = incompletePricingRecap;
  private hasIncompletePricing = hasIncompletePricing;

  private serializeDecimalString(
    value: Prisma.Decimal | number | string | null | undefined,
  ): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    return new Prisma.Decimal(value).toFixed(2);
  }

  private normalizeOptionalText(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeProjectTimeZone(
    value: string | null | undefined,
  ): string | null | undefined {
    const normalized = this.normalizeOptionalText(value);
    if (normalized === undefined || normalized === null) return normalized;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(
        new Date('2026-01-01T00:00:00.000Z'),
      );
    } catch {
      throw new BadRequestException('INVALID_PROJECT_TIME_ZONE');
    }
    return normalized;
  }

  private decimalOrNull(
    value: string | null | undefined,
  ): Prisma.Decimal | null | undefined {
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
              },
            },
          });

          if (membership) {
            await tx.projectAssignment.create({
              data: {
                projectId: project.id,
                workspaceMembershipId: membership.id,
                roleInProject: 'OWNER',
                isPrimaryAssignment: true,
                status: 'ASSIGNED',
              },
            });
          }
        }

        // A new project is born with exactly one empty Working Draft — never a
        // baseline, approved RAB, or progress report. Those only exist once a
        // human explicitly moves the project through the official mechanism.
        await tx.boqStructure.create({
          data: {
            projectId: project.id,
            name: WORKING_DRAFT_STRUCTURE_NAME,
            version: 1,
            status: 'DRAFT',
          },
        });

        return project;
      });
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes('workspaceId') &&
        error.meta.target.includes('code')
      ) {
        throw new ConflictException(
          'Kode proyek sudah dipakai di workspace ini. Gunakan kode lain.',
        );
      }

      console.error('ProjectService Error:', error);
      throw new InternalServerErrorException(
        'Gagal membuat proyek. Pastikan Workspace ID valid dan data lengkap.',
      );
    }
  }

  async initiateSetup(projectId: string, data: InitiateProjectDto) {
    return await this.prisma.$transaction(async (tx) => {
      // Serialize setup attempts per project so duplicate requests cannot race.
      const lockedProject = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT "id" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
      );
      if (lockedProject.length === 0)
        throw new NotFoundException('Project not found');

      // Draft identity is state-based and deliberately independent of its name.
      const draftStructures = await tx.boqStructure.findMany({
        where: { projectId, status: 'DRAFT' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      if (draftStructures.length > 1) {
        throw new ConflictException('MULTIPLE_DRAFT_BOQ_STRUCTURES');
      }

      // New projects reuse their one existing DRAFT. Legacy zero-draft
      // projects may create exactly one container here.
      const boqStructure =
        draftStructures[0] ??
        (await tx.boqStructure.create({
          data: {
            projectId,
            name: 'Main BOQ',
            version: 1,
            status: 'DRAFT',
          },
        }));

      // A populated draft means setup already ran. The project row lock makes
      // this a safe no-op for sequential and concurrent duplicate requests,
      // without inventing approval, baseline, or monitoring state.
      const existingItemCount = await tx.boqItem.count({
        where: { boqStructureId: boqStructure.id },
      });
      if (existingItemCount > 0) {
        return { message: 'Project setup completed successfully' };
      }

      const tempIdMap = new Map<string, string>();
      const folderSet = new Set<string>();

      // 2. Create BoqItems
      let orderCounter = 0;
      for (const item of data.items) {
        let parentId: string | undefined = undefined;
        if (item.parentTempId) {
          if (!tempIdMap.has(item.parentTempId)) {
            throw new BadRequestException(
              `Parent reference ${item.parentTempId} not found in preceding items.`,
            );
          }
          parentId = tempIdMap.get(item.parentTempId);
          if (!folderSet.has(parentId!)) {
            throw new BadRequestException(
              `Parent of ${item.name} must be a FOLDER.`,
            );
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
          // Omitted (undefined) or explicit null unitPrice means "not priced
          // yet" and must stay null — never collapse an unsupplied price
          // into a fabricated 0 (5D null-integrity law / GATE-2A truth
          // constraint). An explicit 0 is a real human-entered price and
          // must round-trip as 0, distinct from "not priced".
          unitPrice =
            item.unitPrice !== undefined && item.unitPrice !== null
              ? new Prisma.Decimal(item.unitPrice)
              : null;
          lineTotal = unitPrice !== null ? quantity.mul(unitPrice) : null;
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
            itemType: isFolder ? 'FOLDER' : isNote ? 'NOTE' : 'WORK_ITEM',
            unitPrice,
            lineTotal,
            sortOrder: item.sortOrder ?? orderCounter++,
            // GATE-2A truth constraint: priceOrigin must exactly mirror
            // whether this row actually carries a human-supplied price —
            // never fabricated, never assumed present. FOLDER/NOTE rows and
            // an unpriced WORK_ITEM both stay null here.
            priceOrigin: unitPrice !== null ? 'MANUAL_CLIENT' : null,
          },
        });

        if (item.tempId) {
          tempIdMap.set(item.tempId, createdItem.id);
        }
        if (isFolder) {
          folderSet.add(createdItem.id);
        }
      }

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
            boqItem: true,
          },
        },
      },
    });

    const report = reports[0];
    if (!report)
      return {
        available: false,
        status: 'UNAVAILABLE',
        message: 'Data realitas belum tersedia',
        data: null,
      };

    // Fetch baseline to get total planned cost
    const baseline = await this.prisma.projectBaseline.findFirst({
      where: { projectId, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
    });

    // NO_BASELINE_FALSE_ZERO / ACTIVE_BASELINE_RAB_TOTAL_NULL_IS_NOT_ZERO: no
    // ACTIVE ProjectBaseline at all, a baseline whose RabDocument is
    // missing, or a RabDocument whose totalBaseCost is not yet authoritative
    // (NULL — an incomplete draft, per the GATE-2A truth constraint) must
    // never be reported as a planned cost of 0. `let overallPlannedCost = 0`
    // followed by a conditional skip is exactly how JavaScript silently
    // fabricates a real-looking zero — fail closed in every one of these
    // three cases instead, reusing this method's existing UNAVAILABLE shape.
    if (!baseline) {
      return {
        available: false,
        status: 'UNAVAILABLE',
        message: 'Baseline aktif belum tersedia',
        data: null,
      };
    }
    const rab = baseline.rabDocumentId
      ? await this.prisma.rabDocument.findUnique({
          where: { id: baseline.rabDocumentId },
        })
      : null;
    if (!rab || rab.totalBaseCost === null) {
      return {
        available: false,
        status: 'UNAVAILABLE',
        message:
          'Total RAB baseline aktif belum tersedia atau belum otoritatif',
        data: null,
      };
    }
    const overallPlannedCost = Number(rab.totalBaseCost);

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

    const overallActualProgress =
      entryCount > 0 ? totalActualProgressPct / entryCount : 0;
    const overallPlannedProgress = null; // Truthful: no time-phased schedule model exists

    // NOTE: No actualCost fallback. If actualCost is 0, it means field did not record it.
    // SIMPROK must not invent evidence. 0 = NOT YET RECORDED. The UI must display this honestly.

    // PHASE 01: DEVIATION INTELLIGENCE
    // Generate verified deviations based strictly on known foundations
    const deviationSignals = await this.deviationService.computeAndPersist(
      projectId,
      report.id,
      report.entries,
    );

    return {
      ...report,
      overallPlannedProgress,
      overallActualProgress,
      overallPlannedCost,
      overallActualCost,
      deviationSignals,
    };
  }

  async getHorizon(projectId: string) {
    // Return latest forecast
    const forecasts = await this.prisma.projectForecast.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    return (
      forecasts[0] || {
        available: false,
        status: 'UNAVAILABLE',
        message: 'Data proyeksi belum tersedia',
        data: null,
      }
    );
  }

  async getStorm(projectId: string) {
    // Return active risks
    return await this.prisma.projectRisk.findMany({
      where: {
        projectId,
        status: { in: ['IDENTIFIED', 'MITIGATING'] }, // Assuming these statuses
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
      },
    });
  }

  async getAuthority(projectId: string) {
    // Return formal decisions
    return await this.prisma.formalDecision.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        recommendation: true,
      },
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

  async updateIntakeContext(
    projectId: string,
    dto: UpdateProjectIntakeContextDto,
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) throw new NotFoundException('Project not found');

    const activeBaselineCount = await this.prisma.projectBaseline.count({
      where: { projectId, status: 'ACTIVE' },
    });

    if (activeBaselineCount > 0) {
      throw new ConflictException(
        'Data proyek telah menjadi bagian dari baseline resmi. Gunakan mekanisme perubahan resmi.',
      );
    }

    const data: Prisma.ProjectUpdateInput = {};

    if (Object.prototype.hasOwnProperty.call(dto, 'budgetBaseline')) {
      data.budgetBaseline =
        dto.budgetBaseline == null
          ? null
          : new Prisma.Decimal(dto.budgetBaseline);
    }

    if (Object.prototype.hasOwnProperty.call(dto, 'mainMaterialSpec')) {
      data.mainMaterialSpec =
        this.normalizeOptionalText(dto.mainMaterialSpec) ?? null;
    }

    return await this.prisma.project.update({
      where: { id: projectId },
      data,
    });
  }

  async updateProjectTimeZone(
    projectId: string,
    dto: UpdateProjectTimeZoneDto,
    actor: {
      accountId: string;
      membershipId: string;
      workspaceId: string;
      assignmentId: string;
      roleInProject: string;
    },
  ) {
    const nextTimeZone = this.normalizeProjectTimeZone(dto.timeZone) ?? null;
    const reason = this.normalizeOptionalText(dto.reason) ?? null;
    const commandFingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          action: 'PROJECT_TIME_ZONE_SET',
          projectId,
          actorAccountId: actor.accountId,
          nextTimeZone,
          reason,
        }),
      )
      .digest('hex');

    return this.prisma.$transaction(async (tx) => {
      const lockedProject = await tx.$queryRaw<
        Array<{ id: string; workspaceId: string; timeZone: string | null }>
      >(
        Prisma.sql`SELECT "id", "workspaceId", "timeZone"
                     FROM "projects"
                    WHERE "id" = ${projectId}::uuid
                    FOR UPDATE`,
      );
      const project = lockedProject[0];
      if (!project) throw new NotFoundException('Project not found');
      if (project.workspaceId !== actor.workspaceId) {
        throw new NotFoundException('Project not found');
      }

      const existingCommand = await tx.projectTimeZoneEvent.findUnique({
        where: { commandId: dto.commandId },
      });
      if (existingCommand) {
        if (
          existingCommand.projectId !== projectId ||
          existingCommand.actorAccountId !== actor.accountId ||
          existingCommand.commandFingerprint !== commandFingerprint
        ) {
          throw new ConflictException('COMMAND_ID_REUSED');
        }
        return tx.project.findUniqueOrThrow({ where: { id: projectId } });
      }

      const trustedActor = await tx.workspaceMembership.findFirst({
        where: {
          id: actor.membershipId,
          accountId: actor.accountId,
          workspaceId: actor.workspaceId,
          status: 'ACTIVE',
          userProfile: { status: 'ACTIVE' },
        },
        select: { id: true },
      });
      if (!trustedActor) {
        throw new BadRequestException('Trusted project actor is required');
      }

      const trustedAssignment = await tx.projectAssignment.findFirst({
        where: {
          id: actor.assignmentId,
          projectId,
          workspaceMembershipId: actor.membershipId,
          status: 'ASSIGNED',
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!trustedAssignment) {
        throw new BadRequestException('Trusted project assignment is required');
      }

      const changed = project.timeZone !== nextTimeZone;
      const updated = changed
        ? await tx.project.update({
            where: { id: projectId },
            data: { timeZone: nextTimeZone },
          })
        : await tx.project.findUniqueOrThrow({
            where: { id: projectId },
          });

      const action = changed
        ? 'PROJECT_TIME_ZONE_UPDATED'
        : 'PROJECT_TIME_ZONE_CONFIRMED';
      const now = new Date();
      const domainEvent = await tx.projectTimeZoneEvent.create({
        data: {
          workspaceId: actor.workspaceId,
          projectId,
          actorAccountId: actor.accountId,
          actorMembershipId: actor.membershipId,
          previousTimeZone: project.timeZone,
          nextTimeZone,
          action,
          reason,
          commandId: dto.commandId,
          commandFingerprint,
          occurredAt: now,
        },
      });

      await tx.progressAuditEvent.create({
        data: {
          schemaVersion: 1,
          eventType: 'PROJECT_CONFIGURATION',
          outcome: ProgressAuditOutcome.SUCCESS,
          workspaceId: actor.workspaceId,
          projectId,
          progressEntryId: null,
          actorAccountId: actor.accountId,
          actorMembershipId: actor.membershipId,
          actorType: 'USER',
          action,
          roleInProjectSnapshot: actor.roleInProject,
          sourceModule: 'PROJECT_GOVERNANCE',
          targetEntityType: 'PROJECT_TIME_ZONE_EVENT',
          targetEntityId: domainEvent.id,
          correlationId: randomUUID(),
          requestId: randomUUID(),
          businessCommandId: dto.commandId,
          commandId: `PROJECT_TIME_ZONE:${dto.commandId}`,
          commandFingerprint,
          reason,
          reasonCode: null,
          reasonText: reason,
          errorCode: null,
          metadata: {
            previousTimeZone: project.timeZone,
            nextTimeZone,
          },
          occurredAt: now,
          recordedAt: now,
        },
      });

      return updated;
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

    // The official RAB reads through the same AHSP identity authority as the
    // draft, so the two rooms cannot disagree about what analysis a row uses.
    return await this.attachPriceSourceAuthority(
      await this.attachAhspIdentity(
        await this.prisma.boqItem.findMany({
          where: { boqStructureId: rab.boqStructureId },
          orderBy: { sortOrder: 'asc' },
        }),
      ),
    );
  }

  /**
   * Intentional final contract: always 200, never 409. GET only describes
   * reality — it never creates a Working Draft, never mutates anything, and
   * never expresses lifecycle state as an HTTP error. `capability` is the
   * sole signal of editability; callers (RabWorkspacePage) must not render
   * editable controls unless capability.canEditDraft is true.
   */
  async getDraftBoq(
    projectId: string,
    projectStatus: ProjectStatus,
  ): Promise<{
    structureId: string | null;
    items: object[];
    recap: object;
    capability: object;
  }> {
    const capability = await this.rabLifecyclePolicy.evaluate(
      projectId,
      projectStatus,
    );

    const structure = await this.prisma.boqStructure.findFirst({
      where: { projectId, name: WORKING_DRAFT_STRUCTURE_NAME, status: 'DRAFT' },
      orderBy: { createdAt: 'desc' },
    });
    if (!structure) {
      return {
        structureId: null,
        items: [],
        recap: this.serializeDraftRecap(
          this.buildDraftRecap(new Prisma.Decimal(0)),
        ),
        capability,
      };
    }
    const rawItems = await this.prisma.boqItem.findMany({
      where: { boqStructureId: structure.id },
      orderBy: { sortOrder: 'asc' },
    });

    // RAB-TRACE-01 — an AHSP has no code in this domain; it is identified by
    // its work type, its method and a version. The viewer was showing wbsCode
    // as if it were an AHSP code, which is the RAB row's own code and not an
    // AHSP identity at all. Project the real identity so both rooms can name
    // the analysis truthfully instead of borrowing a field that means
    // something else. Read-only: no column is written and no schema changes.
    const items = await this.attachPriceSourceAuthority(
      await this.attachAhspIdentity(rawItems),
    );

    // A stale RabDocument recap from a time when every row was priced is not
    // authoritative once the live items include an unpriced WORK_ITEM — the
    // read path re-derives pricingStatus from current items every time
    // rather than trusting a persisted flag (5D: "existing draft recap lama
    // tidak boleh dipakai sebagai otoritas untuk rows yang kini incomplete").
    if (this.hasIncompletePricing(items)) {
      return {
        structureId: structure.id,
        items,
        recap: this.incompletePricingRecap(),
        capability,
      };
    }

    const rab = await this.prisma.rabDocument.findFirst({
      where: { projectId, boqStructureId: structure.id, status: 'DRAFT' },
      orderBy: { updatedAt: 'desc' },
    });
    const subtotal =
      rab && rab.totalBaseCost !== null
        ? new Prisma.Decimal(rab.totalBaseCost)
        : items.reduce(
            (sum, item) =>
              sum.add(
                item.itemType === 'WORK_ITEM' && item.lineTotal
                  ? item.lineTotal
                  : 0,
              ),
            new Prisma.Decimal(0),
          );
    const recap = this.buildDraftRecap(
      subtotal,
      rab?.profitPercent,
      rab?.taxPercent,
    );
    return {
      structureId: structure.id,
      items,
      recap: this.serializeDraftRecap(recap),
      capability,
    };
  }

  /**
   * RAB-TRACE-01 — attach canonical AHSP identity to rows that reference one.
   *
   * Read-only and additive: the row objects are returned unchanged apart from
   * an `ahsp` field carrying what the AHSP itself says it is. Rows with no
   * AHSP get null, so the reader can say "belum terhubung" rather than invent
   * an analysis that was never linked.
   */
  /**
   * RAB-TRACE-01 — the one place RAB reads learn what analysis a row uses.
   *
   * Every lawful RAB read goes through here: the working draft, the official
   * baseline, and any future view of the same rows. Adding it to the draft
   * path alone would have looked right today only because this project has no
   * baseline yet — the moment one existed, the official RAB would have lost
   * the identity the draft showed.
   *
   * Authority order follows what the row is actually bound to. A row carrying
   * an AHSP snapshot is bound to that frozen historical truth, so the snapshot
   * answers; otherwise the live version does. Only when neither exists is the
   * row honestly unlinked — a legitimate snapshot is never called "belum
   * terhubung".
   *
   * Read-only and additive: no column is written and no schema changes.
   */
  private async attachAhspIdentity<
    T extends { ahspVersionId: string | null; ahspSnapshotId?: string | null },
  >(items: T[]): Promise<Array<T & { ahsp: AhspIdentityProjection | null }>> {
    const snapshotIds = Array.from(
      new Set(
        items
          .map((item) => item.ahspSnapshotId)
          .filter((id): id is string => !!id),
      ),
    );
    const versionIds = Array.from(
      new Set(
        items
          .filter((item) => !item.ahspSnapshotId)
          .map((item) => item.ahspVersionId)
          .filter((id): id is string => !!id),
      ),
    );

    const [snapshots, versions] = await Promise.all([
      snapshotIds.length
        ? this.prisma.aHSPSnapshot.findMany({
            where: { id: { in: snapshotIds } },
            select: {
              id: true,
              workType: true,
              methodName: true,
              versionNumber: true,
              outputUnit: true,
            },
          })
        : Promise.resolve([]),
      versionIds.length
        ? this.prisma.aHSPVersion.findMany({
            where: { id: { in: versionIds } },
            select: {
              id: true,
              versionNumber: true,
              outputUnit: true,
              ahsp: { select: { workType: true, methodName: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const bySnapshot = new Map(
      snapshots.map((snapshot): [string, AhspIdentityProjection] => [
        snapshot.id,
        {
          workType: snapshot.workType,
          methodName: snapshot.methodName,
          versionNumber: snapshot.versionNumber,
          outputUnit: snapshot.outputUnit,
          source: 'SNAPSHOT' as const,
        },
      ]),
    );
    const byVersion = new Map(
      versions.map((version): [string, AhspIdentityProjection] => [
        version.id,
        {
          workType: version.ahsp.workType,
          methodName: version.ahsp.methodName,
          versionNumber: version.versionNumber,
          outputUnit: version.outputUnit,
          source: 'LIVE' as const,
        },
      ]),
    );

    return items.map((item) => ({
      ...item,
      ahsp:
        (item.ahspSnapshotId && bySnapshot.get(item.ahspSnapshotId)) ||
        (item.ahspVersionId && byVersion.get(item.ahspVersionId)) ||
        null,
    }));
  }

  /**
   * WHOSE DATA FORMED EACH PRICE — batched, for a whole RAB at once.
   *
   * "SIMPROK calculated it" and "SIMPROK stands behind the sources" are
   * different claims. Only a chain where the AHSP is a SIMPROK/approved asset
   * AND no consumed Basic Price came from the workspace's private catalogue may
   * be called Auto SIMPROK; anything else is the account's own data. The read
   * path must be able to say which, for every row, without opening each row's
   * evidence one at a time.
   *
   * Two queries for the whole structure, both read-only over facts already
   * persisted (AHSP.ownershipType, BasicPrice.assetScope). Nothing is inferred
   * from an amount or a name, and rows with no calculation occurrence simply
   * get null — an unknown, never an assumed authority.
   */
  private async attachPriceSourceAuthority<
    T extends {
      calculationOccurrenceId: string | null;
      ahspVersionId: string | null;
    },
  >(
    items: T[],
  ): Promise<Array<T & { sourceAuthority: PriceSourceAuthority | null }>> {
    const occurrenceIds = Array.from(
      new Set(
        items
          .map((item) => item.calculationOccurrenceId)
          .filter((id): id is string => !!id),
      ),
    );
    if (occurrenceIds.length === 0) {
      return items.map((item) => ({ ...item, sourceAuthority: null }));
    }

    const occurrences = await this.prisma.projectAhspOccurrence.findMany({
      where: { id: { in: occurrenceIds } },
      select: {
        id: true,
        // RAB-TRUTH-01H — the frozen ownership, not the AHSP's ownership today.
        ahspOwnershipAtCalculation: true,
        resourceResolutions: {
          select: { selectedBasicPrice: { select: { assetScope: true } } },
        },
      },
    });

    const byOccurrence = new Map(
      occurrences.map((occurrence): [string, PriceSourceAuthority] => {
        const ownership = occurrence.ahspOwnershipAtCalculation;
        return [
          occurrence.id,
          {
            ahspOwnership: ownership,
            // null stays null — unproven history is unknown, not user data.
            ahspAuthoritative:
              ownership === null
                ? null
                : ownership === 'SIMPROK_ASSET' ||
                  ownership === 'APPROVED_COMMUNITY_ASSET',
            privateBasicPriceCount: occurrence.resourceResolutions.filter(
              (resolution) =>
                resolution.selectedBasicPrice?.assetScope ===
                'WORKSPACE_PRIVATE',
            ).length,
            catalogBasicPriceCount: occurrence.resourceResolutions.filter(
              (resolution) =>
                resolution.selectedBasicPrice?.assetScope === 'SIMPROK_CATALOG',
            ).length,
          },
        ];
      }),
    );

    return items.map((item) => ({
      ...item,
      sourceAuthority:
        (item.calculationOccurrenceId &&
          byOccurrence.get(item.calculationOccurrenceId)) ||
        null,
    }));
  }

  async saveDraftBoq(
    projectId: string,
    dto: SaveDraftBoqDto,
    rawRows: unknown[] = [],
  ): Promise<{ structureId: string; items: object[]; recap: object }> {
    const rawRowAt = (index: number): Record<string, unknown> | undefined => {
      const candidate = rawRows[index];
      return candidate && typeof candidate === 'object'
        ? (candidate as Record<string, unknown>)
        : undefined;
    };

    const saved = await this.prisma.$transaction(async (tx) => {
      const lockedProject = await tx.$queryRaw<
        Array<{ id: string; status: string }>
      >(
        Prisma.sql`SELECT "id", "status" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`,
      );
      const project = lockedProject[0];
      if (!project) throw new NotFoundException('Project not found');

      const capability = await this.rabLifecyclePolicy.evaluateInTransaction(
        tx,
        projectId,
        project.status as ProjectStatus,
      );
      if (!capability.canEditDraft) {
        throw new ConflictException(capability.reasonCode);
      }

      let structure = await tx.boqStructure.findFirst({
        where: {
          projectId,
          name: WORKING_DRAFT_STRUCTURE_NAME,
          status: 'DRAFT',
        },
        orderBy: { createdAt: 'desc' },
      });
      if (!structure) {
        structure = await tx.boqStructure.create({
          data: {
            projectId,
            name: WORKING_DRAFT_STRUCTURE_NAME,
            version: 1,
            status: 'DRAFT',
          },
        });
      }

      // GATE-2A protection: read the current rows BEFORE the full-replace so a
      // SERVER_COST_KERNEL row's authority can be validated and its frozen
      // values carried forward. A row survives a save by VALUE, not by id —
      // the full-replace below always mints new ids, kernel or manual alike.
      const existingItems = await tx.boqItem.findMany({
        where: { boqStructureId: structure.id },
      });
      const existingById = new Map(existingItems.map((row) => [row.id, row]));

      // GATE-2A §C — one canonical recap policy: read the existing DRAFT
      // RabDocument's margin/tax settings before the destructive replacement
      // below, so a save that omits marginPercent/taxPercent preserves a
      // deliberately-set value instead of silently resetting it. Priority:
      // explicit DTO value > existing persisted setting > canonical default
      // (RAB_DRAFT_DEFAULT_MARGIN_PERCENT/_TAX_PERCENT — the same constants
      // buildDraftRecap itself falls back to). The exact same effective
      // percentages are used below for the incomplete recap response, the
      // complete recap calculation, and RabDocument persistence — never a
      // second, divergent formula.
      const existingRabDocument = await tx.rabDocument.findFirst({
        where: { projectId, boqStructureId: structure.id, status: 'DRAFT' },
        orderBy: { updatedAt: 'desc' },
      });
      const effectiveMarginPercent =
        dto.marginPercent !== undefined
          ? dto.marginPercent
          : (existingRabDocument?.profitPercent ??
            RAB_DRAFT_DEFAULT_MARGIN_PERCENT);
      const effectiveTaxPercent =
        dto.taxPercent !== undefined
          ? dto.taxPercent
          : dto.ppnPercent !== undefined
            ? dto.ppnPercent
            : (existingRabDocument?.taxPercent ??
              RAB_DRAFT_DEFAULT_TAX_PERCENT);

      // §4.1: every incoming tempId must be unique, full stop — before any
      // other check, before any mutation.
      const tempIdCounts = new Map<string, number>();
      for (const row of dto.rows) {
        tempIdCounts.set(row.tempId, (tempIdCounts.get(row.tempId) ?? 0) + 1);
      }
      if ([...tempIdCounts.values()].some((count) => count > 1)) {
        throw new ConflictException(
          SERVER_ROW_PROTECTION_REASON.DUPLICATE_TEMP_ID,
        );
      }

      // §4.1: every existing SERVER_COST_KERNEL row must be referenced by
      // the incoming payload exactly once — zero appearances silently
      // deletes it, more than one duplicates/double-counts one kernel
      // calculation. Both fail closed.
      for (const existing of existingItems) {
        if (existing.priceOrigin !== 'SERVER_COST_KERNEL') continue;
        const appearances = tempIdCounts.get(existing.id) ?? 0;
        if (appearances === 0) {
          throw new ConflictException(
            SERVER_ROW_PROTECTION_REASON.SERVER_ROW_OMISSION_REQUIRES_EXPLICIT_COMMAND,
          );
        }
        if (appearances > 1) {
          throw new ConflictException(
            SERVER_ROW_PROTECTION_REASON.SERVER_ROW_DUPLICATE_REFERENCE_FORBIDDEN,
          );
        }
      }

      // Fail-closed BEFORE any delete: if any incoming row would silently
      // overwrite or invalidate a server-authored calculation, reject the
      // whole request now so the transaction rolls back with zero mutation,
      // rather than deleting first and discovering the conflict mid-replace.
      dto.rows.forEach((row, index) => {
        const existing = existingById.get(row.tempId);
        if (!existing || existing.priceOrigin !== 'SERVER_COST_KERNEL') {
          return;
        }
        // §4.2: an explicit "unitPrice" key in the raw request — including
        // an explicit null — is an overwrite attempt on a protected row.
        // Only a key that is genuinely absent from the payload means
        // "don't touch this field." class-transformer's DTO instance
        // cannot make this distinction (every declared field becomes an
        // own property regardless of input), so the pre-transform raw row
        // is required here.
        const rawRow = rawRowAt(index);
        const unitPriceKeyPresent = rawRow
          ? Object.prototype.hasOwnProperty.call(rawRow, 'unitPrice')
          : false;
        if (unitPriceKeyPresent) {
          throw new ConflictException(
            SERVER_ROW_PROTECTION_REASON.SERVER_ROW_UNIT_PRICE_OVERWRITE_FORBIDDEN,
          );
        }
        const quantityChanged =
          row.quantity !== undefined &&
          !new Prisma.Decimal(row.quantity).equals(existing.quantity);
        const unitChanged =
          row.unit !== undefined && row.unit !== existing.unit;
        const itemTypeChanged = row.itemType !== existing.itemType;
        if (quantityChanged || unitChanged || itemTypeChanged) {
          throw new ConflictException(
            SERVER_ROW_PROTECTION_REASON.SERVER_ROW_INPUT_CHANGED_REQUIRES_RECALCULATION,
          );
        }
      });

      /**
       * STRUCTURAL PREFLIGHT — the last gate before anything is destroyed.
       *
       * The whole incoming graph is understood here: duplicate ids, a parent
       * that is not in the payload, a self-parent, a cycle of any length, a
       * parent type canonical law forbids, and two siblings claiming one
       * position. A rejection throws with nothing yet written, so a malformed
       * document leaves the persisted RAB exactly as it was rather than being
       * quietly reshaped into a different, plausible-looking one.
       *
       * It also returns the rows parent-first, which is what the insert loop
       * below needs — validation understood the graph, ordering serves the
       * writer, and the two are no longer the same mechanism (§22). A child
       * listed before its parent is therefore lawful input, not corruption.
       */
      const orderedRows = validateAndOrderRabStructure(dto.rows);

      // Safe full-replace: nullify parent refs first to avoid self-FK conflict, then delete.
      await tx.boqItem.updateMany({
        where: { boqStructureId: structure.id },
        data: { parentId: null },
      });
      await tx.boqItem.deleteMany({ where: { boqStructureId: structure.id } });

      const tempIdMap = new Map<string, string>();
      const insertedItems: Array<{
        itemType: string;
        unitPrice: Prisma.Decimal | null;
        lineTotal: Prisma.Decimal | null;
        [key: string]: unknown;
      }> = [];
      let subtotal = new Prisma.Decimal(0);

      for (const { row, effectiveSortOrder } of orderedRows) {
        /**
         * The preflight proved this parent exists in the payload and that the
         * walk reaches parents first, so a miss here is impossible rather than
         * merely unlikely. Failing loudly keeps that guarantee honest: the old
         * `?? null` is exactly what turned a broken reference into a root row.
         */
        const parentId = row.parentTempId
          ? (tempIdMap.get(row.parentTempId) ??
            (() => {
              throw new BadRequestException(
                RAB_STRUCTURE_REASON.PARENT_NOT_FOUND,
              );
            })())
          : null;
        const isFolder = row.itemType === 'FOLDER';
        const isNote = row.itemType === 'NOTE';
        const quantity =
          !isFolder && !isNote
            ? new Prisma.Decimal(row.quantity ?? 0)
            : new Prisma.Decimal(0);

        const existing = existingById.get(row.tempId);
        const isServerRow =
          !isFolder &&
          !isNote &&
          existing?.priceOrigin === 'SERVER_COST_KERNEL';

        // null/undefined unitPrice means "not priced yet" and must stay null —
        // never collapse an unknown price into a fabricated 0 (5D null-integrity law).
        const hasExplicitPrice =
          !isFolder &&
          !isNote &&
          row.unitPrice !== null &&
          row.unitPrice !== undefined;
        const unitPrice = isServerRow
          ? existing!.unitPrice
          : hasExplicitPrice
            ? new Prisma.Decimal(row.unitPrice as number)
            : null;
        const lineTotal = isServerRow
          ? existing!.lineTotal
          : unitPrice !== null
            ? quantity.mul(unitPrice)
            : null;
        if (row.itemType === 'WORK_ITEM' && lineTotal !== null) {
          subtotal = subtotal.add(lineTotal);
        }

        // §3.1: an unpriced manual row must store priceOrigin=NULL, never
        // MANUAL_CLIENT — MANUAL_CLIENT is reserved for a row that actually
        // carries a human-entered money pair.
        //
        // GATE-2A: ahspVersionId/ahspSnapshotId are not part of this DTO's
        // writable surface — they only ever carry forward from the row they
        // replace, never invented from client input. This preserves a
        // server-authored row's kernel eligibility and provenance
        // (priceOrigin, calculationOccurrenceId, calculationAsOfDate,
        // calculatedAt, calculationPolicyVersion) across an unrelated save.
        const created = await tx.boqItem.create({
          data: {
            boqStructureId: structure.id,
            parentId,
            wbsCode: row.wbsCode ?? '',
            name: row.name,
            itemType: isFolder ? 'FOLDER' : isNote ? 'NOTE' : 'WORK_ITEM',
            quantity,
            unit: !isFolder && !isNote ? (row.unit ?? '') : '',
            unitPrice,
            lineTotal,
            /**
             * THE VALUE S7 CHECKED, NOT A SECOND DERIVATION.
             * Re-deriving `row.sortOrder ?? index` here is what let validation
             * and persistence disagree: the preflight compared what a row
             * CLAIMED while this line wrote what it RESOLVED to, so an omitted
             * sortOrder could silently land on a sibling's position. There is
             * one derivation now, and it happens in the preflight.
             */
            sortOrder: effectiveSortOrder,
            ahspVersionId: existing?.ahspVersionId ?? null,
            ahspSnapshotId: existing?.ahspSnapshotId ?? null,
            workingOccurrenceId: existing?.workingOccurrenceId ?? null,
            priceOrigin: isServerRow
              ? 'SERVER_COST_KERNEL'
              : unitPrice !== null
                ? 'MANUAL_CLIENT'
                : null,
            calculationOccurrenceId: isServerRow
              ? existing!.calculationOccurrenceId
              : null,
            calculationAsOfDate: isServerRow
              ? existing!.calculationAsOfDate
              : null,
            calculatedAt: isServerRow ? existing!.calculatedAt : null,
            calculationPolicyVersion: isServerRow
              ? existing!.calculationPolicyVersion
              : null,
          },
        });
        tempIdMap.set(row.tempId, created.id);
        insertedItems.push(created);
      }

      const pricingIncomplete = this.hasIncompletePricing(insertedItems);

      if (pricingIncomplete) {
        // §4.5: never leave a stale, no-longer-truthful total visible while
        // the draft is incomplete — null out any existing DRAFT
        // RabDocument's totals within this same transaction. Margin/tax
        // settings are left exactly as stored, not deleted.
        await tx.rabDocument.updateMany({
          where: { projectId, boqStructureId: structure.id, status: 'DRAFT' },
          data: { totalBaseCost: null, totalFinalCost: null },
        });
        return {
          structureId: structure.id,
          items: insertedItems,
          recap: this.incompletePricingRecap(
            effectiveMarginPercent,
            effectiveTaxPercent,
          ),
        };
      }

      const recap = this.buildDraftRecap(
        subtotal,
        effectiveMarginPercent,
        effectiveTaxPercent,
      );
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
      const persistedRecap =
        persistedRab && persistedRab.totalBaseCost !== null
          ? this.buildDraftRecap(
              new Prisma.Decimal(persistedRab.totalBaseCost),
              persistedRab.profitPercent,
              persistedRab.taxPercent,
            )
          : recap;

      return {
        structureId: structure.id,
        items: insertedItems,
        recap: this.serializeDraftRecap(persistedRecap),
      };
    });

    /**
     * THE SAME ROW MUST NAME THE SAME ANALYSIS IN BOTH ROOMS.
     *
     * getDraftBoq projects the AHSP identity onto every item (attachAhspIdentity
     * above); this command did not. Ruang Kerja rebuilds its rows from THIS
     * response after a save, so the moment a draft was saved every row lost the
     * analysis it is linked to and reported "Belum terhubung" — while Ruang
     * Hidup, reading the GET path, still showed the code. Same BOQ item, same
     * selected AHSP, two different answers.
     *
     * The linkage was never lost: `ahspVersionId`/`ahspSnapshotId` are carried
     * through the write untouched. Only the projection was missing, so it is
     * added here rather than having the client remember a value the server
     * declined to state. Read-only, additive, outside the transaction because
     * it reads reference data the transaction never wrote.
     */
    return {
      ...saved,
      items: await this.attachPriceSourceAuthority(
        await this.attachAhspIdentity(
          saved.items as Array<
            (typeof saved.items)[number] & {
              ahspVersionId: string | null;
              ahspSnapshotId: string | null;
              calculationOccurrenceId: string | null;
            }
          >,
        ),
      ),
    };
  }

  async getAhspSnapshot(projectId: string) {
    const boqItems = await this.getBoq(projectId);
    if (!boqItems.length) return [];

    const snapshotIds = boqItems
      .map((item) => item.ahspSnapshotId)
      .filter((id): id is string => id !== null);

    if (!snapshotIds.length) return [];

    return await this.prisma.aHSPSnapshot.findMany({
      where: {
        id: { in: snapshotIds },
      },
      include: {
        resources: true,
      },
    });
  }
}
