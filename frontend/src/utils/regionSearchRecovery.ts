/**
 * REGION SEARCH RECOVERY — the proven dead-end after clear/cancel.
 *
 * The combobox stores leftover `results` and flips `state` to `idle` on
 * select. Clear then closed the list without resetting that pair. Focus
 * skipped search because `results.length > 0`, and the open panel rendered
 * nothing (only loading/empty/error/ready paint a body). Typing still
 * worked; recovery after × did not. This module is the one statement of
 * when search must run again. Both existing selectors consume it. It is
 * not a second selector.
 */

export type RegionSearchPanelState =
  | 'idle'
  | 'loading'
  | 'empty'
  | 'ready'
  | 'error';

export const REGION_SEARCH_PLACEHOLDER = 'Ketik nama wilayah...';

/**
 * After the human clears a chosen Region, the field must be immediately
 * searchable: empty query, list open, and a fresh lookup of existing
 * Regions. No leftover results. No closed panel.
 */
export function regionSearchAfterClear(): {
  query: '';
  open: true;
  reload: true;
} {
  return { query: '', open: true, reload: true };
}

/**
 * Focus on an empty field must reload when the panel cannot currently show
 * candidates. A selection still occupies the field, so focus does not
 * replace it with a search.
 */
export function regionSearchShouldReloadOnFocus(facts: {
  hasSelection: boolean;
  panelState: RegionSearchPanelState;
}): boolean {
  if (facts.hasSelection) return false;
  return facts.panelState === 'idle' || facts.panelState === 'error';
}
