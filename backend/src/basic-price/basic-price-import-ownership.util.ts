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
