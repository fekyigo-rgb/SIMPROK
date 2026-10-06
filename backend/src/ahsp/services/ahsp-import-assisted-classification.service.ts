import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AhspClassificationAssignmentProvenance,
  ConstructionClassificationLevel,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConstructionClassificationService,
  type ClassificationNodeView,
} from '../../construction-classification/construction-classification.service';
import { AhspClassificationAssignmentService } from './ahsp-classification-assignment.service';
import {
  APPROVED_JENIS_PEKERJAAN,
  APPROVED_KATEGORI,
  approvedSubkategoriFor,
} from '../../construction-classification/construction-taxonomy.vocabulary';
import {
  type AssistedClassificationContext,
  parseAssistedClassificationContext,
} from '../document/ahsp-assisted-classification';

/**
 * Import seam connector only — exposes ConstructionClassificationService to the
 * existing Import journey and applies AhspClassificationAssignmentService after
 * AHSP materialization. No second taxonomy / assignment engine.
 */
@Injectable()
export class AhspImportAssistedClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classification: ConstructionClassificationService,
    private readonly assignments: AhspClassificationAssignmentService,
  ) {}

  async listRoots(workspaceId: string): Promise<ClassificationNodeView[]> {
    await this.classification.ensureGlobalJenisPengadaanRoots();
    return this.classification.listVisibleRoots({ workspaceId });
  }

  async listChildren(input: {
    workspaceId: string;
    parentId: string;
  }): Promise<ClassificationNodeView[]> {
    return this.classification.listChildren({
      parentId: input.parentId,
      workspaceId: input.workspaceId,
    });
  }

  async search(input: {
    workspaceId: string;
    q: string;
    level?: ConstructionClassificationLevel;
    preferredParentId?: string;
  }): Promise<ClassificationNodeView[]> {
    return this.classification.search({
      workspaceId: input.workspaceId,
      query: input.q,
      level: input.level,
      preferredParentId: input.preferredParentId,
    });
  }

  async createLocalNode(input: {
    workspaceId: string;
    level: ConstructionClassificationLevel;
    name: string;
    parentId: string;
    code?: string | null;
  }): Promise<ClassificationNodeView> {
    if (input.level === ConstructionClassificationLevel.JENIS_PENGADAAN) {
      throw new BadRequestException('CLASSIFICATION_WORKSPACE_ROOT_FORBIDDEN');
    }
    return this.classification.createNode({
      level: input.level,
      name: input.name,
      parentId: input.parentId,
      workspaceId: input.workspaceId,
      code: input.code ?? null,
      allowIdempotentReuse: true,
    });
  }

  /**
   * Explicit save/confirm only. Reuses a visible node of the same level, parent,
   * and name. A missing node is created for this workspace. Never a global node.
   * Dropdown reads do not call this.
   */
  async materializeWorkspacePath(input: {
    workspaceId: string;
    rootId: string;
    kategori: string;
    subkategori: string;
    jenisPekerjaan: string;
  }): Promise<ClassificationNodeView> {
    const kategori = input.kategori.trim();
    const subkategori = input.subkategori.trim();
    const jenisPekerjaan = input.jenisPekerjaan.trim();
    if (!APPROVED_KATEGORI.includes(kategori)) {
      throw new BadRequestException('CLASSIFICATION_PATH_KATEGORI_NOT_IN_VOCABULARY');
    }
    if (!approvedSubkategoriFor(kategori).includes(subkategori)) {
      throw new BadRequestException('CLASSIFICATION_PATH_SUBKATEGORI_NOT_IN_VOCABULARY');
    }
    if (!APPROVED_JENIS_PEKERJAAN.includes(jenisPekerjaan)) {
      throw new BadRequestException('CLASSIFICATION_PATH_JENIS_NOT_IN_VOCABULARY');
    }
    const root = await this.classification.getById({
      id: input.rootId,
      workspaceId: input.workspaceId,
    });
    if (root.level !== ConstructionClassificationLevel.JENIS_PENGADAAN) {
      throw new BadRequestException('CLASSIFICATION_PATH_ROOT_MUST_BE_JENIS_PENGADAAN');
    }
    const kategoriNode = await this.reuseOrCreateLocal({
      workspaceId: input.workspaceId,
      parentId: root.id,
      level: ConstructionClassificationLevel.KATEGORI,
      name: kategori,
    });
    const subNode = await this.reuseOrCreateLocal({
      workspaceId: input.workspaceId,
      parentId: kategoriNode.id,
      level: ConstructionClassificationLevel.SUBKATEGORI,
      name: subkategori,
    });
    return this.reuseOrCreateLocal({
      workspaceId: input.workspaceId,
      parentId: subNode.id,
      level: ConstructionClassificationLevel.JENIS_PEKERJAAN,
      name: jenisPekerjaan,
    });
  }

  private async reuseOrCreateLocal(input: {
    workspaceId: string;
    parentId: string;
    level: ConstructionClassificationLevel;
    name: string;
  }): Promise<ClassificationNodeView> {
    const children = await this.classification.listChildren({
      parentId: input.parentId,
      workspaceId: input.workspaceId,
    });
    const found = children.find(
      (node) => node.level === input.level && node.name === input.name,
    );
    if (found) return found;
    return this.classification.createNode({
      level: input.level,
      name: input.name,
      parentId: input.parentId,
      workspaceId: input.workspaceId,
      allowIdempotentReuse: true,
    });
  }

  async saveJobContext(input: {
    workspaceId: string;
    importJobId: string;
    context: AssistedClassificationContext;
  }): Promise<AssistedClassificationContext> {
    const job = await this.prisma.aHSPImportJob.findFirst({
      where: { id: input.importJobId, workspaceId: input.workspaceId },
      select: { id: true, sourceSha256: true, sourceFileName: true },
    });
    if (!job) throw new NotFoundException('AHSP_IMPORT_JOB_NOT_FOUND');

    await this.assertContextLawful(input.workspaceId, input.context);

    await this.prisma.aHSPImportJob.update({
      where: { id: job.id },
      data: {
        assistedClassificationContext:
          input.context as unknown as Prisma.InputJsonValue,
      },
    });
    // Source identity columns untouched — classification is interpretation only.
    return input.context;
  }

  async loadJobContext(input: {
    workspaceId: string;
    importJobId: string;
  }): Promise<AssistedClassificationContext | null> {
    const job = await this.prisma.aHSPImportJob.findFirst({
      where: { id: input.importJobId, workspaceId: input.workspaceId },
      select: { assistedClassificationContext: true },
    });
    if (!job) throw new NotFoundException('AHSP_IMPORT_JOB_NOT_FOUND');
    return parseAssistedClassificationContext(
      job.assistedClassificationContext,
    );
  }

  /**
   * Persist lawful paths on a materialized AHSP. Idempotent via AssignmentService.
   * Does not invent paths; skips incomplete declarations.
   */
  async applyToAhsp(input: {
    ahspId: string;
    actingWorkspaceId: string;
    actorAccountId: string;
    context: AssistedClassificationContext | null | undefined;
    client?: Prisma.TransactionClient;
  }): Promise<{ applied: number }> {
    const pending = input.context?.pendingPaths ?? [];
    if (!input.context || (input.context.paths.length === 0 && pending.length === 0)) {
      return { applied: 0 };
    }
    await this.assertContextLawful(input.actingWorkspaceId, input.context);

    let applied = 0;
    for (const path of input.context.paths) {
      const provenance =
        path.provenanceHint === 'FROM_SOURCE'
          ? AhspClassificationAssignmentProvenance.SOURCE_DERIVED
          : AhspClassificationAssignmentProvenance.HUMAN_ADDED;
      const assignment = {
        ahspId: input.ahspId,
        leafNodeId: path.leafNodeId,
        provenance,
        actingWorkspaceId: input.actingWorkspaceId,
        actorAccountId: input.actorAccountId,
      };
      await (input.client
        ? this.assignments.addAssignment(assignment, input.client)
        : this.assignments.addAssignment(assignment));
      applied += 1;
    }
    if (pending.length > 0) {
      const rootId = input.context.jenisPengadaanRootId;
      if (!rootId) {
        throw new BadRequestException('CLASSIFICATION_PATH_ROOT_REQUIRED');
      }
      for (const row of pending) {
        const leaf = await this.materializeWorkspacePath({
          workspaceId: input.actingWorkspaceId,
          rootId,
          kategori: row.kategori,
          subkategori: row.subkategori,
          jenisPekerjaan: row.jenisPekerjaan,
        });
        await (input.client
          ? this.assignments.addAssignment(
              {
                ahspId: input.ahspId,
                leafNodeId: leaf.id,
                provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
                actingWorkspaceId: input.actingWorkspaceId,
                actorAccountId: input.actorAccountId,
              },
              input.client,
            )
          : this.assignments.addAssignment({
              ahspId: input.ahspId,
              leafNodeId: leaf.id,
              provenance: AhspClassificationAssignmentProvenance.HUMAN_ADDED,
              actingWorkspaceId: input.actingWorkspaceId,
              actorAccountId: input.actorAccountId,
            }));
        applied += 1;
      }
    }
    return { applied };
  }

  private async assertContextLawful(
    workspaceId: string,
    context: AssistedClassificationContext,
  ): Promise<void> {
    if (context.jenisPengadaanRootId) {
      const root = await this.classification.getLineage({
        id: context.jenisPengadaanRootId,
        workspaceId,
      });
      if (root.node.level !== ConstructionClassificationLevel.JENIS_PENGADAAN) {
        throw new BadRequestException(
          'ASSISTED_CLASSIFICATION_ROOT_MUST_BE_JENIS_PENGADAAN',
        );
      }
    }

    const rootIds = new Set<string>();
    for (const path of context.paths) {
      const lineage = await this.classification.getLineage({
        id: path.leafNodeId,
        workspaceId,
      });
      if (lineage.node.level !== ConstructionClassificationLevel.JENIS_PEKERJAAN) {
        throw new BadRequestException(
          'ASSISTED_CLASSIFICATION_LEAF_MUST_BE_JENIS_PEKERJAAN',
        );
      }
      const jenis = lineage.path.find(
        (n) => n.level === ConstructionClassificationLevel.JENIS_PENGADAAN,
      );
      if (!jenis) {
        throw new BadRequestException(
          'ASSISTED_CLASSIFICATION_PATH_MISSING_JENIS_PENGADAAN',
        );
      }
      rootIds.add(jenis.id);
      if (
        context.jenisPengadaanRootId &&
        jenis.id !== context.jenisPengadaanRootId
      ) {
        throw new BadRequestException(
          'ASSISTED_CLASSIFICATION_SINGLE_JENIS_PENGADAAN_VIOLATION',
        );
      }
    }
    if (rootIds.size > 1) {
      throw new BadRequestException(
        'ASSISTED_CLASSIFICATION_SINGLE_JENIS_PENGADAAN_VIOLATION',
      );
    }
  }
}
