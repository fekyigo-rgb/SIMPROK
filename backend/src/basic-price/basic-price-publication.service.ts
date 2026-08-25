import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  mapPublicationQueueItem,
  type PublicationQueueItem,
} from '../common/basic-price-workflow.projection';
import { WITHDRAWN_PUBLICATION_AUDIT_ACTION } from './basic-price-currentness';

/**
 * RM-02D2A-1 Owner Lock (docs/implementation-gates/rm02d2a1/OWNER-LOCK.md),
 * AS RATIFIED BY THE OWNER IN BP-CAT-01D §1 — the ONLY production authority
 * permitted to TRANSITION an existing workspace BasicPrice from its
 * pre-publication state into status = 'PUBLISHED' AND
 * verificationStatus = 'PUBLISHED'. Both axes move together, atomically, in one
 * transaction (D-09) — a deliberate fail-safe redundancy, never simplified to a
 * single-axis predicate.
 *
 * THE WORDING WAS REFINED, NOT DISCARDED. It previously read "the ONLY code
 * path permitted to WRITE" those two values. That absolute is no longer literally
 * true and keeping it would have made this comment lie: BasicPricePromotionService
 * creates a shared descendant already carrying both values. The distinction the
 * Owner ratified is between DECIDING and RESTATING:
 *
 *   PUBLICATION TRANSITION  (here, and nowhere else)
 *     moves a workspace row that has NOT been published into published state.
 *     This is the decision, and it is what the two-human ladder guards —
 *     source exactly UNPUBLISHED+VERIFIED, verifier != publisher, no
 *     AUTO_PUBLISH.
 *
 *   SHARED RESTATEMENT  (BasicPricePromotionService, and nowhere else)
 *     copies an ALREADY-published truth onto one distinct shared descendant.
 *     It transitions nothing, decides nothing, and is refused unless the origin
 *     has already completed this exact ladder. It never fabricates a PUBLISH
 *     audit — it writes PROMOTE_SHARED — so it can never answer the Cost
 *     Kernel's publisher-evidence lookup.
 *
 * ONE PUBLICATION TRANSITION WRITER. ONE SHARED RESTATEMENT WRITER. NO THIRD.
 * That census is enforced permanently by basic-price-writer-inventory.spec.ts,
 * so a future third writer of these two values fails a test rather than quietly
 * joining the set.
 *
 * D-01..D-15 (see OWNER-LOCK.md for the full contract):
 * - Publisher must be a different human than the ACCEPT-decision verifier
 *   (D-08, VERIFIER_CANNOT_PUBLISH, 409). AUTO_PUBLISH is forbidden — there
 *   is no code path anywhere that calls publish() automatically from
 *   ACCEPT or any other system trigger.
 * - Source state must be exactly UNPUBLISHED+VERIFIED (D-04); any other
 *   two-axis combination fails closed (D-12), never self-heals.
 * - Idempotent only at the PUBLISHED+PUBLISHED terminal state (D-13).
 */
@Injectable()
export class BasicPricePublicationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * RM-02D2A2 — the publication queue is projected, never a raw BasicPrice
   * row: a publisher must see a human-readable resource identity, region, and
   * an exact two-digit decimal price string before publishing. Same
   * workspace-scoped UNPUBLISHED+VERIFIED source set as before.
   */
  async getPublicationQueue(workspaceId: string): Promise<PublicationQueueItem[]> {
    const rows = await this.prisma.basicPrice.findMany({
      // RM-03C: assetScope is asserted POSITIVELY so a workspace-private price
      // can never appear in a publication queue. The result set for catalog
      // rows is provably unchanged — every pre-RM-03C row is SIMPROK_CATALOG,
      // and a private row can never reach UNPUBLISHED+VERIFIED anyway (it is
      // never submission-born, so it never passes through the ACCEPT branch
      // that writes VERIFIED). This is the belt to that structural brace:
      // a publisher must never be shown, let alone asked about, an asset whose
      // owner never asked for national publication.
      where: {
        workspaceId,
        assetScope: 'SIMPROK_CATALOG',
        status: 'UNPUBLISHED',
        verificationStatus: 'VERIFIED',
      },
      orderBy: { createdAt: 'asc' },
      include: { resource: true, region: true },
    });
    return rows.map((row) => mapPublicationQueueItem(row));
  }

  /**
   * BP-CORR-01 — PUBLICATION IS ALSO THE MOMENT A CORRECTION BECOMES CURRENT,
   * which is why the supersession pointer is written here and by nothing else.
   *
   * `supersedesBasicPriceId` is OPTIONAL and defaults to "this corrects
   * nothing". That default is the load-bearing half of the law: an ordinary
   * publish states a NEW fact and leaves every prior price standing, so a
   * March observation never silently erases the January one. A correction is an
   * explicit human claim — "the price I am publishing REPLACES that exact
   * published price" — and SIMPROK never infers it from a later date, an equal
   * resource or a moved value.
   *
   * NOTHING IS WRITTEN TO THE PREDECESSOR. Not a flag, not a date, not a status.
   * It is read (under lock) to prove the claim is lawful, and then left exactly
   * as it stood. The only trace the correction leaves on it is an APPEND-ONLY
   * audit row, which adds to its history rather than editing it.
   *
   * THE SAME LADDER, NO SHORTCUT. A corrected successor is not published by
   * being a correction. It must already be exactly UNPUBLISHED+VERIFIED, its
   * ACCEPT decision must be traceable, and its verifier must still be a
   * different human from its publisher — every gate an ordinary price passes.
   * Correcting a published price earns no exemption from any of them.
   */
  async publish(params: {
    workspaceId: string;
    basicPriceId: string;
    publisherAccountId: string;
    /**
     * The already-published price this publication replaces. Server-validated
     * against the successor's OWN workspace, organization, resource and region
     * — a caller may name an id, never a context.
     */
    supersedesBasicPriceId?: string | null;
  }) {
    const { workspaceId, basicPriceId, publisherAccountId } = params;
    const supersedesBasicPriceId = params.supersedesBasicPriceId ?? null;
    if (!publisherAccountId) throw new ConflictException('PUBLISH_ACTOR_REQUIRED');
    // Cheapest possible refusal of the one claim that is nonsense on its face,
    // before a single row is read.
    if (supersedesBasicPriceId && supersedesBasicPriceId === basicPriceId) {
      throw new ConflictException('SUPERSESSION_SELF_REFERENCE');
    }

    // D-01 — publisher must be an ACTIVE Account with an ACTIVE membership
    // in the target workspace.
    const publisherMembership = await this.prisma.workspaceMembership.findFirst(
      {
        where: {
          accountId: publisherAccountId,
          workspaceId,
          status: 'ACTIVE',
          account: { status: 'ACTIVE' },
          userProfile: {
            is: {
              workspaceId,
              status: UserStatus.ACTIVE,
            },
          },
        },
        select: {
          id: true,
          accountId: true,
          workspaceId: true,
          status: true,
          account: { select: { id: true, status: true } },
          userProfile: {
            select: {
              workspaceMembershipId: true,
              workspaceId: true,
              status: true,
            },
          },
        },
      },
    );
    if (
      !publisherMembership ||
      publisherMembership.account.id !== publisherMembership.accountId ||
      publisherMembership.account.status !== 'ACTIVE' ||
      publisherMembership.workspaceId !== workspaceId ||
      publisherMembership.status !== 'ACTIVE' ||
      !publisherMembership.userProfile ||
      publisherMembership.userProfile.workspaceMembershipId !==
        publisherMembership.id ||
      publisherMembership.userProfile.workspaceId !== workspaceId ||
      publisherMembership.userProfile.status !== UserStatus.ACTIVE
    ) {
      throw new ForbiddenException('PUBLISHER_NOT_ACTIVE_IN_WORKSPACE');
    }
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const organizationId = workspace.organizationId;
    const stateBeforeLock = await this.prisma.basicPrice.findFirst({
      where: { id: basicPriceId, workspaceId, organizationId },
      select: {
        status: true,
        verificationStatus: true,
        // BP-CORR-01 — read here so the idempotent terminal branch can prove
        // the repeat is asking for the SAME correction, not a different one.
        supersedesBasicPriceId: true,
      },
    });

    return this.prisma.$transaction(async (tx) => {
      // D-02 — lock exact row, scoped to basicPriceId + workspaceId.
      // D-03 — cross-tenant / unknown id: 404 (the workspaceId predicate
      // makes a cross-tenant id indistinguishable from a missing id).
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          verificationStatus: string;
          sourceSubmissionId: string | null;
          organizationId: string | null;
          // BP-CORR-01 — the successor's own logical context, read from the
          // LOCKED row so the supersession claim is checked against SIMPROK's
          // truth rather than against anything the caller supplied.
          resourceId: string;
          regionId: string | null;
          supersedesBasicPriceId: string | null;
        }>
      >(
        Prisma.sql`SELECT "id", "status", "verificationStatus", "sourceSubmissionId", "organizationId",
                          "resourceId", "regionId", "supersedesBasicPriceId"
                    FROM "basic_prices"
                    WHERE "id" = ${basicPriceId}::uuid
                      AND "workspaceId" = ${workspaceId}::uuid
                      AND "organizationId" = ${organizationId}::uuid
                    FOR UPDATE`,
      );
      const basicPrice = locked[0];
      if (!basicPrice) throw new NotFoundException('BasicPrice not found');

      // D-13 — the only idempotent terminal state: already PUBLISHED+PUBLISHED.
      if (basicPrice.status === 'PUBLISHED' && basicPrice.verificationStatus === 'PUBLISHED') {
        if (
          stateBeforeLock?.status !== 'PUBLISHED' ||
          stateBeforeLock.verificationStatus !== 'PUBLISHED'
        ) {
          throw new ConflictException('PUBLICATION_CONCURRENTLY_COMPLETED');
        }
        // BP-CORR-01 IDEM-01 — a repeat is idempotent only if it is the SAME
        // act. Re-publishing a settled row while naming a DIFFERENT predecessor
        // (or naming one where the first call named none) is a request to
        // change what a published correction claims, and the honest answer is
        // to refuse rather than to return the old row as though the caller had
        // been agreed with. Nothing is written either way.
        // Normalised to null on both sides: "absent" and "explicitly none" are
        // the same claim, and a repeat that omits the field must not read as a
        // request to CHANGE the correction to nothing.
        if (
          supersedesBasicPriceId !== (basicPrice.supersedesBasicPriceId ?? null)
        ) {
          throw new ConflictException('SUPERSESSION_ALREADY_SETTLED');
        }
        return tx.basicPrice.findUniqueOrThrow({ where: { id: basicPriceId } });
      }

      // D-04 / D-12 — the only source state allowed to transition is exactly
      // UNPUBLISHED+VERIFIED. Every other combination (including partial
      // drift like PUBLISHED+VERIFIED or UNPUBLISHED+PUBLISHED) fails
      // closed — never silently repaired.
      if (basicPrice.status !== 'UNPUBLISHED' || basicPrice.verificationStatus !== 'VERIFIED') {
        throw new ConflictException('INCONSISTENT_BASIC_PRICE_STATE');
      }

      // D-05/D-06/D-07 — trace the exact ACCEPT decision through
      // BasicPrice.sourceSubmission -> PriceSubmission.review ->
      // PriceSubmissionReviewDecision(action=ACCEPT) -> decidedByUserId ->
      // User.workspaceMembershipId -> WorkspaceMembership.accountId. Missing
      // or ambiguous evidence fails closed, never guesses.
      if (!basicPrice.sourceSubmissionId) {
        throw new ConflictException('VERIFIER_EVIDENCE_MISSING');
      }
      const submission = await tx.priceSubmission.findFirst({
        where: {
          id: basicPrice.sourceSubmissionId,
          workspaceId,
          organizationId,
        },
        include: {
          review: {
            where: { workspaceId, organizationId },
            include: {
              decisions: { where: { action: 'ACCEPT' } },
            },
          },
        },
      });
      const acceptDecisions = submission?.review?.decisions ?? [];
      if (acceptDecisions.length !== 1) {
        throw new ConflictException('VERIFIER_EVIDENCE_MISSING');
      }
      const verifierUser = await tx.user.findFirst({
        where: {
          id: acceptDecisions[0].decidedByUserId,
          workspaceId,
          status: UserStatus.ACTIVE,
        },
        select: {
          status: true,
          workspaceMembershipId: true,
          membership: {
            select: {
              id: true,
              accountId: true,
              workspaceId: true,
              status: true,
              account: { select: { id: true, status: true } },
            },
          },
        },
      });
      if (
        !verifierUser ||
        verifierUser.status !== UserStatus.ACTIVE ||
        verifierUser.membership.id !== verifierUser.workspaceMembershipId ||
        verifierUser.membership.workspaceId !== workspaceId ||
        verifierUser.membership.status !== 'ACTIVE' ||
        verifierUser.membership.account.id !== verifierUser.membership.accountId ||
        verifierUser.membership.account.status !== 'ACTIVE'
      ) {
        throw new ConflictException('VERIFIER_EVIDENCE_MISSING');
      }
      const verifierAccountId = verifierUser.membership.accountId;

      // D-08 — separation of duties. AUTO_PUBLISH=FORBIDDEN,
      // VERIFIER_MUST_DIFFER_FROM_PUBLISHER=YES per Owner Lock.
      if (verifierAccountId === publisherAccountId) {
        throw new ConflictException('VERIFIER_CANNOT_PUBLISH');
      }

      // BP-CORR-01 §13 — THE PREDECESSOR IS VALIDATED, NEVER TRUSTED.
      //
      // Everything that decides whether this claim is lawful is read from
      // SIMPROK's own rows: the successor's workspace, organization, resource
      // and region come from the LOCKED row above, and the predecessor is
      // looked up inside that same server-derived scope. The caller contributes
      // exactly one thing — an id — and cannot widen the context it is checked
      // against. A predecessor in another tenant is indistinguishable from one
      // that does not exist.
      //
      // It runs AFTER the two-human ladder above, deliberately: a correction
      // that could not lawfully be published at all must fail as a publication
      // failure, not as a supersession failure.
      if (supersedesBasicPriceId) {
        // Locked in turn, so two corrections racing for the same predecessor
        // resolve here as one explicit refusal rather than as a unique-index
        // error surfacing from the write below. The unique index remains the
        // guarantee; this is the readable path to it.
        const lockedPredecessor = await tx.$queryRaw<
          Array<{
            id: string;
            status: string;
            verificationStatus: string;
            assetScope: string;
            resourceId: string;
            regionId: string | null;
            promotedFromBasicPriceId: string | null;
          }>
        >(
          Prisma.sql`SELECT "id", "status", "verificationStatus", "assetScope",
                            "resourceId", "regionId", "promotedFromBasicPriceId"
                      FROM "basic_prices"
                      WHERE "id" = ${supersedesBasicPriceId}::uuid
                        AND "workspaceId" = ${workspaceId}::uuid
                        AND "organizationId" = ${organizationId}::uuid
                      FOR UPDATE`,
        );
        const predecessor = lockedPredecessor[0];
        if (!predecessor) {
          throw new NotFoundException('SUPERSEDED_BASIC_PRICE_NOT_FOUND');
        }

        // ONLY PUBLISHED TRUTH CAN BE SUPERSEDED. A draft, a merely-VERIFIED
        // row or a rejected one was never current, so there is nothing to
        // replace — and letting a correction point at one would produce a
        // "current" successor standing on a predecessor no one had ever seen.
        if (
          predecessor.status !== 'PUBLISHED' ||
          predecessor.verificationStatus !== 'PUBLISHED'
        ) {
          throw new ConflictException('SUPERSEDED_BASIC_PRICE_NOT_PUBLISHED');
        }

        // A WORKSPACE_PRIVATE price has its own correction channel
        // (BasicPriceProvenanceCorrection) and is never published, so this is
        // belt to the database's braces rather than a new rule.
        if (predecessor.assetScope !== 'SIMPROK_CATALOG') {
          throw new ConflictException('SUPERSEDED_BASIC_PRICE_NOT_CATALOG');
        }

        // A shared descendant restates settled truth for other tenants and is
        // not this workspace's to correct. The workspace-scoped lookup above
        // already excludes it (a shared row has a NULL workspaceId); this says
        // so out loud so the reason is a sentence rather than a 404.
        if (predecessor.promotedFromBasicPriceId !== null) {
          throw new ConflictException('SUPERSEDED_BASIC_PRICE_IS_SHARED');
        }

        // SAME LOGICAL CONTEXT, OR IT IS NOT A CORRECTION.
        //
        // Replacing a price for a DIFFERENT resource or a DIFFERENT region
        // would not correct anything — it would delete one truth and add an
        // unrelated one, leaving the first context with no current price at
        // all. Exact id equality only; never a name match, never a fallback to
        // "no region means any region".
        if (predecessor.resourceId !== basicPrice.resourceId) {
          throw new ConflictException('SUPERSESSION_RESOURCE_MISMATCH');
        }
        if (predecessor.regionId !== basicPrice.regionId) {
          throw new ConflictException('SUPERSESSION_REGION_MISMATCH');
        }

        // ONE CURRENT TRUTH — a predecessor may be replaced once. A second
        // successor would fork the chain into two rows that both claim to have
        // replaced the same price, which is exactly the "two simultaneously
        // competing current truths" state this gate exists to prevent. The
        // UNIQUE index refuses it regardless; this turns that into a named
        // conflict instead of a constraint violation.
        const existingSuccessor = await tx.basicPrice.findFirst({
          where: { supersedesBasicPriceId },
          select: { id: true },
        });
        if (existingSuccessor) {
          throw new ConflictException('PREDECESSOR_ALREADY_SUPERSEDED');
        }
      }

      // D-09 — atomic two-axis write + exactly one audit row.
      //
      // BP-CORR-01 — the supersession pointer joins that same single atomic
      // write rather than following it. "This row is published" and "this row
      // replaced that one" become true in the same instant, so no reader can
      // ever observe a published successor whose correction has not landed yet,
      // or a pointer on a row that is not yet published. `value`, `resourceId`,
      // `regionId`, `effectiveDate`, `assetScope` and both ownership columns
      // are absent here, as they have always been: publication moves status,
      // and now records what it replaced. It still moves no money.
      const updated = await tx.basicPrice.update({
        where: { id: basicPriceId },
        data: {
          status: 'PUBLISHED',
          verificationStatus: 'PUBLISHED',
          supersedesBasicPriceId,
        },
      });

      await tx.basicPricePublicationAudit.create({
        data: {
          basicPriceId,
          action: 'PUBLISH',
          actorAccountId: publisherAccountId,
          reason: supersedesBasicPriceId
            ? `status:UNPUBLISHED->PUBLISHED; verificationStatus:VERIFIED->PUBLISHED; supersedes:${supersedesBasicPriceId}`
            : 'status:UNPUBLISHED->PUBLISHED; verificationStatus:VERIFIED->PUBLISHED',
        },
      });

      if (supersedesBasicPriceId) {
        // THE PREDECESSOR'S HISTORY GAINS A LINE; IT LOSES NOTHING.
        //
        // This is an APPEND to an append-only audit table, not an edit of the
        // price row — the predecessor's own columns are byte-identical before
        // and after. Without it, the fact that a published price stopped being
        // current would be readable only by inference from another row's
        // pointer, and the human who decided it would not be recorded anywhere.
        //
        // The action is SUPERSEDED and never PUBLISH. The Cost Kernel proves a
        // publisher by looking for action = 'PUBLISH' on that exact price, so
        // an audit row wearing that action here would let a correction answer
        // the two-human ladder on the predecessor's behalf.
        await tx.basicPricePublicationAudit.create({
          data: {
            basicPriceId: supersedesBasicPriceId,
            action: 'SUPERSEDED',
            actorAccountId: publisherAccountId,
            reason: `superseded by:${basicPriceId}`,
          },
        });
      }

      return updated;
    });
  }

  /**
   * BP-CORR-01B GAP B — WITHDRAWAL WITHOUT REPLACEMENT.
   *
   * A source can retract a price without anyone knowing what the right number
   * is instead. SIMPROK must be able to say so, and the forbidden shortcut is
   * to invent a successor purely to make the old row disappear: that would put
   * a price into the catalog that nobody ever observed. So withdrawal creates
   * NO BasicPrice, deletes NO BasicPrice, and mutates NO BasicPrice. It appends
   * one governance record, and the currentness projection reads it.
   *
   * IT LIVES HERE BECAUSE PUBLICATION IS ALREADY THE AUTHORITY over whether a
   * price is offered. Withdrawal is the inverse of that same decision, taken by
   * the same kind of human about the same kind of row, so giving it its own
   * service would have created a second lifecycle authority for one audit
   * insert. There is deliberately NO HTTP route: no production door lawfully
   * exposes withdrawal today, and a button with no lawful doorkeeper is worse
   * than no button — the same reasoning that keeps shared promotion at AUTH-C.
   *
   * WITHDRAWAL IS NOT REJECTION AND NOT UNPUBLISHING. The row keeps both
   * publication axes, keeps its money, keeps its provenance and stays readable
   * by id forever. A calculation that already selected it still re-reads and
   * still proves it. Only future OFFERS change.
   */
  async withdraw(params: {
    workspaceId: string;
    basicPriceId: string;
    actorAccountId: string;
    reason: string;
    /**
     * WHEN THE WITHDRAWAL BECOMES TRUE, if the source stated it.
     *
     * Optional, and the absent case is honest rather than invented: SIMPROK
     * records the governed decision instant and claims nothing more than "no
     * earlier or later effective time was supplied". It never guesses a date,
     * and it never says the source stated one when it did not.
     *
     * A stated value may be in the PAST (a retraction we are told about late)
     * or the FUTURE (a retraction announced ahead of time). Both are believed
     * exactly as given; the currentness projection decides what is in force.
     */
    effectiveAt?: Date;
  }) {
    const { workspaceId, basicPriceId, actorAccountId, reason, effectiveAt } =
      params;
    // Resolved ONCE, before the transaction, so the fallback effective instant
    // and the row's own recording time describe the same decision rather than
    // drifting by however long the lock took.
    const decisionInstant = new Date();
    if (!actorAccountId) throw new ConflictException('WITHDRAW_ACTOR_REQUIRED');
    // A withdrawal removes a price from every future offer. That is never
    // self-evident, so the human's stated reason is mandatory — the same rule
    // RM-03D1 applies to a provenance correction.
    if (!reason || !reason.trim()) {
      throw new ConflictException('WITHDRAW_REASON_REQUIRED');
    }

    // Same D-01 actor proof as publication: holding a permission is not enough,
    // the human must be live in this workspace, because their account id is
    // about to be recorded as the author of the decision.
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
      throw new ForbiddenException('WITHDRAWER_NOT_ACTIVE_IN_WORKSPACE');
    }

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { organizationId: true },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    const organizationId = workspace.organizationId;

    return this.prisma.$transaction(async (tx) => {
      // Serialize on the exact row, scoped by tenant. A foreign or unknown id
      // is indistinguishable from a missing one, so this never confirms the
      // existence of a price the caller may not see.
      const locked = await tx.$queryRaw<
        Array<{
          id: string;
          status: string;
          verificationStatus: string;
          assetScope: string;
        }>
      >(
        Prisma.sql`SELECT "id", "status", "verificationStatus", "assetScope"
                     FROM "basic_prices"
                    WHERE "id" = ${basicPriceId}::uuid
                      AND "workspaceId" = ${workspaceId}::uuid
                      AND "organizationId" = ${organizationId}::uuid
                    FOR UPDATE`,
      );
      const basicPrice = locked[0];
      if (!basicPrice) throw new NotFoundException('BasicPrice not found');

      // ONLY PUBLISHED TRUTH CAN BE WITHDRAWN. A draft or merely-VERIFIED row
      // was never offered, so there is nothing to withdraw — and letting a
      // withdrawal land on one would record a decision about a price no one had
      // ever seen.
      if (
        basicPrice.status !== 'PUBLISHED' ||
        basicPrice.verificationStatus !== 'PUBLISHED'
      ) {
        throw new ConflictException('BASIC_PRICE_NOT_PUBLISHED');
      }
      if (basicPrice.assetScope !== 'SIMPROK_CATALOG') {
        throw new ConflictException('PRIVATE_BASIC_PRICE_NOT_WITHDRAWABLE');
      }

      // IDEMPOTENT (W-08). A price is withdrawn or it is not; withdrawing it
      // twice is the same fact stated twice, and a second audit row would make
      // the history claim two decisions were taken. Read inside the lock, so a
      // concurrent duplicate queues here rather than racing.
      const existing = await tx.basicPricePublicationAudit.findFirst({
        where: {
          basicPriceId,
          action: WITHDRAWN_PUBLICATION_AUDIT_ACTION,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (existing) {
        // BP-CORR-01B TEMPORAL — IDEMPOTENT MEANS "THE SAME ACT", NOT MERELY
        // "THE SAME PRICE". Two withdrawals of one price that name DIFFERENT
        // effective instants are two different claims about when it stopped
        // being offered, and silently returning the first would let the second
        // look accepted while changing nothing. Refused explicitly, as a
        // settled-governance conflict, exactly as a re-pointed correction is.
        //
        // A caller that states no effective time is asking for "withdrawn",
        // not for "withdrawn from a specific instant", so it matches whatever
        // is already recorded rather than conflicting with it.
        if (
          effectiveAt &&
          existing.effectiveAt &&
          existing.effectiveAt.getTime() !== effectiveAt.getTime()
        ) {
          throw new ConflictException('WITHDRAWAL_ALREADY_SETTLED');
        }
        return { withdrawal: existing, created: false };
      }

      // THE WHOLE WRITE. One append to an append-only table. No BasicPrice
      // create, no BasicPrice update, no delete — which is why this method does
      // not appear in the permanent BasicPrice writer inventory at all.
      //
      // `effectiveAt` is NEVER null on this action: the database refuses that
      // (basic_price_publication_audits_withdrawn_requires_effective_at_check),
      // and a null would fail OPEN in the currentness projection — the price
      // would stay on offer and the withdrawal would govern nothing. When the
      // caller states nothing, the governed decision instant is recorded and
      // means exactly that: "no earlier or later effective time was supplied".
      const withdrawal = await tx.basicPricePublicationAudit.create({
        data: {
          basicPriceId,
          action: WITHDRAWN_PUBLICATION_AUDIT_ACTION,
          actorAccountId,
          reason,
          effectiveAt: effectiveAt ?? decisionInstant,
        },
      });
      return { withdrawal, created: true };
    });
  }
}
