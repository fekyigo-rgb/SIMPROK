import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, FileInput, RefreshCw, Send, Trash2 } from 'lucide-react';
import { submitPrivateBasicPrice, reconcileImportedPrivateCorrection, ImportRequestError } from '../api/basicPriceImport';
import {
  BasicPriceExplorerError,
  fetchBasicPriceExplorer,
  removeOwnBasicPrice,
  type BasicPriceExplorerItem,
  type ExplorerFilters,
  type ExplorerPageMeta,
  type BasicPriceRegionIndex,
  type BasicPriceItemIndex,
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
  explorerVerifiedUnitLabel,
  formatExplorerPrice,
  basicPriceRegionLabel,
  basicPriceCorrectionPairKey,
  canProposePrivateExplorerItem,
  canLinkExistingImportedPricePair,
  correctionConsentMatchesPair,
  privateProposalIsNotPublication,
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
      regionIndex?: BasicPriceRegionIndex;
      selectedRegionGroup?: string | null;
      itemIndex?: BasicPriceItemIndex;
      selectedItemId?: string | null;
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
  // One sortable choice shared by dropdown, header arrows and fetch effect.
  type SortKey = 'effectiveDate' | 'resourceName' | 'price';
  type SortDirection = 'asc' | 'desc';
  type SortChoice = `${SortKey}:${SortDirection}`;
  // Owner-approved neutral view: show the canonical Item list A–Z on entry.
  // This is presentation state only; other sort choices remain available.
  const [sortOrder, setSortOrder] = useState<SortChoice>('resourceName:asc');
  const [sortBy, sortDirection] = sortOrder.split(':') as [SortKey, SortDirection];
  // Collection is table-scoped, as is sorting. Empty = unchanged combined list.
  const [collection, setCollection] = useState<'' | 'WORKSPACE_PRIVATE' | 'SIMPROK_CATALOG'>('');
  const [page, setPage] = useState(1);
  /** The first region group is server-selected from the canonical eligible set. */
  const [regionGroup, setRegionGroup] = useState('first');
  const [itemGroup, setItemGroup] = useState('first');
  const [itemPage, setItemPage] = useState(1);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [state, setState] = useState<ListState>({ kind: 'loading' });
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  /**
   * SAVE FEEDBACK LIVES WITH THE OPEN ROW. One notice, cleared on Tutup /
   * another Lihat, so a correction confirmation cannot stack.
   */
  const [detailNotice, setDetailNotice] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionWinnerId, setCorrectionWinnerId] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionConfirmed, setCorrectionConfirmed] = useState(false);
  const [correctionConsentPairKey, setCorrectionConsentPairKey] = useState<string | null>(null);
  const requestGate = useRef(createLatestRequestGate());

  const resetCorrectionForm = () => {
    setCorrectionOpen(false);
    setCorrectionWinnerId('');
    setCorrectionReason('');
    setCorrectionConfirmed(false);
    setCorrectionConsentPairKey(null);
  };

  const replaceSelectedIds = (
    next: Set<string> | ((previous: Set<string>) => Set<string>),
  ) => {
    // Selection is the object of the human decision. Any selection mutation
    // invalidates the entire form before the next pair can be presented.
    resetCorrectionForm();
    setSelectedIds(next);
  };

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
        collection: collection || undefined,
        page,
        limit: 50,
        regionBrowse: 'true',
        regionGroup,
        itemBrowse: 'true',
        itemGroup,
        itemPage,
        sortBy,
        sortOrder: sortDirection,
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
            regionIndex: result.regionIndex,
            selectedRegionGroup: result.selectedRegionGroup,
            itemIndex: result.itemIndex,
            selectedItemId: result.selectedItemId,
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
  }, [draft, collection, sortOrder, page, reloadNonce, regionGroup, itemGroup, itemPage]);

  const filtersActive = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(EMPTY_DRAFT) || collection !== '',
    [draft, collection],
  );

  const updateDraft = <K extends keyof DraftFilters>(key: K, value: DraftFilters[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    replaceSelectedIds(new Set());
    setSelectionNotice(null);
    setPage(1);
    setRegionGroup('first');
    setItemGroup('first');
    setItemPage(1);
    // A detail panel describes ONE row. When the list beneath it changes, the
    // row it describes may no longer be there, so the panel closes rather than
    // lingering over a table that no longer contains its subject.
    setOpenDetailId(null);
    setDetailNotice(null);
  };

  const resetFilters = () => {
    setDraft(EMPTY_DRAFT);
    setCollection('');
    setRegionGroup('first');
    setItemGroup('first');
    setItemPage(1);
    setSortOrder('resourceName:asc');
    replaceSelectedIds(new Set());
    setSelectionNotice(null);
    setPage(1);
    setOpenDetailId(null);
    setDetailNotice(null);
  };

  const reload = () => {
    replaceSelectedIds(new Set());
    setReloadNonce((n) => n + 1);
  };

  // One canonical server sort for BOTH the table arrows and Urutkan.
  // A sort switch invalidates the old page's selection and open detail.
  const chooseSort = (
    nextBy: SortKey,
    nextOrder: SortDirection,
  ) => {
    setSortOrder(`${nextBy}:${nextOrder}`);
    replaceSelectedIds(new Set());
    setSelectionNotice(null);
    setPage(1);
    setOpenDetailId(null);
    setDetailNotice(null);
  };

  const chooseRegionGroup = (key: string) => {
    setRegionGroup(key);
    setItemGroup('first');
    setItemPage(1);
    replaceSelectedIds(new Set());
    setSelectionNotice(null);
    setPage(1);
    setOpenDetailId(null);
    setDetailNotice(null);
  };
  const chooseItemPage = (nextPage: number) => {
    setItemPage(nextPage);
    setItemGroup('first');
    replaceSelectedIds(new Set());
    setSelectionNotice(null);
    setPage(1);
    setOpenDetailId(null);
    setDetailNotice(null);
  };

  const chooseItemGroup = (id: string) => {
    setItemGroup(id);
    replaceSelectedIds(new Set());
    setSelectionNotice(null);
    setPage(1);
    setOpenDetailId(null);
    setDetailNotice(null);
  };

  const openDetailItem =
    state.kind === 'ready' && openDetailId
      ? (state.items.find((item) => item.basicPriceId === openDetailId) ?? null)
      : null;

  const visibleRows = state.kind === 'ready' ? state.items : [];
  const selectedRows = visibleRows.filter((item) => selectedIds.has(item.basicPriceId));
  const correctionPairKey = basicPriceCorrectionPairKey(
    selectedRows.map((item) => item.basicPriceId),
  );
  const allPageSelected =
    visibleRows.length > 0 && visibleRows.every((item) => selectedIds.has(item.basicPriceId));
  const canSubmit = hasPermission('BASIC_PRICE_SUBMIT');
  const proposableRows = selectedRows.filter((item) => canProposePrivateExplorerItem(item, canSubmit));
  const removableRows = selectedRows.filter((item) => item.canRemoveOwn === true);
  // UI invitation only. The server rechecks the actual persisted publisher,
  // resource identity, temporal context, trusted actor and both original files.
  const canReconcileImportedPair = hasPermission('BASIC_PRICE_SUBMIT') &&
    selectedRows.length === 2 &&
    canLinkExistingImportedPricePair(selectedRows[0], selectedRows[1]);

  const toggleOne = (id: string) => {
    setSelectionNotice(null);
    replaceSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const togglePage = () => {
    setSelectionNotice(null);
    replaceSelectedIds((previous) => {
      const next = new Set(previous);
      for (const item of visibleRows) {
        if (allPageSelected) next.delete(item.basicPriceId);
        else next.add(item.basicPriceId);
      }
      return next;
    });
  };

  const reconcileSelectedCorrection = async () => {
    if (
      selectionBusy ||
      !canReconcileImportedPair ||
      !correctionReason.trim() ||
      !correctionConsentMatchesPair(
        correctionConsentPairKey,
        selectedRows.map((row) => row.basicPriceId),
        correctionWinnerId,
        correctionConfirmed,
      )
    ) return;
    const correct = selectedRows.find(row => row.basicPriceId === correctionWinnerId);
    const previous = selectedRows.find(row => row.basicPriceId !== correctionWinnerId);
    if (!correct || !previous) return;
    setSelectionBusy(true);
    setSelectionNotice(null);
    try {
      const result = await reconcileImportedPrivateCorrection(
        previous.basicPriceId, correct.basicPriceId,
        previous.price, correct.price, correctionReason.trim(),
      );
      setCorrectionOpen(false);
      setCorrectionWinnerId('');
      setCorrectionReason('');
      setCorrectionConfirmed(false);
      setCorrectionConsentPairKey(null);
      replaceSelectedIds(new Set());
      setReloadNonce(n => n + 1);
      setSelectionNotice(result.unchanged
        ? 'Hubungan koreksi ini sudah tercatat; harga tidak digandakan.'
        : 'Koreksi harga tercatat. Harga sebelumnya tetap dapat dibaca dalam riwayat; tampilan harga berlaku dimuat ulang.');
    } catch (error) {
      const code = error instanceof ImportRequestError ? error.detail : '';
      setSelectionNotice('Koreksi belum dilakukan. Periksa sumber, identitas, atau hak akses; tidak ada harga yang diubah. ' +
        (code ? 'Server: ' + code.slice(0, 180) : 'Silakan muat ulang data.'));
    } finally {
      setSelectionBusy(false);
    }
  };

  const exportSelection = () => {
    if (!selectedRows.length || selectionBusy) return;
    // Reuse AHSP's Blob/CSV download pattern. No secondary price calculation:
    // values are exact decimal strings from the canonical Explorer projection.
    const values: string[][] = [
      ['Item', 'Kategori', 'Kode', 'Harga (Rp)', 'Satuan', 'Wilayah', 'Sumber', 'Berlaku pada'],
      ...selectedRows.map((item) => [
        item.resource.name,
        resourceTypeLabel(item.resource.type),
        item.resource.code ?? '',
        item.price,
        explorerVerifiedUnitLabel(item.resource),
        basicPriceRegionLabel(item),
        item.sourceName ?? '',
        formatDate(item.effectiveDate),
      ]),
    ];
    const safeCell = (value: string) => {
      // Keep Excel from interpreting source-controlled content as a formula.
      const protectedValue = /^[\s]*[=+\-@\t\r]/u.test(value) ? "'" + value : value;
      return '"' + protectedValue.replace(/"/g, '""') + '"';
    };
    const csv = values.map((row) => row.map(safeCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'basic-price-terpilih.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setSelectionNotice(String(selectedRows.length) + ' harga diekspor dari halaman aktif.');
  };

  const removeSelection = async () => {
    if (selectionBusy || !removableRows.length) return;
    if (!window.confirm(
      'Hapus ' + removableRows.length + ' harga privat milik Anda dari daftar aktif? ' +
      'Riwayat tetap disimpan; harga publik dan yang terkait AHSP/RAB tidak dapat dihapus.',
    )) return;
    setSelectionBusy(true);
    setSelectionNotice(null);
    let removed = 0;
    let blocked = 0;
    const refusalReasons: string[] = [];
    const remaining = new Set(selectedRows.filter(
      (row) => row.canRemoveOwn !== true,
    ).map((row) => row.basicPriceId));
    try {
      for (const item of removableRows) {
        try {
          await removeOwnBasicPrice(item.basicPriceId);
          removed += 1;
        } catch (error) {
          blocked += 1;
          remaining.add(item.basicPriceId);
          let code = '';
          if (error instanceof BasicPriceExplorerError) {
            try {
              const payload = JSON.parse(error.message) as { message?: string };
              code = typeof payload.message === 'string' ? payload.message : '';
            } catch { /* Unknown server response: do not guess. */ }
          }
          const why = code === 'BASIC_PRICE_REFERENCED_PROTECTED'
            ? 'terkait harga lain, observasi, atau AHSP/RAB'
            : code === 'PRICE_PROPOSAL_HISTORY_PROTECTED'
              ? 'sudah memiliki riwayat pengajuan'
              : error instanceof BasicPriceExplorerError && error.status === 404
                ? 'tidak ditemukan atau bukan milik akun ini'
                : error instanceof BasicPriceExplorerError && error.status === 403
                  ? 'akses tidak diizinkan'
                  : 'gagal diproses oleh server';
          refusalReasons.push(item.resource.name + ': ' + why);
        }
      }
    } finally {
      replaceSelectedIds(remaining);
      setSelectionBusy(false);
      setReloadNonce((n) => n + 1);
      setSelectionNotice(
        removed + ' harga privat dikeluarkan dari daftar aktif. ' +
        blocked + ' tidak dapat dihapus karena perlindungan atau perubahan status. ' +
        (selectedRows.length - removableRows.length) +
        ' item tidak memenuhi syarat (publik, bukan milik akun, atau mempunyai hubungan/riwayat yang dilindungi).' +
        (refusalReasons.length ? ' Alasan: ' + refusalReasons.join('; ') + '.' : ''),
      );
    }
  };

  const submitSelection = async () => {
    if (selectionBusy || !proposableRows.length) return;
    if (!window.confirm('Usulkan ' + proposableRows.length + ' harga privat ke SIMPROK untuk ditinjau?')) return;
    setSelectionBusy(true);
    setSelectionNotice(null);
    let submitted = 0;
    let already = 0;
    let failed = 0;
    const stillSelected = new Set(
      selectedRows.filter((row) => !proposableRows.some((p) => p.basicPriceId === row.basicPriceId))
        .map((row) => row.basicPriceId),
    );
    try {
      for (const item of proposableRows) {
        try {
          const result = await submitPrivateBasicPrice(item.basicPriceId);
          if (!privateProposalIsNotPublication(result)) {
            failed += 1;
            stillSelected.add(item.basicPriceId);
          } else if (result.alreadyProposed) {
            already += 1;
          } else {
            submitted += 1;
          }
        } catch {
          failed += 1;
          stillSelected.add(item.basicPriceId);
        }
      }
    } finally {
      replaceSelectedIds(stillSelected);
      setSelectionBusy(false);
      setReloadNonce((n) => n + 1);
      setSelectionNotice(
        submitted + ' harga berhasil diusulkan. ' +
        already + ' sudah pernah diusulkan. ' +
        failed + ' gagal; tetap terpilih untuk ditinjau. ' +
        (selectedRows.length - proposableRows.length) + ' tidak memenuhi syarat.',
      );
    }
  };

  useEffect(() => {
    if (!openDetailId) return;
    const selectedRow = document.querySelector(`[data-bp-row-id="${openDetailId}"]`);
    if (selectedRow instanceof HTMLElement) {
      selectedRow.scrollIntoView({ block: 'nearest' });
    }
  }, [openDetailId]);

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

        <div className="bp-field bp-field--date bp-date-help">
          <label className="bp-field__label bp-date-help__trigger" htmlFor="bp-f-date" title={EFFECTIVE_ON_DATE_HELP}>
            Berlaku pada
          </label>
          <input
            id="bp-f-date"
            className="bp-input"
            type="date"
            value={draft.effectiveOn}
            title={EFFECTIVE_ON_DATE_HELP}
            aria-describedby="bp-f-date-help"
            onChange={(event) => updateDraft('effectiveOn', event.target.value)}
          />
          <span id="bp-f-date-help" className="bp-date-help__tooltip" role="tooltip">
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

      {state.kind === 'ready' && state.regionIndex ? (
        <nav className="bp-region-first" aria-label="Jelajah harga berdasarkan provinsi dan kota">
          <div className="bp-region-first__heading">
            <strong>Jelajahi wilayah</strong>
            <span>{state.regionIndex.total} harga di seluruh wilayah</span>
          </div>
          {state.regionIndex.provinces.map((province) => (
            <details className="bp-region-first__province" key={province.id}>
              <summary>{province.name} <span>{province.priceCount} harga</span></summary>
              <div className="bp-region-first__cities">
                {province.provinceOnly.count > 0 ? (
                  <button type="button" className="bp-region-first__city"
                    aria-pressed={state.selectedRegionGroup === province.provinceOnly.key}
                    onClick={() => chooseRegionGroup(province.provinceOnly.key)}>
                    Berlaku seluruh provinsi <span>{province.provinceOnly.count}</span>
                  </button>
                ) : null}
                {province.cities.map((city) => (
                  <button type="button" key={city.key} className="bp-region-first__city"
                    aria-pressed={state.selectedRegionGroup === city.key}
                    onClick={() => chooseRegionGroup(city.key)}>
                    {city.name} <span>{city.priceCount}</span>
                  </button>
                ))}
              </div>
            </details>
          ))}
          {state.regionIndex.unverified.count > 0 ? (
            <button type="button" className="bp-region-first__uncertain"
              aria-pressed={state.selectedRegionGroup === 'unverified'}
              title="Hierarki wilayah harga historis belum terverifikasi"
              onClick={() => chooseRegionGroup('unverified')}>
              Wilayah belum terverifikasi <span>{state.regionIndex.unverified.count} harga</span>
            </button>
          ) : null}
          {state.regionIndex.general.count > 0 ? (
            <button type="button" className="bp-region-first__uncertain"
              aria-pressed={state.selectedRegionGroup === 'general'}
              onClick={() => chooseRegionGroup('general')}>
              Umum (tanpa wilayah) <span>{state.regionIndex.general.count} harga</span>
            </button>
          ) : null}
        </nav>
      ) : null}

      {state.kind === 'ready' && state.itemIndex ? (
        <section className="bp-item-summary" aria-label="Item harga pada wilayah terpilih">
          <div className="bp-item-summary__heading">
            <strong>Item A–Z</strong>
            <span>{state.itemIndex.totalItems} item · {state.itemIndex.totalPrices} catatan harga</span>
          </div>
          <ul className="bp-item-summary__list">
            {state.itemIndex.items.map((item) => (
              <li key={item.id}>
                <button type="button" className="bp-item-summary__button"
                  aria-pressed={state.selectedItemId === item.id}
                  aria-label={`Buka ${item.priceCount} catatan harga ${item.name}`}
                  onClick={() => chooseItemGroup(item.id)}>
                  <span className="bp-item-summary__identity">
                    <strong>{item.name}</strong>
                    <small>{resourceTypeLabel(item.type)} · {item.baseUnit}
                      {item.duplicateName
                        ? ` · ${item.code ?? 'Ref. ' + item.id.slice(0, 8)}` : ''}
                    </small>
                  </span>
                  <span className="bp-item-summary__count">{item.priceCount} harga</span>
                </button>
              </li>
            ))}
          </ul>
          {(state.itemIndex.totalPages ?? 0) > 1 ? (
            <div className="bp-item-summary__pager" aria-label="Halaman daftar item">
              <button type="button" disabled={(state.itemIndex.page ?? 1) <= 1}
                onClick={() => chooseItemPage((state.itemIndex!.page ?? 1) - 1)}>
                Sebelumnya
              </button>
              <span>Item halaman {state.itemIndex.page} dari {state.itemIndex.totalPages}</span>
              <button type="button"
                disabled={(state.itemIndex.page ?? 1) >= (state.itemIndex.totalPages ?? 1)}
                onClick={() => chooseItemPage((state.itemIndex!.page ?? 1) + 1)}>
                Berikutnya
              </button>
            </div>
          ) : null}
        </section>
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
          Sort is server-side before pagination. The existing date presets
          remain; only price (numeric) and item name have verified sortable
          canonical fields. Source/status/unit are derived and keep static
          headers rather than advertise sorting that could mislead users.
        */}
        <div className="bp-tablebar__controls">
          <label className="bp-tablebar__sort">
            Koleksi
            <select
              className="bp-select bp-select--inline"
              value={collection}
              aria-label="Filter koleksi harga"
              onChange={(event) => {
                setCollection(event.target.value as typeof collection);
                replaceSelectedIds(new Set());
                setSelectionNotice(null);
                setPage(1);
                setRegionGroup('first');
    setItemGroup('first');
    setItemPage(1);
                setOpenDetailId(null);
                setDetailNotice(null);
              }}
            >
              <option value="">Semua harga</option>
              <option value="WORKSPACE_PRIVATE">Harga Privat</option>
              <option value="SIMPROK_CATALOG">Pustaka SIMPROK</option>
            </select>
          </label>
          <label className="bp-tablebar__sort">
            Urutkan
            <select
              className="bp-select bp-select--inline"
              value={sortOrder}
              onChange={(event) => {
                const [nextBy, nextOrder] = event.target.value.split(':');
                if (
                  (nextBy === 'effectiveDate' || nextBy === 'resourceName' || nextBy === 'price') &&
                  (nextOrder === 'asc' || nextOrder === 'desc')
                ) {
                  chooseSort(nextBy, nextOrder);
                }
              }}
              aria-label="Urutkan daftar harga"
            >
              <option value="effectiveDate:desc">Tanggal berlaku terbaru</option>
              <option value="effectiveDate:asc">Tanggal berlaku terlama</option>
              <option value="resourceName:asc">Item A–Z</option>
              <option value="resourceName:desc">Item Z–A</option>
              <option value="price:asc">Harga terendah</option>
              <option value="price:desc">Harga tertinggi</option>
            </select>
          </label>
        </div>
      </div>

      {selectedRows.length > 0 ? (
        <div className="bp-selectionbar" role="group" aria-label="Aksi Basic Price terpilih">
          <span aria-live="polite">
            {selectedRows.length} dari {visibleRows.length} harga di halaman ini dipilih
          </span>
          <button type="button" className="bp-btn bp-btn--sm bp-btn--proposal" disabled={selectionBusy || !proposableRows.length}
            title="Hanya harga privat yang belum diusulkan dan memiliki izin pengajuan"
            onClick={() => void submitSelection()}>
            <Send size={14} /> {selectionBusy ? 'Memproses...' : 'Usulkan ke SIMPROK'}
          </button>
          {canReconcileImportedPair ? (
            <button type="button" className="bp-btn bp-btn--sm"
              disabled={selectionBusy}
              onClick={() => {
                setCorrectionOpen(open => !open);
                setCorrectionConfirmed(false);
                setCorrectionConsentPairKey(null);
              }}>
              Hubungkan koreksi harga
            </button>
          ) : null}
          <button type="button" className="bp-btn bp-btn--sm" disabled={selectionBusy} onClick={exportSelection}>
            <Download size={14} /> Export
          </button>
          <button type="button" className="bp-btn bp-btn--sm"
            disabled={selectionBusy || !removableRows.length}
            title="Hanya harga privat milik akun ini yang belum diajukan dan tidak memiliki referensi terlindungi"
            onClick={() => void removeSelection()}>
            <Trash2 size={14} /> Hapus
          </button>
          <button type="button" className="bp-btn bp-btn--link" disabled={selectionBusy}
            onClick={() => { replaceSelectedIds(new Set()); setSelectionNotice(null); }}>
            Batal pilih
          </button>
        </div>
      ) : null}
      {correctionOpen && canReconcileImportedPair ? (
        <section className="bp-note" aria-label="Tentukan harga yang benar" style={{ marginBottom: 12 }}>
          <strong>Koreksi dua harga yang sudah tersimpan</strong>
          <p className="bp-field__help">
            Pilih harga yang benar. Harga lama tidak dihapus dan tetap tercatat pada riwayat koreksi.
            Hanya boleh digunakan untuk dua harga dari penerbit, resource, satuan, wilayah, dan periode yang sama.
          </p>
          {selectedRows.map(row => (
            <label className="bp-choice__item" key={row.basicPriceId} style={{ display: 'block' }}>
              <input type="radio" name="bp-existing-price-winner"
                checked={correctionWinnerId === row.basicPriceId}
                onChange={() => {
                  setCorrectionWinnerId(row.basicPriceId);
                  setCorrectionConfirmed(false);
                  setCorrectionConsentPairKey(null);
                }}/>
              {' '} Harga yang benar: {formatExplorerPrice(row.price)} — {resourceLabel(row.resource)}
            </label>
          ))}
          <label className="bp-field" style={{ marginTop: 8 }}>
            <span className="bp-field__label">Alasan dan dasar koreksi</span>
            <textarea className="bp-textarea" value={correctionReason}
              onChange={event => {
                setCorrectionReason(event.target.value);
                setCorrectionConfirmed(false);
                setCorrectionConsentPairKey(null);
              }}
              placeholder="Contoh: Penerbit mengoreksi harga sebelumnya yang salah."/>
          </label>
          <label className="bp-choice__item" style={{ display: 'block', marginTop: 8 }}>
            <input type="checkbox" checked={correctionConfirmed}
              onChange={event => {
                const confirmed = event.target.checked;
                setCorrectionConfirmed(confirmed);
                setCorrectionConsentPairKey(confirmed ? correctionPairKey : null);
              }}/>
            {' '} Saya memastikan harga terpilih mengoreksi catatan lama, bukan harga dari varian teknis atau sumber berbeda.
          </label>
          <button type="button" className="bp-btn bp-btn--sm"
            disabled={selectionBusy || !correctionWinnerId || !correctionReason.trim() || !correctionConfirmed}
            onClick={() => void reconcileSelectedCorrection()}>
            {selectionBusy ? 'Mencatat koreksi...' : 'Simpan hubungan koreksi'}
          </button>
        </section>
      ) : null}
      {selectionNotice ? (
        <p className="bp-note bp-note--info" role="status" aria-live="polite">{selectionNotice}</p>
      ) : null}

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
onClick={() => { replaceSelectedIds(new Set()); setPage(1); }}
          >
            Kembali ke halaman 1
          </button>
        </div>
      ) : null}

      {state.kind === 'ready' && state.items.length > 0 ? (
        <>
          <div className="bp-tablewrap">
            <table className="bp-table bp-table--explorer">
              <caption className="bp-visually-hidden">
                Daftar harga dasar yang tersedia untuk digunakan
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="bp-col-select">
                    <input type="checkbox" aria-label="Pilih semua harga di halaman ini"
                      checked={allPageSelected}
                      ref={(node) => { if (node) node.indeterminate = selectedRows.length > 0 && !allPageSelected; }}
                      onChange={togglePage} />
                  </th>
                  <th scope="col" className="bp-col-item" aria-sort={sortBy === 'resourceName' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    Item
                    <button
                      type="button"
                      className="bp-table__sortbtn"
                      title="Urutkan item berdasarkan nama"
                      aria-label="Urutkan item A sampai Z atau Z sampai A"
                      onClick={() => chooseSort('resourceName', sortBy === 'resourceName' && sortDirection === 'asc' ? 'desc' : 'asc')}
                    >
                      {sortBy !== 'resourceName' ? <ArrowUpDown size={12} aria-hidden /> : sortDirection === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}
                    </button>
                  </th>
                  <th scope="col" className="bp-th-right bp-col-price" aria-sort={sortBy === 'price' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    Harga
                    <button
                      type="button"
                      className="bp-table__sortbtn bp-table__sortbtn--price"
                      title="Urutkan harga terendah atau tertinggi"
                      aria-label="Urutkan harga terendah atau tertinggi"
                      onClick={() => chooseSort('price', sortBy === 'price' && sortDirection === 'desc' ? 'asc' : 'desc')}
                    >
                      {sortBy !== 'price' ? <ArrowUpDown size={12} aria-hidden /> : sortDirection === 'asc' ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}
                    </button>
                  </th>
                  <th scope="col" className="bp-col-unit">Satuan</th>
                  <th scope="col" className="bp-col-region">Wilayah Berlaku</th>
                  <th scope="col" className="bp-col-source">Sumber</th>
                  <th scope="col" className="bp-col-status">Status</th>
                  <th scope="col" className="bp-th-right bp-col-detail">
                    Detail
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((item) => (
                  <Fragment key={item.basicPriceId}>
                  <tr
                    className={openDetailId === item.basicPriceId ? 'bp-row--open' : undefined}
                    data-bp-row-id={item.basicPriceId}
                  >
                    <td data-label="Pilih" className="bp-cell-select">
                      <input type="checkbox" checked={selectedIds.has(item.basicPriceId)}
                        aria-label={'Pilih harga ' + item.resource.name}
                        onChange={() => toggleOne(item.basicPriceId)} />
                    </td>
                    {/*
                      SIMPLE OUTSIDE: name and category are sufficient in the
                      summary. The canonical code stays in the accessible name,
                      record identity, search, and Detail, never discarded.
                    */}
                    <td
                      data-label="Item"
                      className="bp-cell-resource"
                      aria-label={resourceLabel(item.resource)}
                    >
                      {item.resource.name}
                      <small>{resourceTypeLabel(item.resource.type)}</small>
                    </td>
                    <td data-label="Harga" className="bp-cell-price">
                      {formatExplorerPrice(item.price)}
                    </td>
                    <td data-label="Satuan" className="bp-cell-unit">
                      <span title={item.resource.displayUnit === null ? 'Satuan harga perlu diverifikasi oleh Unit Kernel' : 'Satuan harga terverifikasi (tanpa konversi)'}>
                        {explorerVerifiedUnitLabel(item.resource)}
                      </span>
                    </td>
                    <td data-label="Wilayah Berlaku" className="bp-cell-region">
                      {basicPriceRegionLabel(item)}
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
                        onClick={() => {
                          setDetailNotice(null);
                          setOpenDetailId((current) =>
                            current === item.basicPriceId ? null : item.basicPriceId,
                          );
                        }}
                        title={`Lihat detail ${item.resource.name}`}
                      >
                        {openDetailId === item.basicPriceId ? 'Tutup' : 'Lihat'}
                      </button>
                    </td>
                  </tr>
                  {openDetailItem && openDetailId === item.basicPriceId ? (
                    <tr className="bp-detail-anchor">
                       <td colSpan={8}>
                        {/*
                          BP-UX-DETAIL-ANCHOR-01 — Detail sits under THIS row,
                          not above the table. Same panel, same openDetailId,
                          same list lens.
                        */}
                        <BasicPriceDetailPanel
                          item={openDetailItem}
                          formatDate={formatDate}
                          temporal={state.temporal}
                          notice={detailNotice}
                          onClose={() => {
                            setOpenDetailId(null);
                            setDetailNotice(null);
                          }}
                          onSavedNotice={(notice) => setDetailNotice(notice)}
                          onCurrentChanged={(successorId, notice) => {
                            setOpenDetailId(successorId);
                            setDetailNotice(notice ?? 'Perubahan harga berhasil disimpan.');
                            reload();
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
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
onClick={() => { replaceSelectedIds(new Set()); setSelectionNotice(null); setPage((current) => Math.max(1, current - 1)); }}
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
onClick={() => { replaceSelectedIds(new Set()); setSelectionNotice(null); setPage((current) => current + 1); }}
            >
              Berikutnya
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
