import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Ekstrak Metadata Izin
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    // 2. Ambil Request HTTP dan AccountId dari JWT (Via JwtStrategy)
    const request = context.switchToHttp().getRequest();
    // accountId didapat dari request.user (setelah diisi oleh JwtStrategy)
    const accountId = request.user?.id;

    if (!accountId) {
      throw new ForbiddenException('Account authentication context not found');
    }

    // 3. Tentukan Workspace Context
    // Jika ProjectAccessGuard sudah berjalan lebih dulu (rute project-scoped),
    // request.projectAccess.workspaceId adalah workspace yang sudah diverifikasi
    // ke database dan menjadi otoritatif untuk evaluasi izin — bukan header klien.
    const explicitWorkspaceId: string | undefined =
      request.headers['x-workspace-id'] ||
      request.query['workspaceId'] ||
      request.params['workspaceId'];
    const projectWorkspaceId: string | undefined = request.projectAccess?.workspaceId;

    let workspaceId: string;

    if (projectWorkspaceId) {
      if (explicitWorkspaceId && explicitWorkspaceId !== projectWorkspaceId) {
        throw new ForbiddenException(
          'Supplied workspace context does not match the authorized project workspace',
        );
      }
      workspaceId = projectWorkspaceId;
    } else {
      // Rute non-project: perilaku lama tetap utuh — workspace eksplisit wajib.
      if (!explicitWorkspaceId) {
        throw new BadRequestException('Missing active Workspace Context (x-workspace-id header is required)');
      }
      workspaceId = explicitWorkspaceId;
    }

    // 4. Resolusi Izin berdasarkan Account + Workspace (Identity Chain Verification)
    // Sesuai REG-001: WorkspaceMembership adalah gerbang akses resmi
    const membership = await this.prisma.workspaceMembership.findFirst({
      where: {
        accountId: accountId, // Menggunakan accountId (Platform Identity)
        workspaceId: workspaceId,
        status: 'ACTIVE',
      },
      select: {
        id: true, // Membership ID untuk audit trail
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
                rolePermissions: {
                  select: {
                    permission: {
                      select: {
                        code: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!membership) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    // 5. Ekstrak Semua Kode Izin yang Valid
    const workspaceScopedPermissions = membership.membershipRoles.flatMap(
      (membershipRole) =>
        membershipRole.role.rolePermissions.map(
          (rolePermission) => rolePermission.permission.code,
        ),
    );

    // 6. Evaluasi Hak Akses
    const hasRequiredPermission = requiredPermissions.some((permission) =>
      workspaceScopedPermissions.includes(permission),
    );

    if (!hasRequiredPermission) {
      throw new ForbiddenException('Access Denied: Insufficient Permission for this Workspace');
    }

    // 7. Simpan konteks untuk digunakan service atau guard berikutnya
    request.workspaceContext = {
      workspaceId: workspaceId,
      membershipId: membership.id,
    };

    return true;
  }
}