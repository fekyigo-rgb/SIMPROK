import { useEffect, useRef, useState } from 'react';
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
  const requestGate = useRef(createLatestRequestGate());

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
  };

  const changeFilter = <T extends string>(setter: (value: T | '') => void, value: T | '') => {
    clearForInputChange();
    setter(value);
  };

  const label = mode === 'resource' ? 'Resource Katalog' : 'Satuan Kanonik';
  return (
    <fieldset disabled={disabled} style={{ minWidth: '300px', padding: '10px' }}>
      <legend>{label}</legend>
      <label>
        Cari {label}
        <input
          type="search"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          placeholder={mode === 'resource' ? 'Ketik kode atau nama' : 'Ketik kode, nama, simbol, atau alias'}
        />
      </label>
      {mode === 'resource' ? (
        <label>
          Tipe
          <select
            value={resourceType}
            onChange={(event) => changeFilter(setResourceType, event.target.value as ResourceType | '')}
          >
            <option value="">Semua tipe</option>
            {resourceTypes.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      ) : (
        <>
          <label>
            Dimensi
            <select
              value={dimension}
              onChange={(event) => changeFilter(setDimension, event.target.value as UnitDimension | '')}
            >
              <option value="">Semua dimensi</option>
              {dimensions.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            Jenis
            <select value={kind} onChange={(event) => changeFilter(setKind, event.target.value as UnitKind | '')}>
              <option value="">Semua jenis</option>
              {kinds.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </>
      )}
      <button type="button" onClick={() => { setHasInteracted(true); void runSearch(''); }}>
        Tampilkan awal
      </button>
      {state === 'loading' ? <p role="status">Mencari...</p> : null}
      {state === 'empty' ? <p>Tidak ada kandidat yang cocok.</p> : null}
      {state === 'error' ? <p role="alert">Pencarian gagal. Silakan coba lagi.</p> : null}
      {state === 'ready' ? (
        <ul aria-label={`Hasil pencarian ${label}`}>
          {results.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onSelect(item)}>
                {isResource(item)
                  ? `${item.code ?? 'Tanpa kode'} — ${item.name} — ${item.type} — ${item.baseUnit}`
                  : `${item.code} — ${item.displayName} — ${item.symbol} — ${item.dimension} — ${item.kind}`}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {selected ? (
        <div role="status">
          <strong>Terpilih:</strong>{' '}
          {isResource(selected)
            ? `${selected.code ?? 'Tanpa kode'} — ${selected.name} — ${selected.type} — ${selected.baseUnit}`
            : `${selected.code} — ${selected.displayName} — ${selected.symbol} — ${selected.dimension} — ${selected.kind}`}
          <button type="button" onClick={() => onSelect(null)}>Ganti pilihan</button>
        </div>
      ) : <p>Belum ada pilihan.</p>}
    </fieldset>
  );
}
