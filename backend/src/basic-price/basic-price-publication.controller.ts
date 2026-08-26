import {
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
import { PERMISSIONS } from '../common/constants/permissions';
import { BasicPricePublicationService } from './basic-price-publication.service';
import { PublishBasicPriceDto } from './dto/publish-basic-price.dto';

/**
 * RM-02D2A-1 Work Package D — deliberate breaking route change:
 *   OLD: POST /basic-prices/:basicPriceId/publish  (BasicPricePublicationController, removed)
 *   NEW: POST /basic-price-publications/:basicPriceId/publish
 * No compatibility alias — verified via `rg` that the only callers of the
 * old route were this module's own e2e spec (updated in the same change),
 * never a frontend caller. See IMPLEMENTATION-REPORT.md for the full
 * before/after caller audit.
 */
@Controller('basic-price-publications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BasicPricePublicationController {
  constructor(private readonly publicationService: BasicPricePublicationService) {}

  @Get()
  @Permissions(PERMISSIONS.BASIC_PRICE_PUBLISH)
  async getQueue(@Req() request: any) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    return this.publicationService.getPublicationQueue(workspaceId);
  }

  /**
   * BP-CORR-01 — the body is OPTIONAL and backward compatible: a caller that
   * sends nothing (as every existing caller does) publishes exactly as before
   * and corrects nothing. No new route, no new permission — publishing a
   * correction is the same governed act as publishing anything else, performed
   * by the same authority, so inventing a separate door for it would have
   * created a second publication authority for no gain.
   */
  @Post(':basicPriceId/publish')
  @Permissions(PERMISSIONS.BASIC_PRICE_PUBLISH)
  async publish(
    @Req() request: any,
    @Param('basicPriceId') basicPriceId: string,
    @Body() body: PublishBasicPriceDto = {},
  ) {
    const workspaceId: string = request.workspaceContext?.workspaceId;
    const publisherAccountId: string = request.user.id;
    return this.publicationService.publish({
      workspaceId,
      basicPriceId,
      publisherAccountId,
      supersedesBasicPriceId: body?.supersedesBasicPriceId ?? null,
    });
  }
}
