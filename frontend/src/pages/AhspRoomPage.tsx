import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Plus, Search, RefreshCw, Eye, MoreHorizontal, Trash2, Send, Download, X, ChevronsUpDown } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { explainAhspItemReasons } from '../utils/ahspDocumentUserCopy';
import { canProposeAhsp } from '../utils/ahspProposalStatus';
import {
  describeCuratableObservation,
  previewCandidateNames,
  type CuratableObservationWire,
  type PreviewResourceWire,
} from '../utils/resourceObservationDisplay';

/**
 * THE standalone AHSP room — the one door the sidebar opens, in the Owner
 * mockup's shape. Discovery uses GET /ahsp; import uses POST /ahsp/document
 * preview and /commit; create uses POST /ahsp; "Usulkan ke SIMPROK" uses the
 * existing POST /ahsp/:id/propose lifecycle. All rows are persisted GET /ahsp
 * truth, filtered and paged in the room. Schema fillers methodType/locationType
 * are sent on create, never shown.
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

type PreviewItem = {
  status: string;
  reasonCodes: string[];
  workType: { raw: string } | null;
  methodName: { raw: string } | null;
  resources?: PreviewResourceWire[];
};

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
  const [observations, setObservations] = useState<CuratableObservationWire[]>([]);
  const [curationBusyId, setCurationBusyId] = useState<string | null>(null);
  const [curationError, setCurationError] = useState<string | null>(null);
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
  const [showImport, setShowImport] = useState(false);
  const [workType, setWorkType] = useState('');
  const [methodName, setMethodName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<null | { workItems: PreviewItem[] }>(null);
  const [commitResult, setCommitResult] = useState<null | { written: unknown[]; skipped: unknown[] }>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

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
  const options = useMemo(
    () => ({
      dasar: distinct(allRows.map((r) => r.versions?.[0]?.regulationReference)),
      bidang: distinct(allRows.map((r) => r.fieldCategory)),
      subkategori: distinct(allRows.map((r) => r.subCategory)),
      jenis: distinct(allRows.map((r) => r.workType)),
    }),
    [allRows],
  );

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

  const createWorkspaceAhsp = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const response = await apiFetch('/ahsp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workType: workType.trim(), methodName: methodName.trim(), methodType: 'OTHER', locationType: 'OTHER' }),
      });
      if (!response.ok) {
        setCreateError('AHSP milik Anda belum dapat dibuat. Periksa isian lalu coba lagi.');
        return;
      }
      const created = (await response.json()) as { id?: string };
      if (typeof created.id !== 'string' || created.id === '') {
        setCreateError('Server tidak mengembalikan identitas AHSP yang baru dibuat.');
        return;
      }
      navigate('/ahsp/' + created.id);
    } catch {
      setCreateError('AHSP milik Anda tidak dapat dihubungi.');
    } finally {
      setCreating(false);
    }
  };

  const previewDocument = async () => {
    if (!canManage || !file || importing) return;
    setImporting(true);
    setImportError(null);
    setCommitResult(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await apiFetch('/ahsp/document/preview', { method: 'POST', body });
      if (!response.ok) {
        setImportError('Dokumen AHSP belum dapat dipahami. Periksa berkas lalu coba lagi.');
        return;
      }
      setPreview(await response.json());
    } catch {
      setImportError('Dokumen AHSP tidak dapat dihubungi.');
    } finally {
      setImporting(false);
    }
  };

  const commitDocument = async () => {
    if (!canManage || !file || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await apiFetch('/ahsp/document/commit', { method: 'POST', body });
      if (!response.ok) {
        setImportError('AHSP terbukti belum dapat disimpan. Coba lagi sebentar.');
        return;
      }
      const data = await response.json();
      setCommitResult(data);
      setPreview(data.knowledge ?? preview);
      const reload = await apiFetch('/ahsp');
      if (reload.ok) {
        const rows = await reload.json();
        setState({ phase: 'READY', rows: Array.isArray(rows) ? rows : [] });
      }
      await loadObservations();
    } catch {
      setImportError('AHSP terbukti tidak dapat dihubungi.');
    } finally {
      setImporting(false);
    }
  };

  const loadObservations = async () => {
    if (!canCurate) return;
    try {
      const response = await apiFetch('/resource-observations');
      if (!response.ok) return;
      const data = await response.json();
      setObservations(Array.isArray(data) ? data : []);
    } catch {
      // A curation-list read failure is never rendered as "no work to review".
    }
  };

  useEffect(() => {
    void loadObservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCurate]);

  const curateExisting = async (id: string, selectedResourceCatalogId: string) => {
    if (curationBusyId) return;
    setCurationBusyId(id);
    setCurationError(null);
    try {
      const response = await apiFetch('/resource-observations/' + id + '/curate-existing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedResourceCatalogId }),
      });
      if (!response.ok) {
        setCurationError('Keputusan belum dapat disimpan. Coba lagi.');
        return;
      }
      await loadObservations();
    } catch {
      setCurationError('Keputusan tidak dapat dihubungi.');
    } finally {
      setCurationBusyId(null);
    }
  };

  const curateNew = async (id: string, unitDefinitionId: string) => {
    if (curationBusyId) return;
    setCurationBusyId(id);
    setCurationError(null);
    try {
      const response = await apiFetch('/resource-observations/' + id + '/curate-new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitDefinitionId }),
      });
      if (!response.ok) {
        setCurationError('Sumber daya baru belum dapat ditetapkan. Coba lagi.');
        return;
      }
      await loadObservations();
    } catch {
      setCurationError('Penetapan sumber daya baru tidak dapat dihubungi.');
    } finally {
      setCurationBusyId(null);
    }
  };

  const recognized = preview?.workItems.length ?? 0;
  const ready = preview?.workItems.filter((item) => item.status === 'READY').length ?? 0;
  const unresolved = preview ? recognized - ready : 0;
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
        {canManage ? (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <a href="https://docs.simprok.id/ahsp" target="_blank" rel="noreferrer" style={outlineButton}>
              <BookOpen size={16} /> Panduan AHSP
            </a>
            <button type="button" onClick={() => setShowImport((v) => !v)} style={primaryButton}>
              <Plus size={16} /> Import AHSP
            </button>
          </div>
        ) : null}
      </header>

      {/* Import panel (revealed by the Import AHSP action) */}
      {canManage && showImport ? (
        <section aria-label="Import AHSP" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          <input
            type="file"
            accept=".xlsx"
            aria-label="Berkas AHSP resmi"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setCommitResult(null);
            }}
          />
          <div style={{ marginTop: 'var(--space-3)' }}>
            <button type="button" disabled={!file || importing} onClick={() => void previewDocument()} style={{ ...primaryButton, marginRight: 'var(--space-2)' }}>
              {importing ? 'Membaca…' : 'Pahami dokumen'}
            </button>
            <button type="button" disabled={!file || importing || !preview} onClick={() => void commitDocument()} style={outlineButton}>
              Simpan yang terbukti
            </button>
          </div>
          {importError ? <p role="alert" style={{ color: RED, fontSize: 'var(--text-sm)' }}>{importError}</p> : null}
          {preview ? (
            <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: NAVY }}>
              <p style={{ margin: '0 0 var(--space-2)' }}>
                {recognized} pekerjaan dikenali. {ready} pekerjaan siap digunakan. {unresolved} pekerjaan masih perlu dilengkapi.
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {preview.workItems.map((item, index) => {
                  const candidateNames = item.status === 'READY' ? [] : previewCandidateNames(item.resources);
                  return (
                    <li key={index} style={{ marginBottom: 'var(--space-2)' }}>
                      {item.workType?.raw ?? '—'} — {item.methodName?.raw ?? '—'}
                      {item.status === 'READY' ? ' · siap digunakan' : ` · ${explainAhspItemReasons(item.reasonCodes)}`}
                      {candidateNames.length > 0 ? (
                        <span style={{ display: 'block', color: MUTED }}>
                          SIMPROK menemukan kemungkinan padanan: {candidateNames.slice(0, 4).join(', ')}
                          {candidateNames.length > 4 ? `, dan ${candidateNames.length - 4} lainnya` : ''}. Simpan untuk meninjaunya di bawah.
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
          {commitResult ? (
            <p style={{ fontSize: 'var(--text-sm)', color: NAVY, marginTop: 'var(--space-3)' }}>
              {commitResult.written.length} pekerjaan disimpan. {commitResult.skipped.length} pekerjaan belum disimpan.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Curation queue — the shared observed-resource lifecycle (only when there is work) */}
      {canCurate && observations.length > 0 ? (
        <section aria-label="Sumber daya untuk ditinjau" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-2)' }}>Sumber daya untuk ditinjau</h2>
          <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
            SIMPROK menyimpan sumber daya yang belum dapat dipastikan. Pilih padanan yang tepat, atau usulkan sebagai sumber daya baru.
          </p>
          {curationError ? <p role="alert" style={{ color: RED, fontSize: 'var(--text-sm)' }}>{curationError}</p> : null}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {observations.map((observation) => {
              const view = describeCuratableObservation(observation);
              const busy = curationBusyId === view.id;
              return (
                <li key={view.id} aria-label={'Tinjau ' + view.title} style={{ marginBottom: 'var(--space-3)', paddingBottom: 'var(--space-3)', borderBottom: HAIRLINE }}>
                  <span style={{ fontWeight: 600, color: NAVY }}>{view.title}</span>
                  {view.candidateLine ? <span style={{ display: 'block', color: MUTED, fontSize: 'var(--text-sm)' }}>{view.candidateLine}</span> : null}
                  <span style={{ display: 'block', color: MUTED, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>{view.guidance}</span>
                  <div>
                    {view.candidateChoices.map((choice) => (
                      <button key={choice.resourceCatalogId} type="button" disabled={busy} onClick={() => void curateExisting(view.id, choice.resourceCatalogId)} style={{ ...primaryButton, marginRight: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                        Ini padanannya: {choice.name}
                      </button>
                    ))}
                    {view.canProposeNew && view.newUnitDefinitionId ? (
                      <button type="button" disabled={busy} onClick={() => void curateNew(view.id, view.newUnitDefinitionId as string)} style={outlineButton}>
                        Tetapkan sebagai sumber daya baru
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

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
                <select value={bidang} onChange={(e) => { setBidang(e.target.value); setPage(0); }} aria-label="Saring bidang AHSP" style={controlBox}>
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
                <button type="button" disabled={selectionBusy} onClick={() => void bulkPropose()} style={primaryButton}>
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

          {/* Manual create — existing capability, folded away below the list */}
          {canManage ? (
            <details style={{ ...CARD, marginTop: 'var(--space-4)' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: NAVY }}>AHSP Milik Saya</summary>
              <form aria-label="Buat AHSP milik saya" onSubmit={createWorkspaceAhsp} style={{ maxWidth: '36rem', marginTop: 'var(--space-3)' }}>
                <label style={labelStyle}>Jenis pekerjaan
                  <input required value={workType} onChange={(event) => setWorkType(event.target.value)} aria-label="Jenis pekerjaan" style={controlBox} />
                </label>
                <label style={{ ...labelStyle, marginTop: 'var(--space-3)' }}>Uraian
                  <input required value={methodName} onChange={(event) => setMethodName(event.target.value)} aria-label="Uraian AHSP" style={controlBox} />
                </label>
                {createError ? <p role="alert" style={{ color: RED, fontSize: 'var(--text-sm)' }}>{createError}</p> : null}
                <button type="submit" disabled={creating} style={{ ...primaryButton, marginTop: 'var(--space-3)' }}>
                  {creating ? 'Menyimpan…' : 'Simpan AHSP milik saya'}
                </button>
              </form>
            </details>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

export default AhspRoomPage;
