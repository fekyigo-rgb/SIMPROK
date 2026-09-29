import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AhspClassificationAssignmentProvenance,
  ConstructionClassificationLevel,
  type AhspClassificationAssignment,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConstructionClassificationService,
  type ClassificationLineage,
  type ClassificationNodeView,
} from '../../construction-classification/construction-classification.service';
import { AhspAuditService } from './ahsp-audit.service';

export type AhspClassificationAssignmentView = {
  id: string;
  ahspId: string;
  leafNodeId: string;
  provenance: AhspClassificationAssignmentProvenance;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  /** Derived via ConstructionClassificationService — never persisted as names. */
  path: ClassificationNodeView[];
  jenisPengadaanRootId: string;
};

/**
 * AHSP ↔ canonical classification path association only.
 * Does NOT mint classification nodes. Does NOT replace AHSP scalars.
 * Does NOT own taxonomy search — calls ConstructionClassificationService.
 */
@Injectable()
export class AhspClassificationAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: ConstructionClassificationService,
    private readonly audit: AhspAuditService,
  ) {}

  /**
   * Add one lawful path assignment to an AHSP.
   *
   * @param actingWorkspaceId Visibility / tenancy scope for classification
   *   reads. Must equal AHSP.workspaceId when AHSP is workspace-owned.
   *   Official AHSP (workspaceId null) may only receive GLOBAL leaf nodes.
   */
  async addAssignment(
    input: {
      ahspId: string;
      leafNodeId: string;
      provenance: AhspClassificationAssignmentProvenance;
      actingWorkspaceId: string;
      actorAccountId: string;
    },
    /**
     * Optional transaction client. Omitted, behaviour is unchanged.
     * Manual save passes the same client that just created the parent so the
     * assignment sees that row and rolls back with it.
     */
    client?: Prisma.TransactionClient,
  ): Promise<AhspClassificationAssignmentView> {
    const db = client ?? this.prisma;
    const ahsp = await db.aHSP.findFirst({
      where: { id: input.ahspId, deletedAt: null },
      select: {
        id: true,
        workspaceId: true,
        fieldCategory: true,
        subCategory: true,
        classification: true,
      },
    });
    if (!ahsp) {
      throw new NotFoundException('AHSP_NOT_FOUND');
    }

    if (
      ahsp.workspaceId !== null &&
      ahsp.workspaceId !== input.actingWorkspaceId
    ) {
      throw new BadRequestException(
        'AHSP_CLASSIFICATION_ASSIGNMENT_WORKSPACE_MISMATCH',
      );
    }

    // Visibility + lineage through the ONE classification authority.
    const lineage = await this.classification.getLineage({
      id: input.leafNodeId,
      workspaceId: input.actingWorkspaceId,
    });

    if (lineage.node.level !== ConstructionClassificationLevel.JENIS_PEKERJAAN) {
      throw new BadRequestException(
        'AHSP_CLASSIFICATION_ASSIGNMENT_LEAF_MUST_BE_JENIS_PEKERJAAN',
      );
    }

    // Cross-workspace: leaf may be GLOBAL or same acting workspace only.
    // (getLineage already filters visibility; this rejects foreign-owned leaves.)
    if (
      lineage.node.workspaceId !== null &&
      lineage.node.workspaceId !== input.actingWorkspaceId
    ) {
      throw new BadRequestException(
        'AHSP_CLASSIFICATION_ASSIGNMENT_CROSS_WORKSPACE_FORBIDDEN',
      );
    }

    // Official AHSP: only GLOBAL nodes.
    if (ahsp.workspaceId === null && lineage.node.workspaceId !== null) {
      throw new BadRequestException(
        'AHSP_CLASSIFICATION_ASSIGNMENT_OFFICIAL_REQUIRES_GLOBAL_NODE',
      );
    }

    const root = lineage.path.find(
      (n) => n.level === ConstructionClassificationLevel.JENIS_PENGADAAN,
    );
    if (!root) {
      throw new BadRequestException(
        'AHSP_CLASSIFICATION_ASSIGNMENT_LINEAGE_MISSING_ROOT',
      );
    }

    await this.assertSingleJenisPengadaanRoot(
      {
        ahspId: ahsp.id,
        actingWorkspaceId: input.actingWorkspaceId,
        nextRootId: root.id,
      },
      db,
    );

    const existing = await db.ahspClassificationAssignment.findUnique({
      where: {
        ahspId_leafNodeId_provenance: {
          ahspId: ahsp.id,
          leafNodeId: input.leafNodeId,
          provenance: input.provenance,
        },
      },
    });
    const persist = async (tx: Prisma.TransactionClient) => {
      if (existing) {
        if (
          !existing.isActive &&
          existing.provenance ===
            AhspClassificationAssignmentProvenance.HUMAN_ADDED
        ) {
          const revived = await tx.ahspClassificationAssignment.update({
            where: { id: existing.id },
            data: { isActive: true },
          });
          await this.audit.logAction(
            {
              ahspId: ahsp.id,
              action: 'AhspClassificationAssignmentReactivated',
              who: input.actorAccountId,
              before: this.auditFact(existing),
              after: this.auditFact(revived),
            },
            tx,
          );
          return revived;
        }
        return existing;
      }

      const created = await tx.ahspClassificationAssignment.create({
        data: {
          ahspId: ahsp.id,
          leafNodeId: input.leafNodeId,
          provenance: input.provenance,
        },
      });
      await this.audit.logAction(
        {
          ahspId: ahsp.id,
          action: 'AhspClassificationAssignmentCreated',
          who: input.actorAccountId,
          after: this.auditFact(created),
        },
        tx,
      );
      return created;
    };

    const row = client ? await persist(client) : await this.prisma.$transaction(persist);
    return this.toView(row, lineage, root.id);
  }

  async listAssignments(input: {
    ahspId: string;
    actingWorkspaceId: string;
  }): Promise<AhspClassificationAssignmentView[]> {
    const ahsp = await this.prisma.aHSP.findFirst({
      where: { id: input.ahspId, deletedAt: null },
      select: { id: true, workspaceId: true },
    });
    if (!ahsp) {
      throw new NotFoundException('AHSP_NOT_FOUND');
    }
    if (
      ahsp.workspaceId !== null &&
      ahsp.workspaceId !== input.actingWorkspaceId
    ) {
      throw new BadRequestException(
        'AHSP_CLASSIFICATION_ASSIGNMENT_WORKSPACE_MISMATCH',
      );
    }

    const rows = await this.prisma.ahspClassificationAssignment.findMany({
      where: { ahspId: ahsp.id, isActive: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const out: AhspClassificationAssignmentView[] = [];
    for (const row of rows) {
      const lineage = await this.classification.getLineage({
        id: row.leafNodeId,
        workspaceId: input.actingWorkspaceId,
      });
      const root = lineage.path.find(
        (n) => n.level === ConstructionClassificationLevel.JENIS_PENGADAAN,
      );
      if (!root) {
        throw new BadRequestException(
          'AHSP_CLASSIFICATION_ASSIGNMENT_LINEAGE_MISSING_ROOT',
        );
      }
      out.push(this.toView(row, lineage, root.id));
    }
    return out;
  }

  /**
   * Manual correction of a human-added path. History stays. SOURCE_DERIVED
   * evidence is not erased from this door.
   */
  async deactivateAssignment(input: {
    ahspId: string;
    assignmentId: string;
    actingWorkspaceId: string;
    actorAccountId: string;
  }): Promise<AhspClassificationAssignmentView> {
    const ahsp = await this.prisma.aHSP.findFirst({
      where: { id: input.ahspId, deletedAt: null },
      select: { id: true, workspaceId: true },
    });
    if (!ahsp) {
      throw new NotFoundException('AHSP_NOT_FOUND');
    }
    if (
      ahsp.workspaceId !== null &&
      ahsp.workspaceId !== input.actingWorkspaceId
    ) {
      throw new BadRequestException(
        'AHSP_CLASSIFICATION_ASSIGNMENT_WORKSPACE_MISMATCH',
      );
    }
    const row = await this.prisma.ahspClassificationAssignment.findFirst({
      where: { id: input.assignmentId, ahspId: ahsp.id },
    });
    if (!row) {
      throw new NotFoundException('AHSP_CLASSIFICATION_ASSIGNMENT_NOT_FOUND');
    }
    if (row.provenance !== AhspClassificationAssignmentProvenance.HUMAN_ADDED) {
      throw new BadRequestException(
        'AHSP_CLASSIFICATION_SOURCE_DERIVED_PRESERVED',
      );
    }
    const current = row.isActive
      ? await this.prisma.$transaction(async (tx) => {
          const updated = await tx.ahspClassificationAssignment.update({
            where: { id: row.id },
            data: { isActive: false },
          });
          await this.audit.logAction(
            {
              ahspId: ahsp.id,
              action: 'AhspClassificationAssignmentDeactivated',
              who: input.actorAccountId,
              before: this.auditFact(row),
              after: this.auditFact(updated),
            },
            tx,
          );
          return updated;
        })
      : row;
    const lineage = await this.classification.getLineage({
      id: current.leafNodeId,
      workspaceId: input.actingWorkspaceId,
    });
    const root = lineage.path.find(
      (n) => n.level === ConstructionClassificationLevel.JENIS_PENGADAAN,
    );
    if (!root) {
      throw new BadRequestException(
        'AHSP_CLASSIFICATION_ASSIGNMENT_LINEAGE_MISSING_ROOT',
      );
    }
    return this.toView(current, lineage, root.id);
  }

  private async assertSingleJenisPengadaanRoot(
    input: {
      ahspId: string;
      actingWorkspaceId: string;
      nextRootId: string;
    },
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const existing = await db.ahspClassificationAssignment.findMany({
      where: { ahspId: input.ahspId, isActive: true },
      select: { leafNodeId: true },
    });
    for (const row of existing) {
      const lineage = await this.classification.getLineage({
        id: row.leafNodeId,
        workspaceId: input.actingWorkspaceId,
      });
      const root = lineage.path.find(
        (n) => n.level === ConstructionClassificationLevel.JENIS_PENGADAAN,
      );
      if (root && root.id !== input.nextRootId) {
        throw new BadRequestException(
          'AHSP_CLASSIFICATION_ASSIGNMENT_JENIS_PENGADAAN_CONFLICT',
        );
      }
    }
  }

  private auditFact(row: AhspClassificationAssignment) {
    return {
      id: row.id,
      ahspId: row.ahspId,
      leafNodeId: row.leafNodeId,
      provenance: row.provenance,
      isActive: row.isActive,
    };
  }

  private toView(
    row: AhspClassificationAssignment,
    lineage: ClassificationLineage,
    jenisPengadaanRootId: string,
  ): AhspClassificationAssignmentView {
    return {
      id: row.id,
      ahspId: row.ahspId,
      leafNodeId: row.leafNodeId,
      provenance: row.provenance,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      path: lineage.path,
      jenisPengadaanRootId,
    };
  }
}
