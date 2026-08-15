import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma, ProgressAuditOutcome } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  PERMISSIONS_ALL_KEY,
  PERMISSIONS_KEY,
} from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkspacePermissionResolverService } from '../workspace-permission-resolver.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionResolver: WorkspacePermissionResolverService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  private progressWriteAction(request: any): string | null {
    if (request.method !== 'POST') return null;
    const path = `${request.route?.path ?? request.originalUrl ?? request.url}`;
    if (!path.includes('/progress')) return null;
    if (path.includes('/field')) return 'ACTUAL_SUBMIT';
    if (path.includes('/corrections')) return 'ACTUAL_CORRECT';
    if (path.includes('/verify')) return 'ACTUAL_VERIFY';
    if (path.includes('/accept')) return 'ACTUAL_ACCEPT';
    return null;
  }

  private progressTarget(request: any): {
    targetEntityType: string;
    targetEntityId: string | null;
  } {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const entryId = request.params?.entryId;
    if (typeof entryId === 'string' && uuid.test(entryId)) {
      return { targetEntityType: 'PROGRESS_ENTRY', targetEntityId: entryId };
    }
    const projectId = request.projectAccess?.projectId ?? request.params?.projectId;
    return {
      targetEntityType: 'PROJECT',
      targetEntityId:
        typeof projectId === 'string' && uuid.test(projectId)
          ? projectId
          : null,
    };
  }

  private async auditDeniedProgressWrite(params: {
    request: any;
    accountId: string;
    action: string;
    reasonCode: string;
    reasonText: string;
  }): Promise<void> {
    const access = params.request.projectAccess;
    if (!access?.projectId || !access.workspaceId || !access.membershipId) {
      return;
    }
    const commandId =
      typeof params.request.body?.commandId === 'string'
        ? params.request.body.commandId
        : undefined;
    const target = this.progressTarget(params.request);
    if (!this.prisma) {
      throw new ServiceUnavailableException('DENIAL_AUDIT_UNAVAILABLE');
    }
    try {
      await this.prisma.progressAuditEvent.create({
        data: {
          schemaVersion: 1,
          eventType: 'ACTUAL_PROGRESS',
          outcome: ProgressAuditOutcome.DENIED,
          workspaceId: access.workspaceId,
          projectId: access.projectId,
          progressEntryId: null,
          actorAccountId: params.accountId,
          actorMembershipId: access.membershipId,
          actorType: 'HUMAN',
          roleInProjectSnapshot: access.roleInProject ?? null,
          sourceModule: 'FIELD_PROGRESS',
          targetEntityType: target.targetEntityType,
          targetEntityId: target.targetEntityId,
          correlationId: randomUUID(),
          requestId: randomUUID(),
          businessCommandId: commandId,
          commandId,
          action: params.action,
          reason: params.reasonCode,
          reasonCode: params.reasonCode,
          reasonText: params.reasonText,
          metadata: {
            guard: 'PermissionsGuard',
            requiredPermissions:
              (params.request.__requiredPermissionsForAudit as string[]) ?? [],
          },
          occurredAt: new Date(),
          recordedAt: new Date(),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw new ServiceUnavailableException('DENIAL_AUDIT_UNAVAILABLE');
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1. Ekstrak Metadata Izin
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const requiredAllPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_ALL_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (
      (!requiredPermissions || requiredPermissions.length === 0) &&
      (!requiredAllPermissions || requiredAllPermissions.length === 0)
    ) {
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
    const hasRequiredPermission = (requiredPermissions ?? []).some((permission) =>
      effective.permissions.includes(permission),
    );

    const hasEveryRequiredPermission = (requiredAllPermissions ?? []).every(
      (permission) => effective.permissions.includes(permission),
    );

    if (
      (requiredPermissions?.length > 0 && !hasRequiredPermission) ||
      !hasEveryRequiredPermission
    ) {
      const action = this.progressWriteAction(request);
      if (action) {
        request.__requiredPermissionsForAudit = [
          ...(requiredPermissions ?? []),
          ...(requiredAllPermissions ?? []),
        ];
        await this.auditDeniedProgressWrite({
          request,
          accountId,
          action,
          reasonCode: 'TECHNICAL_PERMISSION_DENIED',
          reasonText:
            'The actor does not hold the required technical progress permission in this project workspace.',
        });
      }
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
