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
    return this.observations.listOpenForCuration(
      this.workspaceId(request),
      this.actor(request),
    );
  }

  /**
   * IQL-01 — the exact questions this workspace has governed, with their
   * state, history and the doors open to THIS actor. Same authority as
   * curation: deciding a resource's identity is one authority.
   */
  @Get('questions')
  @Permissions('AHSP_RESOURCE_IDENTITY_DECIDE')
  async listQuestions(@Req() request: any) {
    return this.observations.listQuestions(
      this.workspaceId(request),
      this.actor(request),
    );
  }

  /** IQL-01 — approve a pending exact-question candidate (never its own author). */
  @Post('questions/:questionKey/approve')
  @Permissions('AHSP_RESOURCE_IDENTITY_DECIDE')
  async approveQuestion(
    @Req() request: any,
    @Param('questionKey') questionKey: string,
    @Body() body: { decisionContextToken?: string; reason?: string },
  ) {
    return this.observations.approveQuestion({
      workspaceId: this.workspaceId(request),
      questionKey,
      actorAccountId: this.actor(request),
      decisionContextToken: body?.decisionContextToken ?? null,
      reason: body?.reason ?? null,
    });
  }

  /** IQL-01 — reject a pending exact-question candidate. A reason is required. */
  @Post('questions/:questionKey/reject')
  @Permissions('AHSP_RESOURCE_IDENTITY_DECIDE')
  async rejectQuestion(
    @Req() request: any,
    @Param('questionKey') questionKey: string,
    @Body() body: { decisionContextToken?: string; reason?: string },
  ) {
    return this.observations.rejectQuestion({
      workspaceId: this.workspaceId(request),
      questionKey,
      actorAccountId: this.actor(request),
      decisionContextToken: body?.decisionContextToken ?? null,
      reason: body?.reason ?? null,
    });
  }

  /** IQL-01 — propose a different answer for an effective question. A reason is required. */
  @Post('questions/:questionKey/supersede')
  @Permissions('AHSP_RESOURCE_IDENTITY_DECIDE')
  async supersedeQuestion(
    @Req() request: any,
    @Param('questionKey') questionKey: string,
    @Body()
    body: {
      decisionContextToken?: string;
      selectedResourceCatalogId?: string;
      reason?: string;
    },
  ) {
    return this.observations.supersedeQuestion({
      workspaceId: this.workspaceId(request),
      questionKey,
      actorAccountId: this.actor(request),
      decisionContextToken: body?.decisionContextToken ?? null,
      selectedResourceCatalogId: body?.selectedResourceCatalogId ?? null,
      reason: body?.reason ?? null,
    });
  }

  /** IQL-01 — stop reusing an approved answer. History stays. A reason is required. */
  @Post('questions/:questionKey/revoke')
  @Permissions('AHSP_RESOURCE_IDENTITY_DECIDE')
  async revokeQuestion(
    @Req() request: any,
    @Param('questionKey') questionKey: string,
    @Body() body: { decisionContextToken?: string; reason?: string },
  ) {
    return this.observations.revokeQuestion({
      workspaceId: this.workspaceId(request),
      questionKey,
      actorAccountId: this.actor(request),
      decisionContextToken: body?.decisionContextToken ?? null,
      reason: body?.reason ?? null,
    });
  }

  /**
   * Human maps this observation to an existing canonical resource. With
   * `rememberForIdenticalQuestions: true` and the row's signed context, the same
   * decision is ALSO offered as an IQL-01 learning candidate — never effective
   * until a different authorized account approves it.
   */
  @Post(':id/curate-existing')
  @Permissions('AHSP_RESOURCE_IDENTITY_DECIDE')
  async curateExisting(
    @Req() request: any,
    @Param('id') id: string,
    @Body()
    body: {
      selectedResourceCatalogId?: string;
      reason?: string;
      rememberForIdenticalQuestions?: unknown;
      decisionContextToken?: string;
    },
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
      // Only an explicit boolean true opts in — never a truthy string.
      rememberForIdenticalQuestions:
        body.rememberForIdenticalQuestions === true,
      decisionContextToken: body.decisionContextToken ?? null,
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
