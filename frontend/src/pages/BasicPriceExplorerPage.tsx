import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileInput, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  BasicPriceExplorerError,
  fetchBasicPriceExplorer,
  type BasicPriceExplorerItem,
  type ExplorerFilters,
  type ExplorerPageMeta,
  type RegionLookupItem,
} from '../api/basicPriceExplorer';
import { ExplorerRegionFilterSelect } from '../components/basic-price/ExplorerRegionFilterSelect';
import { computeBasicPriceSpaceViewModel } from '../utils/basicPriceSpaceViewModel';
import {
  EXPLORER_EMPTY_STATE_BODY,
  EXPLORER_EMPTY_STATE_TITLE,
  EXPLORER_NO_MATCH_TITLE,
  explorerErrorMessageFromStatus,
  explorerErrorStateFromStatus,
  explorerSourceNameLabel,
  formatExplorerPrice,
  freshnessLabel,
  isAmbiguousTimeFilter,
  isInvalidDateRange,
  regionLabel,
  resourceLabel,
  sourceOriginLabel,
  sourceTypeLabel,
  workspaceScopeLabel,
  type ExplorerErrorState,
} from '../utils/basicPriceExplorerDisplay';
import { createLatestRequestGate } from '../utils/catalogSearch';

const SOURCE_ORIGIN_OPTIONS = [
  'GOVERNMENT',
  'SUPPLIER',
  'STORE',
  'DISTRIBUTOR',
  'FIELD_REPORT',
  'COMMUNITY_REPORT',
] as const;

const FRESHNESS_OPTIONS = ['CURRENT', 'EXPIRING', 'EXPIRED'] as const;

interface DraftFilters {
  search: string;
  region: RegionLookupItem | null;
  year: string;
  dateFrom: string;
  dateTo: string;
  sourceOrigin: string;
  sourceName: string;
  unit: string;
  freshnessStatus: string;
  sortOrder: 'asc' | 'desc';
}

const EMPTY_DRAFT: DraftFilters = {
  search: '',
  region: null,
  year: '',
  dateFrom: '',
  dateTo: '',
  sourceOrigin: '',
  sourceName: '',
  unit: '',
  freshnessStatus: '',
  sortOrder: 'desc',
};

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: BasicPriceExplorerItem[]; meta: ExplorerPageMeta }
  | { kind: ExplorerErrorState; message: string };

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * RM02D2A2 remediation — the Basic Price Explorer: the PRIMARY, public-facing
 * Basic Price door (Owner Lock) for any user with BASIC_PRICE_VIEW. Import is
 * a secondary CTA. Review and Publication are secondary, permission-gated
 * management actions surfaced here via the "Manajemen Basic Price" link
 * cluster (BASIC_PRICE_REVIEW_VIEW / BASIC_PRICE_PUBLISH) — neither has a
 * main Sidebar menu of its own. Calls only the canonical GET /basic-prices —
 * no parallel explorer endpoint.
 */
export function BasicPriceExplorerPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const basicPriceSpace = computeBasicPriceSpaceViewModel({
    hasView: hasPermission('BASIC_PRICE_VIEW'),
    hasImport: hasPermission('BASIC_PRICE_IMPORT'),
    hasReviewView: hasPermission('BASIC_PRICE_REVIEW_VIEW'),
    hasPublish: hasPermission('BASIC_PRICE_PUBLISH'),
  });
  const [draft, setDraft] = useState<DraftFilters>(EMPTY_DRAFT);
  const [page, setPage] = useState(1);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const requestGate = useRef(createLatestRequestGate());

  const clientInvalidMessage = isAmbiguousTimeFilter({
    year: draft.year,
    dateFrom: draft.dateFrom,
    dateTo: draft.dateTo,
  })
    ? 'Tahun tidak dapat digabung dengan rentang tanggal — pilih salah satu.'
    : isInvalidDateRange(draft.dateFrom, draft.dateTo)
      ? 'Tanggal awal tidak boleh setelah tanggal akhir.'
      : null;

  useEffect(() => {
    // A client-side-invalid filter combination never reaches the network —
    // clientInvalidMessage (a pure derived value, not state) is rendered
    // directly below instead of being synced into `state`.
    if (clientInvalidMessage) {
      return;
    }

    const sequence = requestGate.current.begin();

    const timer = window.setTimeout(() => {
      // Deferred to the debounce callback (a macrotask), not the effect's own
      // synchronous execution, so this is not a cascading in-effect setState.
      setState({ kind: 'loading' });

      const filters: ExplorerFilters = {
        search: draft.search || undefined,
        regionId: draft.region?.id,
        year: draft.year || undefined,
        dateFrom: draft.dateFrom || undefined,
        dateTo: draft.dateTo || undefined,
        sourceOrigin: draft.sourceOrigin || undefined,
        sourceName: draft.sourceName || undefined,
        unit: draft.unit || undefined,
        freshnessStatus: draft.freshnessStatus || undefined,
        page,
        limit: 20,
        sortBy: 'effectiveDate',
        sortOrder: draft.sortOrder,
      };

      void (async () => {
        try {
          const result = await fetchBasicPriceExplorer(filters);
          if (!requestGate.current.isLatest(sequence)) return;
          setState({ kind: 'ready', items: result.data, meta: result.meta });
        } catch (error) {
          if (!requestGate.current.isLatest(sequence)) return;
          if (error instanceof BasicPriceExplorerError) {
            setState({
              kind: explorerErrorStateFromStatus(error.status),
              message: explorerErrorMessageFromStatus(error.status),
            });
          } else {
            setState({ kind: 'ERROR', message: 'Gagal memuat Harga Dasar. Coba lagi.' });
          }
        }
      })();
    }, 300);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, page, reloadNonce]);

  const filtersActive = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT),
    [draft],
  );

  const updateDraft = <K extends keyof DraftFilters>(key: K, value: DraftFilters[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const resetFilters = () => {
    setDraft(EMPTY_DRAFT);
    setPage(1);
  };

  const reload = () => setReloadNonce((n) => n + 1);

  return (
    <div className="simprok-rab-workspace">
      <header className="simprok-rab-workspace__header">
        <div>
          <div className="simprok-rab-workspace__eyebrow">SIMPROK / Basic Price</div>
          <h1>Jelajahi Harga Dasar</h1>
          <p>
            Cari dan lihat harga dasar yang telah dipublikasikan — menurut wilayah, waktu, dan
            sumber.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={reload} title="Muat ulang" aria-label="Muat ulang">
            <RefreshCw size={16} /> Muat ulang
          </button>
          {basicPriceSpace.showImportDoor ? (
            <button
              onClick={() => navigate('/basic-price/import')}
              title="Impor atau kontribusikan harga dasar"
            >
              <FileInput size={16} /> Impor / Kontribusikan Harga
            </button>
          ) : null}
        </div>
      </header>

      {basicPriceSpace.showManagementArea ? (
        <div
          style={{ display: 'flex', gap: '16px', fontSize: 'var(--text-sm)', marginBottom: '4px' }}
          aria-label="Manajemen Basic Price"
        >
          <span>Manajemen Basic Price:</span>
          {basicPriceSpace.showReviewDoor ? (
            <button
              type="button"
              onClick={() => navigate('/basic-price/reviews')}
              style={{ padding: 0, border: 'none', background: 'none', textDecoration: 'underline', cursor: 'pointer' }}
            >
              Antrean Review
            </button>
          ) : null}
          {basicPriceSpace.showPublicationDoor ? (
            <button
              type="button"
              onClick={() => navigate('/basic-price/publications')}
              style={{ padding: 0, border: 'none', background: 'none', textDecoration: 'underline', cursor: 'pointer' }}
            >
              Antrean Publikasi
            </button>
          ) : null}
        </div>
      ) : null}

      <section
        className="simprok-rab-toolbar"
        aria-label="Filter Harga Dasar"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))', gap: '12px' }}
      >
        <label>
          Cari resource (kode/nama)
          <input
            type="search"
            value={draft.search}
            onChange={(event) => updateDraft('search', event.target.value)}
            placeholder="Ketik kode atau nama resource"
          />
        </label>
        <ExplorerRegionFilterSelect
          selected={draft.region}
          onSelect={(region) => updateDraft('region', region)}
        />
        <label>
          Tahun
          <input
            type="number"
            min={2000}
            max={2100}
            value={draft.year}
            onChange={(event) => updateDraft('year', event.target.value)}
            placeholder="mis. 2026"
          />
        </label>
        <label>
          Tanggal awal
          <input
            type="date"
            value={draft.dateFrom}
            onChange={(event) => updateDraft('dateFrom', event.target.value)}
          />
        </label>
        <label>
          Tanggal akhir
          <input
            type="date"
            value={draft.dateTo}
            onChange={(event) => updateDraft('dateTo', event.target.value)}
          />
        </label>
        <label>
          Asal sumber
          <select
            value={draft.sourceOrigin}
            onChange={(event) => updateDraft('sourceOrigin', event.target.value)}
          >
            <option value="">Semua asal sumber</option>
            {SOURCE_ORIGIN_OPTIONS.map((origin) => (
              <option key={origin} value={origin}>
                {sourceOriginLabel(origin)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nama sumber
          <input
            type="search"
            value={draft.sourceName}
            onChange={(event) => updateDraft('sourceName', event.target.value)}
            placeholder="mis. nama vendor/toko"
          />
        </label>
        <label>
          Satuan
          <input
            type="text"
            value={draft.unit}
            onChange={(event) => updateDraft('unit', event.target.value)}
            placeholder="mis. Zak, M3"
          />
        </label>
        <label>
          Kesegaran
          <select
            value={draft.freshnessStatus}
            onChange={(event) => updateDraft('freshnessStatus', event.target.value)}
          >
            <option value="">Semua status</option>
            {FRESHNESS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {freshnessLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Urutkan
          <select
            value={draft.sortOrder}
            onChange={(event) => updateDraft('sortOrder', event.target.value as 'asc' | 'desc')}
          >
            <option value="desc">Tanggal berlaku terbaru</option>
            <option value="asc">Tanggal berlaku terlama</option>
          </select>
        </label>
        <button type="button" onClick={resetFilters} disabled={!filtersActive}>
          Bersihkan Filter
        </button>
      </section>

      {clientInvalidMessage ? (
        <p role="alert" style={{ marginTop: '16px' }}>
          {clientInvalidMessage}
        </p>
      ) : (
        <>
          {state.kind === 'loading' ? <p role="status">Memuat harga dasar...</p> : null}

          {state.kind === 'FORBIDDEN' ||
          state.kind === 'INVALID_FILTER' ||
          state.kind === 'NOT_FOUND' ||
          state.kind === 'SERVER_ERROR' ||
          state.kind === 'ERROR' ? (
            <p role="alert" style={{ marginTop: '16px' }}>
              {state.message}
            </p>
          ) : null}

          {state.kind === 'ready' && state.meta.total === 0 && !filtersActive ? (
            <div className="simprok-rab-card" style={{ marginTop: '16px' }}>
              <strong>{EXPLORER_EMPTY_STATE_TITLE}</strong>
              <p>{EXPLORER_EMPTY_STATE_BODY}</p>
            </div>
          ) : null}

          {state.kind === 'ready' && state.meta.total === 0 && filtersActive ? (
            <div className="simprok-rab-card" style={{ marginTop: '16px' }}>
              <strong>{EXPLORER_NO_MATCH_TITLE}</strong>
              <button type="button" onClick={resetFilters}>
                Bersihkan filter
              </button>
            </div>
          ) : null}

          {state.kind === 'ready' && state.meta.total > 0 && state.items.length === 0 ? (
            <div className="simprok-rab-card" style={{ marginTop: '16px' }}>
              <strong>Halaman ini tidak memiliki hasil.</strong>
              <p>Total {state.meta.total} hasil ditemukan pada halaman lain.</p>
              <button type="button" onClick={() => setPage(1)}>
                Kembali ke halaman 1
              </button>
            </div>
          ) : null}

          {state.kind === 'ready' && state.items.length > 0 ? (
            <>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}
              >
                {state.items.map((item) => (
                  <section
                    key={item.basicPriceId}
                    className="simprok-rab-card"
                    aria-label={resourceLabel(item.resource)}
                  >
                    <strong>{resourceLabel(item.resource)}</strong>
                    <p>
                      {formatExplorerPrice(item.price)} / {item.resource.baseUnit} ·{' '}
                      {regionLabel(item.region)} · {workspaceScopeLabel(item.workspaceScope)}
                    </p>
                    <p>
                      Berlaku sejak {formatDate(item.effectiveDate)}
                      {item.validUntil ? ` sampai ${formatDate(item.validUntil)}` : ''} ·{' '}
                      {freshnessLabel(item.freshnessStatus)}
                    </p>
                    <p>
                      {explorerSourceNameLabel(item.sourceName)} ({sourceTypeLabel(item.sourceType)},{' '}
                      {sourceOriginLabel(item.sourceOrigin)})
                    </p>
                  </section>
                ))}
              </div>

              <div
                style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '16px' }}
                aria-label="Navigasi halaman hasil"
              >
                <button
                  type="button"
                  disabled={state.meta.page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                >
                  Sebelumnya
                </button>
                <span>
                  Halaman {state.meta.page} dari {Math.max(state.meta.totalPages, 1)} (
                  {state.meta.total} hasil)
                </span>
                <button
                  type="button"
                  disabled={state.meta.page >= state.meta.totalPages}
                  onClick={() => setPage((current) => current + 1)}
                >
                  Berikutnya
                </button>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
