import { useEffect, useRef, useState } from 'react';
import { searchRegions, type RegionLookupItem } from '../../api/basicPriceWorkflow';
import { regionOptionLabel } from '../../utils/basicPriceWorkflowDisplay';
import { createLatestRequestGate } from '../../utils/catalogSearch';

interface RegionSearchSelectProps {
  selected: RegionLookupItem | null;
  disabled?: boolean;
  onSelect: (region: RegionLookupItem | null) => void;
}

/**
 * RM-02D2A2 — canonical Region selector for the import flow. Replaces the old
 * raw-UUID text field: a human searches by code or name and picks a
 * "code — name" candidate; the UUID is only ever the internal selector value,
 * never a human-facing label (Hukum Pintu / no RAW_UUID_LABEL).
 */
export function RegionSearchSelect({ selected, disabled = false, onSelect }: RegionSearchSelectProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RegionLookupItem[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'ready' | 'error'>('idle');
  const [hasInteracted, setHasInteracted] = useState(false);
  const requestGate = useRef(createLatestRequestGate());

  const runSearch = async (searchQuery: string) => {
    const sequence = requestGate.current.begin();
    setState('loading');
    try {
      const items = await searchRegions(searchQuery);
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
      <legend>Wilayah (Region)</legend>
      <label>
        Cari wilayah
        <input
          type="search"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          placeholder="Ketik kode atau nama wilayah"
        />
      </label>
      <button type="button" onClick={() => { setHasInteracted(true); void runSearch(''); }}>
        Tampilkan wilayah
      </button>
      {state === 'loading' ? <p role="status">Mencari wilayah...</p> : null}
      {state === 'empty' ? <p>Tidak ada wilayah yang cocok.</p> : null}
      {state === 'error' ? <p role="alert">Gagal memuat wilayah. Silakan coba lagi.</p> : null}
      {state === 'ready' ? (
        <ul aria-label="Hasil pencarian Wilayah">
          {results.map((region) => (
            <li key={region.id}>
              <button type="button" onClick={() => { onSelect(region); setState('idle'); }}>
                {regionOptionLabel(region)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {selected ? (
        <div role="status">
          <strong>Terpilih:</strong> {regionOptionLabel(selected)}
          <button type="button" onClick={() => onSelect(null)}>Ganti wilayah</button>
        </div>
      ) : (
        <p>Belum ada wilayah dipilih.</p>
      )}
    </fieldset>
  );
}
