import { useEffect, useId, useRef, useState } from 'react';
import {
  searchResourceCatalog,
  searchUnitDefinitions,
  type ResourceLookupItem,
  type ResourceType,
  type UnitDimension,
  type UnitKind,
  type UnitLookupItem,
} from '../../api/basicPriceImport';
import { createLatestRequestGate } from '../../utils/catalogSearch';
// The catalog's human vocabulary. Imported rather than re-spelled here: the
// review room and this selector must call a MATERIAL the same thing.
import {
  resourceOptionLabel,
  rowSectionLabel,
  unitDimensionLabel,
  unitKindLabel,
  unitOptionLabel,
} from '../../utils/basicPriceImportDisplay';

type SelectedItem = ResourceLookupItem | UnitLookupItem;

interface CatalogSearchSelectProps {
  mode: 'resource' | 'unit';
  initialResourceType?: ResourceType;
  selected: SelectedItem | null;
  disabled?: boolean;
  onSelect: (item: SelectedItem | null) => void;
  onPendingChange: (pending: boolean) => void;
}

const resourceTypes: ResourceType[] = ['MATERIAL', 'LABOR', 'EQUIPMENT'];
const dimensions: UnitDimension[] = ['COUNT', 'MASS', 'LENGTH', 'AREA', 'VOLUME', 'TIME', 'PERSON_TIME', 'EQUIPMENT_TIME'];
const kinds: UnitKind[] = ['CANONICAL', 'COMMERCIAL_PACKAGE', 'CONTEXTUAL'];
const isResource = (item: SelectedItem): item is ResourceLookupItem => 'name' in item;

/**
 * BP-UX-FINAL-01 §15/§21 — THE SAME SELECTOR, AT A ROW'S HEIGHT.
 *
 * TWO of these render on EVERY mutable row of the review page, and the Owner's
 * real workbook has eighty-six rows. As a bordered `<fieldset>` carrying a
 * legend, a labelled search box, one or two filter selects, a "Tampilkan awal"
 * button, a bulleted result list and a permanent "Belum ada pilihan." line,
 * each one stood roughly 220px tall — so a single row of that page was taller
 * than a laptop viewport and reviewing dozens of rows meant scrolling past
 * hundreds of identical empty controls.
 *
 * It is now one combobox at the height of the row it belongs to. The filters
 * did not go away: they moved INSIDE the dropdown, where they are needed only
 * once a person is actually searching, and where they no longer cost vertical
 * space on every row that is already resolved.
 *
 * THE ENGINE IS UNTOUCHED. Same two endpoints, same 2-character debounce
 * threshold, same explicit filter invalidation, same latest-request gate, and
 * the same `onPendingChange` contract the review page's completion guard reads
 * — a pending search still blocks `Selesaikan`, exactly as before.
 */
export function CatalogSearchSelect({
  mode,
  initialResourceType,
  selected,
  disabled = false,
  onSelect,
  onPendingChange,
}: CatalogSearchSelectProps) {
  const [query, setQuery] = useState('');
  const [resourceType, setResourceType] = useState<ResourceType | ''>(initialResourceType ?? '');
  const [dimension, setDimension] = useState<UnitDimension | ''>('');
  const [kind, setKind] = useState<UnitKind | ''>('');
  const [results, setResults] = useState<SelectedItem[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'empty' | 'ready' | 'error'>('idle');
  const [hasInteracted, setHasInteracted] = useState(false);
  const [open, setOpen] = useState(false);
  const requestGate = useRef(createLatestRequestGate());
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const runSearch = async (searchQuery: string) => {
    const sequence = requestGate.current.begin();
    setState('loading');
    onPendingChange(true);
    try {
      const page =
        mode === 'resource'
          ? await searchResourceCatalog({ q: searchQuery, type: resourceType || undefined, page: 1, limit: 20 })
          : await searchUnitDefinitions({
              q: searchQuery,
              dimension: dimension || undefined,
              kind: kind || undefined,
              page: 1,
              limit: 20,
            });
      if (!requestGate.current.isLatest(sequence)) return;
      setResults(page.items);
      setState(page.items.length === 0 ? 'empty' : 'ready');
    } catch {
      if (!requestGate.current.isLatest(sequence)) return;
      setResults([]);
      setState('error');
    } finally {
      if (requestGate.current.isLatest(sequence)) onPendingChange(false);
    }
  };

  useEffect(() => {
    if (!hasInteracted || query.trim().length < 2) return;
    const timer = window.setTimeout(() => void runSearch(query.trim()), 300);
    return () => window.clearTimeout(timer);
    // Filters invalidate explicitly; only typed queries use debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const clearForInputChange = () => {
    requestGate.current.invalidate();
    setResults([]);
    setState('idle');
    onPendingChange(false);
    onSelect(null);
  };

  const changeQuery = (value: string) => {
    setHasInteracted(true);
    clearForInputChange();
    setQuery(value);
    setOpen(true);
  };

  const changeFilter = <T extends string>(setter: (value: T | '') => void, value: T | '') => {
    clearForInputChange();
    setter(value);
  };

  const label = mode === 'resource' ? 'Item SIMPROK' : 'Satuan standar';
  const selectedText = selected
    ? isResource(selected)
      ? resourceOptionLabel(selected)
      : unitOptionLabel(selected)
    : '';

  return (
    <div className="bp-field bp-field--grow" ref={rootRef}>
      <label className="bp-field__label" htmlFor={`${listId}-input`}>
        {label}
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
          value={selected ? selectedText : query}
          placeholder={mode === 'resource' ? 'Ketik kode atau nama' : 'Ketik kode, nama, simbol, atau alias'}
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
            title="Ganti pilihan"
            aria-label={`Ganti ${label}`}
          >
            ×
          </button>
        ) : null}

        {open ? (
          <div className="bp-pop__panel bp-pop__panel--list">
            {/*
              THE FILTERS, WHERE THEY ARE ACTUALLY USED. They narrow a SEARCH,
              so they live with the search rather than on a row that may never
              be searched at all.
            */}
            <div className="bp-optionfilters">
              {mode === 'resource' ? (
                <select
                  className="bp-select bp-select--inline"
                  aria-label="Tipe resource"
                  value={resourceType}
                  disabled={disabled}
                  onChange={(event) => changeFilter(setResourceType, event.target.value as ResourceType | '')}
                >
                  <option value="">Semua tipe</option>
                  {resourceTypes.map((value) => <option key={value} value={value}>{rowSectionLabel(value)}</option>)}
                </select>
              ) : (
                <>
                  <select
                    className="bp-select bp-select--inline"
                    aria-label="Dimensi satuan"
                    value={dimension}
                    disabled={disabled}
                    onChange={(event) => changeFilter(setDimension, event.target.value as UnitDimension | '')}
                  >
                    <option value="">Semua dimensi</option>
                    {dimensions.map((value) => <option key={value} value={value}>{unitDimensionLabel(value)}</option>)}
                  </select>
                  <select
                    className="bp-select bp-select--inline"
                    aria-label="Jenis satuan"
                    value={kind}
                    disabled={disabled}
                    onChange={(event) => changeFilter(setKind, event.target.value as UnitKind | '')}
                  >
                    <option value="">Semua jenis</option>
                    {kinds.map((value) => <option key={value} value={value}>{unitKindLabel(value)}</option>)}
                  </select>
                </>
              )}
              <button
                type="button"
                className="bp-btn bp-btn--sm"
                disabled={disabled}
                onClick={() => { setHasInteracted(true); void runSearch(query.trim()); }}
              >
                Cari
              </button>
            </div>

            {state === 'loading' ? (
              <p className="bp-pop__body" role="status">
                Mencari...
              </p>
            ) : null}
            {state === 'empty' ? <p className="bp-pop__body">Tidak ada kandidat yang cocok.</p> : null}
            {state === 'error' ? (
              <p className="bp-pop__body" role="alert">
                Pencarian gagal. Silakan coba lagi.
              </p>
            ) : null}
            {state === 'ready' ? (
              <ul id={listId} role="listbox" aria-label={`Hasil pencarian ${label}`} className="bp-optionlist">
                {results.map((item) => (
                  <li key={item.id} role="option" aria-selected={selected?.id === item.id}>
                    <button
                      type="button"
                      className="bp-option"
                      onClick={() => {
                        onSelect(item);
                        setQuery('');
                        setState('idle');
                        setOpen(false);
                      }}
                    >
                      {isResource(item) ? resourceOptionLabel(item) : unitOptionLabel(item)}
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
