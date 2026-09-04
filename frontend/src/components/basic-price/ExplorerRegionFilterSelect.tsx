import { useEffect, useId, useRef, useState } from 'react';
import { searchExplorerRegions, type RegionLookupItem } from '../../api/basicPriceExplorer';
import {
  regionChosenLabel,
  regionOptionLabels,
} from '../../utils/basicPriceExplorerDisplay';
import { createLatestRequestGate } from '../../utils/catalogSearch';
import {
  regionSearchAfterClear,
  regionSearchShouldReloadOnFocus,
} from '../../utils/regionSearchRecovery';

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
 * only ever the internal filter value; the human always sees the place.
 *
 * BP-UX-FINAL-01 §5/§21 — REFINED FROM A PANEL INTO A CONTROL.
 *
 * The behaviour is unchanged: same endpoint, same permission, same debounce,
 * same latest-request gate, same honest loading/empty/error states, and the
 * same name-first labelling that appends a code only where two candidates in
 * THIS result set are otherwise indistinguishable.
 *
 * What changed is its FOOTPRINT. It used to render a bordered `<fieldset>`
 * with a legend, its own labelled search box, a "Tampilkan wilayah" button, a
 * bulleted result list and a permanent "Semua wilayah." line — around 180px of
 * vertical space for one of six filters, which is most of why the Explorer's
 * own prices sat below the fold. It is now one 32px combobox matching the five
 * controls beside it, with results in an anchored list and the chosen region
 * read back inside the field.
 *
 * NOTHING WAS HIDDEN TO ACHIEVE THAT. Every state the panel could report this
 * control still reports; they simply no longer each demand a row of the page.
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
  const [open, setOpen] = useState(false);
  const requestGate = useRef(createLatestRequestGate());
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

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

  // Dismissal, on the same contract the freshness layer uses: Escape from the
  // keyboard, an outside press from the pointer. A list that cannot be closed
  // would sit on top of the very table it exists to filter.
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

  // Names first; a code is appended only where two candidates in THIS result
  // set share a name and nothing else could tell them apart.
  const labels = regionOptionLabels(results);

  return (
    <div className="bp-field" ref={rootRef}>
      <label className="bp-field__label" htmlFor={`${listId}-input`}>
        Wilayah
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
          // The chosen region reads back IN the field, so a narrowed table
          // never leaves a person hunting for what narrowed it.
          value={selected ? regionChosenLabel(selected) : query}
          placeholder="Semua wilayah"
          onFocus={() => {
            setHasInteracted(true);
            setOpen(true);
            if (
              regionSearchShouldReloadOnFocus({
                hasSelection: selected !== null,
                panelState: state,
              })
            ) {
              void runSearch(query.trim());
            }
          }}
          onChange={(event) => changeQuery(event.target.value)}
        />
        {selected ? (
          <button
            type="button"
            className="bp-btn bp-btn--link bp-region-clear"
            onClick={() => {
              onSelect(null);
              const recovery = regionSearchAfterClear();
              requestGate.current.invalidate();
              setResults([]);
              setState('idle');
              setHasInteracted(true);
              setQuery(recovery.query);
              setOpen(recovery.open);
              if (recovery.reload) void runSearch(recovery.query);
            }}
            title="Hapus filter wilayah"
            aria-label="Hapus filter wilayah"
          >
            ×
          </button>
        ) : null}

        {open ? (
          <div className="bp-pop__panel bp-pop__panel--list">
            {state === 'loading' ? (
              <p className="bp-pop__body" role="status">
                Mencari wilayah...
              </p>
            ) : null}
            {state === 'empty' ? (
              <p className="bp-pop__body">Tidak ada wilayah yang cocok.</p>
            ) : null}
            {state === 'error' ? (
              <p className="bp-pop__body" role="alert">
                Gagal memuat wilayah. Silakan coba lagi.
              </p>
            ) : null}
            {state === 'ready' ? (
              <ul id={listId} role="listbox" aria-label="Hasil pencarian Wilayah" className="bp-optionlist">
                {results.map((region) => (
                  <li key={region.id} role="option" aria-selected={selected?.id === region.id}>
                    <button
                      type="button"
                      className="bp-option"
                      onClick={() => {
                        onSelect(region);
                        setQuery('');
                        setResults([]);
                        setState('idle');
                        setOpen(false);
                      }}
                    >
                      {labels.get(region.id) ?? region.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
