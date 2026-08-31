import { journeyView, type JourneyStage } from '../../utils/basicPriceJourney';
import type { BasicPriceImportBatchSummary } from '../../utils/basicPriceImportDisplay';

interface BasicPriceJourneyStepperProps {
  batch: BasicPriceImportBatchSummary | null;
}

/**
 * BP-UX-FINAL-01 §12 — ONE RESTRAINED WORKFLOW INDICATOR, SHARED BY BOTH
 * IMPORT ROOMS.
 *
 * It is a PROJECTION of canonical truth and holds no state of its own: every
 * verdict comes from `journeyView`, which reads only fields the batch endpoint
 * already sends. Nothing here can move a batch, and nothing here is persisted
 * so that the bar can look tidy.
 *
 * ONE LINE, NO GRAPHICS, NO CELEBRATION. It sits under the header of the
 * import page and the row-review page so a person crossing between them keeps
 * the same thread, and it costs a single row of the viewport rather than the
 * tall banner a six-stage wizard usually demands (§21).
 */
export function BasicPriceJourneyStepper({ batch }: BasicPriceJourneyStepperProps) {
  const view = journeyView(batch);

  return (
    <div className="bp-stack bp-stack--tight">
      {/*
        BP-UX-FINAL-01C §G1 — ONLY <li> MAY BE A CHILD OF <ol>.

        The connector used to be a bare <span> sitting between list items, with
        a Fragment holding the pair. That is invalid list structure: assistive
        technology counts the children of a list, and a stray span either breaks
        the count or is announced as content. The separator is now drawn by the
        item's own ::before, so the markup is six list items and nothing else,
        and the visual line is unchanged.
      */}
      <ol className="bp-steps" aria-label="Perjalanan harga: dari berkas sampai diterbitkan">
        {view.stages.map((stage, index) => (
          <li
            key={stage.key}
            className={`bp-step ${stateClass(stage.state)}${index > 0 ? ' bp-step--linked' : ''}`}
            title={stage.hint}
          >
            <span className="bp-step__mark" aria-hidden="true">
              {mark(stage, index)}
            </span>
            {/*
              THE STATE IS SPOKEN, NEVER LEFT TO THE COLOUR (§G4). A screen
              reader hears "Lengkapi Sumber — sedang berjalan"; a sighted reader
              sees the same words on hover.
            */}
            <span>
              {stage.label}
              {stage.optional ? <span className="bp-muted"> (opsional)</span> : null}
            </span>
            <span className="bp-visually-hidden">{` — ${stateWord(stage.state)}. ${stage.hint}`}</span>
          </li>
        ))}
      </ol>
      {view.note ? <p className="bp-note bp-note--info">{view.note}</p> : null}
    </div>
  );
}

const stateClass = (state: JourneyStage['state']): string => {
  if (state === 'DONE') return 'bp-step--done';
  if (state === 'CURRENT') return 'bp-step--current';
  if (state === 'ATTENTION') return 'bp-step--attention';
  return '';
};

/**
 * `·` for a stage that will not happen for this batch, and that is the whole
 * point of the NOT_OFFERED state: a number would promise a step that is coming.
 */
const mark = (stage: JourneyStage, index: number): string => {
  if (stage.state === 'DONE') return '✓';
  if (stage.state === 'ATTENTION') return '!';
  if (stage.state === 'NOT_OFFERED') return '·';
  return String(index + 1);
};

const stateWord = (state: JourneyStage['state']): string => {
  if (state === 'DONE') return 'selesai';
  if (state === 'CURRENT') return 'sedang berjalan';
  if (state === 'ATTENTION') return 'perlu perhatian';
  if (state === 'NOT_OFFERED') return 'tidak berlaku untuk batch ini';
  return 'belum dimulai';
};
