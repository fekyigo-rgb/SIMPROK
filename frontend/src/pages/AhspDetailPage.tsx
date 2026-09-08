import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Layers, Users, Package, Wrench, FileText, Info, Pencil, History, ArrowLeft, Send, MoreHorizontal, BadgeCheck } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import {
  groupAhspDefinitionResources,
  hasAnyDefinitionComponent,
  resolveDefinitionResourceName,
  type AhspDefinitionComponentGroup,
  type AhspDefinitionResourceWire,
} from '../utils/ahspCompositionDisplay';
import { describeAhspProposalStatus, canProposeAhsp, formatIndoDate } from '../utils/ahspProposalStatus';

/**
 * THE room's own detail — the Owner-approved detail view.
 *
 * Reads GET /ahsp/:id (definition + versions + resources + createdByEmail).
 * Update appends a revision through the existing POST /ahsp/:id/versions route;
 * "Usulkan ke SIMPROK" submits the AHSP for human review through the existing
 * POST /ahsp/:id/propose route — it never publishes. All data is backend truth;
 * this file only arranges it into the Owner mockup and speaks plain Indonesian.
 */

type AhspVersion = {
  id: string;
  versionNumber: number | null;
  status: string | null;
  outputUnit: string | null;
  regulationReference: string | null;
  effectiveDate: string | null;
  resources?: AhspDefinitionResourceWire[] | null;
};

type AhspDetail = {
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
  createdByEmail: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  archivedAt: string | null;
  versions?: AhspVersion[] | null;
};

type DetailState =
  | { phase: 'LOADING' }
  | { phase: 'READY'; ahsp: AhspDetail }
  | { phase: 'FAILED'; message: string };

type ResourceDraft = {
  resourceId: string;
  resourceName: string | null;
  stored: boolean;
  resourceType: 'LABOR' | 'MATERIAL' | 'EQUIPMENT';
  coefficient: string;
  baseUnit: string;
};

const NAVY = 'var(--simprok-authority-navy-800)';
const MUTED = 'var(--simprok-engineering-blue-500)';
const BLUE = 'var(--simprok-trust-blue-500)';
const HAIRLINE = '1px solid var(--simprok-engineering-blue-100)';
const CARD: CSSProperties = {
  background: '#FFFFFF',
  border: HAIRLINE,
  borderRadius: '12px',
  padding: 'var(--space-5, 1.25rem)',
};
const ICON_TILE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '2rem',
  height: '2rem',
  borderRadius: '8px',
  background: 'var(--simprok-engineering-blue-100)',
  color: BLUE,
  flex: '0 0 auto',
};
const outlineButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  background: '#FFFFFF',
  color: NAVY,
  border: HAIRLINE,
  borderRadius: '8px',
  padding: 'var(--space-2) var(--space-4)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
};
const primaryButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  background: BLUE,
  color: '#FFFFFF',
  border: 0,
  borderRadius: '8px',
  padding: 'var(--space-2) var(--space-4)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
};

const orDash = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? (
    <span style={{ color: MUTED }}>—</span>
  ) : (
    <>{String(value)}</>
  );

const emptyResource = (): ResourceDraft => ({
  resourceId: '',
  resourceName: null,
  stored: false,
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
    resourceName: row.resourceName ?? null,
    stored: true,
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

const GROUP_ICON: Record<string, ReactNode> = {
  TENAGA: <Users size={16} />,
  BAHAN: <Package size={16} />,
  PERALATAN: <Wrench size={16} />,
};

export function AhspDetailPage() {
  const { ahspId } = useParams<{ ahspId: string }>();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const [state, setState] = useState<DetailState>({ phase: 'LOADING' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposing, setProposing] = useState(false);
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
                  : 'AHSP ini belum dapat dibaca. Coba lagi sebentar.',
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
    return (state.ahsp.versions ?? [])[0] ?? null;
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
      setActionError('AHSP tidak dapat dibaca ulang. Coba lagi sebentar.');
      return;
    }
    applyPayload((await response.json()) as AhspDetail);
  };

  const proposeToSimprok = async () => {
    if (!ahspId || proposing) return;
    setProposing(true);
    setActionError(null);
    try {
      const response = await apiFetch('/ahsp/' + ahspId + '/propose', { method: 'POST' });
      if (!response.ok) {
        setActionError('Usulan belum dapat dikirim. Coba lagi sebentar.');
        return;
      }
      await reload();
    } catch {
      setActionError('Usulan tidak dapat dihubungi.');
    } finally {
      setProposing(false);
    }
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
            : 'Pembaruan AHSP belum dapat disimpan. Coba lagi sebentar.',
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

  const ahsp = state.phase === 'READY' ? state.ahsp : null;
  const workspaceOwned = ahsp?.workspaceId != null;
  const archived = Boolean(ahsp?.archivedAt);
  const outOfForce = archived || isHistoricalStatus(currentVersion?.status);
  const title = ahsp?.methodName || ahsp?.workType || 'AHSP';
  const proposalStatus = ahsp ? describeAhspProposalStatus(ahsp) : '';
  const showPropose = Boolean(ahsp && canManage && canProposeAhsp(ahsp));

  const infoRow = (label: string, value: ReactNode) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '11rem 0.5rem 1fr',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) 0',
        borderBottom: HAIRLINE,
        fontSize: 'var(--text-sm)',
      }}
    >
      <span style={{ color: MUTED }}>{label}</span>
      <span style={{ color: MUTED }}>:</span>
      <span style={{ color: NAVY }}>{value}</span>
    </div>
  );

  return (
    <main aria-label="Detail AHSP" style={{ padding: 'var(--space-5, 1.25rem)' }}>
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

      {ahsp ? (
        <>
          {/* Breadcrumb */}
          <nav aria-label="Jejak navigasi" style={{ fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
            <span>Beranda</span>
            <span style={{ margin: '0 var(--space-2)' }}>›</span>
            <Link to="/ahsp" style={{ color: MUTED, textDecoration: 'none' }}>AHSP</Link>
            <span style={{ margin: '0 var(--space-2)' }}>›</span>
            <span style={{ color: NAVY }}>{title}</span>
          </nav>

          {/* Header */}
          <header
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: 'var(--space-4)',
            }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: NAVY, margin: 0 }}>{title}</h1>
                {workspaceOwned ? (
                  <span
                    style={{
                      background: 'rgba(46, 158, 107, 0.12)',
                      color: '#2E9E6B',
                      borderRadius: '999px',
                      padding: '0.15rem 0.6rem',
                      fontSize: 'var(--text-sm)',
                      fontWeight: 600,
                    }}
                  >
                    AHSP Saya
                  </span>
                ) : null}
              </div>
              {ahsp.classification ? (
                <p style={{ margin: 'var(--space-1) 0 0', color: MUTED, fontSize: 'var(--text-sm)' }}>{ahsp.classification}</p>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Link to="/ahsp" style={outlineButton}>
                <ArrowLeft size={16} /> Kembali
              </Link>
              {showPropose ? (
                <button type="button" onClick={() => void proposeToSimprok()} disabled={proposing} style={primaryButton}>
                  <Send size={16} /> {proposing ? 'Mengirim…' : 'Usulkan ke SIMPROK'}
                </button>
              ) : null}
              {canManage ? (
                <button type="button" aria-label="Tindakan lain" style={{ ...outlineButton, padding: 'var(--space-2)' }} disabled>
                  <MoreHorizontal size={16} />
                </button>
              ) : null}
            </div>
          </header>

          {actionError ? (
            <p role="alert" style={{ color: '#C0392B', fontSize: 'var(--text-sm)', margin: '0 0 var(--space-3)' }}>
              {actionError}
            </p>
          ) : null}

          {/* Two columns: components (left) + information (right) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-5)', alignItems: 'flex-start' }}>
            <section aria-label="Komponen Pembentuk AHSP" style={{ ...CARD, flex: '1 1 30rem', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                <span style={ICON_TILE}><Layers size={16} /></span>
                <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: 0 }}>Komponen Pembentuk AHSP</h2>
              </div>
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
                  <section key={group.key} aria-label={group.label} style={{ marginBottom: 'var(--space-5)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{ ...ICON_TILE, width: '1.6rem', height: '1.6rem' }}>{GROUP_ICON[group.key] ?? <Package size={14} />}</span>
                        <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: NAVY, margin: 0 }}>{group.label}</h3>
                      </div>
                      <span style={{ color: MUTED, fontSize: 'var(--text-sm)' }}>{group.rows.length} komponen</span>
                    </div>
                    {group.rows.length === 0 ? (
                      <p style={{ color: MUTED, fontSize: 'var(--text-sm)', margin: 0 }}>—</p>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                        <thead>
                          <tr style={{ textAlign: 'left', color: MUTED, background: 'var(--simprok-engineering-blue-100)' }}>
                            <th style={{ padding: 'var(--space-1) var(--space-2)', width: '2.5rem' }}>No.</th>
                            <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Uraian</th>
                            <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Satuan</th>
                            <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Koefisien</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.rows.map((row, index) => (
                            <tr key={group.key + '-' + index}>
                              <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE, color: MUTED }}>{index + 1}</td>
                              <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE, color: NAVY }}>{row.name}</td>
                              <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE }}>{row.unit}</td>
                              <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE }}>{row.coefficient}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </section>
                ))
              )}
            </section>

            <aside style={{ flex: '1 1 20rem', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <section aria-label="Informasi AHSP" style={CARD}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                  <span style={ICON_TILE}><FileText size={16} /></span>
                  <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: 0 }}>Informasi AHSP</h2>
                </div>
                {infoRow('Kode', orDash(ahsp.code))}
                {infoRow('Jenis Pekerjaan', orDash(ahsp.workType))}
                {infoRow('Uraian', orDash(ahsp.methodName))}
                {infoRow('Satuan', orDash(currentVersion?.outputUnit))}
                {infoRow('Bidang / Kategori', orDash(ahsp.fieldCategory))}
                {infoRow('Subkategori', orDash(ahsp.subCategory))}
                {infoRow('Jenis Pekerjaan (klasifikasi)', orDash(ahsp.classification))}
                {infoRow('Dasar AHSP', orDash(currentVersion?.regulationReference))}
                {infoRow('Sumber', ahsp.workspaceId === null ? 'Pustaka SIMPROK' : 'AHSP Saya')}
                {infoRow(
                  'Status Usulan',
                  <span
                    style={{
                      background: 'var(--simprok-engineering-blue-100)',
                      color: NAVY,
                      borderRadius: '999px',
                      padding: '0.1rem 0.55rem',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    {proposalStatus}
                  </span>,
                )}
                {infoRow('Dibuat oleh', orDash(ahsp.createdByEmail))}
                {infoRow('Tanggal dibuat', formatIndoDate(ahsp.createdAt))}
                {infoRow('Terakhir diperbarui', formatIndoDate(ahsp.updatedAt))}
                {infoRow('Keterangan', <span style={{ color: MUTED }}>—</span>)}
              </section>

              <section
                aria-label="Tentang AHSP Ini"
                style={{
                  background: 'var(--simprok-engineering-blue-100)',
                  borderRadius: '12px',
                  padding: 'var(--space-4)',
                  display: 'flex',
                  gap: 'var(--space-3)',
                }}
              >
                <span style={{ color: BLUE, flex: '0 0 auto' }}><Info size={18} /></span>
                <div>
                  <p style={{ margin: '0 0 var(--space-1)', fontWeight: 600, color: NAVY, fontSize: 'var(--text-sm)' }}>Tentang AHSP Ini</p>
                  <p style={{ margin: 0, color: MUTED, fontSize: 'var(--text-sm)' }}>
                    AHSP ini berisi komponen tenaga kerja, bahan, dan peralatan untuk pekerjaan {title}. Harga
                    satuan dihitung terpisah pada modul RAB menggunakan harga sumber yang berlaku.
                  </p>
                </div>
              </section>
            </aside>
          </div>

          {/*
            AHSP YANG BERLAKU — an Owner-approved section, and a locked law.
            Validity is not completeness: a missing recipe is answered by writing
            it, not by declaring the AHSP out of force; "Tidak berlaku" is
            reserved for a withdrawn or superseded definition (currentness law).
            No expiry date is invented for any state.
          */}
          <section aria-label="AHSP yang berlaku" style={{ ...CARD, marginTop: 'var(--space-4)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
              <span style={ICON_TILE}><BadgeCheck size={16} /></span>
              <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: 0 }}>AHSP yang berlaku</h2>
            </div>
            {!currentVersion ? (
              <div aria-label="AHSP belum memiliki rumus">
                <span className="simprok-honest-frame__badge">Belum ada rumus</span>
                <p style={{ color: MUTED, fontSize: 'var(--text-sm)', margin: 'var(--space-1) 0 0' }}>
                  AHSP ini belum memiliki rumus yang tersimpan. Yang belum ada adalah rumusnya —
                  keberlakuannya tidak sedang dinyatakan gugur.
                </p>
              </div>
            ) : outOfForce ? (
              <div aria-label="AHSP tidak berlaku">
                <span className="simprok-honest-frame__badge">Tidak berlaku</span>
                <p style={{ color: MUTED, fontSize: 'var(--text-sm)', margin: 'var(--space-1) 0 0' }}>
                  AHSP ini tidak digunakan untuk pilihan baru.
                </p>
              </div>
            ) : (
              <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: 0 }}>
                AHSP yang saat ini digunakan SIMPROK.
              </p>
            )}
          </section>

          {/* Lower accordions: Update AHSP + Riwayat AHSP */}
          {workspaceOwned && canManage && !archived ? (
            <details style={{ ...CARD, marginTop: 'var(--space-4)' }}>
              <summary style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <span style={ICON_TILE}><Pencil size={16} /></span>
                <span>
                  <span style={{ display: 'block', fontWeight: 600, color: NAVY }}>Update AHSP</span>
                  <span style={{ display: 'block', color: MUTED, fontSize: 'var(--text-sm)' }}>
                    Klik untuk mengubah informasi AHSP (detail, komponen, dan lainnya).
                  </span>
                </span>
              </summary>
              <form aria-label="Update AHSP" onSubmit={addVersion} style={{ marginTop: 'var(--space-4)' }}>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-2)' }}>
                  Satuan
                  <input required value={outputUnit} onChange={(e) => setOutputUnit(e.target.value)} aria-label="Satuan AHSP" style={{ display: 'block', color: NAVY }} />
                </label>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
                  Sumber / peraturan
                  <input value={regulationReference} onChange={(e) => setRegulationReference(e.target.value)} aria-label="Sumber peraturan AHSP" style={{ display: 'block', width: '100%', maxWidth: '36rem', color: NAVY }} />
                </label>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
                  Tanggal sumber
                  <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} aria-label="Tanggal sumber" style={{ display: 'block', color: NAVY }} />
                </label>
                {resourceDrafts.map((row, index) => (
                  <fieldset key={index} style={{ border: HAIRLINE, borderRadius: '8px', marginBottom: 'var(--space-2)', padding: 'var(--space-3)' }}>
                    <legend style={{ color: NAVY, fontSize: 'var(--text-sm)' }}>Komponen {index + 1}</legend>
                    {row.stored ? (
                      <span aria-label={'Sumber daya ' + (index + 1)} style={{ marginRight: 'var(--space-2)', color: NAVY }}>
                        {resolveDefinitionResourceName({ resourceId: row.resourceId, resourceName: row.resourceName })}
                      </span>
                    ) : (
                      <input
                        placeholder="Sumber daya"
                        aria-label={'Sumber daya ' + (index + 1)}
                        value={row.resourceId}
                        onChange={(e) => {
                          const next = [...resourceDrafts];
                          next[index] = { ...row, resourceId: e.target.value };
                          setResourceDrafts(next);
                        }}
                        style={{ marginRight: 'var(--space-2)', color: NAVY }}
                      />
                    )}
                    <select
                      aria-label={'Kelompok ' + (index + 1)}
                      value={row.resourceType}
                      onChange={(e) => {
                        const next = [...resourceDrafts];
                        next[index] = { ...row, resourceType: e.target.value as ResourceDraft['resourceType'] };
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
                      onChange={(e) => {
                        const next = [...resourceDrafts];
                        next[index] = { ...row, baseUnit: e.target.value };
                        setResourceDrafts(next);
                      }}
                      style={{ marginRight: 'var(--space-2)', color: NAVY }}
                    />
                    <input
                      placeholder="Koefisien"
                      aria-label={'Koefisien ' + (index + 1)}
                      value={row.coefficient}
                      onChange={(e) => {
                        const next = [...resourceDrafts];
                        next[index] = { ...row, coefficient: e.target.value };
                        setResourceDrafts(next);
                      }}
                      style={{ color: NAVY }}
                    />
                  </fieldset>
                ))}
                <button type="button" onClick={() => setResourceDrafts([...resourceDrafts, emptyResource()])} style={{ ...outlineButton, marginRight: 'var(--space-2)' }}>
                  Tambah baris komponen
                </button>
                <button type="submit" disabled={busy} style={primaryButton}>Update AHSP</button>
              </form>
            </details>
          ) : null}

          {historicalVersions.length > 0 ? (
            <details style={{ ...CARD, marginTop: 'var(--space-3)' }}>
              <summary aria-label="Riwayat AHSP" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <span style={ICON_TILE}><History size={16} /></span>
                <span>
                  <span style={{ display: 'block', fontWeight: 600, color: NAVY }}>Riwayat AHSP</span>
                  <span style={{ display: 'block', color: MUTED, fontSize: 'var(--text-sm)' }}>
                    Lihat daftar perubahan yang pernah dilakukan pada AHSP ini.
                  </span>
                </span>
              </summary>
              <table style={{ width: '100%', maxWidth: '48rem', borderCollapse: 'collapse', fontSize: 'var(--text-sm)', marginTop: 'var(--space-3)' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: MUTED, background: 'var(--simprok-engineering-blue-100)' }}>
                    <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Sumber / Peraturan</th>
                    <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Berlaku dari</th>
                    <th style={{ padding: 'var(--space-1) var(--space-2)' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {historicalVersions.map((version) => (
                    <tr key={version.id}>
                      <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE, color: NAVY }}>{version.regulationReference || '—'}</td>
                      <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE }}>{formatIndoDate(version.effectiveDate)}</td>
                      <td style={{ padding: 'var(--space-1) var(--space-2)', borderBottom: HAIRLINE }}>{historyStatusLabel(version.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

export default AhspDetailPage;
