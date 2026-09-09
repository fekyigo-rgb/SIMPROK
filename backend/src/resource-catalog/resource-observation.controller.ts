import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ResourceObservationService } from './resource-observation.service';

/**
 * THE shared curation door for observed resources — the backend behind
 * "Usulkan ke SIMPROK". Not a second brain: it lists what the shared lifecycle
 * has staged and records the two human decisions (map to an existing catalog
 * row, or confirm genuinely new). Minting still happens in the ONE admission
 * authority. Guarded by the SAME governed permission the project-AHSP identity
 * decision already uses — deciding a resource's identity is one authority,
 * whatever surface asks.
 *
 * Workspace comes from the guard-verified context only, never the client.
 */
@Controller('resource-observations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ResourceObservationController {
  constructor(private readonly observations: ResourceObservationService) {}

  private workspaceId(request: any): string {
    const workspaceId: string | undefined =
      request.workspaceContext?.workspaceId;
    if (!workspaceId)
      throw new BadRequestException('WORKSPACE_CONTEXT_REQUIRED');
    return workspaceId;
  }

  private actor(request: any): string {
    const actor: string | undefined = request.user?.id;
    if (!actor) throw new BadRequestException('ACTOR_REQUIRED');
    return actor;
  }

  /**
   * The observations still awaiting a human decision, each enriched with the
   * live candidates and a suggested unit so the curator has what both decisions
   * need — the same authorities, never a second matcher.
   */
  @Get()
  @Permissions('AHSP_RESOURCE_IDENTITY_DECIDE')
  async list(@Req() request: any) {
    return this.observations.listOpenForCuration(this.workspaceId(request));
  }

  /** Human maps this observation to an existing canonical resource. */
  @Post(':id/curate-existing')
  @Permissions('AHSP_RESOURCE_IDENTITY_DECIDE')
  async curateExisting(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { selectedResourceCatalogId?: string; reason?: string },
  ) {
    if (!body?.selectedResourceCatalogId) {
      throw new BadRequestException('SELECTED_RESOURCE_CATALOG_ID_REQUIRED');
    }
    return this.observations.curateExisting({
      workspaceId: this.workspaceId(request),
      observationId: id,
      selectedResourceCatalogId: body.selectedResourceCatalogId,
      actorAccountId: this.actor(request),
      reason: body.reason ?? null,
    });
  }

  /** Human confirms this observation is genuinely new; the authority mints it. */
  @Post(':id/curate-new')
  @Permissions('AHSP_RESOURCE_IDENTITY_DECIDE')
  async curateNew(
    @Req() request: any,
    @Param('id') id: string,
    @Body() body: { unitDefinitionId?: string; reason?: string },
  ) {
    if (!body?.unitDefinitionId) {
      throw new BadRequestException('UNIT_DEFINITION_ID_REQUIRED');
    }
    return this.observations.curateNew({
      workspaceId: this.workspaceId(request),
      observationId: id,
      unitDefinitionId: body.unitDefinitionId,
      actorAccountId: this.actor(request),
      reason: body.reason ?? null,
    });
  }
}
