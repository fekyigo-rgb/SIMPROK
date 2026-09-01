import { useEffect, useState } from 'react';
import {
  BasicPriceExplorerError,
  fetchBasicPriceDetail,
  type BasicPriceDetail,
} from '../../api/basicPriceExplorer';

export type BasicPriceDetailState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; detail: BasicPriceDetail }
  | { kind: 'error'; status: number };

/**
 * BP-UX-FINAL-01C — ONE LAWFUL DETAIL READ, FETCHED ON DEMAND, SHARED.
 *
 * WHY A HOOK RATHER THAN A FETCH IN EACH COMPONENT. The freshness layer and the
 * Detail panel ask the SAME question about the SAME price, and a person very
 * often opens both. Two components each owning their own request would double
 * the traffic and — worse — could render two different answers for one row if a
 * correction landed between them.
 *
 * WHY IT IS NEVER CALLED FROM THE LIST. `basicPriceId` is null until a person
 * actually opens something. Prefetching a history for twenty rows nobody
 * expanded would turn one paginated list request into twenty-one on every page
 * load — the N+1 this read is explicitly forbidden to introduce. The Explorer
 * stays exactly one request.
 *
 * THE CACHE IS A MEMO, NOT A STORE. Module-level, keyed by id, holding only
 * what the server already returned. It is never written to by the UI, never
 * merged, and never used to answer a question the server was not asked — so it
 * cannot drift into a second source of truth. It lives for the page session; a
 * reload re-reads everything from the server.
 */
const detailCache = new Map<string, BasicPriceDetail>();

/** The one shared instance, so an idle result is referentially stable. */
const IDLE: BasicPriceDetailState = { kind: 'idle' };
const LOADING: BasicPriceDetailState = { kind: 'loading' };

interface FetchOutcome {
  id: string;
  epoch: number;
  state: BasicPriceDetailState;
}

export function useBasicPriceDetail(
  basicPriceId: string | null,
  epoch = 0,
): BasicPriceDetailState {
  const [outcome, setOutcome] = useState<FetchOutcome | null>(null);

  /**
   * NOTHING IS SET SYNCHRONOUSLY IN THIS EFFECT, DELIBERATELY.
   *
   * `idle`, `loading` and a cache HIT are all DERIVED below during render —
   * they are facts about the arguments, not state that needs storing, and
   * writing them here would be the cascading-render pattern React warns about.
   * The only `setState` is inside the async callback, after a real network
   * answer, which is the same discipline the Explorer's own debounced read uses.
   */
  useEffect(() => {
    if (!basicPriceId) return;
    // epoch 0 may reuse the memo. A later epoch is a deliberate re-read after
    // a human write, so a stale memo must not answer.
    if (epoch === 0 && detailCache.has(basicPriceId)) return;

    const controller = new AbortController();

    void (async () => {
      try {
        const detail = await fetchBasicPriceDetail(basicPriceId, controller.signal);
        if (controller.signal.aborted) return;
        detailCache.set(basicPriceId, detail);
        setOutcome({ id: basicPriceId, epoch, state: { kind: 'ready', detail } });
      } catch (error) {
        // An abort is not a failure — the person closed the layer or moved to
        // another row, and reporting an error there would blame them for it.
        if (controller.signal.aborted) return;
        setOutcome({
          id: basicPriceId,
          epoch,
          state: {
            kind: 'error',
            status: error instanceof BasicPriceExplorerError ? error.status : 0,
          },
        });
      }
    })();

    return () => controller.abort();
  }, [basicPriceId, epoch]);

  if (!basicPriceId) return IDLE;

  // A cache hit answers without any state at all, so reopening a layer is
  // instant and costs no request. After a write, epoch > 0 waits for the
  // matching fetch rather than flashing the pre-write memo.
  const cached = detailCache.get(basicPriceId);
  if (cached && epoch === 0) return { kind: 'ready', detail: cached };

  // An outcome from a PREVIOUS id or epoch must never be shown against this one.
  if (outcome && outcome.id === basicPriceId && outcome.epoch === epoch) {
    return outcome.state;
  }

  return LOADING;
}

/**
 * Test-only reset. Exported because a module-level cache that cannot be cleared
 * makes every test after the first one depend on the ones before it.
 */
export function __clearBasicPriceDetailCache(): void {
  detailCache.clear();
}

/** Drop one memo so the next epoch re-reads the lawful detail projection. */
export function forgetBasicPriceDetail(basicPriceId: string): void {
  detailCache.delete(basicPriceId);
}
