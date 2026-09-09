import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Plus, Search, RefreshCw, Eye, MoreHorizontal, Trash2, Send, Download, X, ChevronsUpDown } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { canProposeAhsp } from '../utils/ahspProposalStatus';
import { USULKAN_TOOLTIP } from '../utils/ahspProposalCopy';
import { UsulkanSimprokDialog } from '../components/ahsp/UsulkanSimprokDialog';
import { BIDANG, JENIS_PEKERJAAN, mergeVocabulary, subkategoriForBidang } from '../constructionTaxonomy';

/**
 * THE standalone AHSP room — the one door the sidebar opens, in the Owner
 * mockup's shape. Discovery uses GET /ahsp; "Usulkan ke SIMPROK" uses the
 * existing POST /ahsp/:id/propose lifecycle (behind an Owner-locked tooltip +
 * confirmation). Import and unresolved-resource curation live behind their OWN
 * door (/ahsp/import) so this list stays a clean library, never a process dump.
 *
 * The Bidang/Subkategori/Jenis filters draw their vocabulary from the ONE shared
 * construction taxonomy (constructionTaxonomy.ts), merged with values actually
 * present in the data so no stored value is ever hidden. The taxonomy guides
 * discovery; the persisted GET /ahsp rows remain the AHSP source of truth.
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
const BLUE = 'var(--simprok-trust-blue-500)';
const RED = '#C0392B';
const HAIRLINE = '1px solid var(--simprok-engineering-blue-100)';
const CARD: CSSProperties = { background: '#FFFFFF', border: HAIRLINE, borderRadius: '12px', padding: 'var(--space-4)' };
const th: CSSProperties = { padding: 'var(--space-2)', textAlign: 'left', color: MUTED, fontWeight: 600, whiteSpace: 'nowrap' };
const td: CSSProperties = { padding: 'var(--space-2)', borderTop: HAIRLINE, verticalAlign: 'top', color: NAVY };
const primaryButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', background: BLUE, color: '#FFFFFF', border: 0, borderRadius: '8px', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontSize: 'var(--text-sm)' };
const outlineButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', background: '#FFFFFF', color: NAVY, border: HAIRLINE, borderRadius: '8px', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontSize: 'var(--text-sm)' };
const controlBox: CSSProperties = { color: NAVY, padding: 'var(--space-2)', border: HAIRLINE, borderRadius: '8px', background: '#FFFFFF', width: '100%' };
const labelStyle: CSSProperties = { display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-1)' };

const PAGE_SIZE = 10;
const ownershipLabel = (workspaceId: string | null) => (workspaceId === null ? 'Pustaka SIMPROK' : 'AHSP Saya');
const orDash = (v: string | null | undefined) => (v == null || v === '' ? <span style={{ color: MUTED }}>—</span> : String(v));
const distinct = (values: Array<string | null | undefined>): string[] =>
  [...new Set(values.map((v) => (v ?? '').trim()).filter((v) => v !== ''))].sort();

export function AhspRoomPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const canCurate = hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE');
  const [state, setState] = useState<RoomState>({ phase: 'LOADING' });
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'ALL' | 'SIMPROK' | 'MINE'>('ALL');
  const [dasar, setDasar] = useState('');
  const [bidang, setBidang] = useState('');
  const [subkategori, setSubkategori] = useState('');
  const [jenis, setJenis] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
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

  // The union of every curated Subkategori — the option set when no Bidang is chosen.
  const allCuratedSub = useMemo(() => BIDANG.flatMap((b) => subkategoriForBidang(b)), []);

  const options = useMemo(() => {
    // Subkategori is context-aware: curated to the chosen Bidang, then merged with
    // the Subkategori values that Bidang's rows actually carry (never hidden).
    const rowsForSub = bidang ? allRows.filter((r) => (r.fieldCategory ?? '') === bidang) : allRows;
    const curatedSub = bidang ? subkategoriForBidang(bidang) : allCuratedSub;
    return {
      dasar: distinct(allRows.map((r) => r.versions?.[0]?.regulationReference)),
      bidang: mergeVocabulary(BIDANG, allRows.map((r) => r.fieldCategory)),
      subkategori: mergeVocabulary(curatedSub, rowsForSub.map((r) => r.subCategory)),
      jenis: mergeVocabulary(JENIS_PEKERJAAN, allRows.map((r) => r.workType)),
    };
  }, [allRows, bidang, allCuratedSub]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRows.filter((row) => {
      if (source === 'SIMPROK' && row.workspaceId !== null) return false;
      if (source === 'MINE' && row.workspaceId === null) return false;
      if (dasar && (row.versions?.[0]?.regulationReference ?? '') !== dasar) return false;
      if (bidang && (row.fieldCategory ?? '') !== bidang) return false;
      if (subkategori && (row.subCategory ?? '') !== subkategori) return false;
      if (jenis && (row.workType ?? '') !== jenis) return false;
      if (!needle) return true;
      const hay = `${row.code ?? ''} ${row.workType ?? ''} ${row.methodName ?? ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [allRows, query, source, dasar, bidang, subkategori, jenis]);

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visibleRows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = visibleRows.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeEnd = safePage * PAGE_SIZE + pageRows.length;

  const resetFilters = () => {
    setQuery('');
    setSource('ALL');
    setDasar('');
    setBidang('');
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

  const refreshAfterMutation = async () => {
    const rows = await loadList();
    if (rows) setState({ phase: 'READY', rows });
    clearSelection();
  };

  const bulkPropose = async () => {
    if (selectionBusy) return;
    const proposable = selectedRows.filter((r) => canProposeAhsp(r));
    if (proposable.length === 0) {
      setSelectionError('Tidak ada AHSP terpilih yang dapat diusulkan (hanya AHSP Saya yang belum diusulkan).');
      return;
    }
    setSelectionBusy(true);
    setSelectionError(null);
    try {
      for (const row of proposable) {
        await apiFetch('/ahsp/' + row.id + '/propose', { method: 'POST' });
      }
      await refreshAfterMutation();
    } catch {
      setSelectionError('Usulan tidak dapat dihubungi.');
    } finally {
      setSelectionBusy(false);
    }
  };

  const confirmPropose = async () => {
    await bulkPropose();
    setShowProposeConfirm(false);
  };

  const openProposeConfirm = () => {
    if (proposableCount === 0) {
      setSelectionError('Tidak ada AHSP terpilih yang dapat diusulkan (hanya AHSP Saya yang belum diusulkan).');
      return;
    }
    setSelectionError(null);
    setShowProposeConfirm(true);
  };

  const bulkDelete = async () => {
    if (selectionBusy || selectedRows.length === 0) return;
    const reason = window.prompt(`Hapus ${selectedRows.length} AHSP terpilih? Tuliskan alasan penghapusan:`);
    if (reason == null || reason.trim() === '') return;
    setSelectionBusy(true);
    setSelectionError(null);
    try {
      for (const row of selectedRows) {
        await apiFetch('/ahsp/' + row.id, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: reason.trim() }),
        });
      }
      await refreshAfterMutation();
    } catch {
      setSelectionError('Penghapusan tidak dapat dihubungi.');
    } finally {
      setSelectionBusy(false);
    }
  };

  const exportSelection = () => {
    if (selectedRows.length === 0) return;
    const header = ['Kode', 'Jenis Pekerjaan', 'Uraian', 'Satuan', 'Bidang', 'Sumber'];
    const escape = (v: string) => '"' + v.replace(/"/g, '""') + '"';
    const lines = [header.map(escape).join(',')];
    for (const r of selectedRows) {
      lines.push([
        r.code ?? '',
        r.workType ?? '',
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
    <main aria-label="Ruang AHSP" style={{ padding: 'var(--space-5, 1.25rem)' }}>
      {/* Header + primary actions */}
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: NAVY, margin: 0 }}>AHSP</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: 'var(--space-1) 0 0' }}>
            Standar harga satuan pekerjaan untuk mendukung penyusunan dan analisis proyek.
          </p>
        </div>
        {canManage || canCurate ? (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {canManage ? (
              <a href="https://docs.simprok.id/ahsp" target="_blank" rel="noreferrer" style={outlineButton}>
                <BookOpen size={16} /> Panduan AHSP
              </a>
            ) : null}
            <button type="button" onClick={() => navigate('/ahsp/import')} style={primaryButton}>
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
          {/* Search + filter control area */}
          <section aria-label="Pencarian dan saringan AHSP" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
              <div style={{ position: 'relative', flex: '1 1 24rem' }}>
                <Search size={16} style={{ position: 'absolute', left: '0.6rem', top: '50%', transform: 'translateY(-50%)', color: MUTED }} />
                <input
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setPage(0); }}
                  aria-label="Cari AHSP"
                  placeholder="Cari kode atau uraian pekerjaan..."
                  style={{ ...controlBox, paddingLeft: '2rem' }}
                />
              </div>
              <button type="button" style={primaryButton} onClick={() => setPage(0)}>Cari</button>
              <button type="button" onClick={resetFilters} style={{ ...outlineButton, marginLeft: 'auto', border: 0, color: BLUE }}>
                <RefreshCw size={14} /> Reset Filter
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: 'var(--space-3)' }}>
              <label style={labelStyle}>Sumber
                <select value={source} onChange={(e) => { setSource(e.target.value as 'ALL' | 'SIMPROK' | 'MINE'); setPage(0); }} aria-label="Saring sumber AHSP" style={controlBox}>
                  <option value="ALL">Semua</option>
                  <option value="SIMPROK">Pustaka SIMPROK</option>
                  <option value="MINE">AHSP Saya</option>
                </select>
              </label>
              <label style={labelStyle}>Dasar AHSP
                <select value={dasar} onChange={(e) => { setDasar(e.target.value); setPage(0); }} aria-label="Saring dasar AHSP" style={controlBox}>
                  <option value="">Semua Dasar AHSP</option>
                  {options.dasar.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label style={labelStyle}>Bidang / Kategori
                <select value={bidang} onChange={(e) => { setBidang(e.target.value); setSubkategori(''); setPage(0); }} aria-label="Saring bidang AHSP" style={controlBox}>
                  <option value="">Semua Bidang</option>
                  {options.bidang.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label style={labelStyle}>Subkategori
                <select value={subkategori} onChange={(e) => { setSubkategori(e.target.value); setPage(0); }} aria-label="Saring subkategori AHSP" style={controlBox}>
                  <option value="">Semua Subkategori</option>
                  {options.subkategori.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </label>
              <label style={labelStyle}>Jenis Pekerjaan
                <select value={jenis} onChange={(e) => { setJenis(e.target.value); setPage(0); }} aria-label="Saring jenis pekerjaan AHSP" style={controlBox}>
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
              <div style={{ display: 'flex', gap: 'var(--space-2)', marginLeft: 'auto', flexWrap: 'wrap' }}>
                <button type="button" disabled={selectionBusy} onClick={() => void bulkDelete()} style={{ ...outlineButton, color: RED, borderColor: RED }}>
                  <Trash2 size={14} /> Hapus
                </button>
                <button type="button" disabled={selectionBusy} title={USULKAN_TOOLTIP} onClick={openProposeConfirm} style={primaryButton}>
                  <Send size={14} /> {selectionBusy ? 'Memproses…' : 'Usulkan ke SIMPROK'}
                </button>
                <button type="button" onClick={exportSelection} style={outlineButton}>
                  <Download size={14} /> Export
                </button>
                <button type="button" aria-label="Batalkan pilihan" onClick={clearSelection} style={{ ...outlineButton, padding: 'var(--space-2)' }}>
                  <X size={14} />
                </button>
              </div>
            </section>
          ) : null}
          {selectionError ? <p role="alert" style={{ color: RED, fontSize: 'var(--text-sm)', margin: '0 0 var(--space-2)' }}>{selectionError}</p> : null}

          {/* Table */}
          <section aria-label="AHSP yang tersedia" style={CARD}>
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
                  <table aria-label="Daftar AHSP yang tersedia" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                    <thead>
                      <tr style={{ background: 'var(--simprok-engineering-blue-100)' }}>
                        <th style={{ ...th, width: '2.5rem' }}>
                          <input type="checkbox" aria-label="Pilih semua di halaman ini" checked={pageAllSelected} onChange={toggleSelectPage} />
                        </th>
                        <th style={th}>Kode {sortHint}</th>
                        <th style={th}>Jenis Pekerjaan {sortHint}</th>
                        <th style={th}>Uraian {sortHint}</th>
                        <th style={th}>Satuan {sortHint}</th>
                        <th style={th}>Bidang {sortHint}</th>
                        <th style={th}>Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((row) => (
                        <tr key={row.id}>
                          <td style={td}>
                            <input type="checkbox" aria-label={'Pilih ' + (row.methodName ?? row.workType ?? row.id)} checked={selected.has(row.id)} onChange={() => toggleSelect(row.id)} />
                          </td>
                          <td style={td}>{orDash(row.code)}</td>
                          <td style={td}>{orDash(row.workType)}</td>
                          <td style={td}>{orDash(row.methodName)}</td>
                          <td style={td}>{orDash(row.versions?.[0]?.outputUnit)}</td>
                          <td style={td}>{orDash(row.fieldCategory)}</td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>
                            <Link to={'/ahsp/' + row.id} style={{ ...outlineButton, padding: '0.2rem 0.6rem', textDecoration: 'none' }}>
                              <Eye size={14} /> Lihat
                            </Link>
                            <button type="button" aria-label="Tindakan lain" style={{ ...outlineButton, padding: '0.2rem 0.4rem', marginLeft: 'var(--space-2)' }} disabled>
                              <MoreHorizontal size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Pagination */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center', justifyContent: 'space-between', marginTop: 'var(--space-3)' }}>
                  <span style={{ color: MUTED, fontSize: 'var(--text-sm)' }}>
                    Menampilkan {rangeStart} - {rangeEnd} dari {visibleRows.length} data
                  </span>
                  <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                    <button type="button" aria-label="Halaman sebelumnya" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} style={{ ...outlineButton, padding: '0.25rem 0.6rem' }}>‹</button>
                    <span style={{ color: NAVY, fontSize: 'var(--text-sm)', padding: '0 var(--space-2)' }}>{safePage + 1} / {pageCount}</span>
                    <button type="button" aria-label="Halaman berikutnya" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} style={{ ...outlineButton, padding: '0.25rem 0.6rem' }}>›</button>
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
