import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WorkspaceMembershipService {
  constructor(private readonly prisma: PrismaService) {}

  findAllForAccount(accountId: string) {
    return this.prisma.workspaceMembership.findMany({
      where: {
        accountId,
        status: 'ACTIVE',
      },
      include: {
        userProfile: true,
        workspace: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneForAccount(id: string, accountId: string) {
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: {
        id,
        accountId,
        status: 'ACTIVE',
      },
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

  findByWorkspaceForAccount(workspaceId: string, accountId: string) {
    return this.prisma.workspaceMembership.findMany({
      where: {
        workspaceId,
        accountId,
        status: 'ACTIVE',
      },
      include: {
        userProfile: true,
        workspace: true,
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

  async findByUserForAccount(userId: string, accountId: string) {
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

    if (!user || !user.membership || user.membership.accountId !== accountId || user.membership.status !== 'ACTIVE') {
      throw new NotFoundException('Workspace membership not found for this user');
    }

    return user.membership;
  }

  healthCheck() {
    return { module: 'workspace-membership', status: 'ok' };
  }
}
