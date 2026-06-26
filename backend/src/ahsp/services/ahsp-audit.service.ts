import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditLogParams {
  ahspId: string;
  ahspVersionId?: string;
  action: string;
  who: string;
  before?: any;
  after?: any;
  reason?: string;
}

@Injectable()
export class AhspAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async logAction(params: AuditLogParams) {
    return this.prisma.aHSPAuditLog.create({
      data: {
        ahspId: params.ahspId,
        ahspVersionId: params.ahspVersionId,
        action: params.action,
        who: params.who,
        before: params.before || null,
        after: params.after || null,
        reason: params.reason,
      },
    });
  }
}
