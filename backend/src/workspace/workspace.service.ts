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

  async findOne(id: string) {
    const workspace = await this.prisma.workspace.findUnique({
      where: {
        id,
      },
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    return workspace;
  }

  async findByOrganization(organizationId: string) {
    return this.prisma.workspace.findMany({
      where: {
        organizationId,
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