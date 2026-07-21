import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import { WorkspacePermissionResolverService } from '../workspace-permission-resolver.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionResolver: WorkspacePermissionResolverService,
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
    const projectWorkspaceId: string | undefined =
      request.projectAccess?.workspaceId;

    let workspaceId: string;

    if (projectWorkspaceId) {
      // Setiap explicit workspace context yang diberikan — header, query, ATAU route param —
      // harus persis sama dengan project workspace. Diperiksa satu per satu (bukan lewat
      // precedence `||`) supaya satu context yang cocok tidak menutupi context lain yang
      // berbeda. Strict equality saja: tidak ada lowercase/trim/normalisasi. Nilai yang
      // bukan string tunggal (array/object) fail closed sebagai mismatch.
      const suppliedWorkspaceContexts: unknown[] = [
        request.headers['x-workspace-id'],
        request.query['workspaceId'],
        request.params['workspaceId'],
      ];

      for (const supplied of suppliedWorkspaceContexts) {
        if (supplied === undefined) {
          continue;
        }
        if (typeof supplied !== 'string' || supplied !== projectWorkspaceId) {
          throw new ForbiddenException(
            'Supplied workspace context does not match the authorized project workspace',
          );
        }
      }

      workspaceId = projectWorkspaceId;
    } else {
      // Rute non-project: perilaku lama tetap utuh — precedence dan wajib-ada tidak berubah.
      const explicitWorkspaceId: string | undefined =
        request.headers['x-workspace-id'] ||
        request.query['workspaceId'] ||
        request.params['workspaceId'];

      if (!explicitWorkspaceId) {
        throw new BadRequestException(
          'Missing active Workspace Context (x-workspace-id header is required)',
        );
      }
      workspaceId = explicitWorkspaceId;
    }

    // 4. Resolusi Izin berdasarkan Account + Workspace — satu-satunya sumber,
    // dipakai bersama oleh GET /auth/capabilities. Lihat
    // WorkspacePermissionResolverService untuk semantik lengkap.
    const effective = await this.permissionResolver.resolve(
      accountId,
      workspaceId,
    );

    if (!effective) {
      throw new ForbiddenException('You do not have access to this workspace');
    }

    // 5. Evaluasi Hak Akses
    const hasRequiredPermission = requiredPermissions.some((permission) =>
      effective.permissions.includes(permission),
    );

    if (!hasRequiredPermission) {
      throw new ForbiddenException(
        'Access Denied: Insufficient Permission for this Workspace',
      );
    }

    // 6. Simpan konteks untuk digunakan service atau guard berikutnya
    request.workspaceContext = {
      workspaceId: workspaceId,
      membershipId: effective.membershipId,
    };

    return true;
  }
}
