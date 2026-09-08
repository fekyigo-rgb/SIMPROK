import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { explainAhspItemReasons } from '../utils/ahspDocumentUserCopy';
import {
  describeCuratableObservation,
  previewCandidateNames,
  type CuratableObservationWire,
  type PreviewResourceWire,
} from '../utils/resourceObservationDisplay';

/**
 * THE standalone AHSP room — the one door the sidebar opens.
 *
 * Discovery still uses GET /ahsp. Import still uses POST /ahsp/document/preview
 * and /commit. Create still uses POST /ahsp. Schema fillers methodType /
 * locationType are sent, never shown.
 */

type AhspRow = {
  id: string;
  workspaceId: string | null;
  workType: string | null;
  methodName: string | null;
  archivedAt: string | null;
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

const cell: CSSProperties = {
  padding: 'var(--space-3)',
  borderBottom: '1px solid var(--simprok-engineering-blue-100)',
  verticalAlign: 'top',
};

const orDash = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? (
    <span style={{ color: MUTED }}>—</span>
  ) : (
    String(value)
  );

const ownershipLabel = (workspaceId: string | null) =>
  workspaceId === null ? 'Pustaka SIMPROK' : 'AHSP Saya';

const primaryButton: CSSProperties = {
  background: 'var(--simprok-trust-blue-500)',
  color: '#FFFFFF',
  border: 0,
  padding: 'var(--space-2) var(--space-4)',
  marginRight: 'var(--space-2)',
};

const navyButton: CSSProperties = {
  ...primaryButton,
  background: NAVY,
};

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
  const [workType, setWorkType] = useState('');
  const [methodName, setMethodName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<null | {
    document: { regulationReference: { raw: string } | null; effectiveDate: string | null };
    workItems: PreviewItem[];
  }>(null);
  const [commitResult, setCommitResult] = useState<null | {
    written: Array<{ ahspId: string; workType: string }>;
    skipped: Array<{ workType: string | null; reasonCodes: string[] }>;
  }>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

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
                : 'Daftar AHSP tidak dapat dibaca (HTTP ' + response.status + ').',
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

  const visibleRows = useMemo(() => {
    if (state.phase !== 'READY') return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return state.rows;
    return state.rows.filter((row) => {
      const hay = `${row.workType ?? ''} ${row.methodName ?? ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [state, query]);

  const createWorkspaceAhsp = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManage || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const response = await apiFetch('/ahsp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workType: workType.trim(),
          methodName: methodName.trim(),
          methodType: 'OTHER',
          locationType: 'OTHER',
        }),
      });
      if (!response.ok) {
        setCreateError('AHSP milik Anda tidak dapat dibuat (HTTP ' + response.status + ').');
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
        setImportError('Dokumen AHSP tidak dapat dipahami (HTTP ' + response.status + ').');
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
        setImportError('AHSP terbukti tidak dapat disimpan (HTTP ' + response.status + ').');
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
      // Committing stages the unproven resources as observations; surface them.
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

  return (
    <main aria-label="Ruang AHSP" style={{ padding: 'var(--space-6, 1.5rem)' }}>
      <header style={{ marginBottom: 'var(--space-5)' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: NAVY, margin: 0 }}>
          AHSP
        </h1>
      </header>

      {canManage ? (
        <section aria-label="Import AHSP" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
            Import AHSP
          </h2>
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
            <button
              type="button"
              disabled={!file || importing}
              onClick={() => void previewDocument()}
              style={primaryButton}
            >
              {importing ? 'Membaca…' : 'Pahami dokumen'}
            </button>
            <button
              type="button"
              disabled={!file || importing || !preview}
              onClick={() => void commitDocument()}
              style={navyButton}
            >
              Simpan yang terbukti
            </button>
          </div>
          {importError ? (
            <p role="alert" style={{ color: NAVY, fontSize: 'var(--text-sm)' }}>
              {importError}
            </p>
          ) : null}
          {preview ? (
            <div style={{ marginTop: 'var(--space-4)', fontSize: 'var(--text-sm)', color: NAVY }}>
              <p style={{ margin: '0 0 var(--space-2)' }}>
                {recognized} pekerjaan dikenali. {ready} pekerjaan siap digunakan.{' '}
                {unresolved} pekerjaan masih perlu dilengkapi.
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {preview.workItems.map((item, index) => {
                  const candidateNames =
                    item.status === 'READY' ? [] : previewCandidateNames(item.resources);
                  return (
                    <li key={index} style={{ marginBottom: 'var(--space-2)' }}>
                      {item.workType?.raw ?? '—'} — {item.methodName?.raw ?? '—'}
                      {item.status === 'READY'
                        ? ' · siap digunakan'
                        : ` · ${explainAhspItemReasons(item.reasonCodes)}`}
                      {candidateNames.length > 0 ? (
                        <span style={{ display: 'block', color: MUTED }}>
                          SIMPROK menemukan kemungkinan padanan:{' '}
                          {candidateNames.slice(0, 4).join(', ')}
                          {candidateNames.length > 4
                            ? `, dan ${candidateNames.length - 4} lainnya`
                            : ''}
                          . Simpan untuk meninjaunya di bawah.
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
              {commitResult.written.length} pekerjaan disimpan.{' '}
              {commitResult.skipped.length} pekerjaan belum disimpan.
            </p>
          ) : null}
        </section>
      ) : null}

      {canCurate && observations.length > 0 ? (
        <section aria-label="Sumber daya untuk ditinjau" style={{ marginBottom: 'var(--space-6)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-2)' }}>
            Sumber daya untuk ditinjau
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
            SIMPROK menyimpan sumber daya yang belum dapat dipastikan. Pilih padanan yang
            tepat, atau usulkan sebagai sumber daya baru.
          </p>
          {curationError ? (
            <p role="alert" style={{ color: NAVY, fontSize: 'var(--text-sm)' }}>
              {curationError}
            </p>
          ) : null}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {observations.map((observation) => {
              const view = describeCuratableObservation(observation);
              const busy = curationBusyId === view.id;
              return (
                <li
                  key={view.id}
                  aria-label={'Tinjau ' + view.title}
                  style={{
                    marginBottom: 'var(--space-4)',
                    paddingBottom: 'var(--space-3)',
                    borderBottom: '1px solid var(--simprok-engineering-blue-100)',
                  }}
                >
                  <span style={{ fontWeight: 600, color: NAVY }}>{view.title}</span>
                  {view.candidateLine ? (
                    <span style={{ display: 'block', color: MUTED, fontSize: 'var(--text-sm)' }}>
                      {view.candidateLine}
                    </span>
                  ) : null}
                  <span style={{ display: 'block', color: MUTED, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-2)' }}>
                    {view.guidance}
                  </span>
                  <div>
                    {view.candidateChoices.map((choice) => (
                      <button
                        key={choice.resourceCatalogId}
                        type="button"
                        disabled={busy}
                        onClick={() => void curateExisting(view.id, choice.resourceCatalogId)}
                        style={{ ...primaryButton, marginBottom: 'var(--space-2)' }}
                      >
                        Ini padanannya: {choice.name}
                      </button>
                    ))}
                    {view.canProposeNew && view.newUnitDefinitionId ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void curateNew(view.id, view.newUnitDefinitionId as string)}
                        style={navyButton}
                      >
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

      {state.phase === 'LOADING' ? (
        <p role="status" style={{ color: MUTED }}>
          Memuat daftar AHSP…
        </p>
      ) : null}

      {state.phase === 'FAILED' ? (
        <section className="simprok-honest-frame" role="alert" aria-label="AHSP tidak tersedia">
          <span className="simprok-honest-frame__badge">Tidak tersedia</span>
          <p>{state.message}</p>
        </section>
      ) : null}

      {state.phase === 'READY' ? (
        <section aria-label="AHSP yang tersedia">
          <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
            AHSP yang tersedia
          </h2>
          <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
            Cari
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Cari AHSP"
              placeholder="Jenis pekerjaan atau uraian"
              style={{ display: 'block', width: '100%', maxWidth: '24rem', color: NAVY, marginTop: 'var(--space-1)' }}
            />
          </label>
          {state.rows.length === 0 ? (
            <section className="simprok-honest-frame" aria-label="AHSP kosong">
              <span className="simprok-honest-frame__badge">Belum ada data</span>
              <p>Belum ada AHSP yang tersedia dalam workspace ini.</p>
            </section>
          ) : visibleRows.length === 0 ? (
            <p style={{ color: MUTED, fontSize: 'var(--text-sm)' }}>Tidak ada AHSP yang cocok dengan pencarian ini.</p>
          ) : (
            <table
              aria-label="Daftar AHSP yang tersedia"
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}
            >
              <thead>
                <tr style={{ textAlign: 'left', color: NAVY }}>
                  <th style={cell}>Jenis Pekerjaan</th>
                  <th style={cell}>Uraian</th>
                  <th style={cell}>Kepemilikan</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.id}>
                    <td style={cell}>
                      <Link
                        to={'/ahsp/' + row.id}
                        style={{ color: NAVY, fontWeight: 600, textDecoration: 'none' }}
                      >
                        {orDash(row.workType)}
                      </Link>
                    </td>
                    <td style={cell}>{orDash(row.methodName)}</td>
                    <td style={cell}>{ownershipLabel(row.workspaceId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}

      {canManage ? (
        <form
          aria-label="Buat AHSP milik saya"
          onSubmit={createWorkspaceAhsp}
          style={{ maxWidth: '36rem', marginTop: 'var(--space-6)' }}
        >
          <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
            AHSP Milik Saya
          </h2>
          <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-2)' }}>
            Jenis pekerjaan
            <input
              required
              value={workType}
              onChange={(event) => setWorkType(event.target.value)}
              aria-label="Jenis pekerjaan"
              style={{ display: 'block', width: '100%', color: NAVY }}
            />
          </label>
          <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
            Uraian
            <input
              required
              value={methodName}
              onChange={(event) => setMethodName(event.target.value)}
              aria-label="Uraian AHSP"
              style={{ display: 'block', width: '100%', color: NAVY }}
            />
          </label>
          {createError ? (
            <p role="alert" style={{ color: NAVY, fontSize: 'var(--text-sm)' }}>
              {createError}
            </p>
          ) : null}
          <button type="submit" disabled={creating} style={primaryButton}>
            {creating ? 'Menyimpan…' : 'Simpan AHSP milik saya'}
          </button>
        </form>
      ) : null}
    </main>
  );
}

export default AhspRoomPage;
