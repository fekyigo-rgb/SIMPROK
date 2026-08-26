import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * WHAT A FAILED `Simpan & Gunakan` IS ALLOWED TO CLAIM ABOUT PERSISTENCE.
 *
 * THE DEFECT THIS FILE EXISTS FOR. `smart-save` is ONE product command and
 * deliberately NOT one transaction: step 1 binds proven rows in bounded chunks
 * that each commit on their own, and step 2 materializes prices in a single
 * transaction of its own. That design is healthy — it is what makes a retry
 * continue from committed truth instead of redoing work — but it means a
 * failure in step 2 happens AFTER step 1's commits are already durable.
 *
 * The browser, meanwhile, reported every smart-save failure through the generic
 * private-use vocabulary, whose sentences end `Tidak ada yang tersimpan.` and
 * `Tidak ada yang tersimpan sebagian.` Those are the sentences of an atomic
 * command. Said about this one they are simply false: thirteen bindings can be
 * in the database while the reviewer is being told nothing was saved. A person
 * who believes that will re-review rows SIMPROK has already decided, or abandon
 * a batch that is most of the way home.
 *
 * SO THE REPAIR IS THE TRUTH CONTRACT, NOT THE ARCHITECTURE. Nothing here
 * widens a transaction, batches a chunk differently or removes the idempotence
 * that makes retrying safe. What it adds is an obligation: a failed smart-save
 * must state what it actually knows about persistence, and may state certainty
 * ONLY when certainty was measured.
 *
 * THREE ANSWERS, AND ONLY ONE OF THEM IS A GUESS-FREE ZERO.
 *
 *   NONE     Measured. The counts before and after are equal, so this command
 *            persisted nothing and the UI may say so.
 *   PARTIAL  Measured. Something this press did survived the failure. The UI
 *            must say what, and must not claim a clean slate.
 *   UNKNOWN  Not measured — the re-read itself failed, or the request never
 *            reached a point where a measurement exists. The UI must say it
 *            does not know, which is the one honest thing left.
 *
 * COUNTS ARE DELTAS, AND DELTAS ARE MEASURED TWICE. A batch may already hold
 * rows a human finished by hand before this press, so "there are bindings" is
 * not evidence that THIS press made any. Both facts are counted before the
 * command runs and counted again after it fails, and only the difference is
 * ever reported.
 */
export const SMART_SAVE_INTERRUPTED = 'SMART_SAVE_INTERRUPTED';

export type SmartSavePersistence = 'NONE' | 'PARTIAL' | 'UNKNOWN';

/** One measurement of the two facts a smart-save can persist. */
export interface SmartSavePersistedFacts {
  /** Rows of this batch that are bound and ready. */
  boundRows: number;
  /** Private prices that exist for this batch's rows. */
  keptPrices: number;
}

/**
 * The envelope a failed smart-save adds to whatever the underlying error
 * already said. Counts appear ONLY on `PARTIAL`, because they are the only
 * state in which a count is both known and worth a person's attention.
 */
export interface SmartSaveFailureEnvelope {
  persistence: SmartSavePersistence;
  /** Rows this press bound that survived the failure. Omitted unless PARTIAL. */
  boundRowsDelta?: number;
  /** Prices this press created that survived the failure. Omitted unless PARTIAL. */
  keptPricesDelta?: number;
}

export interface SmartSaveFailureBody {
  /** Whatever else the original refusal carried, e.g. an implied source type. */
  [detail: string]: unknown;
  /**
   * The named reason, in the field every other Basic Price refusal already uses
   * so the browser's existing `namedCodeOf` reads it without a second rule.
   * A domain refusal keeps ITS OWN name — a reviewer who is missing an
   * effective date must still be told that, not told "interrupted" — and only a
   * fault with no name of its own becomes `SMART_SAVE_INTERRUPTED`.
   */
  message: string;
  smartSave: SmartSaveFailureEnvelope;
}

/**
 * Reads the named code out of an already-thrown Nest exception, if it has one.
 *
 * Deliberately narrow: `ConflictException('BATCH_NOT_MUTABLE')` and the richer
 * object bodies `keepBatchPrivate` throws both put the code where the rest of
 * this module looks for it, and anything else is treated as unnamed rather than
 * mined for a sentence it never promised.
 */
const namedCodeOf = (error: unknown): string | null => {
  if (!(error instanceof HttpException)) return null;
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    const message = (response as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return null;
};

/**
 * TURNS A MEASUREMENT INTO A VERDICT. Two equal readings prove NONE; any
 * increase proves PARTIAL; a missing reading is UNKNOWN and never anything
 * better. A DECREASE is impossible for two append-only facts, and if it ever
 * happens the measurement is not trustworthy — so it reads UNKNOWN rather than
 * being clamped to zero and reported as a certainty.
 */
export const classifySmartSavePersistence = (
  before: SmartSavePersistedFacts | null,
  after: SmartSavePersistedFacts | null,
): SmartSaveFailureEnvelope => {
  if (!before || !after) return { persistence: 'UNKNOWN' };
  const boundRowsDelta = after.boundRows - before.boundRows;
  const keptPricesDelta = after.keptPrices - before.keptPrices;
  if (boundRowsDelta < 0 || keptPricesDelta < 0)
    return { persistence: 'UNKNOWN' };
  if (boundRowsDelta === 0 && keptPricesDelta === 0)
    return { persistence: 'NONE' };
  return { persistence: 'PARTIAL', boundRowsDelta, keptPricesDelta };
};

/**
 * Whatever else the original refusal said about itself.
 *
 * SOME REFUSALS CARRY MORE THAN A CODE. `keepBatchPrivate` raises an incoherent
 * source classification as an object that also names the ONE type the stated
 * origin implies — the fact that actually lets a person fix it. Rebuilding the
 * body from the code alone silently threw that away, and because `smart-save`
 * is now the ONLY route the review room presses, it threw it away on the whole
 * product path. So the original object is carried through and the envelope is
 * added to it.
 *
 * A STRING BODY CONTRIBUTES NOTHING EXTRA, and a non-HttpException has nothing
 * to contribute at all; both yield an empty object rather than a guess.
 */
const detailsOf = (error: unknown): Record<string, unknown> => {
  if (!(error instanceof HttpException)) return {};
  const response = error.getResponse();
  if (!response || typeof response !== 'object') return {};
  return { ...(response as Record<string, unknown>) };
};

/**
 * The exception a failed smart-save actually throws.
 *
 * THE ORIGINAL STATUS SURVIVES. A 409 that names a missing effective date is
 * still a 409 naming a missing effective date; this only appends what the
 * command knows about persistence. Promoting every failure to 500 would hide a
 * reason the reviewer can act on behind a fault they cannot.
 *
 * `message` AND `smartSave` ARE WRITTEN LAST, so the command's own two facts
 * can never be overwritten by a field that happened to share their name.
 */
export const buildSmartSaveFailure = (
  error: unknown,
  envelope: SmartSaveFailureEnvelope,
): HttpException => {
  const status =
    error instanceof HttpException
      ? error.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  const body: SmartSaveFailureBody = {
    ...detailsOf(error),
    message: namedCodeOf(error) ?? SMART_SAVE_INTERRUPTED,
    smartSave: envelope,
  };
  return new HttpException(body, status);
};
