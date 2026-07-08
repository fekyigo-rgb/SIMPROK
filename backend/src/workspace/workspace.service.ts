import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForAccount(accountId: string) {
    return this.prisma.workspace.findMany({
      where: {
        memberships: {
          some: {
            accountId,
            status: 'ACTIVE',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOneForAccount(id: string, accountId: string) {
    const workspace = await this.prisma.workspace.findFirst({
      where: {
        id,
        memberships: {
          some: {
            accountId,
            status: 'ACTIVE',
          },
        },
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return workspace;
  }

  async findByOrganizationForAccount(organizationId: string, accountId: string) {
    return this.prisma.workspace.findMany({
      where: {
        organizationId,
        memberships: {
          some: {
            accountId,
            status: 'ACTIVE',
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  healthCheck() {
    return {
      module: 'workspace',
      status: 'ok',
    };
  }
}
