import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WorkspaceMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.workspaceMembership.findMany({
      include: {
        userProfile: true,
        workspace: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { id },
      include: {
        userProfile: true,
        workspace: true,
      },
    });

    if (!membership) {
      throw new NotFoundException('Workspace membership not found');
    }

    return membership;
  }

  findByWorkspace(workspaceId: string) {
    return this.prisma.workspaceMembership.findMany({
      where: { workspaceId },
      include: {
        userProfile: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByAccount(accountId: string) {
    return this.prisma.workspaceMembership.findMany({
      where: { accountId },
      include: {
        workspace: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByUser(userId: string) {
    // Berdasarkan Identity Chain resmi di PDF: Account -> WorkspaceMembership -> User
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        membership: {
          include: {
            workspace: true,
            userProfile: true,
          },
        },
      },
    });

    if (!user || !user.membership) {
      throw new NotFoundException('Workspace membership not found for this user');
    }

    return user.membership;
  }

  healthCheck() {
    return { module: 'workspace-membership', status: 'ok' };
  }
}
