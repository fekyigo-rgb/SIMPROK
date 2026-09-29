import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Plus, Search, RefreshCw, Eye, MoreHorizontal, Trash2, Send, Download, X, ChevronsUpDown } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { canProposeAhsp } from '../utils/ahspProposalStatus';
import { USULKAN_TOOLTIP } from '../utils/ahspProposalCopy';
import { presentAhspIdentity } from '../utils/ahspIdentityDisplay';
import {
  NETWORK_FAILURE,
  describeBulkDelete,
  describeBulkPropose,
  readApiFailure,
  type ActionOutcome,
  type ApiFailure,
} from '../utils/ahspActionFeedback';
import { UsulkanSimprokDialog } from '../components/ahsp/UsulkanSimprokDialog';
import { ActionOutcomeNotice } from '../components/ahsp/ActionOutcomeNotice';
import { BIDANG, JENIS_PEKERJAAN, mergeVocabulary, subkategoriForBidang } from '../constructionTaxonomy';
import { JENIS_PENGADAAN_OPTIONS } from '../jenisPengadaanVocabulary';
import '../styles/ahsp.css';

/**
 * THE standalone AHSP room — the one door the sidebar opens, in the Owner
 * mockup's shape. Discovery uses GET /ahsp; "Usulkan ke SIMPROK" uses the
 * existing POST /ahsp/:id/propose lifecycle (behind an Owner-locked tooltip +
 * confirmation). Import and unresolved-resource curation live behind their OWN
 * door (/ahsp/import) so this list stays a clean library, never a process dump.
 *
 * The Kategori/Subkategori/Jenis filters draw vocabulary from the ONE shared
 * construction taxonomy (constructionTaxonomy.ts), merged with values actually
 * present in the data so no stored value is ever hidden. Jenis Pengadaan uses
 * the shared vocabulary for presentation; list rows do not yet carry a
 * dedicated assignment consumer — selection is honest visual parity, not a
 * second backend filter engine.
 */

type AhspRow = {
  id: string;
  workspaceId: string | null;
  workType: string | null;
  methodName: string | null;
  code: string | null;
  fieldCategory: string | null;
  subCategory: string | null;
  classification: string | null;
  ownershipType: string | null;
  reviewStatus: string | null;
  proposedAt: string | null;
  archivedAt: string | null;
  versions?: Array<{ outputUnit: string | null; regulationReference: string | null }> | null;
};

type RoomState =
  | { phase: 'LOADING' }
  | { phase: 'READY'; rows: AhspRow[] }
  | { phase: 'FAILED'; message: string };

const NAVY = 'var(--simprok-authority-navy-800)';
const MUTED = 'var(--simprok-engineering-blue-500)';
const HAIRLINE = '1px solid var(--simprok-engineering-blue-100)';
const CARD: CSSProperties = { background: '#FFFFFF', border: HAIRLINE, borderRadius: '12px', padding: 'var(--space-4)' };

const PAGE_SIZE = 10;
const ownershipLabel = (workspaceId: string | null) => (workspaceId === null ? 'Pustaka SIMPROK' : 'AHSP Saya');
const orDash = (v: string | null | undefined) => (v == null || v === '' ? <span style={{ color: MUTED }}>—</span> : String(v));

export function AhspRoomPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const canCurate = hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE');
  const [state, setState] = useState<RoomState>({ phase: 'LOADING' });
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'ALL' | 'SIMPROK' | 'MINE'>('ALL');
  const [jenisPengadaan, setJenisPengadaan] = useState('');
  const [kategori, setKategori] = useState('');
  const [subkategori, setSubkategori] = useState('');
  const [jenis, setJenis] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  // Which bulk request is running, so each button tells the truth about itself.
  const [selectionAction, setSelectionAction] = useState<'PROPOSE' | 'DELETE' | null>(null);
  const selectionBusy = selectionAction !== null;
  // What the last bulk action actually did — shown where the selection bar was.
  const [selectionOutcome, setSelectionOutcome] = useState<ActionOutcome | null>(null);
  const [showProposeConfirm, setShowProposeConfirm] = useState(false);

  const loadList = async (): Promise<AhspRow[] | null> => {
    const response = await apiFetch('/ahsp');
    if (!response.ok) return null;
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await apiFetch('/ahsp');
        if (!response.ok) {
          if (!active) return;
          setState({
            phase: 'FAILED',
            message:
              response.status === 401 || response.status === 403
                ? 'Workspace aktif Anda tidak memiliki kewenangan untuk membuka daftar AHSP.'
                : 'Daftar AHSP belum dapat dibaca. Coba lagi sebentar.',
          });
          return;
        }
        const data = await response.json();
        if (!active) return;
        setState({ phase: 'READY', rows: Array.isArray(data) ? data : [] });
      } catch {
        if (!active) return;
        setState({ phase: 'FAILED', message: 'Daftar AHSP tidak dapat dihubungi.' });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const allRows = useMemo(() => (state.phase === 'READY' ? state.rows : []), [state]);

  // The union of every curated Subkategori — the option set when no Kategori is chosen.
  const allCuratedSub = useMemo(() => BIDANG.flatMap((b) => subkategoriForBidang(b)), []);

  const options = useMemo(() => {
    // Subkategori is context-aware: curated to the chosen Kategori, then merged with
    // the Subkategori values that Kategori's rows actually carry (never hidden).
    const rowsForSub = kategori ? allRows.filter((r) => (r.fieldCategory ?? '') === kategori) : allRows;
    const curatedSub = kategori ? subkategoriForBidang(kategori) : allCuratedSub;
    return {
      kategori: mergeVocabulary(BIDANG, allRows.map((r) => r.fieldCategory)),
      subkategori: mergeVocabulary(curatedSub, rowsForSub.map((r) => r.subCategory)),
      // A recorded source code is never offered as a Jenis Pekerjaan.
      jenis: mergeVocabulary(JENIS_PEKERJAAN, allRows.map((r) => presentAhspIdentity(r).workType)),
    };
  }, [allRows, kategori, allCuratedSub]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRows.filter((row) => {
      if (source === 'SIMPROK' && row.workspaceId !== null) return false;
      if (source === 'MINE' && row.workspaceId === null) return false;
      // Jenis Pengadaan: when list rows carry classification text, filter it.
      // Rows without classification remain visible — assignment list consumer not connected.
      if (jenisPengadaan) {
        const cls = (row.classification ?? '').trim();
        if (cls !== '' && cls !== jenisPengadaan) return false;
      }
      if (kategori && (row.fieldCategory ?? '') !== kategori) return false;
      if (subkategori && (row.subCategory ?? '') !== subkategori) return false;
      if (jenis && (presentAhspIdentity(row).workType ?? '') !== jenis) return false;
      if (!needle) return true;
      // Search may still reach Dasar/Bidang provenance text without a dedicated Dasar filter.
      const hay = `${row.code ?? ''} ${row.workType ?? ''} ${row.methodName ?? ''} ${row.fieldCategory ?? ''} ${row.versions?.[0]?.regulationReference ?? ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [allRows, query, source, jenisPengadaan, kategori, subkategori, jenis]);

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visibleRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = visibleRows.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = safePage * PAGE_SIZE + pageRows.length;

  const resetFilters = () => {
    setQuery('');
    setSource('ALL');
    setJenisPengadaan('');
    setKategori('');
    setSubkategori('');
    setJenis('');
    setPage(0);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const pageAllSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));
  const toggleSelectPage = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) pageRows.forEach((r) => next.delete(r.id));
      else pageRows.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const selectedRows = allRows.filter((r) => selected.has(r.id));
  const proposableCount = selectedRows.filter((r) => canProposeAhsp(r)).length;

  // After a bulk action the list is re-read, and only the rows that did NOT go
  // through stay selected — so what is still selected is exactly what is left to do.
  const refreshAfterMutation = async (stillSelected: ReadonlySet<string>) => {
    const rows = await loadList().catch(() => null);
    if (rows) setState({ phase: 'READY', rows });
    setSelected(new Set(stillSelected));
  };

  /**
   * Send one request per row and COUNT what the server answered. A refusal is a
   * refusal even when the loop keeps going; nothing is rounded up to success.
   */
  const sendForEach = async (
    rows: AhspRow[],
    send: (row: AhspRow) => Promise<Response>,
  ): Promise<{ succeeded: number; failedIds: Set<string>; failure: ApiFailure | null }> => {
    let succeeded = 0;
    let failure: ApiFailure | null = null;
    const failedIds = new Set<string>();
    for (const row of rows) {
      try {
        const response = await send(row);
        if (response.ok) {
          succeeded += 1;
        } else {
          failedIds.add(row.id);
          failure = failure ?? (await readApiFailure(response));
        }
      } catch {
        failedIds.add(row.id);
        failure = failure ?? NETWORK_FAILURE;
      }
    }
    return { succeeded, failedIds, failure };
  };

  const nothingProposable: ActionOutcome = {
    kind: 'FAILURE',
    lines: [
      { tone: 'FAILURE', text: 'Tidak ada AHSP terpilih yang dapat diusulkan.' },
      { tone: 'NOTE', text: 'Hanya AHSP Saya yang belum diusulkan yang dapat diusulkan ke SIMPROK. Belum ada yang dikirim.' },
    ],
  };

  const bulkPropose = async () => {
    if (selectionBusy) return;
    const proposable = selectedRows.filter((r) => canProposeAhsp(r));
    if (proposable.length === 0) {
      setSelectionOutcome(nothingProposable);
      return;
    }
    setSelectionAction('PROPOSE');
    setSelectionOutcome(null);
    try {
      const { succeeded, failedIds, failure } = await sendForEach(proposable, (row) =>
        apiFetch('/ahsp/' + row.id + '/propose', { method: 'POST' }),
      );
      await refreshAfterMutation(failedIds);
      setSelectionOutcome(
        describeBulkPropose({
          succeeded,
          failed: failedIds.size,
          notApplicable: selectedRows.length - proposable.length,
          failure,
        }),
      );
    } finally {
      setSelectionAction(null);
    }
  };

  const confirmPropose = async () => {
    await bulkPropose();
    setShowProposeConfirm(false);
  };

  const openProposeConfirm = () => {
    if (proposableCount === 0) {
      setSelectionOutcome(nothingProposable);
      return;
    }
    setSelectionOutcome(null);
    setShowProposeConfirm(true);
  };

  const bulkDelete = async () => {
    if (selectionBusy || selectedRows.length === 0) return;
    const reason = window.prompt(`Hapus ${selectedRows.length} AHSP terpilih? Tuliskan alasan penghapusan:`);
    if (reason == null || reason.trim() === '') return;
    setSelectionAction('DELETE');
    setSelectionOutcome(null);
    try {
      const { succeeded, failedIds, failure } = await sendForEach(selectedRows, (row) =>
        apiFetch('/ahsp/' + row.id, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        }),
      );
      await refreshAfterMutation(failedIds);
      setSelectionOutcome(describeBulkDelete({ succeeded, failed: failedIds.size, notApplicable: 0, failure }));
    } finally {
      setSelectionAction(null);
    }
  };

  const exportSelection = () => {
    if (selectedRows.length === 0) return;
    const header = ['Kode', 'Jenis Pekerjaan', 'Uraian', 'Satuan', 'Kategori', 'Sumber'];
    const escape = (v: string) => '"' + v.replace(/"/g, '""') + '"';
    const lines = [header.map(escape).join(',')];
    for (const r of selectedRows) {
      const identity = presentAhspIdentity(r);
      lines.push([
        identity.code ?? '',
        identity.workType ?? '',
        r.methodName ?? '',
        r.versions?.[0]?.outputUnit ?? '',
        r.fieldCategory ?? '',
        ownershipLabel(r.workspaceId),
      ].map((v) => escape(String(v))).join(','));
    }
    const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ahsp-terpilih.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const sortHint = <ChevronsUpDown size={12} style={{ verticalAlign: 'middle', opacity: 0.5 }} />;

  return (
    <main className="ahsp-room" aria-label="Ruang AHSP">
      {/* Header + primary actions — Owner order: Panduan | Buat AHSP Manual | + Import AHSP */}
      <header className="ahsp-room__header">
        <div>
          <h1 className="ahsp-room__title">AHSP</h1>
          <p className="ahsp-room__subtitle">
            Standar harga satuan pekerjaan untuk mendukung penyusunan dan analisis proyek.
          </p>
        </div>
        {canManage || canCurate ? (
          <div className="ahsp-room__actions">
            {canManage ? (
              <a href="https://docs.simprok.id/ahsp" target="_blank" rel="noreferrer" className="ahsp-action ahsp-action--outline">
                <BookOpen size={16} /> Panduan AHSP
              </a>
            ) : null}
            {canManage ? (
              <Link to="/ahsp/manual" className="ahsp-action ahsp-action--outline">
                Buat AHSP Manual
              </Link>
            ) : null}
            <button type="button" onClick={() => navigate('/ahsp/import')} className="ahsp-action ahsp-action--primary">
              <Plus size={16} /> Import AHSP
            </button>
          </div>
        ) : null}
      </header>

      {state.phase === 'LOADING' ? <p role="status" style={{ color: MUTED }}>Memuat daftar AHSP…</p> : null}

      {state.phase === 'FAILED' ? (
        <section className="simprok-honest-frame" role="alert" aria-label="AHSP tidak tersedia">
          <span className="simprok-honest-frame__badge">Tidak tersedia</span>
          <p>{state.message}</p>
        </section>
      ) : null}

      {state.phase === 'READY' ? (
        <>
          {/* Search + filter control area — Owner: no dedicated Dasar AHSP primary filter */}
          <section aria-label="Pencarian dan saringan AHSP" className="ahsp-room__filters">
            <div className="ahsp-search-row">
              <div className="ahsp-search-row__field">
                <Search size={16} className="ahsp-search-row__icon" aria-hidden />
                <input
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setPage(0); }}
                  aria-label="Cari AHSP"
                  placeholder="Cari kode atau uraian pekerjaan..."
                  className="ahsp-search-row__input"
                />
              </div>
              <button type="button" className="ahsp-action ahsp-action--primary" onClick={() => setPage(0)}>Cari</button>
              <button type="button" onClick={resetFilters} className="ahsp-action ahsp-action--quiet ahsp-search-row__reset">
                <RefreshCw size={14} /> Reset Filter
              </button>
            </div>
            <div className="ahsp-room__filter-grid">
              <label className="ahsp-field">
                <span className="ahsp-field__label">Sumber</span>
                <select className="ahsp-field__control" value={source} onChange={(e) => { setSource(e.target.value as 'ALL' | 'SIMPROK' | 'MINE'); setPage(0); }} aria-label="Saring sumber AHSP">
                  <option value="ALL">Semua</option>
                  <option value="SIMPROK">Pustaka SIMPROK</option>
                  <option value="MINE">AHSP Saya</option>
                </select>
              </label>
              <label className="ahsp-field">
                <span className="ahsp-field__label">Jenis Pengadaan</span>
                <select className="ahsp-field__control" value={jenisPengadaan} onChange={(e) => { setJenisPengadaan(e.target.value); setPage(0); }} aria-label="Saring jenis pengadaan AHSP">
                  <option value="">Semua Jenis Pengadaan</option>
                  {JENIS_PENGADAAN_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="ahsp-field">
                <span className="ahsp-field__label">Kategori</span>
                <select className="ahsp-field__control" value={kategori} onChange={(e) => { setKategori(e.target.value); setSubkategori(''); setPage(0); }} aria-label="Saring kategori AHSP">
                  <option value="">Semua Kategori</option>
                  {options.kategori.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="ahsp-field">
                <span className="ahsp-field__label">Subkategori</span>
                <select className="ahsp-field__control" value={subkategori} onChange={(e) => { setSubkategori(e.target.value); setPage(0); }} aria-label="Saring subkategori AHSP">
                  <option value="">Semua Subkategori</option>
                  {options.subkategori.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label className="ahsp-field">
                <span className="ahsp-field__label">Jenis Pekerjaan</span>
                <select className="ahsp-field__control" value={jenis} onChange={(e) => { setJenis(e.target.value); setPage(0); }} aria-label="Saring jenis pekerjaan AHSP">
                  <option value="">Semua Jenis Pekerjaan</option>
                  {options.jenis.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
            </div>
          </section>

          {/* Selection action bar */}
          {selected.size > 0 ? (
            <section aria-label="Tindakan AHSP terpilih" style={{ ...CARD, marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, color: NAVY }}>{selected.size} AHSP dipilih</span>
              <div className="ahsp-action-row" style={{ marginLeft: 'auto' }}>
                <button type="button" className="ahsp-action ahsp-action--danger" disabled={selectionBusy} aria-busy={selectionAction === 'DELETE' || undefined} onClick={() => void bulkDelete()}>
                  {selectionAction === 'DELETE' ? null : <Trash2 size={14} />} {selectionAction === 'DELETE' ? 'Menghapus…' : 'Hapus'}
                </button>
                <button type="button" className="ahsp-action ahsp-action--primary" disabled={selectionBusy} aria-busy={selectionAction === 'PROPOSE' || undefined} title={USULKAN_TOOLTIP} onClick={openProposeConfirm}>
                  {selectionAction === 'PROPOSE' ? null : <Send size={14} />} {selectionAction === 'PROPOSE' ? 'Memproses…' : 'Usulkan ke SIMPROK'}
                </button>
                <button type="button" className="ahsp-action ahsp-action--outline" disabled={selectionBusy} onClick={exportSelection}>
                  <Download size={14} /> Export
                </button>
                <button type="button" className="ahsp-action ahsp-action--outline" disabled={selectionBusy} aria-label="Batalkan pilihan" onClick={clearSelection}>
                  <X size={14} />
                </button>
              </div>
            </section>
          ) : null}
          {selectionOutcome ? (
            <div style={{ margin: '0 0 var(--space-3)' }}>
              <ActionOutcomeNotice outcome={selectionOutcome} onDismiss={() => setSelectionOutcome(null)} />
            </div>
          ) : null}

          {/* Table */}
          <section aria-label="AHSP yang tersedia" className="ahsp-room__table-card">
            {allRows.length === 0 ? (
              <section className="simprok-honest-frame" aria-label="AHSP kosong">
                <span className="simprok-honest-frame__badge">Belum ada data</span>
                <p>Belum ada AHSP yang tersedia dalam workspace ini.</p>
              </section>
            ) : visibleRows.length === 0 ? (
              <p style={{ color: MUTED, fontSize: 'var(--text-sm)' }}>Tidak ada AHSP yang cocok dengan pencarian atau saringan ini.</p>
            ) : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table aria-label="Daftar AHSP yang tersedia" className="ahsp-room__table">
                    <thead>
                      <tr>
                        <th style={{ width: '2.5rem' }}>
                          <input type="checkbox" aria-label="Pilih semua di halaman ini" checked={pageAllSelected} onChange={toggleSelectPage} />
                        </th>
                        <th>Kode {sortHint}</th>
                        <th>Jenis Pekerjaan {sortHint}</th>
                        <th>Uraian {sortHint}</th>
                        <th>Satuan {sortHint}</th>
                        <th>Kategori {sortHint}</th>
                        <th>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row) => {
                        // Kode and Jenis Pekerjaan are named from ONE mapping: a recorded
                        // source code is shown as the code, never again as a work type.
                        const identity = presentAhspIdentity(row);
                        return (
                          <tr key={row.id}>
                            <td>
                              <input type="checkbox" aria-label={'Pilih ' + (row.methodName ?? row.workType ?? row.id)} checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} />
                            </td>
                            <td>{orDash(identity.code)}</td>
                            <td>{orDash(identity.workType)}</td>
                            <td>{orDash(row.methodName)}</td>
                            <td>{orDash(row.versions?.[0]?.outputUnit)}</td>
                            <td>{orDash(row.fieldCategory)}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>
                              <Link to={'/ahsp/' + row.id} className="ahsp-action ahsp-action--outline ahsp-action--compact">
                                <Eye size={14} /> Lihat
                              </Link>
                              <button type="button" aria-label="Tindakan lain" className="ahsp-action ahsp-action--outline ahsp-action--compact" style={{ marginLeft: 'var(--space-2)' }} disabled>
                                <MoreHorizontal size={14} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="ahsp-room__pagination">
                  <span className="ahsp-room__pagination-meta">
                    Menampilkan {rangeStart} - {rangeEnd} dari {visibleRows.length} data
                  </span>
                  <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                    <button type="button" aria-label="Halaman sebelumnya" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="ahsp-action ahsp-action--outline ahsp-action--compact">‹</button>
                    <span style={{ color: NAVY, fontSize: 'var(--text-sm)', padding: '0 var(--space-2)' }}>{safePage + 1} / {pageCount}</span>
                    <button type="button" aria-label="Halaman berikutnya" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} className="ahsp-action ahsp-action--outline ahsp-action--compact">›</button>
                  </div>
                </div>
              </>
            )}
          </section>
        </>
      ) : null}

      <UsulkanSimprokDialog
        open={showProposeConfirm}
        busy={selectionBusy}
        onCancel={() => setShowProposeConfirm(false)}
        onConfirm={() => void confirmPropose()}
      />
    </main>
  );
}

export default AhspRoomPage;
