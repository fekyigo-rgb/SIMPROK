import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import {
  groupAhspDefinitionResources,
  hasAnyDefinitionComponent,
  type AhspDefinitionComponentGroup,
  type AhspDefinitionResourceWire,
} from '../utils/ahspCompositionDisplay';

/**
 * THE room's own detail — not a second AHSP room, not the RAB preview.
 *
 * Reads GET /ahsp/:id. Mutations call the existing AhspController routes:
 * approve, archive, transfer, createVersion, retire, snapshot. Official
 * Repository rows (workspaceId null) stay read-only here because withdrawing
 * national reference data is not one workspace's decision.
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

type ResourceDraft = {
  resourceId: string;
  resourceType: 'LABOR' | 'MATERIAL' | 'EQUIPMENT';
  coefficient: string;
  baseUnit: string;
};

const NAVY = 'var(--simprok-authority-navy-800)';
const MUTED = 'var(--simprok-engineering-blue-500)';

const actionButton: React.CSSProperties = {
  background: 'var(--simprok-trust-blue-500)',
  color: '#FFFFFF',
  border: 0,
  padding: 'var(--space-2) var(--space-4)',
  marginRight: 'var(--space-2)',
  marginBottom: 'var(--space-2)',
};

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

const emptyResource = (): ResourceDraft => ({
  resourceId: '',
  resourceType: 'LABOR',
  coefficient: '',
  baseUnit: '',
});

export function AhspDetailPage() {
  const { ahspId } = useParams<{ ahspId: string }>();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const canApprove = hasPermission('AHSP_APPROVE');
  const [state, setState] = useState<DetailState>({ phase: 'LOADING' });
  const [versionId, setVersionId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outputUnit, setOutputUnit] = useState('');
  const [regulationReference, setRegulationReference] = useState('');
  const [resourceDrafts, setResourceDrafts] = useState<ResourceDraft[]>([emptyResource()]);

  const applyPayload = useCallback((data: AhspDetail, preserveVersionId: string | null) => {
    setState({ phase: 'READY', ahsp: data });
    const versions = data.versions ?? [];
    const keep =
      preserveVersionId && versions.some((version) => version.id === preserveVersionId)
        ? preserveVersionId
        : versions[0]
          ? versions[0].id
          : null;
    setVersionId(keep);
  }, []);

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
        applyPayload(data, null);
      } catch {
        if (!active) return;
        setState({ phase: 'FAILED', message: 'AHSP tidak dapat dihubungi.' });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [ahspId, applyPayload]);

  const selectedVersion = useMemo(() => {
    if (state.phase !== 'READY') return null;
    const versions = state.ahsp.versions ?? [];
    return versions.find((version) => version.id === versionId) ?? versions[0] ?? null;
  }, [state, versionId]);

  const groups: AhspDefinitionComponentGroup[] = useMemo(
    () => groupAhspDefinitionResources(selectedVersion?.resources),
    [selectedVersion],
  );

  const reload = async (preserveVersionId: string | null) => {
    if (!ahspId) return;
    const response = await apiFetch('/ahsp/' + ahspId);
    if (!response.ok) {
      setActionError('AHSP tidak dapat dibaca ulang (HTTP ' + response.status + ').');
      return;
    }
    applyPayload((await response.json()) as AhspDetail, preserveVersionId);
  };

  const runAction = async (path: string, body: Record<string, unknown>, preserveVersionId: string | null) => {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const response = await apiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setActionError('Tindakan ditolak (HTTP ' + response.status + ').');
        return;
      }
      await reload(preserveVersionId);
    } catch {
      setActionError('Tindakan tidak dapat dihubungi.');
    } finally {
      setBusy(false);
    }
  };

  const addVersion = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ahspId || busy) return;
    const resources = resourceDrafts
      .map((row) => ({
        resourceId: row.resourceId.trim(),
        resourceType: row.resourceType,
        coefficient: Number(row.coefficient),
        baseUnit: row.baseUnit.trim(),
      }))
      .filter((row) => row.resourceId !== '' && row.baseUnit !== '' && Number.isFinite(row.coefficient));
    setBusy(true);
    setActionError(null);
    try {
      const response = await apiFetch('/ahsp/' + ahspId + '/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outputUnit: outputUnit.trim(),
          regulationReference: regulationReference.trim() || undefined,
          resources,
        }),
      });
      if (!response.ok) {
        setActionError('Versi tidak dapat dibuat (HTTP ' + response.status + ').');
        return;
      }
      const created = (await response.json()) as { id?: string };
      await reload(typeof created.id === 'string' ? created.id : null);
      setOutputUnit('');
      setRegulationReference('');
      setResourceDrafts([emptyResource()]);
    } catch {
      setActionError('Versi tidak dapat dihubungi.');
    } finally {
      setBusy(false);
    }
  };

  const workspaceOwned = state.phase === 'READY' && state.ahsp.workspaceId !== null;
  const archived = state.phase === 'READY' && Boolean(state.ahsp.archivedAt);
  const approved = state.phase === 'READY' && state.ahsp.reviewStatus === 'APPROVED';
  const userAsset = state.phase === 'READY' && state.ahsp.ownershipType === 'USER_ASSET';
  const retired =
    selectedVersion?.status === 'SUPERSEDED' || selectedVersion?.status === 'ARCHIVED';

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

          {workspaceOwned && !archived ? (
            <section aria-label="Tata kelola AHSP" style={{ maxWidth: '48rem', marginBottom: 'var(--space-6)' }}>
              <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
                Tata kelola
              </h2>
              <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
                Memakai rute AhspController yang sudah ada. Bukan katalog kedua,
                bukan Repositori Resmi. Alih kepemilikan mengubah ownershipType
                setelah disetujui, bukan workspaceId.
              </p>
              <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
                Alasan (wajib untuk arsip, alih kepemilikan, dan tarik versi)
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  aria-label="Alasan tata kelola"
                  rows={2}
                  style={{ display: 'block', width: '100%', color: NAVY }}
                />
              </label>
              {canApprove && !approved ? (
                <button
                  type="button"
                  disabled={busy}
                  style={actionButton}
                  onClick={() => void runAction('/ahsp/' + state.ahsp.id + '/approve', {}, versionId)}
                >
                  Setujui
                </button>
              ) : null}
              {canManage ? (
                <button
                  type="button"
                  disabled={busy || reason.trim() === ''}
                  style={actionButton}
                  onClick={() =>
                    void runAction('/ahsp/' + state.ahsp.id + '/archive', { reason: reason.trim() }, versionId)
                  }
                >
                  Arsipkan
                </button>
              ) : null}
              {canManage && approved && userAsset ? (
                <button
                  type="button"
                  disabled={busy || reason.trim() === ''}
                  style={actionButton}
                  onClick={() =>
                    void runAction(
                      '/ahsp/' + state.ahsp.id + '/transfer',
                      { reason: reason.trim(), targetOwnershipType: 'APPROVED_COMMUNITY_ASSET' },
                      versionId,
                    )
                  }
                >
                  Alihkan ke aset komunitas yang disetujui
                </button>
              ) : null}
              {actionError ? (
                <p role="alert" style={{ color: NAVY, fontSize: 'var(--text-sm)' }}>
                  {actionError}
                </p>
              ) : null}
            </section>
          ) : null}

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
                {workspaceOwned && canManage && selectedVersion && !retired ? (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <button
                      type="button"
                      disabled={busy || reason.trim() === ''}
                      style={actionButton}
                      onClick={() =>
                        void runAction(
                          '/ahsp/versions/' + selectedVersion.id + '/retire',
                          { status: 'SUPERSEDED', reason: reason.trim() },
                          selectedVersion.id,
                        )
                      }
                    >
                      Tarik versi (diganti)
                    </button>
                    <button
                      type="button"
                      disabled={busy || reason.trim() === ''}
                      style={actionButton}
                      onClick={() =>
                        void runAction(
                          '/ahsp/versions/' + selectedVersion.id + '/retire',
                          { status: 'ARCHIVED', reason: reason.trim() },
                          selectedVersion.id,
                        )
                      }
                    >
                      Tarik versi (diarsipkan)
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      style={actionButton}
                      onClick={() =>
                        void runAction(
                          '/ahsp/versions/' + selectedVersion.id + '/snapshot',
                          {},
                          selectedVersion.id,
                        )
                      }
                    >
                      Bekukan versi ini
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </section>

          {workspaceOwned && canManage && !archived ? (
            <form aria-label="Tambah versi AHSP" onSubmit={addVersion} style={{ marginBottom: 'var(--space-6)' }}>
              <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
                Tambah versi
              </h2>
              <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
                Memakai POST /ahsp/:id/versions. Satuan output diselesaikan Unit Kernel yang sudah ada.
              </p>
              <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-2)' }}>
                Satuan output
                <input
                  required
                  value={outputUnit}
                  onChange={(event) => setOutputUnit(event.target.value)}
                  aria-label="Satuan output versi"
                  style={{ display: 'block', color: NAVY }}
                />
              </label>
              <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
                Sumber / peraturan
                <input
                  value={regulationReference}
                  onChange={(event) => setRegulationReference(event.target.value)}
                  aria-label="Sumber peraturan versi"
                  style={{ display: 'block', width: '100%', maxWidth: '36rem', color: NAVY }}
                />
              </label>
              {resourceDrafts.map((row, index) => (
                <fieldset
                  key={index}
                  style={{ border: '1px solid var(--simprok-engineering-blue-100)', marginBottom: 'var(--space-2)', padding: 'var(--space-3)' }}
                >
                  <legend style={{ color: NAVY, fontSize: 'var(--text-sm)' }}>Komponen {index + 1}</legend>
                  <input
                    placeholder="Sumber daya"
                    aria-label={'Sumber daya ' + (index + 1)}
                    value={row.resourceId}
                    onChange={(event) => {
                      const next = [...resourceDrafts];
                      next[index] = { ...row, resourceId: event.target.value };
                      setResourceDrafts(next);
                    }}
                    style={{ marginRight: 'var(--space-2)', color: NAVY }}
                  />
                  <select
                    aria-label={'Tipe sumber daya ' + (index + 1)}
                    value={row.resourceType}
                    onChange={(event) => {
                      const next = [...resourceDrafts];
                      next[index] = {
                        ...row,
                        resourceType: event.target.value as ResourceDraft['resourceType'],
                      };
                      setResourceDrafts(next);
                    }}
                    style={{ marginRight: 'var(--space-2)', color: NAVY }}
                  >
                    <option value="LABOR">LABOR</option>
                    <option value="MATERIAL">MATERIAL</option>
                    <option value="EQUIPMENT">EQUIPMENT</option>
                  </select>
                  <input
                    placeholder="Satuan"
                    aria-label={'Satuan komponen ' + (index + 1)}
                    value={row.baseUnit}
                    onChange={(event) => {
                      const next = [...resourceDrafts];
                      next[index] = { ...row, baseUnit: event.target.value };
                      setResourceDrafts(next);
                    }}
                    style={{ marginRight: 'var(--space-2)', color: NAVY }}
                  />
                  <input
                    placeholder="Koefisien"
                    aria-label={'Koefisien ' + (index + 1)}
                    value={row.coefficient}
                    onChange={(event) => {
                      const next = [...resourceDrafts];
                      next[index] = { ...row, coefficient: event.target.value };
                      setResourceDrafts(next);
                    }}
                    style={{ color: NAVY }}
                  />
                </fieldset>
              ))}
              <button
                type="button"
                onClick={() => setResourceDrafts([...resourceDrafts, emptyResource()])}
                style={{ ...actionButton, background: NAVY }}
              >
                Tambah baris komponen
              </button>
              <button type="submit" disabled={busy} style={actionButton}>
                Simpan versi
              </button>
            </form>
          ) : null}

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
