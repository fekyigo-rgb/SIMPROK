import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';

/**
 * THE standalone AHSP room — the one door the sidebar opens.
 *
 * It answers the question asked OUTSIDE a project: "what AHSP is visible to my
 * workspace". That is a different contract from the RAB picker, which asks
 * "what may this BOQ item bind to right now", and the two deliberately do not
 * share a query — binding eligibility is a security invariant tied to what
 * selectForBoqItem revalidates, and a display surface must never pull on it.
 *
 * Every column is a stored database column returned by GET /ahsp. The version
 * number is counted by the database, not here. Nothing on this page is derived,
 * inferred, or supplied by a fixture.
 *
 * Create uses existing POST /ahsp. File intake is not opened: WAVE2 is absent
 * from canonical main, and USI-01 is the Basic Price engine.
 */

type AhspRow = {
  id: string;
  workspaceId: string | null;
  workType: string | null;
  methodType: string | null;
  locationType: string | null;
  methodName: string | null;
  ownershipType: string | null;
  reviewStatus: string | null;
  archivedAt: string | null;
  updatedAt: string | null;
  _count?: { versions: number } | null;
};

type RoomState =
  | { phase: 'LOADING' }
  | { phase: 'READY'; rows: AhspRow[] }
  | { phase: 'FAILED'; message: string };

const NAVY = 'var(--simprok-authority-navy-800)';
const MUTED = 'var(--simprok-engineering-blue-500)';

const METHOD_TYPES = ['MANUAL', 'MECHANICAL', 'SEMI_MECHANICAL', 'CHEMICAL', 'OTHER'] as const;
const LOCATION_TYPES = [
  'GENERAL',
  'URBAN',
  'RURAL',
  'MOUNTAIN',
  'SWAMP',
  'COASTAL',
  'OFFSHORE',
  'OTHER',
] as const;

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

const originLabel = (workspaceId: string | null) =>
  workspaceId === null ? 'Repositori Resmi' : 'Workspace ini';

export function AhspRoomPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const [state, setState] = useState<RoomState>({ phase: 'LOADING' });
  const [workType, setWorkType] = useState('');
  const [methodName, setMethodName] = useState('');
  const [methodType, setMethodType] = useState<(typeof METHOD_TYPES)[number]>('MANUAL');
  const [locationType, setLocationType] = useState<(typeof LOCATION_TYPES)[number]>('GENERAL');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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
          methodType,
          locationType,
        }),
      });
      if (!response.ok) {
        setCreateError('AHSP workspace tidak dapat dibuat (HTTP ' + response.status + ').');
        return;
      }
      const created = (await response.json()) as { id?: string };
      if (typeof created.id !== 'string' || created.id === '') {
        setCreateError('Server tidak mengembalikan identitas AHSP yang baru dibuat.');
        return;
      }
      navigate('/ahsp/' + created.id);
    } catch {
      setCreateError('AHSP workspace tidak dapat dihubungi.');
    } finally {
      setCreating(false);
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
          Analisa Harga Satuan Pekerjaan yang tersedia dalam workspace ini.
        </p>
      </header>

      <section
        className="simprok-honest-frame"
        aria-label="Impor berkas AHSP tidak dihidupkan"
        style={{ marginBottom: 'var(--space-5)' }}
      >
        <span className="simprok-honest-frame__badge">Tidak dihidupkan</span>
        <p>
          Impor berkas AHSP tidak dibuka. WAVE2 tidak ada di canonical main.
          USI-01 adalah mesin Basic Price, bukan mesin AHSP. Tidak ada importer
          kedua.
        </p>
      </section>

      {canManage ? (
        <form
          aria-label="Buat AHSP workspace"
          onSubmit={createWorkspaceAhsp}
          style={{ maxWidth: '36rem', marginBottom: 'var(--space-6)' }}
        >
          <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
            Buat AHSP workspace
          </h2>
          <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
            Memakai POST /ahsp yang sudah ada. Bukan impor berkas, bukan Repositori Resmi.
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
          <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-2)' }}>
            Uraian / metode
            <input
              required
              value={methodName}
              onChange={(event) => setMethodName(event.target.value)}
              aria-label="Uraian metode"
              style={{ display: 'block', width: '100%', color: NAVY }}
            />
          </label>
          <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-2)' }}>
            Tipe metode
            <select
              value={methodType}
              onChange={(event) => setMethodType(event.target.value as (typeof METHOD_TYPES)[number])}
              aria-label="Tipe metode"
              style={{ display: 'block', color: NAVY }}
            >
              {METHOD_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
            Lokasi
            <select
              value={locationType}
              onChange={(event) => setLocationType(event.target.value as (typeof LOCATION_TYPES)[number])}
              aria-label="Lokasi"
              style={{ display: 'block', color: NAVY }}
            >
              {LOCATION_TYPES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
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
            {creating ? 'Menyimpan…' : 'Simpan AHSP workspace'}
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
          aria-label="Daftar AHSP workspace"
          style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}
        >
          <thead>
            <tr style={{ textAlign: 'left', color: NAVY }}>
              <th style={cell}>Jenis Pekerjaan</th>
              <th style={cell}>Metode</th>
              <th style={cell}>Tipe</th>
              <th style={cell}>Lokasi</th>
              <th style={cell}>Asal</th>
              <th style={cell}>Status Tinjauan</th>
              <th style={cell}>Versi</th>
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
                <td style={cell}>{orDash(row.methodType)}</td>
                <td style={cell}>{orDash(row.locationType)}</td>
                <td style={cell}>{originLabel(row.workspaceId)}</td>
                <td style={{ ...cell, color: NAVY }}>
                  {orDash(row.reviewStatus)}
                  {row.archivedAt ? <span style={{ color: MUTED }}> · Diarsipkan</span> : null}
                </td>
                <td style={cell}>{orDash(row._count?.versions)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </main>
  );
}

export default AhspRoomPage;
