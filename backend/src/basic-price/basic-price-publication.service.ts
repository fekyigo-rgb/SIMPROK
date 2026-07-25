import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The ONLY code path permitted to write BasicPrice.status = 'PUBLISHED'
 * (01-RM02B0-SCHEMA-CONTRACT.md §8.1 Option C). Preconditions:
 * verificationStatus == 'VERIFIED' (never before); actor is human (never
 * SYSTEM/AI — enforced structurally by requiring a real actorAccountId,
 * never defaulted); idempotent (publishing an already-PUBLISHED price
 * returns the existing state, never double-audits).
 */
@Injectable()
export class BasicPricePublicationService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(basicPriceId: string, actorAccountId: string) {
    if (!actorAccountId) throw new ConflictException('PUBLISH_ACTOR_REQUIRED');

    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ id: string; status: string; verificationStatus: string }>
      >(Prisma.sql`SELECT "id", "status", "verificationStatus" FROM "basic_prices" WHERE "id" = ${basicPriceId}::uuid FOR UPDATE`);
      const basicPrice = locked[0];
      if (!basicPrice) throw new NotFoundException('BasicPrice not found');

      if (basicPrice.status === 'PUBLISHED') {
        // Idempotent: already published, return existing state, no
        // duplicate audit row.
        return tx.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });
      }

      if (basicPrice.verificationStatus !== 'VERIFIED') {
        throw new ConflictException('NOT_YET_VERIFIED');
      }

      const updated = await tx.basicPrice.update({
        where: { id: basicPriceId },
        data: { status: 'PUBLISHED' },
      });

      await tx.basicPricePublicationAudit.create({
        data: {
          basicPriceId,
          action: 'PUBLISH',
          actorAccountId,
        },
      });

      return updated;
    });
  }
}
