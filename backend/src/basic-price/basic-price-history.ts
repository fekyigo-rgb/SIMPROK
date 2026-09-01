export const BASIC_PRICE_HISTORY_VERSION =
  'BPUXFINAL01D_BASIC_PRICE_CORRECTION_LINEAGE_V2';

/**
 * BP-UX-FINAL-01D — THE PRICE'S OWN CORRECTION LINEAGE, FROM EXACT PERSISTED
 * POINTERS AND FROM NOTHING ELSE.
 *
 * WHAT THIS IS, STATED BEFORE ANYTHING ELSE, BECAUSE THE NAME WAS THE DEFECT.
 *
 * This file walks `BasicPrice.supersedesBasicPriceId`. That column carries ONE
 * sentence and not a broader one: "a human published this price as an explicit
 * CORRECTION of that exact published price". SIMPROK keeps three different
 * things apart here, and only the first is readable from this pointer:
 *
 *   A. CORRECTION       an observation was WRONG and has been replaced. This is
 *                       the supersession pointer, and `PublishBasicPriceDto`
 *                       says so in as many words: "Correction is an explicit
 *                       act, never an inference."
 *   B. NEW OBSERVATION  a later, equally valid market/source reading. It
 *                       asserts nothing about the earlier one being erroneous,
 *                       and it CARRIES NO POINTER — the same DTO: "an ordinary
 *                       publish states a NEW fact and leaves every prior price
 *                       standing, so a March observation never silently erases
 *                       the January one."
 *   C. CONFLICT         two observations claiming the same factual context and
 *                       contradicting each other. Adjudication, and a separate
 *                       locked gate.
 *
 * SO THIS IS NOT "THE COMPLETE PRICE HISTORY", AND MUST NEVER BE LABELLED AS
 * ONE. A resource whose price has been observed twelve times and corrected
 * never has exactly ONE entry here — which is the truth about its corrections
 * and says nothing at all about its observations. Calling that "no prior price
 * exists" would be an invented absence, which is the same class of lie as an
 * invented fact. Every user-facing surface over this data says RIWAYAT KOREKSI.
 *
 * WHAT MAKES THIS SAFE TO DO IN MEMORY — four facts the DATABASE guarantees,
 * not four assumptions this file makes:
 *
 *   1. AT MOST ONE SUCCESSOR PER PREDECESSOR.
 *      `basic_prices_supersedesBasicPriceId_key` is a UNIQUE index on a
 *      nullable column, so a correction chain cannot fork: A -> B and A -> B'
 *      is refused by PostgreSQL (23505), never merely by application code a
 *      future caller might forget to route through. The lineage is therefore a
 *      LINKED LIST, never a tree, and "the timeline" is well defined.
 *
 *   2. NO CYCLES.
 *      `basic_prices_supersession_not_self_check` refuses A -> A, and the
 *      pointer can only ever be written during a row's own publication
 *      transition, at a predecessor that is ALREADY published. Every arrow
 *      therefore points strictly backwards in publication order, so A -> B -> A
 *      is unreachable (the migration states this proof in full). The visited
 *      guard below is belt to those braces — an impossible state must produce a
 *      bounded answer, never a hang.
 *
 *   3. ONE LOGICAL CONTEXT.
 *      The publication writer refuses `SUPERSESSION_RESOURCE_MISMATCH` and
 *      `SUPERSESSION_REGION_MISMATCH`, so every member of a chain shares the
 *      SAME `resourceId` and the SAME `regionId`. That is what lets the caller
 *      fetch a chain's candidates with ONE bounded query instead of walking the
 *      database one generation at a time.
 *
 *   4. CHAINS ARE CATALOG-ONLY.
 *      A predecessor must be `SIMPROK_CATALOG` and PUBLISHED on both axes, and
 *      a successor must be PUBLISHED on both axes — which a WORKSPACE_PRIVATE
 *      row can never be (`basic_prices_private_never_published_check`). So a
 *      private price's history is exactly one entry, and this walk simply finds
 *      no pointers rather than needing a special case.
 *
 * MEMBERSHIP IS DECIDED BY EXACT ID POINTERS. NOTHING ELSE.
 *
 * The caller's fetch is scoped by resource + region because fact 3 proves that
 * is a SUPERSET of the chain — it is a way to read fewer rows, and it is NOT
 * how membership is decided. A row that shares the resource, the region, the
 * value, the source and the date but is not named by a `supersedesBasicPriceId`
 * pointer is a DIFFERENT observation and never appears in this timeline. There
 * is no same-value inference, no same-resource inference, no nearest-date
 * inference, and no timestamp heuristic anywhere in this file. That is the
 * whole difference between a price history and a plausible story.
 *
 * NOTHING IS ERASED. A predecessor row is never touched by a correction — the
 * successor carries the entire relationship — so every past value is still
 * stored, still readable by id, and still spendable by a calculation that
 * already selected it. This function only ORDERS what persistence already
 * holds.
 */

/** The two fields the walk needs. Anything else is the caller's business. */
export interface SupersessionLineageRow {
  id: string;
  supersedesBasicPriceId: string | null;
}

/**
 * Where a row stands in its own timeline.
 *
 * `SUPERSEDED` is asserted ONLY when a successor is actually present in the
 * lawful row set — never inferred from age, and never from the row's own
 * columns, because a superseded predecessor carries no mark of its own.
 */
export type SupersessionState = 'CURRENT' | 'SUPERSEDED';

export interface SupersessionTimelineEntry<
  TRow extends SupersessionLineageRow,
> {
  row: TRow;
  state: SupersessionState;
}

/**
 * THE WALK'S RESULT, AND THE ONE THING IT MUST SAY ABOUT ITS OWN LIMITS.
 *
 * `truncated` is the difference between "this is the whole correction lineage"
 * and "this is as much of it as could be read". It is COMPUTED, never assumed,
 * from a fact that is exact: the OLDEST entry emitted still names a predecessor
 * that is not in the answer. That happens for exactly two reasons — the
 * caller's bounded fetch did not reach back far enough, or the predecessor is a
 * row this workspace may not read — and both mean the same thing to the person
 * reading the screen: there is more chain than is shown.
 *
 * WHY A FLAG RATHER THAN A BIGGER READ. The alternative to admitting truncation
 * is removing the ceiling, and an unbounded backwards walk is exactly the
 * runaway traversal this read may not become. A bounded answer that says it is
 * bounded is worth more than an unbounded one that claims completeness; the
 * label above it changes from "Riwayat Koreksi" to "Riwayat Koreksi Terbaru"
 * and no false claim is ever printed.
 *
 * IT IS NEVER `true` MERELY BECAUSE THE CEILING EXISTS. A chain of two in a
 * catalog of ten reports `false`, because nothing was left unread.
 */
export interface SupersessionTimeline<TRow extends SupersessionLineageRow> {
  entries: SupersessionTimelineEntry<TRow>[];
  truncated: boolean;
}

/**
 * A hard ceiling on how many generations will be walked.
 *
 * Facts 1 and 2 make an unbounded walk unreachable, so this can never fire in a
 * healthy database. It exists because a read that CANNOT be made to hang is
 * worth more than a read that merely should not — and because a corrupted chain
 * must degrade into a short, honest answer rather than into a stalled request.
 */
export const BASIC_PRICE_HISTORY_MAX_GENERATIONS = 200;

/**
 * Order one supersession chain NEWEST FIRST, starting from any member.
 *
 * The anchor may be the current row, a predecessor deep in history, or a row in
 * no chain at all. All three are ordinary: `GET /basic-prices/:id` has always
 * been a LAWFULNESS question rather than a selection one (a superseded price
 * stays fully readable), so the timeline is built around whichever member the
 * caller happened to open.
 *
 * Returns no entries when the anchor is not in `rows` — an anchor the caller
 * could not lawfully read produces no lineage rather than a partial one, and
 * reports `truncated: false` because nothing was cut short: nothing was read.
 */
export function buildSupersessionTimeline<TRow extends SupersessionLineageRow>(
  anchorId: string,
  rows: readonly TRow[],
): SupersessionTimeline<TRow> {
  const byId = new Map<string, TRow>();
  for (const row of rows) byId.set(row.id, row);

  if (!byId.has(anchorId)) return { entries: [], truncated: false };

  /** predecessorId -> the row that replaced it. Built from exact pointers. */
  const successorOf = new Map<string, TRow>();
  for (const row of rows) {
    if (row.supersedesBasicPriceId) {
      successorOf.set(row.supersedesBasicPriceId, row);
    }
  }

  // 1. Climb FORWARD to the newest member. Opening a predecessor must show the
  //    whole story, including the corrections that came after it — otherwise a
  //    person reading an old price would be shown it as though it were the last
  //    word.
  let newest = byId.get(anchorId)!;
  const climbed = new Set<string>([newest.id]);
  for (let step = 0; step < BASIC_PRICE_HISTORY_MAX_GENERATIONS; step += 1) {
    const successor = successorOf.get(newest.id);
    if (!successor || climbed.has(successor.id)) break;
    climbed.add(successor.id);
    newest = successor;
  }

  // 2. Descend BACKWARD from it, emitting newest -> oldest.
  const entries: SupersessionTimelineEntry<TRow>[] = [];
  const emitted = new Set<string>();
  let cursor: TRow | undefined = newest;
  for (
    let step = 0;
    step < BASIC_PRICE_HISTORY_MAX_GENERATIONS && cursor;
    step += 1
  ) {
    if (emitted.has(cursor.id)) break;
    emitted.add(cursor.id);
    entries.push({
      row: cursor,
      state: successorOf.has(cursor.id) ? 'SUPERSEDED' : 'CURRENT',
    });
    const predecessorId: string | null = cursor.supersedesBasicPriceId;
    // A pointer to a row the caller may not read stops the walk HERE rather
    // than skipping it: an honest short history beats a timeline with an
    // invisible hole in the middle of it.
    cursor = predecessorId ? byId.get(predecessorId) : undefined;
  }

  /**
   * DID THE CHAIN CONTINUE PAST WHERE THIS ANSWER STOPS?
   *
   * Read off the OLDEST entry emitted, which is the only place the walk can
   * have stopped short. If it still names a predecessor, then a correction
   * older than everything shown here exists and this answer does not contain
   * it — whether because the caller's fetch ceiling cut it off, because the
   * generation bound was reached, or because that row is not this workspace's
   * to read. One flag, three causes, one honest consequence.
   *
   * This is an EXACT test, not an estimate: the pointer either exists on a row
   * already in hand or it does not. Nothing is inferred about how much more
   * there is, because nothing can be — and claiming a count would be inventing
   * the very thing the flag exists to admit is unknown.
   */
  const oldest = entries[entries.length - 1];
  return {
    entries,
    truncated: Boolean(oldest?.row.supersedesBasicPriceId),
  };
}
