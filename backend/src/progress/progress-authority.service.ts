import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { ProjectAccessContext } from '../auth/project-access-policy.service';

export const PROGRESS_AUTHORITIES = {
  VERIFY: 'FIELD_PROGRESS_VERIFY',
  CORRECT: 'FIELD_PROGRESS_CORRECT',
  ACCEPT: 'FIELD_PROGRESS_ACCEPT',
} as const;

export interface ProgressAuthorityContext {
  positionId: string;
  positionCode: string;
  authorityCode: string;
}

@Injectable()
export class ProgressAuthorityService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    accountId: string,
    projectAccess: ProjectAccessContext,
    authorityCode: string,
  ): Promise<ProgressAuthorityContext | null> {
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: {
        id: projectAccess.membershipId,
        accountId,
        workspaceId: projectAccess.workspaceId,
        status: 'ACTIVE',
      },
      select: {
        userProfile: {
          select: {
            status: true,
            positionAssignments: {
              where: {
                isActive: true,
                removedAt: null,
                position: {
                  workspaceId: projectAccess.workspaceId,
                  positionAuthorities: {
                    some: { authority: { code: authorityCode } },
                  },
                },
              },
              select: {
                position: { select: { id: true, code: true } },
              },
              orderBy: { assignedAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    });

    const assignment = membership?.userProfile?.positionAssignments[0];
    if (membership?.userProfile?.status !== 'ACTIVE' || !assignment) {
      return null;
    }

    return {
      positionId: assignment.position.id,
      positionCode: assignment.position.code,
      authorityCode,
    };
  }

  async require(
    accountId: string,
    projectAccess: ProjectAccessContext,
    authorityCode: string,
  ): Promise<ProgressAuthorityContext> {
    const authority = await this.resolve(accountId, projectAccess, authorityCode);
    if (!authority) {
      throw new ForbiddenException('Configured project authority required');
    }
    return authority;
  }
}
