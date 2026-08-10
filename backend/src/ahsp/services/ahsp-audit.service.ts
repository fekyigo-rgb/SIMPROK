import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

/** Anything that can write the audit row — the root client or an open transaction. */
type AuditClient = Pick<Prisma.TransactionClient, 'aHSPAuditLog'>;

@Injectable()
export class AhspAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * RM-03D1 — `client` lets a caller write this audit row INSIDE its own
   * transaction.
   *
   * It defaults to the root Prisma client, so every existing call site keeps
   * its exact behaviour. But a state transition and the record of why it
   * happened must commit or roll back together: retirement used to update the
   * version, then write the audit through the root client, so a failed audit
   * left a version withdrawn with no reason attached — the audit trail silently
   * disagreeing with reality. One parameter removes that, without a second
   * audit implementation to drift from this one.
   */
  async logAction(params: AuditLogParams, client?: AuditClient) {
    return (client ?? this.prisma).aHSPAuditLog.create({
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
