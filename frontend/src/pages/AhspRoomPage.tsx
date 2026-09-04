import { useEffect, useState } from 'react';
import { apiFetch } from '../utils/apiClient';

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

/**
 * A NULL workspaceId is the Official Repository, which is why the backend lets
 * every workspace see it. Saying so is more honest than printing an empty cell.
 */
const originLabel = (workspaceId: string | null) =>
  workspaceId === null ? 'Repositori Resmi' : 'Workspace ini';

export function AhspRoomPage() {
  const [state, setState] = useState<RoomState>({ phase: 'LOADING' });

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await apiFetch('/ahsp');
        if (!response.ok) {
          if (!active) return;
          // A refused or broken request is a FAILURE, never an empty room.
          // Rendering "belum ada AHSP" for a 403 would report an authorization
          // fact as a data fact, and send the user looking for AHSP that exists.
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
                <td style={cell}>{orDash(row.workType)}</td>
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
