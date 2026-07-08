import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { AhspService } from './services/ahsp.service';
import type { CreateAhspDto, UpdateAhspDto } from './services/ahsp.service';
import { AhspVersionService } from './services/ahsp-version.service';
import type { CreateAhspVersionDto } from './services/ahsp-version.service';
import { AhspSnapshotService } from './services/ahsp-snapshot.service';
import { OwnershipType } from '@prisma/client';

/**
 * AHSP Controller — Golden Path v0 Slice A
 *
 * Semua endpoint dilindungi JWT + PermissionsGuard.
 * WorkspaceId dibaca dari x-workspace-id header (via PermissionsGuard context).
 * Tidak ada endpoint publik.
 */
@Controller('ahsp')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AhspController {
  constructor(
    private readonly ahspService: AhspService,
    private readonly ahspVersionService: AhspVersionService,
    private readonly ahspSnapshotService: AhspSnapshotService,
  ) {}

  // ─────────────────────────────────────────────
  // AHSP CRUD
  // ─────────────────────────────────────────────

  @Get('health')
  @Permissions('AHSP_VIEW')
  healthCheck() {
    return { module: 'ahsp', status: 'ok' };
  }

  @Post()
  @Permissions('AHSP_MANAGE')
  async create(@Req() request: any, @Body() body: CreateAhspDto) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const userId: string = request.projectAccess?.userId ?? body.userId;

    if (!userId) {
      throw new BadRequestException('userId diperlukan untuk membuat AHSP');
    }

    return this.ahspService.create({
      ...body,
      workspaceId: body.workspaceId ?? workspaceId,
      userId,
    });
  }

  @Get(':id')
  @Permissions('AHSP_VIEW')
  async getById(@Req() request: any, @Param('id') id: string) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    return this.ahspService.getById(id, workspaceId);
  }

  @Patch(':id')
  @Permissions('AHSP_MANAGE')
  async update(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: UpdateAhspDto & { reason: string; userId: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    return this.ahspService.update(id, body, body.userId, body.reason, workspaceId);
  }

  @Delete(':id')
  @Permissions('AHSP_MANAGE')
  async delete(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId: string; reason: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    return this.ahspService.delete(id, body.userId, body.reason, workspaceId);
  }

  @Post(':id/archive')
  @Permissions('AHSP_MANAGE')
  async archive(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId: string; reason: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    return this.ahspService.archive(id, body.userId, body.reason, workspaceId);
  }

  @Post(':id/approve')
  @Permissions('AHSP_APPROVE')
  async approve(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    return this.ahspService.approve(id, body.userId, workspaceId);
  }

  @Post(':id/transfer')
  @Permissions('AHSP_MANAGE')
  async transfer(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId: string; reason: string; targetOwnershipType: OwnershipType },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    return this.ahspService.transfer(id, body.targetOwnershipType, body.userId, body.reason, workspaceId);
  }

  // ─────────────────────────────────────────────
  // AHSP VERSION
  // ─────────────────────────────────────────────

  @Post(':id/versions')
  @Permissions('AHSP_MANAGE')
  async createVersion(
    @Req() request: any,
    @Param('id') ahspId: string,
    @Body() body: CreateAhspVersionDto,
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    return this.ahspVersionService.createVersion(ahspId, {
      ...body,
      workspaceId: body.workspaceId ?? workspaceId,
    });
  }

  // ─────────────────────────────────────────────
  // AHSP SNAPSHOT (freeze basis AHSP untuk BOQ)
  // ─────────────────────────────────────────────

  @Post('versions/:versionId/snapshot')
  @Permissions('AHSP_MANAGE')
  async createSnapshot(
    @Req() request: any,
    @Param('versionId') versionId: string,
    @Body() body: { userId: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('workspaceId diperlukan untuk membuat AHSP Snapshot');
    }
    return this.ahspSnapshotService.createSnapshot(versionId, workspaceId, body.userId);
  }
}
