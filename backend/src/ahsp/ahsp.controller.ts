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
import { TrustedAhspActorService } from './services/trusted-ahsp-actor.service';
import { RetireAhspVersionDto } from './dto/retire-ahsp-version.dto';
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
    private readonly trustedActor: TrustedAhspActorService,
  ) {}

  /**
   * RM-03B remediation — the ONE way this controller learns who is acting.
   *
   * Every mutation below records provenance (createdBy/approvedBy/archivedBy/
   * deletedBy/ownershipTransferredBy, plus an audit `who`). Each used to read
   * `body.userId`, so an authenticated User A could attribute their own change
   * to User B. The workspace was already trusted, so nothing leaked across
   * tenants — but the audit trail lied, and provenance is the product here.
   *
   * `body.userId` is now never read for authority on any route. Where the
   * request type still carries the field it is inert, and a test proves it.
   */
  private resolveActor(request: any): Promise<string> {
    return this.trustedActor.resolveActorUserId(request.workspaceContext);
  }

  // ─────────────────────────────────────────────
  // AHSP CRUD
  // ─────────────────────────────────────────────

  @Get('health')
  @Permissions('AHSP_VIEW')
  healthCheck() {
    return { module: 'ahsp', status: 'ok' };
  }

  /**
   * THE standalone AHSP discovery door — the one the sidebar opens.
   *
   * It answers the question a user asks OUTSIDE a project: 'what AHSP is
   * visible to my workspace'. That is a different contract from the RAB
   * picker, which asks 'what may this BOQ item bind to right now', and the two
   * are deliberately not sharing a query: binding eligibility is a security
   * invariant tied to what selectForBoqItem revalidates, and a display surface
   * must never be able to pull on it.
   *
   * Workspace comes from the guard-verified context, exactly as every other
   * route here reads it — never from the client, so no caller can name another
   * tenant's workspace and read its AHSP.
   */
  @Get()
  @Permissions('AHSP_VIEW')
  async list(@Req() request: any) {
    const workspaceId: string | undefined =
      request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    return this.ahspService.list(workspaceId);
  }

  @Post()
  @Permissions('AHSP_MANAGE')
  async create(@Req() request: any, @Body() body: CreateAhspDto) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;

    // RM-03B tenant trust: the workspace comes from the guard-verified context
    // ONLY. This read `body.workspaceId ?? workspaceId`, so a client-supplied
    // field OVERRODE the verified one and a member of workspace B could plant
    // an AHSP into workspace A. That was already wrong; it becomes an
    // exploitable pricing path the moment workspace-private AHSPs are bindable,
    // because private eligibility is keyed on exactly this column. There is no
    // global ValidationPipe and CreateAhspDto is a plain interface, so a forged
    // body field is stripped nowhere else — it must be ignored here.
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    const userId = await this.resolveActor(request);

    // Both authority fields are destructured OUT of the body before it is
    // spread, so a forged value cannot survive even if the spread order were
    // later changed by accident. Relying on "the explicit key wins because it
    // comes second" is a property of this line, not of the contract.
    const { userId: _clientActor, workspaceId: _clientWorkspace, ...safeBody } = body;

    return this.ahspService.create({
      ...safeBody,
      workspaceId,
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
    @Body() body: UpdateAhspDto & { reason: string; userId?: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.update(id, body, actorUserId, body.reason, workspaceId);
  }

  @Delete(':id')
  @Permissions('AHSP_MANAGE')
  async delete(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId?: string; reason: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.delete(id, actorUserId, body.reason, workspaceId);
  }

  @Post(':id/archive')
  @Permissions('AHSP_MANAGE')
  async archive(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId?: string; reason: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.archive(id, actorUserId, body.reason, workspaceId);
  }

  @Post(':id/approve')
  @Permissions('AHSP_APPROVE')
  async approve(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId?: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.approve(id, actorUserId, workspaceId);
  }

  @Post(':id/transfer')
  @Permissions('AHSP_MANAGE')
  async transfer(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { userId?: string; reason: string; targetOwnershipType: OwnershipType },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    const actorUserId = await this.resolveActor(request);
    return this.ahspService.transfer(id, body.targetOwnershipType, actorUserId, body.reason, workspaceId);
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
    // Same trust inversion as create(), same fix. A version inherits the
    // eligibility of its parent AHSP, so a forged workspaceId here is just as
    // load-bearing as one on the AHSP itself.
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    const userId = await this.resolveActor(request);
    const { userId: _clientActor, workspaceId: _clientWorkspace, ...safeBody } = body;
    return this.ahspVersionService.createVersion(ahspId, {
      ...safeBody,
      workspaceId,
      userId,
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
    @Body() body: { userId?: string },
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('workspaceId diperlukan untuk membuat AHSP Snapshot');
    }
    const actorUserId = await this.resolveActor(request);
    return this.ahspSnapshotService.createSnapshot(versionId, workspaceId, actorUserId);
  }

  // ─────────────────────────────────────────────
  // AHSP VERSION RETIREMENT (RM-03D1)
  // ─────────────────────────────────────────────

  /**
   * Withdraw ONE erroneous or replaced version from all future selection.
   *
   * The service already had `updateStatus` with no caller, so an incorrect
   * version stayed eligible forever and the only reachable alternative —
   * `POST :id/archive` — archives the whole AHSP parent and takes the correct
   * versions with it. This is the narrow, version-scoped act that was missing.
   *
   * PERMISSION — the SAME AHSP_MANAGE the create-version route already requires.
   * Withdrawing a version you may create is not a broader authority than
   * creating it, so no new permission code is minted. History is preserved: the
   * version, its resources, its audit log and every occurrence that priced
   * against it all survive, and only future eligibility changes.
   */
  @Post('versions/:versionId/retire')
  @Permissions('AHSP_MANAGE')
  async retireVersion(
    @Req() request: any,
    @Param('versionId') versionId: string,
    @Body() body: RetireAhspVersionDto,
  ) {
    const workspaceId: string | undefined = request.workspaceContext?.workspaceId;
    if (!workspaceId) {
      throw new BadRequestException('AHSP_WORKSPACE_CONTEXT_REQUIRED');
    }
    // Same trusted-actor discipline as every other mutation here: the acting
    // user is derived, never read from the body.
    const actorUserId = await this.resolveActor(request);
    return this.ahspVersionService.retireVersion({
      versionId,
      workspaceId,
      status: body.status,
      userId: actorUserId,
      reason: body.reason,
    });
  }
}
