import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { loadCallerOwnedBatch } from './basic-price-import-ownership.util';
import { BasicPriceRowResolutionService } from './basic-price-row-resolution.service';
import {
  BasicPricePrivateAssetService,
  type KeepBatchPrivateResult,
} from './basic-price-private-asset.service';
import {
  buildSmartSaveFailure,
  classifySmartSavePersistence,
  type SmartSavePersistedFacts,
} from './basic-price-smart-save-failure.law';
import type { TrustedBasicPriceActor } from './trusted-basic-price-actor.service';

/**
 * `Simpan & Gunakan` — ONE user intent, ONE backend command.
 *
 * WHAT WAS WRONG. The browser did the orchestrating: it POSTed
 * `accept-machine-proven`, waited, then POSTed `keep-private`. Two business
 * mutations sequenced by a client, which means a closed laptop, a dropped
 * connection or a stray reload between them leaves the batch in a state no
 * single actor intended — rows bound but nothing kept — and the person who
 * pressed once has no idea which half happened. Orchestration that decides what
 * a product DOES is server work; a browser's job is to state an intent.
 *
 * IT DECIDES NOTHING ITSELF. This class contains no identity law, no metadata
 * law, no eligibility law and no writes of its own. It calls two existing
 * authorities in order and reports what they did:
 *
 *   1. `acceptMachineProvenRows` — re-derives, at execution time, which rows
 *      the canonical authorities can still prove, and binds them through the
 *      SAME primitive an individual `Selesaikan` uses, recording the acting
 *      human and HOW the decision was made.
 *   2. `keepBatchPrivate` — materializes every row that is now lawfully ready
 *      as a WORKSPACE_PRIVATE price, under its own unchanged metadata and
 *      provenance assertions.
 *
 * ONE COMMAND IS NOT ONE TRANSACTION, and deliberately so. Step 1 commits in
 * bounded chunks and step 2 is independently idempotent, so a failure anywhere
 * leaves committed truth committed and a retry of the same command continues
 * from it: rows already bound are no longer `NEEDS_REVIEW` and are skipped,
 * rows already kept come back as `alreadyPrivateCount`. A single giant
 * transaction would trade that honest resumability for a rollback fantasy over
 * work that had genuinely succeeded.
 *
 * WHICH IS EXACTLY WHY IT MEASURES ITSELF. Resumability is only a virtue if the
 * person is told the truth about where they are resuming FROM. Two counts are
 * taken before the command runs and taken again if it fails, and the difference
 * — never an assumption, never the step results alone — is what the failure
 * reports. See `basic-price-smart-save-failure.law.ts` for why a sentence like
 * "nothing was saved" is a falsehood this command may not tell.
 *
 * BOTH PERMISSIONS, NEITHER WIDENED. The route declares `PermissionsAll(
 * BASIC_PRICE_RESOLVE, BASIC_PRICE_SUBMIT)`: binding an identity and
 * materializing a price are two capabilities, and a caller who holds only one
 * of them must not gain the other by pressing a button that happens to do both.
 */
export interface SmartSaveResult {
  batchId: string;
  /** What step 1 did — see `acceptMachineProvenRows`. */
  accepted: {
    acceptedCount: number;
    eligibleCount: number;
    skippedCount: number;
    excludedCount: number;
    remainingEligible: number;
    evidenceLoads: number;
    chunks: number;
  };
  /** What step 2 did — see `keepBatchPrivate`. */
  kept: KeepBatchPrivateResult;
}

@Injectable()
export class BasicPriceSmartSaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resolution: BasicPriceRowResolutionService,
    private readonly privateAssets: BasicPricePrivateAssetService,
  ) {}

  /**
   * THE TWO FACTS A SMART-SAVE CAN PERSIST, counted straight from the database.
   *
   * Ready rows and private prices are the only durable effects this command
   * has, and both are append-only in practice — a bound row does not go back to
   * NEEDS_REVIEW and a kept price is never deleted here — which is what makes a
   * before/after difference meaningful rather than a race.
   *
   * IT MAY ONLY BE CALLED ONCE AUTHORITY IS PROVEN, and the signature says so:
   * it takes the SERVER-DERIVED workspace and scopes both counts by it, so even
   * a future caller that forgot the check ahead of it cannot read another
   * tenant's rows through this method. The ordering guarantee itself is
   * `loadCallerOwnedBatch` at the top of the command; this is the second lock on
   * the same door, not a substitute for the first.
   *
   * An earlier version took only `batchId` and ran BEFORE any ownership code —
   * two unscoped counts against whatever id the URL carried. Nothing was
   * mutated and no count reached the body, but reading another workspace's rows
   * is already the breach, and "the arithmetic happened not to expose it" is
   * not a boundary anyone should have to re-derive.
   */
  private async measure(
    batchId: string,
    workspaceId: string,
  ): Promise<SmartSavePersistedFacts> {
    const [boundRows, keptPrices] = await Promise.all([
      this.prisma.basicPriceImportRow.count({
        where: {
          batchId,
          status: 'READY_FOR_SUBMISSION',
          batch: { workspaceId },
        },
      }),
      this.prisma.basicPrice.count({
        where: { workspaceId, sourceImportRow: { batchId } },
      }),
    ]);
    return { boundRows, keptPrices };
  }

  /**
   * A measurement that REFUSES TO GUESS. If the database cannot be read at the
   * moment a failure is being explained, the honest answer is that persistence
   * is unknown — not a zero invented so the sentence reads tidily.
   */
  private async measureOrNull(
    batchId: string,
    workspaceId: string,
  ): Promise<SmartSavePersistedFacts | null> {
    try {
      return await this.measure(batchId, workspaceId);
    } catch {
      return null;
    }
  }

  async acceptProvenAndKeepPrivate(params: {
    workspaceId: string;
    batchId: string;
    actor: TrustedBasicPriceActor;
    reviewerAccountId: string;
    excludeRowIds?: readonly string[];
  }): Promise<SmartSaveResult> {
    const { workspaceId, batchId, actor, reviewerAccountId, excludeRowIds } =
      params;

    /**
     * AUTHORITY FIRST — BEFORE ANY OTHER READ OF ANY KIND.
     *
     * The guards on the route prove that this account is a member of this
     * workspace and holds both permissions IN it. They prove NOTHING about the
     * batch id in the URL, because no guard has ever seen it. So the very first
     * thing this command does is ask the ONE ownership authority whether the
     * caller may see this batch at all, and every read below — the measurement,
     * the eligible set, the prices — happens only on the far side of it.
     *
     * The refusal is deliberately indistinguishable from non-existence, so a
     * caller who guesses batch ids learns nothing from the difference between
     * "yours", "someone else's" and "no such thing".
     */
    await loadCallerOwnedBatch(this.prisma, {
      batchId,
      workspaceId,
      accountId: reviewerAccountId,
      notFoundMessage: 'Batch not found',
    });

    // WHERE THIS PRESS STARTED. Taken before anything is attempted, because
    // after a failure there is no way back to it — and without it "there are
    // twelve bindings" cannot be told apart from "this press made twelve".
    const before = await this.measureOrNull(batchId, workspaceId);

    try {
      // BIND FIRST, so the keep step counts rows this very press made ready.
      // Ownership, tenancy, mutability and every identity guard are checked
      // inside — this class re-implements none of them.
      const accepted = await this.resolution.acceptMachineProvenRows(
        workspaceId,
        batchId,
        reviewerAccountId,
        { excludeRowIds },
      );

      // Then materialize whatever is lawfully ready — which includes rows a
      // person had already finished by hand before pressing. Its metadata and
      // provenance assertions are untouched and still fail closed.
      const kept = await this.privateAssets.keepBatchPrivate({
        batchId,
        actor,
      });

      return { batchId, accepted, kept };
    } catch (error) {
      // WHAT SURVIVED. Re-read rather than inferred: step 1's chunks commit as
      // they go, so a failure in step 2 leaves real bindings behind, and the
      // only trustworthy account of them is the database's own.
      const after = await this.measureOrNull(batchId, workspaceId);
      throw buildSmartSaveFailure(
        error,
        classifySmartSavePersistence(before, after),
      );
    }
  }
}
