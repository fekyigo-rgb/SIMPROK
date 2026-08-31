import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileInput, RefreshCw } from 'lucide-react';
import {
  BasicPriceExplorerError,
  fetchBasicPriceExplorer,
  type BasicPriceExplorerItem,
  type ExplorerFilters,
  type ExplorerPageMeta,
  type RegionLookupItem,
} from '../api/basicPriceExplorer';
import { ExplorerRegionFilterSelect } from '../components/basic-price/ExplorerRegionFilterSelect';
import { FreshnessChip } from '../components/basic-price/FreshnessChip';
import { BasicPriceDetailPanel } from '../components/basic-price/BasicPriceDetailPanel';
import { useAuth } from '../contexts/AuthContext';
import {
  EFFECTIVE_ON_DATE_HELP,
  asOfContextLine,
  EXPLORER_EMPTY_STATE_BODY,
  EXPLORER_EMPTY_STATE_TITLE,
  EXPLORER_NO_MATCH_TITLE,
  RESOURCE_TYPE_OPTIONS,
  SOURCE_FAMILY_OPTIONS,
  explorerErrorMessageFromStatus,
  explorerErrorStateFromStatus,
  explorerSourceNameLabel,
  formatExplorerPrice,
  regionLabel,
  resourceLabel,
  resourceTypeLabel,
  sourceFamilyLabel,
  type ExplorerErrorState,
} from '../utils/basicPriceExplorerDisplay';
import {
  asOfContext,
  presentContext,
  type TemporalContext,
} from '../utils/basicPriceFreshness';
import { createLatestRequestGate } from '../utils/catalogSearch';
import '../styles/basicPrice.css';

/**
 * THE SIX VISIBLE CONTROLS, AND NOTHING ELSE (Owner Lock, BP-UX-FINAL-01 §5/§24).
 *
 * WHAT WAS REMOVED FROM THIS SURFACE, AND WHY NONE OF IT IS A LOSS:
 *
 *   Satuan             a free-text exact-match box over `ResourceCatalog.baseUnit`.
 *                      Someone who knows the unit already knows the resource, and
 *                      the unit is a COLUMN — visible on every row without asking.
 *   Kesegaran          the user-facing vocabulary is now two words, and the chip
 *                      states one of them on every row. Filtering an
 *                      already-current list by "is it current" was a question
 *                      about the list, not about the prices.
 *   Tahun              the same axis as the date filter (`effectiveDate`), and the
 *                      server rejects the two together with a 400. Two controls
 *                      that cannot both be used is a trap, not a choice.
 *   Tanggal awal/akhir a range, where a single day is what anyone actually asks:
 *                      "what price applied then".
 *   Urutkan            moved to the table, where sorting belongs.
 *
 * NONE OF THIS NARROWS THE API. Every parameter above still exists on
 * `ExplorerFilters` and is still sent when set. What changed is which questions
 * the room puts to a person before they have seen a single price.
 */
interface DraftFilters {
  search: string;
  region: RegionLookupItem | null;
  resourceType: string;
  sourceFamily: string;
  sourceName: string;
  /**
   * "Berlaku pada tanggal" — sent as the canonical `asOf` parameter, which the
   * SERVER answers with the full temporal law: effectiveDate <= D, validUntil
   * null or >= D, and currentness evaluated AT D.
   *
   * It used to be mapped onto `dateTo`, i.e. `effectiveDate <= D` alone — only
   * the first of those three lines. The list that produced still contained
   * prices whose own source said they had expired, and prices a published
   * correction had already replaced, under a label promising otherwise.
   */
  effectiveOn: string;
}

const EMPTY_DRAFT: DraftFilters = {
  search: '',
  region: null,
  resourceType: '',
  sourceFamily: '',
  sourceName: '',
  effectiveOn: '',
};

type ListState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      items: BasicPriceExplorerItem[];
      meta: ExplorerPageMeta;
      /**
       * BP-UX-FINAL-01D GAP-D — THE TEMPORAL CONTEXT THESE EXACT ROWS WERE
       * SELECTED FOR, carried WITH them rather than re-read from the draft.
       *
       * The draft runs 300ms ahead of the table while a person is typing.
       * Reading the context line and the freshness chips off the draft would,
       * for that moment, describe rows selected for one day using the words of
       * another — a smaller version of the drift this mission closes. Pinning
       * it to the result means the screen states one day, always: the one it is
       * actually showing.
       */
      temporal: TemporalContext;
    }
  | { kind: ExplorerErrorState; message: string };

/** Owner-facing calendar dates as dd/mm/yyyy (no locale short-month drift). */
const formatDate = (value: string): string => {
  const isoDay = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoDay) return `${isoDay[3]}/${isoDay[2]}/${isoDay[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

/**
 * Basic Price Explorer — the ONE and only Basic Price product experience
 * (Owner Decision: ONE SIMPROK BASIC PRICE PRODUCT MODEL). Any account with an
 * active workspace membership lands here directly at /basic-price: there is no
 * capability-space landing, no role-based variant, and no combination of
 * VIEW/IMPORT/REVIEW/PUBLISH decides what renders. Calls only the canonical
 * GET /basic-prices — no parallel explorer endpoint.
 *
 * IT IS A LIST OF CURRENTLY USABLE PRICES, NOT A MUSEUM (§6) — AND THAT IS THE
 * SERVER'S DOING, NOT THIS PAGE'S. `findAllForWorkspace` composes three
 * separate where-fragments before it returns a row: eligibility (published and
 * verified, or this workspace's own private asset), promotion precedence (a
 * workspace is never offered its own price twice), and currentness (superseded,
 * withdrawn, or restating something that is no longer current). This page
 * therefore needs no filter of its own to keep history out — and must never
 * grow one, because a second copy of that rule in the browser would drift from
 * the one the Cost Kernel reads.
 *
 * Because presence in this table ALREADY means "available for current use", no
 * row repeats "Siap Digunakan". The only status a row carries is the one that
 * actually varies between rows: its freshness.
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
   * BP-UX-FINAL-01 §4 — DEMOTED, NOT REMOVED. The room may have ONE primary
   * CTA, and it is Impor. These two are back-office rooms for a minority of
   * accounts, so they read as quiet links under the subtitle rather than as
   * buttons competing with the action everybody came for. Same routes, same
   * permission codes, same visibility law.
   */
  const { hasPermission } = useAuth();
  const curatesSubmissions = hasPermission('BASIC_PRICE_REVIEW_VIEW');
  const publishesPrices = hasPermission('BASIC_PRICE_PUBLISH');

  const [draft, setDraft] = useState<DraftFilters>(EMPTY_DRAFT);
  /**
   * Sorting is NOT part of the filter draft, deliberately: it narrows nothing,
   * so it must not make "Hapus filter" appear or suggest the list is filtered.
   */
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const requestGate = useRef(createLatestRequestGate());

  useEffect(() => {
    const sequence = requestGate.current.begin();

    const timer = window.setTimeout(() => {
      // Deferred to the debounce callback (a macrotask), not the effect's own
      // synchronous execution, so this is not a cascading in-effect setState.
      setState({ kind: 'loading' });

      const filters: ExplorerFilters = {
        search: draft.search || undefined,
        regionId: draft.region?.id,
        // ONE DATE, ONE QUESTION, ANSWERED SERVER-SIDE.
        //
        // `dateFrom`, `dateTo` and `year` are deliberately not sent. They narrow
        // which prices STARTED in a window; `asOf` asks which price APPLIED on a
        // day, which is the question the control's label actually promises. The
        // server's own ambiguity rule (year + range = 400) can therefore no
        // longer be tripped from this room at all.
        //
        // ABSENT MEANS NOW, resolved once at the server's request boundary. The
        // browser never computes an instant of its own.
        asOf: draft.effectiveOn || undefined,
        resourceType: draft.resourceType || undefined,
        sourceFamily: draft.sourceFamily || undefined,
        sourceName: draft.sourceName || undefined,
        page,
        limit: 20,
        sortBy: 'effectiveDate',
        sortOrder,
      };

      /*
       * THE ONE INSTANT THIS RESULT IS ABOUT, RESOLVED BESIDE THE REQUEST.
       *
       * An empty date means PRESENT — the same law the server states for an
       * absent `asOf`. A set date makes this an AS-OF lens, parsed to the exact
       * UTC midnight `parseDateOnlyUtc` produces on the server, so the screen
       * and the query can never disagree by a timezone.
       */
      const temporal = filters.asOf
        ? asOfContext(filters.asOf, new Date())
        : presentContext(new Date());

      void (async () => {
        try {
          const result = await fetchBasicPriceExplorer(filters);
          if (!requestGate.current.isLatest(sequence)) return;
          setState({
            kind: 'ready',
            items: result.data,
            meta: result.meta,
            temporal,
          });
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
    // NO exhaustive-deps SUPPRESSION ANY MORE, and that is a real improvement
    // rather than a tidy-up: the old effect closed over a filter draft holding
    // eleven fields plus a client-side validity check, so the dependency list
    // could not be stated honestly and the rule was silenced. Four values now
    // decide this request, all four are listed, and the linter agrees.
  }, [draft, sortOrder, page, reloadNonce]);

  const filtersActive = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT),
    [draft],
  );

  const updateDraft = <K extends keyof DraftFilters>(key: K, value: DraftFilters[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPage(1);
    // A detail panel describes ONE row. When the list beneath it changes, the
    // row it describes may no longer be there, so the panel closes rather than
    // lingering over a table that no longer contains its subject.
    setOpenDetailId(null);
  };

  const resetFilters = () => {
    setDraft(EMPTY_DRAFT);
    setPage(1);
    setOpenDetailId(null);
  };

  const reload = () => setReloadNonce((n) => n + 1);

  const openDetailItem =
    state.kind === 'ready' && openDetailId
      ? (state.items.find((item) => item.basicPriceId === openDetailId) ?? null)
      : null;

  return (
    <div className="bp-room">
      <header className="bp-head">
        <div>
          <div className="bp-head__crumb">SIMPROK / Basic Price</div>
          <h1 className="bp-head__title">Basic Price</h1>
          <p className="bp-head__sub">
            Daftar harga tenaga kerja, bahan, dan peralatan yang tersedia di SIMPROK.
          </p>
          {curatesSubmissions || publishesPrices ? (
            <nav className="bp-head__doors" aria-label="Ruang kurasi Basic Price">
              {curatesSubmissions ? (
                <button
                  type="button"
                  className="bp-btn bp-btn--link"
                  onClick={() => navigate('/basic-price/reviews')}
                  title="Harga yang diusulkan ke SIMPROK dan menunggu peninjauan"
                >
                  Pengajuan harga →
                </button>
              ) : null}
              {publishesPrices ? (
                <button
                  type="button"
                  className="bp-btn bp-btn--link"
                  onClick={() => navigate('/basic-price/publications')}
                  title="Harga yang sudah diverifikasi dan menunggu penerbitan"
                >
                  Siap diterbitkan →
                </button>
              ) : null}
            </nav>
          ) : null}
        </div>
        <div className="bp-head__actions">
          <button
            type="button"
            className="bp-btn"
            onClick={reload}
            title="Muat ulang"
            aria-label="Muat ulang"
          >
            <RefreshCw size={14} /> Muat ulang
          </button>
          <button
            type="button"
            className="bp-btn bp-btn--primary"
            onClick={() => navigate('/basic-price/import')}
            title="Impor atau tambah harga dasar"
          >
            <FileInput size={14} /> Impor / Tambah Harga
          </button>
          {/* Primary CTA wording locked for BP-VISUAL-USABILITY-05 */}
        </div>
      </header>

      <section className="bp-filters" aria-label="Filter Basic Price">
        <div className="bp-field bp-field--search">
          <label className="bp-field__label" htmlFor="bp-f-search">
            Cari
          </label>
          <input
            id="bp-f-search"
            className="bp-input"
            type="search"
            value={draft.search}
            onChange={(event) => updateDraft('search', event.target.value)}
            placeholder="Cari nama atau kode"
          />
        </div>

        <div className="bp-field">
          <label className="bp-field__label" htmlFor="bp-f-category">
            Kategori
          </label>
          <select
            id="bp-f-category"
            className="bp-select"
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
        </div>

        <ExplorerRegionFilterSelect
          selected={draft.region}
          onSelect={(region) => updateDraft('region', region)}
        />

        <div className="bp-field">
          <label className="bp-field__label" htmlFor="bp-f-family">
            Jenis sumber
          </label>
          <select
            id="bp-f-family"
            className="bp-select"
            value={draft.sourceFamily}
            onChange={(event) => updateDraft('sourceFamily', event.target.value)}
          >
            <option value="">Semua jenis</option>
            {SOURCE_FAMILY_OPTIONS.map((family) => (
              <option key={family} value={family}>
                {sourceFamilyLabel(family)}
              </option>
            ))}
          </select>
        </div>

        {/*
          NAMA SUMBER IS A TEXT SEARCH, NOT AN AUTOCOMPLETE, AND THAT IS A
          DELIBERATE REFUSAL.

          §5 prefers a searchable combobox "if the existing component system
          safely supports it". It does not: there is no source-name lookup
          endpoint anywhere in the API, so a combobox here would have to build
          its candidate list from the rows currently on screen — offering a
          handful of names as though they were the set of sources SIMPROK knows,
          and silently omitting every source not on this page. A text box
          promises exactly what it does.
        */}
        <div className="bp-field">
          <label className="bp-field__label" htmlFor="bp-f-sourcename">
            Nama sumber
          </label>
          <input
            id="bp-f-sourcename"
            className="bp-input"
            type="search"
            value={draft.sourceName}
            onChange={(event) => updateDraft('sourceName', event.target.value)}
            placeholder="mis. Dinas PUPR Kota Ambon"
          />
        </div>

        <div className="bp-field bp-field--date">
          <label className="bp-field__label" htmlFor="bp-f-date">
            Berlaku pada
          </label>
          <input
            id="bp-f-date"
            className="bp-input"
            type="date"
            value={draft.effectiveOn}
            aria-describedby="bp-f-date-help"
            onChange={(event) => updateDraft('effectiveOn', event.target.value)}
          />
          <span id="bp-f-date-help" className="bp-field__help">
            {EFFECTIVE_ON_DATE_HELP}
          </span>
        </div>

        {/*
          A RESET THAT APPEARS ONLY WHEN THERE IS SOMETHING TO RESET (§5). The
          old permanent "Bersihkan Filter" button occupied a filter slot on
          every visit in order to say nothing at all.
        */}
        {filtersActive ? (
          <div className="bp-filters__reset">
            <button type="button" className="bp-btn bp-btn--sm" onClick={resetFilters}>
              Hapus filter
            </button>
          </div>
        ) : null}
      </section>

      {/*
        AN AS-OF LENS MUST NEVER BE MISTAKEN FOR TODAY'S LIST (§C).

        Once a date is chosen the table is answering a different question, and
        every row in it may be a historical truth rather than a current one.
        Said once, above the table, and only when a date is actually set —
        a permanent line would be noise on the ordinary present-day view.
      */}
      {draft.effectiveOn ? (
        <p className="bp-note bp-note--info" aria-live="polite">
          {asOfContextLine(draft.effectiveOn, formatDate)}
        </p>
      ) : null}

      <div className="bp-tablebar">
        <span aria-live="polite">
          {state.kind === 'ready'
            ? `${state.meta.total} harga tersedia`
            : state.kind === 'loading'
              ? 'Memuat Basic Price...'
              : ''}
        </span>
        {/*
          SORTING LIVES WITH THE TABLE (§5), and offers only what the API can
          actually order by: `sortBy` is fixed to `effectiveDate` server-side,
          and resource name and price are NOT sortable columns — so no header
          here pretends to be clickable.
        */}
        <label className="bp-tablebar__sort">
          Urutkan
          <select
            className="bp-select bp-select--inline"
            value={sortOrder}
            onChange={(event) => {
              setSortOrder(event.target.value as 'asc' | 'desc');
              setPage(1);
            }}
            aria-label="Urutkan berdasarkan tanggal berlaku"
          >
            <option value="desc">Tanggal berlaku terbaru</option>
            <option value="asc">Tanggal berlaku terlama</option>
          </select>
        </label>
      </div>

      {state.kind === 'FORBIDDEN' ||
      state.kind === 'INVALID_FILTER' ||
      state.kind === 'NOT_FOUND' ||
      state.kind === 'SERVER_ERROR' ||
      state.kind === 'ERROR' ? (
        <p className="bp-note bp-note--danger" role="alert">
          {state.message}
        </p>
      ) : null}

      {state.kind === 'ready' && state.meta.total === 0 && !filtersActive ? (
        <div className="bp-empty">
          <p className="bp-empty__title">{EXPLORER_EMPTY_STATE_TITLE}</p>
          <p className="bp-empty__body">{EXPLORER_EMPTY_STATE_BODY}</p>
        </div>
      ) : null}

      {state.kind === 'ready' && state.meta.total === 0 && filtersActive ? (
        <div className="bp-empty">
          <p className="bp-empty__title">{EXPLORER_NO_MATCH_TITLE}</p>
          <button
            type="button"
            className="bp-btn bp-btn--sm"
            style={{ marginTop: '10px' }}
            onClick={resetFilters}
          >
            Hapus filter
          </button>
        </div>
      ) : null}

      {state.kind === 'ready' && state.meta.total > 0 && state.items.length === 0 ? (
        <div className="bp-empty">
          <p className="bp-empty__title">Halaman ini tidak memiliki hasil.</p>
          <p className="bp-empty__body">
            Total {state.meta.total} hasil ditemukan pada halaman lain.
          </p>
          <button
            type="button"
            className="bp-btn bp-btn--sm"
            style={{ marginTop: '10px' }}
            onClick={() => setPage(1)}
          >
            Kembali ke halaman 1
          </button>
        </div>
      ) : null}

      {openDetailItem && state.kind === 'ready' ? (
        /*
          §5.4 — DETAIL INHERITS THE LIST'S LENS, never a fresh present-tense
          one. `openDetailItem` is by construction a row of `state.items`, so
          the panel and the row it came from are read in the same instant.
        */
        <BasicPriceDetailPanel
          item={openDetailItem}
          formatDate={formatDate}
          onClose={() => setOpenDetailId(null)}
          temporal={state.temporal}
          onCurrentChanged={(successorId) => {
            setOpenDetailId(successorId);
            reload();
          }}
        />
      ) : null}

      {state.kind === 'ready' && state.items.length > 0 ? (
        <>
          <div className="bp-tablewrap">
            <table className="bp-table">
              <caption className="bp-visually-hidden">
                Daftar harga dasar yang tersedia untuk digunakan
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="bp-col-item">Item</th>
                  <th scope="col" className="bp-th-right bp-col-price">
                    Harga
                  </th>
                  <th scope="col" className="bp-col-unit">Satuan</th>
                  <th scope="col" className="bp-col-region">Wilayah</th>
                  <th scope="col" className="bp-col-source">Sumber</th>
                  <th scope="col" className="bp-col-status">Status</th>
                  <th scope="col" className="bp-th-right bp-col-detail">
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((item) => (
                  <tr key={item.basicPriceId}>
                    {/*
                      NAME FIRST (§7). `resourceLabel` leads with the code,
                      which is right for a one-line label and wrong for a table
                      a person scans by name — so the same two facts are stacked
                      rather than reordered, and the cell's accessible name
                      still uses the canonical label.
                    */}
                    <td
                      data-label="Item"
                      className="bp-cell-resource"
                      aria-label={resourceLabel(item.resource)}
                    >
                      {item.resource.name}
                      <small>
                        {item.resource.code ? `${item.resource.code} · ` : ''}
                        {resourceTypeLabel(item.resource.type)}
                      </small>
                    </td>
                    <td data-label="Harga" className="bp-cell-price">
                      {formatExplorerPrice(item.price)}
                    </td>
                    <td data-label="Satuan" className="bp-cell-unit">
                      {item.resource.baseUnit}
                    </td>
                    <td data-label="Wilayah" className="bp-cell-region">
                      {regionLabel(item.region)}
                    </td>
                    {/*
                      THE REAL SOURCE NAME (§7, §24) — "Dinas PUPR Provinsi
                      Maluku", never "Pemerintah". The family/origin is a coarser
                      internal grouping and stays in Detail and in the filter,
                      where a grouping is what you actually want. A row with no
                      provenance chain says so instead of borrowing its family's
                      name.
                    */}
                    <td data-label="Sumber" className="bp-cell-source">
                      {item.sourceName ? (
                        item.sourceName
                      ) : (
                        <span className="bp-cell-muted">
                          {explorerSourceNameLabel(item.sourceName)}
                        </span>
                      )}
                    </td>
                    <td data-label="Status">
                      {/*
                        THE CHIP SPEAKS IN THE TABLE'S TENSE (GAP-D). It is
                        handed the instant THESE rows were selected for, so a
                        price shown because it applied on a past day is
                        explained as of that day — never with present-tense
                        advice to go and check today's market.
                      */}
                      <FreshnessChip
                        facts={item}
                        basicPriceId={item.basicPriceId}
                        resourceName={item.resource.name}
                        formatDate={formatDate}
                        temporal={state.temporal}
                      />
                    </td>
                    <td data-label="Detail" className="bp-cell-action">
                      <button
                        type="button"
                        className="bp-btn bp-btn--link"
                        aria-expanded={openDetailId === item.basicPriceId}
                        onClick={() =>
                          setOpenDetailId((current) =>
                            current === item.basicPriceId ? null : item.basicPriceId,
                          )
                        }
                        title={`Lihat detail ${item.resource.name}`}
                      >
                        {openDetailId === item.basicPriceId ? 'Tutup' : 'Lihat'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bp-pager" aria-label="Navigasi halaman hasil">
            <button
              type="button"
              className="bp-btn bp-btn--sm"
              disabled={state.meta.page <= 1}
              aria-disabled={state.meta.page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Sebelumnya
            </button>
            <span>
              Halaman {state.meta.page} dari {Math.max(state.meta.totalPages, 1)}
            </span>
            <button
              type="button"
              className="bp-btn bp-btn--sm"
              disabled={state.meta.page >= state.meta.totalPages}
              aria-disabled={state.meta.page >= state.meta.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Berikutnya
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
