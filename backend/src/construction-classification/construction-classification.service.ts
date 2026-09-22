import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ConstructionClassificationLevel,
  type ConstructionClassificationNode,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertLawfulParentRelation,
  normalizeClassificationName,
  requiredParentLevel,
  visibilityWhere,
} from './construction-classification.policy';
import { JENIS_PENGADAAN_OPTIONS } from './jenis-pengadaan.vocabulary';

export type ClassificationNodeView = {
  id: string;
  level: ConstructionClassificationLevel;
  name: string;
  normalizedName: string;
  code: string | null;
  parentId: string | null;
  workspaceId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ClassificationLineage = {
  node: ClassificationNodeView;
  ancestors: ClassificationNodeView[];
  path: ClassificationNodeView[];
};

@Injectable()
export class ConstructionClassificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Provisions GLOBAL JENIS_PENGADAAN roots from the ONE shared Buat RAB /
   * Ruang Interaksi vocabulary. Idempotent. Does NOT invent Kategori+.
   */
  async ensureGlobalJenisPengadaanRoots(): Promise<ClassificationNodeView[]> {
    const out: ClassificationNodeView[] = [];
    for (const name of JENIS_PENGADAAN_OPTIONS) {
      out.push(
        await this.createNode({
          level: ConstructionClassificationLevel.JENIS_PENGADAAN,
          name,
          workspaceId: null,
          parentId: null,
          allowIdempotentReuse: true,
        }),
      );
    }
    return out;
  }

  /**
   * Create a classification node. GLOBAL writes (workspaceId null) are for
   * foundation provisioning only in Slice 1 — no public promotion engine.
   * Workspace writes never become GLOBAL.
   */
  async createNode(input: {
    level: ConstructionClassificationLevel;
    name: string;
    code?: string | null;
    parentId?: string | null;
    workspaceId: string | null;
    allowIdempotentReuse?: boolean;
  }): Promise<ClassificationNodeView> {
    const name = input.name?.trim() ?? '';
    if (!name) {
      throw new BadRequestException('CLASSIFICATION_EMPTY_NAME');
    }
    const normalizedName = normalizeClassificationName(name);
    const parentId = input.parentId ?? null;
    const workspaceId = input.workspaceId;

    // Root authority: workspace must not mint an independent Jenis Pengadaan
    // universe. GLOBAL roots are provisioned only from the shared vocabulary.
    if (
      input.level === ConstructionClassificationLevel.JENIS_PENGADAAN &&
      workspaceId !== null
    ) {
      throw new BadRequestException(
        'CLASSIFICATION_WORKSPACE_ROOT_FORBIDDEN',
      );
    }

    // GLOBAL JENIS_PENGADAAN must match the ONE shared vocabulary (normalization-
    // safe). Fail closed before any Prisma write — no second vocabulary via
    // generic createNode.
    if (
      input.level === ConstructionClassificationLevel.JENIS_PENGADAAN &&
      workspaceId === null
    ) {
      const inVocabulary = JENIS_PENGADAAN_OPTIONS.some(
        (opt) => normalizeClassificationName(opt) === normalizedName,
      );
      if (!inVocabulary) {
        throw new BadRequestException(
          'CLASSIFICATION_GLOBAL_ROOT_NOT_IN_VOCABULARY',
        );
      }
    }

    const expectedParent = requiredParentLevel(input.level);
    if (expectedParent === null && parentId !== null) {
      throw new BadRequestException('CLASSIFICATION_ROOT_MUST_HAVE_NULL_PARENT');
    }
    if (expectedParent !== null && parentId === null) {
      throw new BadRequestException('CLASSIFICATION_NON_ROOT_REQUIRES_PARENT');
    }

    let parent: ConstructionClassificationNode | null = null;
    if (parentId) {
      parent = await this.prisma.constructionClassificationNode.findUnique({
        where: { id: parentId },
      });
      if (!parent) {
        throw new BadRequestException('CLASSIFICATION_PARENT_NOT_FOUND');
      }
    }

    const violation = assertLawfulParentRelation({
      level: input.level,
      parent,
      workspaceId,
    });
    if (violation) {
      throw new BadRequestException(`CLASSIFICATION_${violation}`);
    }

    // Same-scope identity twin.
    const existing = await this.findIdentityTwin({
      level: input.level,
      normalizedName,
      parentId,
      workspaceId,
    });
    if (existing) {
      if (input.allowIdempotentReuse) {
        return this.toView(existing);
      }
      throw new ConflictException('CLASSIFICATION_DUPLICATE_IN_SCOPE');
    }

    // Visible GLOBAL reuse: a workspace create that matches an already-visible
    // GLOBAL node under the same lawful parent/level must reuse it — do not
    // mint a useless local duplicate (Product Law soft-cascade / one truth).
    if (workspaceId !== null) {
      const globalTwin = await this.findIdentityTwin({
        level: input.level,
        normalizedName,
        parentId,
        workspaceId: null,
      });
      if (globalTwin) {
        return this.toView(globalTwin);
      }
    }

    try {
      const created = await this.prisma.constructionClassificationNode.create({
        data: {
          level: input.level,
          name,
          normalizedName,
          code: input.code?.trim() || null,
          parentId,
          workspaceId,
          isActive: true,
        },
      });
      return this.toView(created);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        if (input.allowIdempotentReuse) {
          const twin = await this.findIdentityTwin({
            level: input.level,
            normalizedName,
            parentId,
            workspaceId,
          });
          if (twin) return this.toView(twin);
        }
        throw new ConflictException('CLASSIFICATION_DUPLICATE_IN_SCOPE');
      }
      throw err;
    }
  }

  async getById(input: {
    id: string;
    workspaceId: string;
  }): Promise<ClassificationNodeView> {
    const node = await this.prisma.constructionClassificationNode.findFirst({
      where: {
        id: input.id,
        ...visibilityWhere(input.workspaceId),
      },
    });
    if (!node) {
      throw new NotFoundException('CLASSIFICATION_NODE_NOT_FOUND');
    }
    return this.toView(node);
  }

  async listChildren(input: {
    parentId: string;
    workspaceId: string;
  }): Promise<ClassificationNodeView[]> {
    // Parent must be visible in scope.
    await this.getById({ id: input.parentId, workspaceId: input.workspaceId });
    const rows = await this.prisma.constructionClassificationNode.findMany({
      where: {
        parentId: input.parentId,
        ...visibilityWhere(input.workspaceId),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  /**
   * Search by name/code. Soft cascade: optional preferredParentId narrows
   * results but does NOT hard-lock — callers may search globally within
   * lawful visibility without a parent context (T-S1-14).
   */
  async search(input: {
    workspaceId: string;
    query: string;
    level?: ConstructionClassificationLevel;
    preferredParentId?: string | null;
    limit?: number;
  }): Promise<ClassificationNodeView[]> {
    const q = input.query?.trim() ?? '';
    if (!q) {
      return [];
    }
    const normalized = normalizeClassificationName(q);
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

    const rows = await this.prisma.constructionClassificationNode.findMany({
      where: {
        AND: [
          visibilityWhere(input.workspaceId),
          ...(input.level ? [{ level: input.level }] : []),
          {
            OR: [
              { normalizedName: { contains: normalized } },
              { name: { contains: q, mode: 'insensitive' as const } },
              { code: { contains: q, mode: 'insensitive' as const } },
            ],
          },
        ],
      },
      orderBy: [{ level: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      take: limit * 2,
    });

    let views = rows.map((r) => this.toView(r));
    if (input.preferredParentId) {
      const preferred = views.filter(
        (v) => v.parentId === input.preferredParentId,
      );
      const rest = views.filter((v) => v.parentId !== input.preferredParentId);
      views = [...preferred, ...rest];
    }
    return views.slice(0, limit);
  }

  async getLineage(input: {
    id: string;
    workspaceId: string;
  }): Promise<ClassificationLineage> {
    const node = await this.getById(input);
    const ancestors: ClassificationNodeView[] = [];
    let cursorParentId = node.parentId;
    const guard = new Set<string>([node.id]);

    while (cursorParentId) {
      if (guard.has(cursorParentId)) {
        throw new BadRequestException('CLASSIFICATION_LINEAGE_CYCLE');
      }
      guard.add(cursorParentId);
      const parent = await this.prisma.constructionClassificationNode.findFirst({
        where: {
          id: cursorParentId,
          ...visibilityWhere(input.workspaceId),
        },
      });
      if (!parent) {
        throw new BadRequestException('CLASSIFICATION_LINEAGE_BROKEN');
      }
      ancestors.unshift(this.toView(parent));
      cursorParentId = parent.parentId;
    }

    return {
      node,
      ancestors,
      path: [...ancestors, node],
    };
  }

  async listVisibleRoots(input: {
    workspaceId: string;
  }): Promise<ClassificationNodeView[]> {
    const rows = await this.prisma.constructionClassificationNode.findMany({
      where: {
        level: ConstructionClassificationLevel.JENIS_PENGADAAN,
        ...visibilityWhere(input.workspaceId),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => this.toView(r));
  }

  private async findIdentityTwin(input: {
    level: ConstructionClassificationLevel;
    normalizedName: string;
    parentId: string | null;
    workspaceId: string | null;
  }): Promise<ConstructionClassificationNode | null> {
    return this.prisma.constructionClassificationNode.findFirst({
      where: {
        level: input.level,
        normalizedName: input.normalizedName,
        parentId: input.parentId,
        workspaceId: input.workspaceId,
        isActive: true,
      },
    });
  }

  private toView(node: ConstructionClassificationNode): ClassificationNodeView {
    return {
      id: node.id,
      level: node.level,
      name: node.name,
      normalizedName: node.normalizedName,
      code: node.code,
      parentId: node.parentId,
      workspaceId: node.workspaceId,
      isActive: node.isActive,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt,
    };
  }
}
