import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Ekstrak Metadata Peran dari Handler/Controller
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // 2. Ambil Request dan AccountId dari Context (ditetapkan oleh JwtStrategy)
    const request = context.switchToHttp().getRequest();
    // PENTING: Menggunakan accountId (platform identity), bukan userId (operational identity)
    const accountId = request.user?.id; 

    if (!accountId) {
      throw new ForbiddenException('Account authentication context not found');
    }

    // 3. Ekstrak Workspace Context
    const workspaceId =
      request.headers['x-workspace-id'] ||
      request.query['workspaceId'] ||
      request.params['workspaceId'];

    if (!workspaceId) {
      throw new BadRequestException('Missing active Workspace Context (x-workspace-id header is required)');
    }

    // 4. Resolusi Peran berdasarkan Account + Workspace (Identity Chain Verification)
    // Sesuai RBAC Resolution Chain: WorkspaceMembership -> MembershipRole -> Role
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: {
        accountId: accountId, // Menggunakan accountId, bukan userId
        workspaceId: workspaceId,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        membershipRoles: {
          where: {
            isActive: true,
            OR: [
              { endDate: null },
              { endDate: { gte: new Date() } }
            ]
          },
          select: {
            role: {
              select: {
                code: true, // Ambil kode peran untuk validasi
              },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    // 5. Ekstrak Peran yang valid di Workspace Context ini
    const workspaceScopedRoles = membership.membershipRoles.map(
      (mr) => mr.role.code,
    );

    // 6. Validasi Hak Akses
    const hasRequiredRole = requiredRoles.some((role) =>
      workspaceScopedRoles.includes(role),
    );

    if (!hasRequiredRole) {
      throw new ForbiddenException('Access Denied: Insufficient Role for this Workspace');
    }

    // 7. Simpan Konteks untuk Audit Trail
    request.workspaceContext = {
      workspaceId: workspaceId,
      membershipId: membership.id,
    };

    return true;
  }
}