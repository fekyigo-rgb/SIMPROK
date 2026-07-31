import { useEffect, useRef, useState } from 'react';
import { searchExplorerRegions, type RegionLookupItem } from '../../api/basicPriceExplorer';
import { regionOptionLabel } from '../../utils/basicPriceExplorerDisplay';
import { createLatestRequestGate } from '../../utils/catalogSearch';

interface ExplorerRegionFilterSelectProps {
  selected: RegionLookupItem | null;
  disabled?: boolean;
  onSelect: (region: RegionLookupItem | null) => void;
}

/**
 * RM02D2A2 — Region filter for the Basic Price Explorer. Calls the
 * Explorer-scoped GET /basic-prices/lookups/regions (BASIC_PRICE_VIEW), never
 * the import lookup (BASIC_PRICE_IMPORT) — a view-only visitor must be able to
 * filter by region without ever touching an import-gated endpoint. The UUID is
 * only ever the internal filter value; the human always sees "code — name".
 */
export function ExplorerRegionFilterSelect({
  selected,
  disabled = false,
  onSelect,
}: ExplorerRegionFilterSelectProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RegionLookupItem[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'ready' | 'error'>('idle');
  const [hasInteracted, setHasInteracted] = useState(false);
  const requestGate = useRef(createLatestRequestGate());

  const runSearch = async (searchQuery: string) => {
    const sequence = requestGate.current.begin();
    setState('loading');
    try {
      const items = await searchExplorerRegions(searchQuery);
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
    <fieldset disabled={disabled} style={{ minWidth: '240px', padding: '10px' }}>
      <legend>Wilayah</legend>
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
          <strong>Wilayah terpilih:</strong> {regionOptionLabel(selected)}
          <button type="button" onClick={() => onSelect(null)}>Hapus filter wilayah</button>
        </div>
      ) : (
        <p>Semua wilayah.</p>
      )}
    </fieldset>
  );
}
