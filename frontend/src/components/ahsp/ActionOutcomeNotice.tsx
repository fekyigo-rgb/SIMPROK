import type { ActionOutcome, OutcomeTone } from '../../utils/ahspActionFeedback';
import '../../styles/ahsp.css';

/**
 * ACG-01 OWNER BROWSER GAP — the ONE way an AHSP action's outcome is shown,
 * right where the action was pressed. It renders the lines the feedback module
 * wrote and nothing of its own: no copy, no endpoint, no state.
 *
 * A success is a polite status; a failure or partial save is an alert, so an
 * assistive reader hears it at once. It never floats over the page, so it can
 * never cover the action it reports on.
 */

const LINE_CLASS: Readonly<Record<OutcomeTone, string>> = {
  SUCCESS: 'ahsp-outcome__line ahsp-outcome__line--success',
  PENDING: 'ahsp-outcome__line ahsp-outcome__line--pending',
  FAILURE: 'ahsp-outcome__line ahsp-outcome__line--failure',
  NOTE: 'ahsp-outcome__line',
};

type Props = {
  outcome: ActionOutcome;
  /** Named when the item it reports on is no longer on screen. */
  title?: string;
  onDismiss?: () => void;
};

export function ActionOutcomeNotice({ outcome, title, onDismiss }: Props) {
  return (
    <div
      className={'ahsp-outcome ahsp-outcome--' + outcome.kind.toLowerCase()}
      role={outcome.kind === 'SUCCESS' ? 'status' : 'alert'}
    >
      <div className="ahsp-outcome__lines">
        {title ? <span className="ahsp-outcome__line" style={{ fontWeight: 600 }}>{title}</span> : null}
        {outcome.lines.map((line, index) => (
          <span key={index} className={LINE_CLASS[line.tone]}>
            {line.text}
          </span>
        ))}
      </div>
      {onDismiss ? (
        <button type="button" className="ahsp-action ahsp-action--quiet ahsp-action--compact" onClick={onDismiss}>
          Tutup
        </button>
      ) : null}
    </div>
  );
}

export default ActionOutcomeNotice;
