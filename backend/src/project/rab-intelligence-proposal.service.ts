import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { BoqItem } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  RabIntelligenceProposal,
  RabIntelligenceRequest,
} from '../intelligence/simprok-intelligence.port';
import { SimprokIntelligenceOrchestrator } from '../intelligence/simprok-intelligence.orchestrator';
import { CreateRabIntelligenceProposalDto } from './dto/create-rab-intelligence-proposal.dto';

const MAX_BOQ_ITEMS = 20;
const MAX_AHSP_CANDIDATES = 25;
const MAIN_MATERIAL_SPEC_MAX_LENGTH = 2000;

/**
 * First grounded RAB intelligence proposal slice (P8A-3). Builds a bounded,
 * tenant-scoped, sanitized grounding packet from data that is actually
 * stored (BOQ draft/baseline, canonical AHSP), then delegates to
 * SimprokIntelligenceOrchestrator for the full provider -> Constitutional
 * Boundary -> append-only Evidence -> draft-only pipeline. This service
 * never writes RAB rows, AHSP, Basic Price, baselines, or canonical
 * knowledge -- it only reads and proposes.
 */
@Injectable()
export class RabIntelligenceProposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: SimprokIntelligenceOrchestrator,
  ) {}

  async propose(
    projectId: string,
    accountId: string,
    dto: CreateRabIntelligenceProposalDto,
  ): Promise<RabIntelligenceProposal> {
    // ProjectAccessGuard has already verified this account may access
    // :projectId. We still re-read the project ourselves (never trusting
    // the client body) to get server-authoritative workspaceId/
    // organizationId/mainMaterialSpec, matching the existing project.service
    // convention (getBoq/getAhspSnapshot also re-derive from projectId).
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        workspaceId: true,
        organizationId: true,
        mainMaterialSpec: true,
      },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const boqStructureId = await this.resolveBoqStructureId(projectId);
    if (!boqStructureId) {
      throw new BadRequestException(
        'Project has no draft or baseline BOQ to ground an intelligence proposal against',
      );
    }

    const selectedItems = await this.selectBoqItems(boqStructureId, dto.boqItemRefs);
    if (selectedItems.length === 0) {
      // The BOQ structure exists but has no WORK_ITEM rows to ground a
      // proposal against -- fail honestly before ever calling the provider,
      // rather than sending it an empty item set.
      throw new BadRequestException(
        'Project BOQ has no WORK_ITEM rows to ground an intelligence proposal against',
      );
    }

    const ahspCandidateRows = await this.prisma.aHSP.findMany({
      where: {
        deletedAt: null,
        reviewStatus: 'APPROVED',
        OR: [{ workspaceId: project.workspaceId }, { workspaceId: null }],
      },
      select: { id: true, workType: true, methodName: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_AHSP_CANDIDATES,
    });

    const rabRequest: RabIntelligenceRequest = {
      requestId: randomUUID(),
      workspaceId: project.workspaceId,
      organizationId: project.organizationId,
      projectId: project.id,
      accountId,
      boqItemRefs: selectedItems.map((item) => item.id),
      boqItems: selectedItems.map((item) => ({
        boqItemRef: item.id,
        wbsCode: item.wbsCode,
        name: item.name,
        unit: item.unit,
        // Canonical decimal string -- never a lossy JS number conversion.
        quantity: item.quantity.toString(),
      })),
      ahspCandidates: ahspCandidateRows.map((row) => ({
        id: row.id,
        label: `${row.workType} - ${row.methodName}`,
      })),
      // Basic Price grounding is not yet safely groundable: no relational
      // link exists from BoqItem/AHSP to BasicPrice/ResourceCatalog to
      // determine relevance without guessing. Passing an explicit empty
      // array (not omitting the field) makes the orchestrator's candidate
      // allowlist strip any selectedBasicPriceIds a provider still returns.
      basicPriceCandidates: [],
      // Stable, content-free references only -- these land in
      // IntelligenceEvidence.sourceReferences, so no project name and no
      // raw spec text may ever be put here.
      projectContextRef: `project:${project.id}`,
      mainMaterialSpecRef: project.mainMaterialSpec
        ? `project:${project.id}:main-material-spec`
        : undefined,
      // Actual bounded/sanitized content for the provider only -- never
      // read by evidence-building, never logged.
      mainMaterialSpecContext: project.mainMaterialSpec
        ? project.mainMaterialSpec.trim().slice(0, MAIN_MATERIAL_SPEC_MAX_LENGTH)
        : undefined,
      // Always NOT_ALLOWED from this endpoint; the orchestrator also hard
      // locks this independently, but the intent is set honestly here too.
      efPermission: 'NOT_ALLOWED',
      requestedAction: 'GENERATE_DRAFT_RAB',
    };

    return this.orchestrator.proposeRabDraft(rabRequest);
  }

  private async resolveBoqStructureId(projectId: string): Promise<string | null> {
    const draft = await this.prisma.boqStructure.findFirst({
      where: { projectId, name: 'Working Draft', status: 'DRAFT' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (draft) return draft.id;

    const baseline = await this.prisma.projectBaseline.findFirst({
      where: { projectId, status: 'ACTIVE' },
      orderBy: { versionNumber: 'desc' },
      select: { rabDocumentId: true },
    });
    if (!baseline) return null;

    const rab = await this.prisma.rabDocument.findUnique({
      where: { id: baseline.rabDocumentId },
      select: { boqStructureId: true },
    });
    return rab?.boqStructureId ?? null;
  }

  /**
   * Never loads the whole BOQ into memory. Default selection queries the
   * database directly with `orderBy` + `take`; explicit refs are queried
   * only by those exact ids within this project's own boqStructureId (so a
   * ref from another project/tenant can never match), then re-ordered to
   * match the caller's requested order deterministically.
   */
  private async selectBoqItems(
    boqStructureId: string,
    requestedRefs: string[] | undefined,
  ): Promise<BoqItem[]> {
    if (!requestedRefs || requestedRefs.length === 0) {
      return this.prisma.boqItem.findMany({
        where: { boqStructureId, itemType: 'WORK_ITEM' },
        orderBy: { sortOrder: 'asc' },
        take: MAX_BOQ_ITEMS,
      });
    }

    if (requestedRefs.length > MAX_BOQ_ITEMS) {
      throw new BadRequestException(`At most ${MAX_BOQ_ITEMS} boqItemRefs may be requested at once`);
    }

    const rows = await this.prisma.boqItem.findMany({
      where: { boqStructureId, itemType: 'WORK_ITEM', id: { in: requestedRefs } },
    });
    const rowsById = new Map(rows.map((row) => [row.id, row]));

    // Reject any ref outside this project's own scoped BOQ item set --
    // this is what stops a client from using another project/tenant's ref.
    const missing = requestedRefs.filter((ref) => !rowsById.has(ref));
    if (missing.length > 0) {
      throw new BadRequestException(
        'One or more boqItemRefs do not belong to this project draft/baseline BOQ',
      );
    }

    // `id: { in: [...] }` does not guarantee row order matches the input
    // array -- re-map over requestedRefs so selection order is deterministic.
    return requestedRefs.map((ref) => rowsById.get(ref)!);
  }
}
