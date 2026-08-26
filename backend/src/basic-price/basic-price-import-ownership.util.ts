import { NotFoundException } from '@nestjs/common';

/**
 * User-owned import boundary (Owner Decision: ONE SIMPROK BASIC PRICE
 * PRODUCT MODEL): a user's own import-batch lifecycle (view/update batch,
 * resolve/reject/candidate-lookup a row, submit batch) is scoped to the
 * account that uploaded it. A same-workspace teammate who also holds
 * BASIC_PRICE_IMPORT/_RESOLVE/_SUBMIT must not read or mutate someone
 * else's batch — that authority belongs to the separate, internal
 * PriceSubmission curation queue (BASIC_PRICE_REVIEW_VIEW/_VERIFY/_PUBLISH),
 * not to this route family.
 *
 * Fails closed with the same "not found" message already used for a
 * workspace mismatch, so ownership denial is never distinguishable from
 * plain non-existence (no batch/row enumeration signal).
 */
export function assertBatchOwnedByCaller(
  batch: { uploadedByAccountId: string },
  currentAccountId: string,
  notFoundMessage: string,
): void {
  if (batch.uploadedByAccountId !== currentAccountId) {
    throw new NotFoundException(notFoundMessage);
  }
}

/** The two facts the authority above needs, plus what callers gate on next. */
export interface CallerOwnedBatch {
  id: string;
  workspaceId: string;
  uploadedByAccountId: string;
  status: string;
}

/**
 * The smallest client this needs. Structural rather than `PrismaService`, so a
 * transaction client and a unit test's double both satisfy it without this
 * module reaching for the Nest container.
 */
export interface BatchOwnershipReader {
  basicPriceImportBatch: {
    findUnique(args: {
      where: { id: string };
      select: {
        id: true;
        workspaceId: true;
        uploadedByAccountId: true;
        status: true;
      };
    }): Promise<CallerOwnedBatch | null>;
  };
}

/**
 * THE FIRST QUERY ANY BATCH COMMAND MAY ISSUE.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. It is NOT a second ownership law: the
 * verdict is still `assertBatchOwnedByCaller` above, unchanged and uncopied.
 * What it adds is the step that verdict always silently depended on — actually
 * LOADING the batch and comparing its tenant — so a command can prove authority
 * before it reads anything else, instead of proving it somewhere in the middle.
 *
 * IT EXISTS BECAUSE ORDER IS PART OF THE LAW. `smart-save` measured a batch's
 * bindings and prices by naked `batchId` and only afterwards called the command
 * whose own first act is this check. Every guard in front of the route was
 * doing its job — a caller must hold both permissions IN a workspace they are a
 * member of — but no guard knows anything about a batch id in a URL, so a
 * member of workspace A could name a batch of workspace B and have two counts
 * run against it before a single line of ownership code executed. Nothing was
 * mutated and, as it happened, no count reached the response body; that is
 * luck about today's classification arithmetic, not a boundary. A read of
 * another tenant's rows is already the breach.
 *
 * BOTH REFUSALS ARE THE SAME REFUSAL. A batch that does not exist, a batch in
 * another workspace and a teammate's batch in this one all raise the identical
 * `NotFoundException` with the caller-supplied message, so no probe can tell
 * them apart and no batch id can be enumerated.
 */
export async function loadCallerOwnedBatch(
  client: BatchOwnershipReader,
  params: {
    batchId: string;
    workspaceId: string;
    accountId: string;
    notFoundMessage: string;
  },
): Promise<CallerOwnedBatch> {
  const batch = await client.basicPriceImportBatch.findUnique({
    where: { id: params.batchId },
    select: {
      id: true,
      workspaceId: true,
      uploadedByAccountId: true,
      status: true,
    },
  });
  // TENANT FIRST. The workspace compared against is the SERVER-DERIVED one the
  // permissions guard resolved; a client body, query or header claim never
  // reaches this line.
  if (!batch || batch.workspaceId !== params.workspaceId) {
    throw new NotFoundException(params.notFoundMessage);
  }
  assertBatchOwnedByCaller(batch, params.accountId, params.notFoundMessage);
  return batch;
}
