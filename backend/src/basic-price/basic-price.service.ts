import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * BasicPriceService — Golden Path v0 Slice A
 *
 * Hanya read operations untuk Golden Path v0.
 * Write operations (submit harga) ada di reality-intake domain.
 * Semua query scoped by workspaceId.
 */
@Injectable()
export class BasicPriceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ambil semua harga dasar yang berlaku untuk workspace ini.
   * Termasuk harga workspace-specific dan harga global (workspaceId = null, status PUBLISHED).
   */
  async findAllForWorkspace(workspaceId: string) {
    return this.prisma.basicPrice.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [
          { workspaceId },
          { workspaceId: null },
        ],
      },
      include: {
        resource: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            baseUnit: true,
          },
        },
      },
      orderBy: [
        { effectiveDate: 'desc' },
        { createdAt: 'desc' },
      ],
    });
  }

  /**
   * Ambil satu BasicPrice by ID, pastikan scoped ke workspace.
   */
  async findOneForWorkspace(id: string, workspaceId: string) {
    const price = await this.prisma.basicPrice.findFirst({
      where: {
        id,
        status: 'PUBLISHED',
        OR: [
          { workspaceId },
          { workspaceId: null },
        ],
      },
      include: {
        resource: true,
      },
    });

    if (!price) {
      throw new NotFoundException('BasicPrice not found');
    }

    return price;
  }

  /**
   * Cari BasicPrice berdasarkan resourceId untuk workspace.
   * Prioritas: workspace-specific > global.
   */
  async findByResource(resourceId: string, workspaceId: string) {
    return this.prisma.basicPrice.findMany({
      where: {
        resourceId,
        status: 'PUBLISHED',
        OR: [
          { workspaceId },
          { workspaceId: null },
        ],
      },
      include: {
        resource: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
            baseUnit: true,
          },
        },
      },
      orderBy: [
        { workspaceId: 'desc' }, // workspace-specific first
        { effectiveDate: 'desc' },
      ],
    });
  }

  healthCheck() {
    return { module: 'basic-price', status: 'ok' };
  }
}
