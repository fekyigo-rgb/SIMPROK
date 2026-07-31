import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ReviewSlaState } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { PERMISSIONS } from '../common/constants/permissions';
import { PriceSubmissionReviewService } from './price-submission-review.service';
import {
  AcceptPriceSubmissionReviewDto,
  ReassignPriceSubmissionReviewDto,
  RejectPriceSubmissionReviewDto,
  RequestCorrectionPriceSubmissionReviewDto,
} from './dto/price-submission-review-decision.dto';

/**
 * RM-02D2A-1 Work Package B — the ONE runtime human-review entry point.
 * Closes the RUNTIME_HUMAN_REVIEW_ENTRYPOINT=MISSING gap the RM-02 final
 * exit-gate audit found: previously PriceSubmissionReviewService's
 * accept/reject/requestCorrection/reassign methods had zero controller,
 * worker, or cron wiring anywhere in the codebase.
 *
 * workspaceId comes from PermissionsGuard's resolved request.workspaceContext
 * (x-workspace-id header); organizationId and the acting User.id are always
 * server-resolved here, never accepted from the request body — see
 * PriceSubmissionReviewService.resolveOrganizationId/resolveActingUserId.
 */
@Controller('basic-price-reviews')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BasicPriceReviewController {
  constructor(private readonly reviewService: PriceSubmissionReviewService) {}

  @Get()
  @Permissions(PERMISSIONS.BASIC_PRICE_REVIEW_VIEW)
  async listQueue(@Req() request: any, @Query('slaState') slaState?: ReviewSlaState) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const organizationId = await this.reviewService.resolveOrganizationId(workspaceId);
    return this.reviewService.listReviewQueue({ workspaceId, organizationId, slaState });
  }

  /**
   * Declared BEFORE the ':reviewId' route so the static 'reviewer-candidates'
   * segment is never captured as a reviewId. Gated by BASIC_PRICE_VERIFY (the
   * reassign actor's permission), workspace always from server context.
   */
  @Get('reviewer-candidates')
  @Permissions(PERMISSIONS.BASIC_PRICE_VERIFY)
  async reviewerCandidates(@Req() request: any, @Query('q') q?: string) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    return this.reviewService.listReviewerCandidates({ workspaceId, q });
  }

  @Get(':reviewId')
  @Permissions(PERMISSIONS.BASIC_PRICE_REVIEW_VIEW)
  async getDetail(@Req() request: any, @Param('reviewId') reviewId: string) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const organizationId = await this.reviewService.resolveOrganizationId(workspaceId);
    return this.reviewService.getReviewDetailForApi({ workspaceId, organizationId, reviewId });
  }

  @Post(':reviewId/accept')
  @Permissions(PERMISSIONS.BASIC_PRICE_VERIFY)
  async accept(
    @Req() request: any,
    @Param('reviewId') reviewId: string,
    @Body() dto: AcceptPriceSubmissionReviewDto,
  ) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const accountId: string = request.user.id;
    const organizationId = await this.reviewService.resolveOrganizationId(workspaceId);
    const decidedByUserId = await this.reviewService.resolveActingUserId(accountId, workspaceId);
    return this.reviewService.acceptPriceSubmissionReview({
      workspaceId,
      organizationId,
      reviewId,
      decidedByUserId,
      note: dto.note,
      explicitGeneralRegion: dto.explicitGeneralRegion,
    });
  }

  @Post(':reviewId/reject')
  @Permissions(PERMISSIONS.BASIC_PRICE_VERIFY)
  async reject(
    @Req() request: any,
    @Param('reviewId') reviewId: string,
    @Body() dto: RejectPriceSubmissionReviewDto,
  ) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const accountId: string = request.user.id;
    const organizationId = await this.reviewService.resolveOrganizationId(workspaceId);
    const decidedByUserId = await this.reviewService.resolveActingUserId(accountId, workspaceId);
    return this.reviewService.rejectPriceSubmissionReview({
      workspaceId,
      organizationId,
      reviewId,
      decidedByUserId,
      note: dto.note,
    });
  }

  @Post(':reviewId/request-correction')
  @Permissions(PERMISSIONS.BASIC_PRICE_VERIFY)
  async requestCorrection(
    @Req() request: any,
    @Param('reviewId') reviewId: string,
    @Body() dto: RequestCorrectionPriceSubmissionReviewDto,
  ) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const accountId: string = request.user.id;
    const organizationId = await this.reviewService.resolveOrganizationId(workspaceId);
    const decidedByUserId = await this.reviewService.resolveActingUserId(accountId, workspaceId);
    return this.reviewService.requestCorrectionForPriceSubmissionReview({
      workspaceId,
      organizationId,
      reviewId,
      decidedByUserId,
      note: dto.note,
    });
  }

  @Post(':reviewId/reassign')
  @Permissions(PERMISSIONS.BASIC_PRICE_VERIFY)
  async reassign(
    @Req() request: any,
    @Param('reviewId') reviewId: string,
    @Body() dto: ReassignPriceSubmissionReviewDto,
  ) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const accountId: string = request.user.id;
    const organizationId = await this.reviewService.resolveOrganizationId(workspaceId);
    const decidedByUserId = await this.reviewService.resolveActingUserId(accountId, workspaceId);
    return this.reviewService.reassignPriceSubmissionReview({
      workspaceId,
      organizationId,
      reviewId,
      decidedByUserId,
      note: dto.note,
      assignedToUserId: dto.assignedToUserId ?? null,
    });
  }
}
