import { useEffect, useId, useRef, useState } from 'react';
import { fetchReviewerCandidates, type ReviewerIdentity } from '../../api/basicPriceWorkflow';
import { reviewerLabel } from '../../utils/basicPriceWorkflowDisplay';
import { createLatestRequestGate } from '../../utils/catalogSearch';

interface ReviewerSearchSelectProps {
  selected: ReviewerIdentity | null;
  disabled?: boolean;
  onSelect: (reviewer: ReviewerIdentity | null) => void;
}

/**
 * RM-02D2A2 — reassign reviewer selector. Only ever lists candidates returned
 * by GET /basic-price-reviews/reviewer-candidates, which the backend restricts
 * to ACTIVE User -> Membership -> Account humans in the caller's workspace. No
 * raw UUID entry is possible; the userId is only the internal selector value.
 *
 * BP-UX-FINAL-01 §20 — the third selector in this room brought to the same
 * shape as the other two. Same endpoint, same gate, same states; one control
 * instead of a bordered panel, so the reassign card is a card rather than a
 * page. An empty selection still says what an empty selection MEANS here —
 * releasing the assignment — because that is a real, deliberate choice and not
 * merely a blank field.
 */
export function ReviewerSearchSelect({ selected, disabled = false, onSelect }: ReviewerSearchSelectProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReviewerIdentity[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'ready' | 'error'>('idle');
  const [hasInteracted, setHasInteracted] = useState(false);
  const [open, setOpen] = useState(false);
  const requestGate = useRef(createLatestRequestGate());
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const runSearch = async (searchQuery: string) => {
    const sequence = requestGate.current.begin();
    setState('loading');
    try {
      const items = await fetchReviewerCandidates(searchQuery || undefined);
      if (!requestGate.current.isLatest(sequence)) return;
      setResults(items);
      setState(items.length === 0 ? 'empty' : 'ready');
    } catch {
      if (!requestGate.current.isLatest(sequence)) return;
      setResults([]);
      setState('error');
    }
  };

  useEffect(() => {
    if (!hasInteracted || query.trim().length < 1) return;
    const timer = window.setTimeout(() => void runSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query, hasInteracted]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
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

  const changeQuery = (value: string) => {
    setHasInteracted(true);
    requestGate.current.invalidate();
    setResults([]);
    setState('idle');
    onSelect(null);
    setQuery(value);
    setOpen(true);
  };

  return (
    <div className="bp-field" ref={rootRef}>
      <label className="bp-field__label" htmlFor={`${listId}-input`}>
        Reviewer tujuan
      </label>
      <div className="bp-pop">
        <input
          id={`${listId}-input`}
          type="search"
          className="bp-input"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          disabled={disabled}
          value={selected ? reviewerLabel(selected) : query}
          placeholder="Ketik nama atau email"
          onFocus={() => {
            setHasInteracted(true);
            setOpen(true);
            if (!selected && state === 'idle' && results.length === 0) void runSearch('');
          }}
          onChange={(event) => changeQuery(event.target.value)}
        />
        {selected ? (
          <button
            type="button"
            className="bp-btn bp-btn--link bp-region-clear"
            disabled={disabled}
            onClick={() => {
              onSelect(null);
              setQuery('');
              setOpen(false);
            }}
            title="Ganti reviewer"
            aria-label="Ganti reviewer"
          >
            ×
          </button>
        ) : null}

        {open ? (
          <div className="bp-pop__panel bp-pop__panel--list">
            {state === 'loading' ? (
              <p className="bp-pop__body" role="status">
                Mencari reviewer...
              </p>
            ) : null}
            {state === 'empty' ? (
              <p className="bp-pop__body">Tidak ada reviewer aktif yang cocok.</p>
            ) : null}
            {state === 'error' ? (
              <p className="bp-pop__body" role="alert">
                Gagal memuat reviewer. Silakan coba lagi.
              </p>
            ) : null}
            {state === 'ready' ? (
              <ul id={listId} role="listbox" aria-label="Hasil pencarian Reviewer" className="bp-optionlist">
                {results.map((reviewer) => (
                  <li key={reviewer.userId} role="option" aria-selected={selected?.userId === reviewer.userId}>
                    <button
                      type="button"
                      className="bp-option"
                      onClick={() => {
                        onSelect(reviewer);
                        setQuery('');
                        setState('idle');
                        setOpen(false);
                      }}
                    >
                      {reviewerLabel(reviewer)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      {!selected ? (
        <span className="bp-field__help">
          Kosongkan untuk melepas penugasan reviewer.
        </span>
      ) : null}
    </div>
  );
}
