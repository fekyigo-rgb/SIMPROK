import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, ClipboardCheck, FileInput, RefreshCw } from 'lucide-react';
import {
  BasicPriceExplorerError,
  fetchBasicPriceExplorer,
  type BasicPriceExplorerItem,
  type ExplorerFilters,
  type ExplorerPageMeta,
  type RegionLookupItem,
} from '../api/basicPriceExplorer';
import { ExplorerRegionFilterSelect } from '../components/basic-price/ExplorerRegionFilterSelect';
import { useAuth } from '../contexts/AuthContext';
import {
  EXPLORER_EMPTY_STATE_BODY,
  EXPLORER_EMPTY_STATE_TITLE,
  EXPLORER_NO_MATCH_TITLE,
  RESOURCE_TYPE_OPTIONS,
  SOURCE_FAMILY_OPTIONS,
  explorerErrorMessageFromStatus,
  explorerErrorStateFromStatus,
  explorerSourceNameLabel,
  formatExplorerPrice,
  freshnessLabel,
  isAmbiguousTimeFilter,
  isInvalidDateRange,
  regionLabel,
  resourceLabel,
  resourceTypeLabel,
  REVERIFICATION_HELP_TEXT,
  REVERIFICATION_HELP_TRIGGER,
  reverificationLine,
  sourceFamilyLabel,
  sourceOriginLabel,
  sourceTypeLabel,
  workspaceScopeLabel,
  type ExplorerErrorState,
} from '../utils/basicPriceExplorerDisplay';
import { createLatestRequestGate } from '../utils/catalogSearch';

const FRESHNESS_OPTIONS = ['CURRENT', 'EXPIRING', 'EXPIRED'] as const;

interface DraftFilters {
  search: string;
  region: RegionLookupItem | null;
  year: string;
  dateFrom: string;
  dateTo: string;
  resourceType: string;
  sourceFamily: string;
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
  resourceType: '',
  sourceFamily: '',
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
 * Basic Price Explorer — the ONE and only Basic Price product experience
 * (Owner Decision: ONE SIMPROK BASIC PRICE PRODUCT MODEL). Any account with
 * an active workspace membership lands here directly at /basic-price: there
 * is no capability-space landing, no role-based variant, and no combination
 * of VIEW/IMPORT/REVIEW/PUBLISH decides what renders. Import is always the
 * primary secondary action; internal Review/Publication are back-office
 * curation and are never linked from here. Calls only the canonical
 * GET /basic-prices — no parallel explorer endpoint.
 */
export function BasicPriceExplorerPage() {
  const navigate = useNavigate();
  /**
   * THE TWO CURATION ROOMS HAD NO DOOR.
   *
   * `/basic-price/reviews` and `/basic-price/publications` were built, routed
   * and permission-gated, and nothing anywhere in the product linked to either
   * one: a curator could reach the queue of things awaiting their verdict only
   * by typing the URL, and a publisher likewise. A room with no door is not a
   * room a person has.
   *
   * The doors live HERE, in the Basic Price room, rather than in the Sidebar,
   * because the Sidebar is deliberately ungated — every active membership sees
   * every entry — and these two are not everybody's. Hukum Pintu's third state
   * applies: outside your authority, the door is not greyed out, it is absent.
   * `hasPermission` fails closed while capabilities are still loading, so a
   * door never flickers into existence before the authority behind it is known.
   *
   * These are the SAME permission codes the backend guards the routes with
   * (BASIC_PRICE_REVIEW_VIEW on GET /basic-price-reviews, BASIC_PRICE_PUBLISH
   * on GET /basic-price-publications) and the same ones PermissionRoute already
   * enforces on entry — this only decides whether the door is drawn, never
   * whether it opens.
   */
  const { hasPermission } = useAuth();
  const curatesSubmissions = hasPermission('BASIC_PRICE_REVIEW_VIEW');
  const publishesPrices = hasPermission('BASIC_PRICE_PUBLISH');
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
        resourceType: draft.resourceType || undefined,
        sourceFamily: draft.sourceFamily || undefined,
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
            setState({ kind: 'ERROR', message: 'Gagal memuat Basic Price. Coba lagi.' });
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
          <h1>Basic Price</h1>
          <p>Daftar harga upah, bahan, dan peralatan yang tersedia di SIMPROK.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button onClick={reload} title="Muat ulang" aria-label="Muat ulang">
            <RefreshCw size={16} /> Muat ulang
          </button>
          <button
            onClick={() => navigate('/basic-price/import')}
            title="Impor atau masukkan harga dasar"
          >
            <FileInput size={16} /> Impor / Masukkan Harga
          </button>
          {curatesSubmissions ? (
            <button
              onClick={() => navigate('/basic-price/reviews')}
              title="Harga yang diusulkan ke SIMPROK dan menunggu peninjauan"
            >
              <ClipboardCheck size={16} /> Pengajuan Basic Price
            </button>
          ) : null}
          {publishesPrices ? (
            <button
              onClick={() => navigate('/basic-price/publications')}
              title="Harga yang sudah diverifikasi dan menunggu penerbitan"
            >
              <BadgeCheck size={16} /> Siap Diterbitkan
            </button>
          ) : null}
        </div>
      </header>

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
        <label>
          Kategori
          <select
            value={draft.resourceType}
            onChange={(event) => updateDraft('resourceType', event.target.value)}
          >
            <option value="">Semua kategori</option>
            {RESOURCE_TYPE_OPTIONS.map((type) => (
              <option key={type} value={type}>
                {resourceTypeLabel(type)}
              </option>
            ))}
          </select>
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
          Keluarga sumber
          <select
            value={draft.sourceFamily}
            onChange={(event) => updateDraft('sourceFamily', event.target.value)}
          >
            <option value="">Semua sumber</option>
            {SOURCE_FAMILY_OPTIONS.map((family) => (
              <option key={family} value={family}>
                {sourceFamilyLabel(family)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Nama toko/supplier/sumber
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

      <h2>Daftar Harga</h2>

      {clientInvalidMessage ? (
        <p role="alert" style={{ marginTop: '16px' }}>
          {clientInvalidMessage}
        </p>
      ) : (
        <>
          {state.kind === 'loading' ? <p role="status">Memuat Basic Price...</p> : null}

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
                    {/*
                      A SEPARATE LINE, DELIBERATELY. "Berlaku sejak / sampai" is
                      the hard validity window; this is advice about freshness.
                      Folding them into one sentence would let a reader hear
                      "expires" where SIMPROK only said "check this again". It
                      is absent entirely when nothing was recommended, because a
                      dash there would read as a missing fact rather than a
                      deliberate silence.
                    */}
                    {reverificationLine(item, formatDate) ? (
                      <p>
                        {reverificationLine(item, formatDate)}{' '}
                        <span
                          role="note"
                          tabIndex={0}
                          title={REVERIFICATION_HELP_TEXT.join('\n\n')}
                          aria-label={REVERIFICATION_HELP_TEXT.join(' ')}
                        >
                          {REVERIFICATION_HELP_TRIGGER}
                        </span>
                      </p>
                    ) : null}
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
