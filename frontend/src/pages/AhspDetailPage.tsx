import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
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
 * Reads GET /ahsp/:id. Update appends a historical revision through the
 * existing POST /ahsp/:id/versions route. Historical revisions stay visible
 * as provenance, never as alternative AHSPs to activate.
 *
 * Schema fillers and provenance internals (page, section, expiredDate,
 * methodType, locationType) stay stored. They are not shown as AHSP facts.
 *
 * Internal curation (approve / archive / transfer / retire / snapshot) stays
 * on the existing API. It is not AHSP identity for an ordinary user. There is
 * no AHSP "Usulkan ke SIMPROK" user-proposal workflow on this surface.
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
  methodName: string | null;
  archivedAt: string | null;
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

const actionButton: CSSProperties = {
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

const field: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '11rem 1fr',
  gap: 'var(--space-3)',
  padding: 'var(--space-2) 0',
  borderBottom: '1px solid var(--simprok-engineering-blue-100)',
  fontSize: 'var(--text-sm)',
};

const labelStyle: CSSProperties = { color: MUTED, margin: 0 };
const valueStyle: CSSProperties = { color: NAVY, margin: 0 };

const emptyResource = (): ResourceDraft => ({
  resourceId: '',
  resourceType: 'LABOR',
  coefficient: '',
  baseUnit: '',
});

const toDateInput = (value: string | null | undefined) => {
  if (!value) return '';
  const day = value.slice(0, 10);
  return day.length === 10 ? day : '';
};

const draftsFromVersion = (version: AhspVersion | null): ResourceDraft[] => {
  const resources = version?.resources ?? [];
  if (resources.length === 0) return [emptyResource()];
  return resources.map((row) => ({
    resourceId: (row.resourceId ?? '').trim(),
    resourceType:
      row.resourceType === 'MATERIAL' || row.resourceType === 'EQUIPMENT'
        ? row.resourceType
        : 'LABOR',
    coefficient: row.coefficient == null ? '' : String(row.coefficient),
    baseUnit: (row.baseUnit ?? '').trim(),
  }));
};

const historyStatusLabel = (status: string | null | undefined) => {
  if (status === 'SUPERSEDED') return 'Diganti';
  if (status === 'ARCHIVED') return 'Diarsipkan';
  if (status === 'DRAFT') return 'Draf';
  if (status === 'PUBLISHED') return 'Diterbitkan';
  return 'Riwayat';
};

const isHistoricalStatus = (status: string | null | undefined) =>
  status === 'SUPERSEDED' || status === 'ARCHIVED';

const formatStoredDate = (value: string | null) => {
  if (!value) return null;
  const day = value.slice(0, 10);
  return day.length === 10 ? day : value;
};

export function AhspDetailPage() {
  const { ahspId } = useParams<{ ahspId: string }>();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const [state, setState] = useState<DetailState>({ phase: 'LOADING' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outputUnit, setOutputUnit] = useState('');
  const [regulationReference, setRegulationReference] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [resourceDrafts, setResourceDrafts] = useState<ResourceDraft[]>([emptyResource()]);

  const applyPayload = useCallback((data: AhspDetail) => {
    setState({ phase: 'READY', ahsp: data });
    const current = (data.versions ?? [])[0] ?? null;
    setOutputUnit(current?.outputUnit ?? '');
    setRegulationReference(current?.regulationReference ?? '');
    setEffectiveDate(toDateInput(current?.effectiveDate));
    setResourceDrafts(draftsFromVersion(current));
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
        applyPayload(data);
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

  const currentVersion = useMemo(() => {
    if (state.phase !== 'READY') return null;
    const versions = state.ahsp.versions ?? [];
    return versions[0] ?? null;
  }, [state]);

  const historicalVersions = useMemo(() => {
    if (state.phase !== 'READY') return [];
    return (state.ahsp.versions ?? []).slice(1);
  }, [state]);

  const groups: AhspDefinitionComponentGroup[] = useMemo(
    () => groupAhspDefinitionResources(currentVersion?.resources),
    [currentVersion],
  );

  const reload = async () => {
    if (!ahspId) return;
    const response = await apiFetch('/ahsp/' + ahspId);
    if (!response.ok) {
      setActionError('AHSP tidak dapat dibaca ulang (HTTP ' + response.status + ').');
      return;
    }
    applyPayload((await response.json()) as AhspDetail);
  };

  const addVersion = async (event: FormEvent) => {
    event.preventDefault();
    if (!ahspId || busy) return;
    const unit = outputUnit.trim();
    const resources = resourceDrafts
      .map((row) => ({
        resourceId: row.resourceId.trim(),
        resourceType: row.resourceType,
        coefficient: Number(row.coefficient),
        baseUnit: row.baseUnit.trim(),
      }))
      .filter(
        (row) =>
          row.resourceId !== '' &&
          row.baseUnit !== '' &&
          Number.isFinite(row.coefficient) &&
          row.coefficient > 0,
      );
    if (unit === '') {
      setActionError('Satuan AHSP diperlukan.');
      return;
    }
    if (resources.length === 0) {
      setActionError('Isi paling sedikit satu komponen dengan sumber daya, satuan, dan koefisien.');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const response = await apiFetch('/ahsp/' + ahspId + '/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outputUnit: unit,
          regulationReference: regulationReference.trim() || undefined,
          effectiveDate: effectiveDate.trim() ? new Date(effectiveDate.trim()).toISOString() : undefined,
          resources,
        }),
      });
      if (!response.ok) {
        setActionError(
          response.status === 400
            ? 'Pembaruan belum dapat disimpan. Periksa satuan dan komponen.'
            : 'Pembaruan AHSP tidak dapat disimpan (HTTP ' + response.status + ').',
        );
        return;
      }
      await reload();
    } catch {
      setActionError('Pembaruan AHSP tidak dapat dihubungi.');
    } finally {
      setBusy(false);
    }
  };

  const workspaceOwned = state.phase === 'READY' && state.ahsp.workspaceId !== null;
  const archived = state.phase === 'READY' && Boolean(state.ahsp.archivedAt);
  const sourceDate = formatStoredDate(currentVersion?.effectiveDate ?? null);

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
            <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: NAVY, margin: 0 }}>
              {state.ahsp.methodName || state.ahsp.workType || 'AHSP'}
            </h1>
          </header>

          <section aria-label="Identitas AHSP" style={{ maxWidth: '48rem', marginBottom: 'var(--space-6)' }}>
            <div style={field}>
              <p style={labelStyle}>Jenis pekerjaan</p>
              <p style={valueStyle}>{orDash(state.ahsp.workType)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Uraian</p>
              <p style={valueStyle}>{orDash(state.ahsp.methodName)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Satuan</p>
              <p style={valueStyle}>{orDash(currentVersion?.outputUnit)}</p>
            </div>
            <div style={field}>
              <p style={labelStyle}>Sumber / peraturan</p>
              <p style={valueStyle}>{orDash(currentVersion?.regulationReference)}</p>
            </div>
            {sourceDate ? (
              <div style={field}>
                <p style={labelStyle}>Tanggal sumber</p>
                <p style={valueStyle}>{sourceDate}</p>
              </div>
            ) : null}
            <div style={field}>
              <p style={labelStyle}>Kepemilikan</p>
              <p style={valueStyle}>
                {state.ahsp.workspaceId === null ? 'Pustaka SIMPROK' : 'AHSP Saya'}
              </p>
            </div>
          </section>

          <section aria-label="AHSP yang berlaku" style={{ marginBottom: 'var(--space-6)' }}>
            <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
              AHSP yang berlaku
            </h2>
            {archived || !currentVersion || isHistoricalStatus(currentVersion.status) ? (
              <section className="simprok-honest-frame" aria-label="AHSP tidak berlaku">
                <span className="simprok-honest-frame__badge">Tidak berlaku</span>
                <p>
                  {!currentVersion
                    ? 'AHSP ini belum memiliki rumus yang tersimpan.'
                    : 'AHSP ini tidak digunakan untuk pilihan baru.'}
                </p>
              </section>
            ) : (
              <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: 0 }}>
                AHSP yang saat ini digunakan SIMPROK.
              </p>
            )}
          </section>

          {historicalVersions.length > 0 ? (
            <section aria-label="Riwayat AHSP" style={{ marginBottom: 'var(--space-6)' }}>
              <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
                Riwayat
              </h2>
              <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
                Riwayat perubahan AHSP.
              </p>
              <table
                style={{ width: '100%', maxWidth: '48rem', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}
              >
                <thead>
                  <tr style={{ textAlign: 'left', color: NAVY }}>
                    <th style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                      Sumber / Peraturan
                    </th>
                    <th style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                      Berlaku dari
                    </th>
                    <th style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {historicalVersions.map((version) => (
                    <tr key={version.id}>
                      <td style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)', color: NAVY }}>
                        {version.regulationReference || '—'}
                      </td>
                      <td style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                        {formatStoredDate(version.effectiveDate) || '—'}
                      </td>
                      <td style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                        {historyStatusLabel(version.status)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}

          {workspaceOwned && canManage && !archived ? (
            <form aria-label="Update AHSP" onSubmit={addVersion} style={{ marginBottom: 'var(--space-6)' }}>
              <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
                Update AHSP
              </h2>
              <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
                Perbarui rumus. Jejak sebelumnya tetap tersimpan.
              </p>
              <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-2)' }}>
                Satuan
                <input
                  required
                  value={outputUnit}
                  onChange={(event) => setOutputUnit(event.target.value)}
                  aria-label="Satuan AHSP"
                  style={{ display: 'block', color: NAVY }}
                />
              </label>
              <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
                Sumber / peraturan
                <input
                  value={regulationReference}
                  onChange={(event) => setRegulationReference(event.target.value)}
                  aria-label="Sumber peraturan AHSP"
                  style={{ display: 'block', width: '100%', maxWidth: '36rem', color: NAVY }}
                />
              </label>
              <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
                Tanggal sumber
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(event) => setEffectiveDate(event.target.value)}
                  aria-label="Tanggal sumber"
                  style={{ display: 'block', color: NAVY }}
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
                    aria-label={'Kelompok ' + (index + 1)}
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
                    <option value="LABOR">Tenaga</option>
                    <option value="MATERIAL">Bahan</option>
                    <option value="EQUIPMENT">Peralatan</option>
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
                Update AHSP
              </button>
              {actionError ? (
                <p role="alert" style={{ color: NAVY, fontSize: 'var(--text-sm)' }}>
                  {actionError}
                </p>
              ) : null}
            </form>
          ) : null}

          {actionError && !(workspaceOwned && canManage && !archived) ? (
            <p role="alert" style={{ color: NAVY, fontSize: 'var(--text-sm)' }}>
              {actionError}
            </p>
          ) : null}

          <section aria-label="Komponen pembentuk">
            <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-3)' }}>
              Komponen pembentuk
            </h2>
            {!currentVersion ? (
              <section className="simprok-honest-frame" aria-label="Komponen AHSP kosong">
                <span className="simprok-honest-frame__badge">Belum ada data</span>
                <p>Komponen tidak dapat ditampilkan karena rumus belum ada.</p>
              </section>
            ) : !hasAnyDefinitionComponent(groups) ? (
              <section className="simprok-honest-frame" aria-label="Komponen AHSP kosong">
                <span className="simprok-honest-frame__badge">Belum ada data</span>
                <p>AHSP ini belum menyatakan komponen tenaga, bahan, atau peralatan.</p>
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
