import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  PayloadTooLargeException,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { IntakeEnqueueService } from './intake-enqueue.service';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.pdf']);
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

@Controller('reality-intake/uploads')
@UseGuards(JwtAuthGuard)
export class UploadController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly intakeEnqueue: IntakeEnqueueService,
  ) {}

  @Post()
  @HttpCode(201)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: any,
    @Body('workspaceId') workspaceId: string | undefined,
    @CurrentUser() account: any,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (!workspaceId) {
      throw new BadRequestException('workspaceId is required');
    }

    if (!file) {
      throw new BadRequestException('file is required');
    }

    this.validateFile(file);

    const membership = await this.prisma.workspaceMembership.findUnique({
      where: {
        accountId_workspaceId: {
          accountId: account.id,
          workspaceId,
        },
      },
      include: {
        workspace: true,
      },
    });

    if (!membership || membership.status !== 'ACTIVE') {
      throw new ForbiddenException('Active workspace membership required');
    }

    const result = await this.intakeEnqueue.enqueueUpload({
      fileName: file.originalname,
      mimeType: file.mimetype,
      byteSize: file.size,
      bytes: file.buffer,
      workspaceId,
      organizationId: membership.workspace.organizationId,
      uploadedByAccountId: account.id,
    });

    if (result.duplicate) {
      response.status(200);
    }

    return result;
  }

  private validateFile(file: any): void {
    if (!file.buffer || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException('file buffer is required');
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      throw new PayloadTooLargeException('file exceeds 20MB limit');
    }

    const extension = this.getExtension(file.originalname);
    if (
      !ALLOWED_EXTENSIONS.has(extension) ||
      !ALLOWED_MIME_TYPES.has(file.mimetype)
    ) {
      throw new BadRequestException('only .xlsx and .pdf files are allowed');
    }
  }

  private getExtension(fileName: string): string {
    const normalizedName = fileName || '';
    const index = normalizedName.lastIndexOf('.');
    return index >= 0 ? normalizedName.slice(index).toLowerCase() : '';
  }
}
