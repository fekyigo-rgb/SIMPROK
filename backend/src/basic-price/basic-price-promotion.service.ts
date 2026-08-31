import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * BP-CAT-01B — the ONE governed writer that admits an already-published
 * workspace catalog price into the SHARED SIMPROK catalog.
 *
 * PROMOTION IS NOT PUBLICATION. Publication answers "this workspace's own
 * curation ladder is finished for this price" and moves two status columns on
 * a row that keeps its workspace. Promotion answers a different question —
 * "this already-lawful catalog truth is now admitted into the shared catalog
 * every workspace reads" — and it never moves the origin at all. Conflating
 * them would make every workspace publication a national act, which is exactly
 * the widening BASIC_PRICE_PROMOTE_SHARED exists to prevent.
 *
 * RELATIONSHIP TO BasicPricePublicationService's OWNER LOCK. That service's
 * contract makes it the only path permitted to TRANSITION a row into
 * PUBLISHED+PUBLISHED — the two-human ladder (source exactly
 * UNPUBLISHED+VERIFIED, verifier != publisher, no AUTO_PUBLISH). This service
 * transitions nothing. It requires an origin that has ALREADY completed that
 * exact ladder, and copies the settled truth onto a new shared artifact. The
 * two-human gate is not bypassed here; it is a precondition, re-proved from the
 * origin's own columns before anything is written.
 *
 * THE ORIGIN IS NEVER MOVED. There is deliberately no UPDATE of the origin row
 * anywhere in this file. Turning a workspace price into a national one by
 * setting its `workspaceId` to NULL would erase the tenant that produced it
 * from its own history — the shared catalog would gain a price and a workspace
 * would silently lose one. Promotion creates a distinct artifact and leaves the
 * origin exactly as it stood.
 *
 * IDEMPOTENCY IS A DATABASE FACT. `BasicPrice.promotedFromBasicPriceId` is
 * UNIQUE, so a second promotion of the same origin is refused by PostgreSQL
 * itself, not merely by the fast path below. The fast path is an optimisation
 * for the common repeat; the constraint is the guarantee.
 *
 * BP-CAT-01E — NOT PRODUCTION-ACTIVATED (AUTH-C). No HTTP route reaches this
 * service. The endpoint that briefly did was removed, because it was guarded by
 * a WORKSPACE-scoped permission, and lifting one tenant's fact into shared
 * SIMPROK knowledge is a PLATFORM decision that a workspace permission cannot
 * honestly express. That nobody can currently grant the code in-product is a
 * safety property, not evidence that the authority model is right.
 *
 * SIMPROK has no production-real platform authority primitive today: the
 * Authority / PositionAuthority chain exists in the schema but is inert — its
 * writers throw unconditionally and no guard or resolver reads it. Inventing one
 * is an Owner decision, not an executor's.
 *
 * So the DOMAIN stays complete, proven and locked, and the ACTIVATION waits.
 * Everything below — the preconditions, the origin preservation, the exact
 * money, the lineage, the idempotency, the audit — is exercised end to end
 * through this service directly. When the Owner settles the platform authority
 * primitive, wiring one guarded route to `promoteToSharedCatalog` is the whole
 * of the remaining work. Until then there is no route and no button, because a
 * door with no lawful doorkeeper is worse than no door.
 */
@Injectable()
export class BasicPricePromotionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Exactly the source facts a promoted row inherits, and nothing else.
   *
   * Listed explicitly rather than spread from the origin: a spread would silently
   * carry every column a future migration adds — including the ownership columns
   * this row must NOT inherit — and the first person to notice would be a tenant
   * finding their workspace id on a national price.
   */
  private static readonly INHERITED_SOURCE_FACTS = {
    resourceId: true,
    regionId: true,
    effectiveDate: true,
    sourcePeriodLabel: true,
    sourcePeriodGranularity: true,
    effectiveDateProvenance: true,
    effectiveDateDerivationRule: true,
    value: true,
    kdnPercent: true,
    kdnEstablishment: true,
    sourceType: true,
    sourceOrigin: true,
    freshnessStatus: true,
    reportedByAccountId: true,
    reviewDate: true,
    validUntil: true,
  } as const;

  /**
   * Admit one origin BasicPrice into the shared catalog.
   *
   * `workspaceId` is the guard-resolved workspace of the caller and is used as a
   * tenant predicate on the origin, so an actor can only promote a price their
   * own workspace owns. A foreign or unknown id is indistinguishable from a
   * missing one (404), so the route never confirms the existence of ids the
   * caller cannot see.
   */
  async promoteToSharedCatalog(params: {
    workspaceId: string;
    basicPriceId: string;
    actorAccountId: string;
  }) {
    const { workspaceId, basicPriceId, actorAccountId } = params;
    if (!actorAccountId) {
      throw new ConflictException('PROMOTION_ACTOR_REQUIRED');
    }
    // The guard stack always populates the workspace context, so an empty value
    // here means the context was lost rather than that the caller omitted it.
    // Refused explicitly, because an empty tenant predicate reaching the query
    // below would surface as an opaque 500 instead of an honest refusal.
    if (!workspaceId) {
      throw new ConflictException('BASIC_PRICE_WORKSPACE_CONTEXT_REQUIRED');
    }

    // The actor must be a live human in this workspace, proved the same way
    // BasicPricePublicationService proves its publisher (D-01). Holding the
    // permission is not enough on its own: a suspended account or a membership
    // with no live User profile must not be recorded as the author of a fact
    // that every other tenant will read.
    const actorMembership = await this.prisma.workspaceMembership.findFirst({
      where: {
        accountId: actorAccountId,
        workspaceId,
        status: 'ACTIVE',
        account: { status: 'ACTIVE' },
        userProfile: { is: { workspaceId, status: UserStatus.ACTIVE } },
      },
      select: { id: true },
    });
    if (!actorMembership) {
      throw new ForbiddenException('PROMOTER_NOT_ACTIVE_IN_WORKSPACE');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const organizationId = workspace.organizationId;

    // FAST PATH. A repeat promotion is the expected case once a price is in the
    // shared catalog, and it must cost one indexed read rather than a
    // transaction that is destined to hit the unique constraint. Scoped by the
    // same tenant predicate as the locked read below, so it can never answer for
    // an origin the caller may not see.
    const alreadyPromoted = await this.prisma.basicPrice.findFirst({
      where: {
        promotedFromBasicPriceId: basicPriceId,
        promotedFrom: { is: { workspaceId, organizationId } },
      },
    });
    if (alreadyPromoted) {
      return { shared: alreadyPromoted, created: false };
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize on the exact origin row. Two concurrent promotions of the
        // same price queue here rather than racing, so the second one observes
        // the first one's result instead of both reading "not promoted yet".
        const locked = await tx.$queryRaw<
          Array<{
            id: string;
            assetScope: string;
            status: string;
            verificationStatus: string;
          }>
        >(
          Prisma.sql`SELECT "id", "assetScope", "status", "verificationStatus"
                       FROM "basic_prices"
                      WHERE "id" = ${basicPriceId}::uuid
                        AND "workspaceId" = ${workspaceId}::uuid
                        AND "organizationId" = ${organizationId}::uuid
                      FOR UPDATE`,
        );
        const origin = locked[0];
        if (!origin) throw new NotFoundException('BasicPrice not found');

        // Re-read the lineage under the lock. The fast path above ran before the
        // lock existed, so it is evidence of nothing by the time we are here.
        const existing = await tx.basicPrice.findFirst({
          where: { promotedFromBasicPriceId: basicPriceId },
        });
        if (existing) {
          return { shared: existing, created: false };
        }

        // A workspace-private price is not catalog truth and has no publication
        // ladder behind it. It may never become national.
        if (origin.assetScope !== 'SIMPROK_CATALOG') {
          throw new ConflictException('PRIVATE_BASIC_PRICE_NOT_PROMOTABLE');
        }
        // The two-human ladder must already be finished, on BOTH axes. A partial
        // state (PUBLISHED on one axis only) is exactly the drift the Owner Lock
        // refuses to self-heal, and it fails closed here too rather than being
        // quietly completed by a promotion.
        if (
          origin.status !== 'PUBLISHED' ||
          origin.verificationStatus !== 'PUBLISHED'
        ) {
          throw new ConflictException('BASIC_PRICE_NOT_PUBLISHED');
        }

        // BP-CORR-01 — A REPLACED TRUTH IS NEVER ADMITTED INTO SHARED KNOWLEDGE.
        //
        // The two publication axes above prove the origin was PUBLISHED; they
        // cannot prove it is still CURRENT, because supersession deliberately
        // leaves the predecessor's own columns untouched. Without this check a
        // price SIMPROK had already corrected could be lifted into the national
        // catalog and handed to every other workspace as settled truth — the
        // old money, spreading, after the correction that replaced it.
        //
        // Read under the same lock, from the successor's side, exactly as the
        // candidate layer reads it. Refused rather than silently retargeted at
        // the successor: promoting the corrected price is a NEW governed
        // decision about a DIFFERENT artifact, and it must be made explicitly,
        // by a human, with its own lineage (BP-CORR-01 PROMO-06).
        const supersededBy = await tx.basicPrice.findFirst({
          where: { supersedesBasicPriceId: basicPriceId },
          select: { id: true },
        });
        if (supersededBy) {
          throw new ConflictException('BASIC_PRICE_SUPERSEDED');
        }

        const source = await tx.basicPrice.findUniqueOrThrow({
          where: { id: basicPriceId },
          select: BasicPricePromotionService.INHERITED_SOURCE_FACTS,
        });

        const shared = await tx.basicPrice.create({
          data: {
            // Every source fact, verbatim. `value` is copied as the Decimal the
            // origin holds — promotion is an act of admission, never of pricing,
            // so there is no rounding, averaging or normalisation anywhere on
            // this path.
            ...source,
            // SHARED SCOPE. Both ownership columns are cleared, because
            // `organizationId` is an ownership/scope dimension here — the
            // publication lock reads it as part of its tenant predicate, and the
            // Cost Kernel binds a row's submission and import batch to it. A
            // national row that kept one tenant's organization would be claiming
            // an owner it does not have.
            workspaceId: null,
            organizationId: null,
            assetScope: 'SIMPROK_CATALOG',
            status: 'PUBLISHED',
            verificationStatus: 'PUBLISHED',
            // The origin keeps its own provenance channels: `sourceSubmissionId`
            // is UNIQUE and still held by it, and `sourceImportRowId` may never
            // sit on a catalog row at all. The lineage below is what makes this
            // row traceable, and it is the only honest carrier available.
            promotedFromBasicPriceId: basicPriceId,
          },
        });

        // WHO / WHEN / WHAT ACTION / WHAT RESULT come from the audit row itself;
        // WHAT ORIGIN is named in the reason AND carried as a queryable relation
        // by the lineage column, so the trail does not depend on parsing text.
        // The action is PROMOTE_SHARED, never PUBLISH: this row was not
        // published, and labelling it so would make the audit history lie — and
        // would also make it answer the Cost Kernel's publisher-evidence lookup,
        // which deliberately filters on action = 'PUBLISH'.
        await tx.basicPricePublicationAudit.create({
          data: {
            basicPriceId: shared.id,
            action: 'PROMOTE_SHARED',
            actorAccountId,
            reason: `promotedFromBasicPriceId:${basicPriceId}; originWorkspaceId:${workspaceId}`,
          },
        });

        return { shared, created: true };
      });
    } catch (error) {
      // The unique constraint is the real guarantee, so the race it catches is
      // handled by reading the winner exactly once — never by retrying, and
      // never by a backoff loop. Both callers then return the same shared row.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const winner = await this.prisma.basicPrice.findFirst({
          where: { promotedFromBasicPriceId: basicPriceId },
        });
        if (winner) {
          return { shared: winner, created: false };
        }
      }
      throw error;
    }
  }
}
