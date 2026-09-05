import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';

/**
 * THE standalone AHSP room — the one door the sidebar opens.
 *
 * It answers: "AHSP resmi apa yang tersedia dan masih berlaku?"
 * It does not answer how SIMPROK interprets method or terrain, and it does
 * not present historical revisions as alternative AHSPs.
 *
 * Discovery still uses GET /ahsp — visibility, not RAB bindability. Create
 * uses existing POST /ahsp. Schema still requires methodType/locationType;
 * they are sent as unspecified fillers, never shown as official AHSP facts.
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

const NAVY = 'var(--simprok-authority-navy-800)';
const MUTED = 'var(--simprok-engineering-blue-500)';

const cell: React.CSSProperties = {
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

const availabilityLabel = (archivedAt: string | null) =>
  archivedAt ? 'Tidak berlaku' : 'Tersedia';

export function AhspRoomPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const [state, setState] = useState<RoomState>({ phase: 'LOADING' });
  const [workType, setWorkType] = useState('');
  const [methodName, setMethodName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<null | {
    status: string;
    reasonCodes: string[];
    document: { regulationReference: { raw: string } | null; effectiveDate: string | null };
    workItems: Array<{
      status: string;
      reasonCodes: string[];
      workType: { raw: string } | null;
      methodName: { raw: string } | null;
      resources: Array<{ rawName: string | null; group: string | null; coefficient: number | null }>;
    }>;
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

  const createWorkspaceAhsp = async (event: React.FormEvent) => {
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
    } catch {
      setImportError('AHSP terbukti tidak dapat dihubungi.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <main aria-label="Ruang AHSP" style={{ padding: 'var(--space-6, 1.5rem)' }}>
      <header style={{ marginBottom: 'var(--space-5)' }}>
        <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: 0 }}>SIMPROK / AHSP</p>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: NAVY, margin: 'var(--space-1) 0' }}>
          AHSP
        </h1>
        <p style={{ fontSize: 'var(--text-sm)', color: NAVY, margin: 0 }}>
          AHSP yang terlihat di workspace ini. Bukan tafsir metode atau lokasi SIMPROK.
        </p>
      </header>

      {canManage ? (
        <section aria-label="Baca dokumen AHSP resmi" style={{ marginBottom: 'var(--space-5)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
            Dokumen AHSP resmi
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
            SIMPROK membaca grid yang sudah ada, memahami analisa, dan hanya
            menulis fakta yang terbukti. Yang ambigu tidak disimpan. Tanggal
            berlaku tidak dikarang menjadi hari ini.
          </p>
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
              style={{
                background: 'var(--simprok-trust-blue-500)',
                color: '#FFFFFF',
                border: 0,
                padding: 'var(--space-2) var(--space-4)',
                marginRight: 'var(--space-2)',
              }}
            >
              {importing ? 'Membaca…' : 'Pahami dokumen'}
            </button>
            <button
              type="button"
              disabled={!file || importing || !preview}
              onClick={() => void commitDocument()}
              style={{
                background: 'var(--simprok-authority-navy-800)',
                color: '#FFFFFF',
                border: 0,
                padding: 'var(--space-2) var(--space-4)',
              }}
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
            <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: NAVY }}>
              <p>
                {preview.workItems.length} pekerjaan. Terbukti:{' '}
                {preview.workItems.filter((item) => item.status === 'READY').length}. Belum terbukti:{' '}
                {preview.workItems.filter((item) => item.status !== 'READY').length}.
              </p>
              <p>
                Peraturan:{' '}
                {preview.document.regulationReference?.raw ?? 'tidak terbukti'}
                . Tanggal berlaku: {preview.document.effectiveDate ?? 'tidak terbukti dari dokumen'}.
              </p>
              <ul>
                {preview.workItems.map((item, index) => (
                  <li key={index}>
                    {item.status === 'READY' ? 'Terbukti' : 'Belum terbukti'}:{' '}
                    {item.workType?.raw ?? '—'} — {item.methodName?.raw ?? '—'}
                    {item.status !== 'READY' ? ` (${item.reasonCodes.join(', ')})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {commitResult ? (
            <p style={{ fontSize: 'var(--text-sm)', color: NAVY }}>
              Tersimpan: {commitResult.written.length}. Tidak disimpan:{' '}
              {commitResult.skipped.length}.
            </p>
          ) : null}
        </section>
      ) : null}

      {canManage ? (
        <form
          aria-label="Buat AHSP milik saya"
          onSubmit={createWorkspaceAhsp}
          style={{ maxWidth: '36rem', marginBottom: 'var(--space-6)' }}
        >
          <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
            AHSP Milik Saya
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
            Untuk AHSP sah yang belum ada di pustaka SIMPROK, jika tidak
            berasal dari dokumen analisa.
          </p>
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
          <button
            type="submit"
            disabled={creating}
            style={{
              background: 'var(--simprok-trust-blue-500)',
              color: '#FFFFFF',
              border: 0,
              padding: 'var(--space-2) var(--space-4)',
            }}
          >
            {creating ? 'Menyimpan…' : 'Simpan AHSP milik saya'}
          </button>
        </form>
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

      {state.phase === 'READY' && state.rows.length === 0 ? (
        <section className="simprok-honest-frame" aria-label="AHSP kosong">
          <span className="simprok-honest-frame__badge">Belum ada data</span>
          <p>Belum ada AHSP yang tersedia dalam workspace ini.</p>
        </section>
      ) : null}

      {state.phase === 'READY' && state.rows.length > 0 ? (
        <table
          aria-label="Daftar AHSP yang tersedia"
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}
        >
          <thead>
            <tr style={{ textAlign: 'left', color: NAVY }}>
              <th style={cell}>Jenis Pekerjaan</th>
              <th style={cell}>Uraian</th>
              <th style={cell}>Kepemilikan</th>
              <th style={cell}>Ketersediaan</th>
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row) => (
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
                <td style={{ ...cell, color: NAVY }}>{availabilityLabel(row.archivedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}

export default AhspRoomPage;
