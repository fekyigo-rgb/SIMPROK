import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../utils/apiClient';
import {
  groupAhspDefinitionResources,
  hasAnyDefinitionComponent,
  type AhspDefinitionComponentGroup,
  type AhspDefinitionResourceWire,
} from '../utils/ahspCompositionDisplay';

/**
 * THE room's own detail — not a second AHSP room, not the RAB preview.
 *
 * It asks GET /ahsp/:id, the definition the list already proved visible, and
 * renders stored columns plus the version's stored resources. It does not
 * call eligible-versions, occurrences, or snapshots: those are bind and
 * project-freeze questions, not "what is this AHSP".
 */

type AhspVersion = {
  id: string;
  versionNumber: number | null;
  status: string | null;
  outputUnit: string | null;
  regulationReference: string | null;
  regulationPage: string | null;
  regulationSection: string | null;
  effectiveDate: string | null;
  expiredDate: string | null;
  resources?: AhspDefinitionResourceWire[] | null;
};

type AhspDetail = {
  id: string;
  workspaceId: string | null;
  workType: string | null;
  methodType: string | null;
  locationType: string | null;
  methodName: string | null;
  ownershipType: string | null;
  reviewStatus: string | null;
  archivedAt: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  approvedByEmail: string | null;
  ownershipTransferredAt: string | null;
  ownershipTransferredByName: string | null;
  versions?: AhspVersion[] | null;
};

type DetailState =
  | { phase: 'LOADING' }
  | { phase: 'READY'; ahsp: AhspDetail }
  | { phase: 'FAILED'; message: string };

const NAVY = 'var(--simprok-authority-navy-800)';
const MUTED = 'var(--simprok-engineering-blue-500)';

const orDash = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? (
    <span style={{ color: MUTED }}>—</span>
  ) : (
    <>{String(value)}</>
  );

const originLabel = (workspaceId: string | null) =>
  workspaceId === null ? 'Repositori Resmi' : 'Workspace ini';

const field: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '11rem 1fr',
  gap: 'var(--space-3)',
  padding: 'var(--space-2) 0',
  borderBottom: '1px solid var(--simprok-engineering-blue-100)',
  fontSize: 'var(--text-sm)',
};

const labelStyle: React.CSSProperties = { color: MUTED, margin: 0 };
const valueStyle: React.CSSProperties = { color: NAVY, margin: 0 };

export function AhspDetailPage() {
  const { ahspId } = useParams<{ ahspId: string }>();
  const [state, setState] = useState<DetailState>({ phase: 'LOADING' });
  const [versionId, setVersionId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!ahspId) {
      setState({
        phase: 'FAILED',
        message: 'AHSP ini tidak dapat dibuka karena identitasnya tidak ada di alamat.',
      });
      return;
    }
    const load = async () => {
      try {
        const response = await apiFetch('/ahsp/' + ahspId);
        if (!response.ok) {
          if (!active) return;
          setState({
            phase: 'FAILED',
            message:
              response.status === 401 || response.status === 403
                ? 'Workspace aktif Anda tidak memiliki kewenangan untuk membuka AHSP ini.'
                : response.status === 404
                  ? 'AHSP ini tidak ditemukan dalam workspace aktif.'
                  : 'AHSP tidak dapat dibaca (HTTP ' + response.status + ').',
          });
          return;
        }
        const data = (await response.json()) as AhspDetail;
        if (!active) return;
        setState({ phase: 'READY', ahsp: data });
        const first = Array.isArray(data.versions) && data.versions[0] ? data.versions[0].id : null;
        setVersionId(first);
      } catch {
        if (!active) return;
        setState({ phase: 'FAILED', message: 'AHSP tidak dapat dihubungi.' });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [ahspId]);

  const selectedVersion = useMemo(() => {
    if (state.phase !== 'READY') return null;
    const versions = state.ahsp.versions ?? [];
    return versions.find((version) => version.id === versionId) ?? versions[0] ?? null;
  }, [state, versionId]);

  const groups: AhspDefinitionComponentGroup[] = useMemo(
    () => groupAhspDefinitionResources(selectedVersion?.resources),
    [selectedVersion],
  );

  return (
    <main aria-label="Detail AHSP" style={{ padding: 'var(--space-6, 1.5rem)' }}>
      <p style={{ fontSize: 'var(--text-sm)', margin: 0 }}>
        <Link to="/ahsp" style={{ color: 'var(--simprok-trust-blue-500)' }}>
          ← AHSP
        </Link>
      </p>

      {state.phase === 'LOADING' ? (
        <p role="status" style={{ color: MUTED }}>
          Memuat detail AHSP…
        </p>
      ) : null}

      {state.phase === 'FAILED' ? (
        <section className="simprok-honest-frame" role="alert" aria-label="AHSP tidak tersedia">
          <span className="simprok-honest-frame__badge">Tidak tersedia</span>
          <p>{state.message}</p>
        </section>
      ) : null}

      {state.phase === 'READY' ? (
        <>
          <header style={{ margin: 'var(--space-4) 0 var(--space-5)' }}>
            <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: 0 }}>SIMPROK / AHSP / Detail</p>
            <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: NAVY, margin: 'var(--space-1) 0' }}>
              {state.ahsp.methodName || state.ahsp.workType || 'AHSP'}
            </h1>
          </header>

          <section aria-label="Identitas AHSP" style={{ maxWidth: '48rem', marginBottom: 'var(--space-6)' }}>
            <div style={field}>
              <p style={labelStyle}>Kode AHSP</p>
              <p style={valueStyle}>{orDash(null)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Uraian</p>
              <p style={valueStyle}>{orDash(state.ahsp.methodName)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Jenis Pekerjaan</p>
              <p style={valueStyle}>{orDash(state.ahsp.workType)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Bidang</p>
              <p style={valueStyle}>{orDash(null)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Tipe metode</p>
              <p style={valueStyle}>{orDash(state.ahsp.methodType)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Lokasi</p>
              <p style={valueStyle}>{orDash(state.ahsp.locationType)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Asal</p>
              <p style={valueStyle}>{originLabel(state.ahsp.workspaceId)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Kepemilikan</p>
              <p style={valueStyle}>{orDash(state.ahsp.ownershipType)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Status tinjauan</p>
              <p style={valueStyle}>
                {orDash(state.ahsp.reviewStatus)}
                {state.ahsp.archivedAt ? <span style={{ color: MUTED }}> · Diarsipkan</span> : null}
              </p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Disetujui oleh</p>
              <p style={valueStyle}>{orDash(state.ahsp.approvedByName)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Dipindahkan oleh</p>
              <p style={valueStyle}>{orDash(state.ahsp.ownershipTransferredByName)}</p>
            </div>
          </section>

          <section aria-label="Versi AHSP" style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>Versi</h2>
            {!state.ahsp.versions || state.ahsp.versions.length === 0 ? (
              <section className="simprok-honest-frame" aria-label="Versi AHSP kosong">
                <span className="simprok-honest-frame__badge">Belum ada data</span>
                <p>AHSP ini belum memiliki versi.</p>
              </section>
            ) : (
              <>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-2)' }}>
                  Versi yang ditampilkan
                  <select
                    aria-label="Versi AHSP"
                    value={selectedVersion?.id ?? ''}
                    onChange={(event) => setVersionId(event.target.value)}
                    style={{ display: 'block', marginTop: 'var(--space-1)', color: NAVY }}
                  >
                    {state.ahsp.versions.map((version) => (
                      <option key={version.id} value={version.id}>
                        {version.versionNumber == null ? '—' : 'Versi ' + version.versionNumber}
                        {version.status ? ' · ' + version.status : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <div style={field}>
                  <p style={labelStyle}>Status versi</p>
                  <p style={valueStyle}>{orDash(selectedVersion?.status)}</p>
                </div>
                <div style={field}>
                  <p style={labelStyle}>Satuan output</p>
                  <p style={valueStyle}>{orDash(selectedVersion?.outputUnit)}</p>
                </div>
                <div style={field}>
                  <p style={labelStyle}>Sumber / peraturan</p>
                  <p style={valueStyle}>{orDash(selectedVersion?.regulationReference)}</p>
                </div>
                <div style={field}>
                  <p style={labelStyle}>Halaman</p>
                  <p style={valueStyle}>{orDash(selectedVersion?.regulationPage)}</p>
                </div>
                <div style={field}>
                  <p style={labelStyle}>Bagian</p>
                  <p style={valueStyle}>{orDash(selectedVersion?.regulationSection)}</p>
                </div>
              </>
            )}
          </section>

          <section aria-label="Komponen pembentuk">
            <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
              Komponen pembentuk
            </h2>
            {!selectedVersion ? (
              <section className="simprok-honest-frame" aria-label="Komponen AHSP kosong">
                <span className="simprok-honest-frame__badge">Belum ada data</span>
                <p>Komponen tidak dapat ditampilkan karena versi belum ada.</p>
              </section>
            ) : !hasAnyDefinitionComponent(groups) ? (
              <section className="simprok-honest-frame" aria-label="Komponen AHSP kosong">
                <span className="simprok-honest-frame__badge">Belum ada data</span>
                <p>Versi ini belum menyatakan komponen tenaga, bahan, atau peralatan.</p>
              </section>
            ) : (
              groups.map((group) => (
                <section
                  key={group.key}
                  aria-label={group.label}
                  style={{ marginBottom: 'var(--space-5)' }}
                >
                  <h3 style={{ fontSize: 'var(--text-sm)', color: NAVY, margin: '0 0 var(--space-2)' }}>
                    {group.label}
                  </h3>
                  {group.rows.length === 0 ? (
                    <p style={{ color: MUTED, fontSize: 'var(--text-sm)', margin: 0 }}>—</p>
                  ) : (
                    <table
                      style={{ width: '100%', maxWidth: '48rem', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}
                    >
                      <thead>
                        <tr style={{ textAlign: 'left', color: NAVY }}>
                          <th style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                            Sumber daya
                          </th>
                          <th style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                            Satuan
                          </th>
                          <th style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                            Koefisien
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.map((row, index) => (
                          <tr key={group.key + '-' + index}>
                            <td style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)', color: NAVY }}>
                              {row.name}
                            </td>
                            <td style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                              {row.unit}
                            </td>
                            <td style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                              {row.coefficient}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              ))
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}

export default AhspDetailPage;
