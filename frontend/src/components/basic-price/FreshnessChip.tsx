import { useEffect, useId, useRef, useState } from 'react';
import {
  CORRECTION_HISTORY_PARTIAL_NOTE,
  CORRECTION_HISTORY_UNAVAILABLE,
  FRESHNESS_VIEW_LABELS,
  NO_CORRECTION_RECORDED,
  anchorCorrectionRow,
  correctionHistoryLabel,
  correctionHistoryRows,
  freshnessMeaning,
  freshnessView,
  type FreshnessFacts,
  type TemporalContext,
} from '../../utils/basicPriceFreshness';
import { useBasicPriceDetail } from './useBasicPriceDetail';

interface FreshnessChipProps {
  facts: FreshnessFacts;
  /** The row this chip belongs to, so the layer can name what it is about. */
  basicPriceId: string;
  resourceName: string;
  formatDate: (iso: string) => string;
  /**
   * The instant — and the KIND of instant — this whole screen answers for.
   * Handed down rather than resolved here, so the chip speaks in the same tense
   * the list was filtered in. See `basicPriceFreshness.ts`.
   */
  temporal: TemporalContext;
}

/**
 * BP-UX-FINAL-01C §9/§11 — THE CLICKABLE FRESHNESS LAYER, NOW OVER REAL HISTORY.
 *
 * The chip states one of two words. Pressing it opens a light anchored layer
 * that answers exactly TWO questions and no others:
 *
 *   1. what does this freshness state mean, ON THE DAY BEING ASKED ABOUT;
 *   2. how has this price been CORRECTED.
 *
 * THE LINEAGE IS NOW READ, NOT DECLARED MISSING. The previous version rendered
 * one synthetic "current" row and a sentence saying the screen could not read
 * the past — honest at the time, because no API exposed the lineage. It does
 * now (`GET /basic-prices/:id/detail`), and this layer consumes it: exact
 * `supersedesBasicPriceId` lineage, newest first, `Saat ini` / `Digantikan`.
 *
 * AND IT IS CALLED A CORRECTION HISTORY, WHICH IS THE ONLY THING IT IS. That
 * pointer records an explicit human claim that a published price was WRONG and
 * has been replaced. A genuinely later observation of the same market carries
 * no pointer, so it is not in here — and a heading saying "riwayat harga" would
 * have turned an empty lineage into the false statement "this resource has no
 * earlier price".
 *
 * FETCHED ONLY WHEN OPENED. `useBasicPriceDetail` is passed null until the
 * layer is actually open, so twenty collapsed chips cost zero requests. While
 * the read is in flight the layer shows the one entry the ROW ITSELF proves —
 * its own real date and its own real money — rather than a spinner over an
 * empty box or, worse, a guessed past.
 *
 * WHAT IS DELIBERATELY NOT IN HERE.
 *
 * No current-price field, no source field, no price-date field and no region
 * field — all four already sit on the row this chip is anchored to, and
 * repeating them turns a small explanation into a second detail page. The
 * history rows do carry a date and an amount, which is not the same thing: that
 * pairing IS the history, and without it there is nothing to show.
 *
 * And NO ACTION. No edit, no publish, no correction, no approval. Governance
 * acts belong to the rooms that hold the authority for them; a tooltip that
 * could change a published price would be authority arriving through the back
 * door.
 */
export function FreshnessChip({
  facts,
  basicPriceId,
  resourceName,
  formatDate,
  temporal,
}: FreshnessChipProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const view = freshnessView(facts);
  const label = FRESHNESS_VIEW_LABELS[view];

  // Null while closed: a collapsed chip must cost nothing.
  const detail = useBasicPriceDetail(open ? basicPriceId : null);

  /*
   * A LAYER THAT CANNOT BE DISMISSED IS A MODAL WEARING A POPOVER'S CLOTHES.
   * Escape returns focus to the chip that opened it, so a keyboard reader is
   * never dropped at the top of the document; an outside press closes without
   * moving focus, because the person has already looked elsewhere.
   */
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  /*
   * THE SCREEN'S OWN INSTANT, NOT A FRESH ONE.
   *
   * This used to call `new Date()` here. In an AS-OF lens that produced two
   * clocks on one screen: the row was selected for the day the person asked
   * about, and then described as of today. `temporal` carries the SAME instant
   * the server filtered on, and the mode decides whether the wording may give
   * present-tense field advice at all.
   */
  const meaning = open ? freshnessMeaning(facts, temporal, formatDate) : null;
  const corrections = detail.kind === 'ready' ? detail.detail.corrections : null;
  const rows = corrections
    ? correctionHistoryRows(corrections.entries, formatDate)
    : [anchorCorrectionRow(facts, formatDate)];

  return (
    <span className="bp-pop" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`bp-chip ${view === 'TERKINI' ? 'bp-chip--fresh' : 'bp-chip--recheck'}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        title={`Status: ${label} — klik untuk penjelasan dan riwayat koreksi`}
      >
        {/*
          STATUS IS NEVER COLOUR ALONE (§22/G4). The dot is decoration; the word
          beside it carries the whole meaning, so a reader who cannot separate
          green from gold loses nothing.
        */}
        <span className="bp-chip__dot" aria-hidden="true" />
        {label}
      </button>

      {open && meaning ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={`Status harga ${resourceName}`}
          className="bp-pop__panel"
        >
          <p className="bp-pop__title">{meaning.headline}</p>
          <p className="bp-pop__body">{meaning.body}</p>

          {meaning.reasons.length > 0 ? (
            <ul className="bp-pop__reasons">
              {meaning.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}

          <div className="bp-pop__section">
            {/*
              NAMED FOR WHAT IT IS (GAP-A). This lineage comes from exact
              `supersedesBasicPriceId` pointers, which record CORRECTIONS and
              nothing else — a later, equally valid observation carries no
              pointer and is not here. "Riwayat harga" over this data promised a
              completeness the column cannot give. When the server's bounded
              read stopped short it says "Terbaru" instead, which is the only
              honest heading for a partial answer.
            */}
            <span className="bp-pop__label">
              {correctionHistoryLabel(Boolean(corrections?.truncated))}
            </span>
            <div className="bp-history">
              {rows.map((entry) => (
                <div className="bp-history__row" key={entry.key}>
                  <span className="bp-history__date">{entry.date}</span>
                  <span className="bp-history__price">{entry.price}</span>
                  <span className="bp-history__tag">{entry.tag}</span>
                </div>
              ))}
            </div>
            {/*
              FOUR HONEST STATES, AND NO FIFTH.

              loading — the anchor row above is already real; nothing is claimed
                        about a past that has not arrived yet.
              error   — said plainly. A silent single row would read as "this
                        price has never been corrected", which is a claim, not a
                        silence.
              ready + one entry — the lineage really is one long. Said in the
                        one sentence that is provable, and NOT extended into
                        "there is no earlier price", which this data cannot say.
              ready + more      — the lineage itself, whole or labelled partial.
            */}
            {detail.kind === 'loading' ? (
              <p className="bp-pop__body bp-muted" role="status">
                Memuat riwayat koreksi...
              </p>
            ) : null}
            {detail.kind === 'error' ? (
              <p className="bp-pop__body bp-muted" role="status">
                {CORRECTION_HISTORY_UNAVAILABLE}
              </p>
            ) : null}
            {corrections?.truncated ? (
              <p className="bp-pop__body bp-muted">
                {CORRECTION_HISTORY_PARTIAL_NOTE}
              </p>
            ) : null}
            {corrections &&
            corrections.entries.length === 1 &&
            !corrections.truncated ? (
              <p className="bp-pop__body bp-muted">{NO_CORRECTION_RECORDED}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </span>
  );
}
