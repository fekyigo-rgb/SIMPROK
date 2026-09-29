import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { WorkspacePermissionResolverService } from '../auth/workspace-permission-resolver.service';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ResourceObservationService, neutralQuestionOfHandBuiltLine } from './resource-observation.service';
import { identicalQuestionKey } from './identical-question-key';
import {
  AhspImportService,
  ahspSourceRowKey,
} from '../ahsp/services/ahsp-import.service';

/**
 * THE shared curation door for observed resources — the backend behind
 * "Usulkan ke SIMPROK". Not a second brain: it lists what the shared lifecycle
 * has staged and records the two human decisions (map to an existing catalog
 * row, or confirm genuinely new). Minting still happens in the ONE admission
 * authority. Guarded by the SAME governed permission the project-AHSP identity
 * decision already uses — deciding a resource's identity is one authority,
 * whatever surface asks. The ONE exception is JUDGING a pending IQL-01
 * candidate (list, approve, reject), which the second holder's narrower
 * AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE also opens — never deciding rows,
 * teaching, revoking or superseding.
 *
 * Workspace comes from the guard-verified context only, never the client.
 */
@Controller('resource-observations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ResourceObservationController {
  constructor(
    private readonly observations: ResourceObservationService,
    private readonly permissions: WorkspacePermissionResolverService,
    /**
     * The AHSP import journal, asked ONLY about its own documents. Provided as a
     * stateless class exactly as the domain modules already provide the identity
     * authority — no module cycle, and no AHSP knowledge inside the shared
     * observed-resource lifecycle.
     */
    private readonly ahspJournal: AhspImportService,
  ) {}

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
   * need — the same authorities, never a second matcher — and (GAP C2) with the
   * work item each row was quoted by.
   *
   * COMPOSED HERE, deliberately. The observed-resource lifecycle is shared by
   * AHSP, Basic Price and BOQ and must not learn about any one of them: `origin`
   * there is a provenance tag, never a branch. So the shared read stays as it
   * is, the AHSP journal answers for its own documents, and this controller —
   * the edge where one screen's payload is assembled — puts the two together.
   *
   * Every row keeps its answer, including the honest ones: a row whose document
   * left no journal (every observation recorded before the journal existed) is
   * ABSENT, and a source row that two work items quote is AMBIGUOUS. Neither is
   * dressed up as context, and neither blocks that row's own curation.
   */
  @Get()
  @Permissions('AHSP_RESOURCE_IDENTITY_DECIDE')
  async list(
    @Req() request: any,
    @Query('importJobId') importJobId?: string,
    @Query('ahspId') ahspId?: string,
    @Query('sourceSha256') sourceSha256?: string,
  ) {
    const workspaceId = this.workspaceId(request);
    const scopeFlags = [importJobId, ahspId, sourceSha256].filter(
      (value) => typeof value === 'string' && value.length > 0,
    );
    if (scopeFlags.length > 1) {
      throw new BadRequestException('OBSERVATION_SCOPE_CONFLICT');
    }

    let presentation: { workType: string | null; methodName: string | null } | null = null;
    let rows;
    if (typeof ahspId === 'string' && ahspId.length > 0) {
      const locators = await this.observations.locatorsForAhsp(workspaceId, ahspId);
      if (locators === null) throw new NotFoundException('AHSP_NOT_FOUND');
      const handBuilt = await this.observations.handBuiltLinesForAhsp(workspaceId, ahspId);
      if (handBuilt === null) throw new NotFoundException('AHSP_NOT_FOUND');
      await this.observations.ensureHandBuiltObservations(workspaceId, handBuilt.lines);
      const subjectKeys = handBuilt.lines
        .map((line) => neutralQuestionOfHandBuiltLine(workspaceId, line))
        .filter((question) => question !== null)
        .map((question) => identicalQuestionKey(question));
      const locatorRows =
        locators.length > 0
          ? await this.observations.listOpenForCuration(workspaceId, this.actor(request), {
              kind: 'LOCATORS',
              locators,
            })
          : [];
      const subjectRows =
        subjectKeys.length > 0
          ? await this.observations.listOpenForCuration(workspaceId, this.actor(request), {
              kind: 'SUBJECT_KEYS',
              subjectKeys,
            })
          : [];
      rows = [...locatorRows, ...subjectRows];
      presentation = handBuilt.presentation;
    } else {
      let scope:
        | { readonly kind: 'SOURCE_SHA256'; readonly sourceSha256: string }
        | undefined;
      if (typeof importJobId === 'string' && importJobId.length > 0) {
        const identity = await this.ahspJournal.documentIdentityOfJob({
          workspaceId,
          importJobId,
        });
        if (!identity) throw new NotFoundException('IMPORT_JOB_NOT_FOUND');
        if (!identity.sourceSha256) return [];
        scope = { kind: 'SOURCE_SHA256', sourceSha256: identity.sourceSha256 };
      } else if (typeof sourceSha256 === 'string' && sourceSha256.length > 0) {
        if (!/^[0-9a-fA-F]{64}$/.test(sourceSha256)) {
          throw new BadRequestException('SOURCE_SHA256_INVALID');
        }
        scope = { kind: 'SOURCE_SHA256', sourceSha256 };
      }
      rows = await this.observations.listOpenForCuration(
        workspaceId,
        this.actor(request),
        scope,
      );
    }
    if (rows.length === 0) return rows;
    const context = await this.ahspJournal.workContextForSourceRows(workspaceId, rows);
    return rows.map((row) => {
      const journal = context.get(ahspSourceRowKey(row)) ?? { kind: 'ABSENT' as const };
      const workContext =
        (row.sourceSha256 == null || row.sourceSha256 === '') && presentation
          ? {
              kind: 'FOUND' as const,
              workType: presentation.workType,
              methodName: presentation.methodName,
            }
          : journal;
      return { ...row, workContext };
    });
  }

  /**
   * IQL-01 — the exact questions this workspace has governed, with their
   * state, history and the doors open to THIS actor. Curators and the second
   * holder may both look; only a curator is offered REVOKE / SUPERSEDE.
   */
  @Get('questions')
  @Permissions(
    'AHSP_RESOURCE_IDENTITY_DECIDE',
    'AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE',
  )
  async listQuestions(@Req() request: any) {
    const workspaceId = this.workspaceId(request);
    const actorAccountId = this.actor(request);
    // The ONE permission authority the guard itself used — never a second query.
    const effective = await this.permissions.resolve(
      actorAccountId,
      workspaceId,
    );
    return this.observations.listQuestions(workspaceId, actorAccountId, {
      mayDecide:
        effective?.permissions.includes('AHSP_RESOURCE_IDENTITY_DECIDE') ??
        false,
    });
  }

  /** IQL-01 — approve a pending exact-question candidate (never its own author). */
  @Post('questions/:questionKey/approve')
  @Permissions(
    'AHSP_RESOURCE_IDENTITY_DECIDE',
    'AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE',
  )
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
  @Permissions(
    'AHSP_RESOURCE_IDENTITY_DECIDE',
    'AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE',
  )
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
    @Body()
    body: {
      unitDefinitionId?: string;
      reason?: string;
      refusedCandidateIds?: unknown;
      candidateContextDigest?: unknown;
    },
  ) {
    if (!body?.unitDefinitionId) {
      throw new BadRequestException('UNIT_DEFINITION_ID_REQUIRED');
    }
    // Both halves of an examination, or neither: a refused set without the
    // context it was refused in (or the reverse) is not an examination.
    const refused = body.refusedCandidateIds;
    const digest = body.candidateContextDigest;
    const hasRefused = refused !== undefined && refused !== null;
    const hasDigest = digest !== undefined && digest !== null;
    if (hasRefused !== hasDigest) {
      throw new BadRequestException('EXAMINATION_INCOMPLETE');
    }
    if (
      hasRefused &&
      (!Array.isArray(refused) ||
        refused.length === 0 ||
        !refused.every((value) => typeof value === 'string' && value !== '') ||
        typeof digest !== 'string' ||
        digest === '')
    ) {
      throw new BadRequestException('EXAMINATION_INVALID');
    }
    return this.observations.curateNew({
      workspaceId: this.workspaceId(request),
      observationId: id,
      unitDefinitionId: body.unitDefinitionId,
      actorAccountId: this.actor(request),
      reason: body.reason ?? null,
      examination: hasRefused
        ? {
            refusedCandidateIds: refused as string[],
            candidateContextDigest: digest as string,
          }
        : null,
    });
  }
}
