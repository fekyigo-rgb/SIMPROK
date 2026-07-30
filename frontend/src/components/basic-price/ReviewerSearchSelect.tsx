import { useEffect, useRef, useState } from 'react';
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
 * to ACTIVE User→Membership→Account humans in the caller's workspace. No raw
 * UUID entry is possible; the userId is only the internal selector value.
 */
export function ReviewerSearchSelect({ selected, disabled = false, onSelect }: ReviewerSearchSelectProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ReviewerIdentity[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'ready' | 'error'>('idle');
  const [hasInteracted, setHasInteracted] = useState(false);
  const requestGate = useRef(createLatestRequestGate());

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

  const changeQuery = (value: string) => {
    setHasInteracted(true);
    requestGate.current.invalidate();
    setResults([]);
    setState('idle');
    onSelect(null);
    setQuery(value);
  };

  return (
    <fieldset disabled={disabled} style={{ minWidth: '280px', padding: '10px' }}>
      <legend>Reviewer tujuan</legend>
      <label>
        Cari reviewer aktif
        <input
          type="search"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          placeholder="Ketik nama atau email"
        />
      </label>
      <button type="button" onClick={() => { setHasInteracted(true); void runSearch(''); }}>
        Tampilkan reviewer
      </button>
      {state === 'loading' ? <p role="status">Mencari reviewer...</p> : null}
      {state === 'empty' ? <p>Tidak ada reviewer aktif yang cocok.</p> : null}
      {state === 'error' ? <p role="alert">Gagal memuat reviewer. Silakan coba lagi.</p> : null}
      {state === 'ready' ? (
        <ul aria-label="Hasil pencarian Reviewer">
          {results.map((reviewer) => (
            <li key={reviewer.userId}>
              <button type="button" onClick={() => { onSelect(reviewer); setState('idle'); }}>
                {reviewerLabel(reviewer)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {selected ? (
        <div role="status">
          <strong>Terpilih:</strong> {reviewerLabel(selected)}
          <button type="button" onClick={() => onSelect(null)}>Ganti reviewer</button>
        </div>
      ) : (
        <p>Belum ada reviewer dipilih (kosongkan untuk melepas penugasan).</p>
      )}
    </fieldset>
  );
}
