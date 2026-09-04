import { useEffect, useId, useRef, useState } from 'react';
import { searchRegions, type RegionLookupItem } from '../../api/basicPriceWorkflow';
import {
  regionChosenLabel,
  regionOptionLabels,
} from '../../utils/basicPriceWorkflowDisplay';
import { createLatestRequestGate } from '../../utils/catalogSearch';
import {
  REGION_SEARCH_PLACEHOLDER,
  regionSearchAfterClear,
  regionSearchShouldReloadOnFocus,
} from '../../utils/regionSearchRecovery';

interface RegionSearchSelectProps {
  selected: RegionLookupItem | null;
  disabled?: boolean;
  onSelect: (region: RegionLookupItem | null) => void;
}

/**
 * RM-02D2A2 — canonical Region selector for the import flow. Replaces the old
 * raw-UUID text field: a human searches by code or name and picks a candidate;
 * the UUID is only ever the internal selector value, never a human-facing label
 * (Hukum Pintu / no RAW_UUID_LABEL).
 *
 * BP-UX-FINAL-01 §14/§21 — same engine, one control instead of a panel. It sits
 * in the Konteks Sumber grid beside five other fields, so it now matches their
 * height rather than being a bordered fieldset three times taller than its
 * neighbours. Endpoint, permission, debounce, request gate and every reported
 * state are untouched.
 */
export function RegionSearchSelect({ selected, disabled = false, onSelect }: RegionSearchSelectProps) {
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
      {/*
        BP-VISUAL-TRUTH-07 §18 — "Wilayah", not "Wilayah (Region)". The English
        gloss was a developer's reassurance that this control writes the
        `Region` entity; a person filling in a source form is owed one word in
        one language.

        §7 — and the title says WHICH region question this is. Intake asks a
        DIFFERENT one: which price COLUMN of a multi-region workbook to read,
        in the file's own wording. Both were called "Wilayah", which is how
        answering "TELUK AMBON" there and reading "Kecamatan Teluk Ambon
        Baguala, Kota Ambon" here could only look like SIMPROK changing the
        answer — when in fact two different questions had been answered.
      */}
      <label
        className="bp-field__label"
        htmlFor={`${listId}-input`}
        title="Wilayah resmi SIMPROK tempat harga ini dicatat. Berbeda dari kolom harga yang dibaca dari berkas."
      >
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
          value={selected ? regionChosenLabel(selected) : query}
          placeholder={REGION_SEARCH_PLACEHOLDER}
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
            title="Ganti wilayah"
            aria-label="Ganti wilayah"
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
            {/*
              AN EMPTY RESULT IS NOT A DEAD END. Wilayah is governed reference
              data — SIMPROK will not invent a place, because an invented place
              is a false claim about the real world. So when nothing matches,
              the honest answer names WHO can add it rather than leaving a
              person retyping.
            */}
            {state === 'empty' ? (
              <p className="bp-pop__body" role="status">
                Wilayah itu belum terdaftar di SIMPROK. Daftar wilayah ditetapkan
                oleh pemilik data, bukan dibuat otomatis saat impor — mintalah
                wilayah ini ditambahkan, lalu pilih kembali di sini.
              </p>
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
