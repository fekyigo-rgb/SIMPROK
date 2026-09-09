import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import { useAuth } from '../contexts/AuthContext';
import { explainAhspItemReasons } from '../utils/ahspDocumentUserCopy';
import {
  describeCuratableObservation,
  previewCandidateNames,
  type CuratableObservationWire,
  type PreviewResourceWire,
} from '../utils/resourceObservationDisplay';
import {
  describeSameness,
  identicalAggregateLine,
  identicalDeletedAggregateLine,
  type AhspIdentityMatchWire,
} from '../utils/ahspSamenessDisplay';

type SamenessDecision = 'USE_EXISTING' | 'KEEP_SEPARATE' | 'SKIP';

/**
 * THE Import AHSP door — its own page, separate from the AHSP list, so the list
 * stays a clean library and this is the workspace for understanding a document.
 *
 * NOTHING about the canonical pipeline changes. Upload still uses the EXISTING
 * POST /ahsp/document/preview and /commit; unresolved resources still surface as
 * the EXISTING shared observation lifecycle (GET /resource-observations +
 * /curate-existing | /curate-new); manual create still uses the EXISTING
 * POST /ahsp. This file only rehomes that surface out of the room — bytes ->
 * SourceEnvelope -> ReaderRegistry -> SourceTable -> understanding -> Unit Kernel
 * -> Resource Identity -> Observation/Curation -> canonical writer, unchanged.
 */

type PreviewItem = {
  status: string;
  reasonCodes: string[];
  workType: { raw: string } | null;
  methodName: { raw: string } | null;
  resources?: PreviewResourceWire[];
  identityVerdict?: string;
  identityMatches?: AhspIdentityMatchWire[];
};

const NAVY = 'var(--simprok-authority-navy-800)';
const MUTED = 'var(--simprok-engineering-blue-500)';
const BLUE = 'var(--simprok-trust-blue-500)';
const RED = '#C0392B';
// Color Lock: ungu is ONLY SIMPROK recommendation/insight — the POSSIBLY match.
const UNGU = '#6D4A9E';
const HAIRLINE = '1px solid var(--simprok-engineering-blue-100)';
const CARD: CSSProperties = { background: '#FFFFFF', border: HAIRLINE, borderRadius: '12px', padding: 'var(--space-4)' };
const primaryButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', background: BLUE, color: '#FFFFFF', border: 0, borderRadius: '8px', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontSize: 'var(--text-sm)' };
const outlineButton: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', background: '#FFFFFF', color: NAVY, border: HAIRLINE, borderRadius: '8px', padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', fontSize: 'var(--text-sm)' };
const controlBox: CSSProperties = { color: NAVY, padding: 'var(--space-2)', border: HAIRLINE, borderRadius: '8px', background: '#FFFFFF', width: '100%' };
const labelStyle: CSSProperties = { display: 'block', fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-1)' };

export function AhspImportPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('AHSP_MANAGE');
  const canCurate = hasPermission('AHSP_RESOURCE_IDENTITY_DECIDE');

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<null | { workItems: PreviewItem[] }>(null);
  const [commitResult, setCommitResult] = useState<null | { written: unknown[]; skipped: unknown[] }>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const [observations, setObservations] = useState<CuratableObservationWire[]>([]);
  const [curationBusyId, setCurationBusyId] = useState<string | null>(null);
  const [curationError, setCurationError] = useState<string | null>(null);

  const [workType, setWorkType] = useState('');
  const [methodName, setMethodName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Human decisions for AHSPs the identity classifier flagged. Keyed by the same
  // source-name identity the backend uses, so a decision travels from this
  // preview to the commit upload of the same file. Never a frontend-only truth.
  const [decisions, setDecisions] = useState<Record<string, SamenessDecision>>({});
  // A commit SPENDS the decisions it carried. The list that comes back is the
  // knowledge computed before those writes, so leaving the controls live would let
  // one human intent be recorded twice. They stay closed until the reader asks
  // SIMPROK to understand the document again.
  const [settled, setSettled] = useState(false);
  // Collision-proof separator (matches the backend decisionMap): a real space
  // would let a different (workType, methodName) split map two distinct items to
  // ONE Record key. The null char never appears in a source name.
  const decisionKey = (item: PreviewItem) => (item.workType?.raw ?? '') + '\u0000' + (item.methodName?.raw ?? '');
  const setDecision = (item: PreviewItem, action: SamenessDecision) =>
    setDecisions((prev) => ({ ...prev, [decisionKey(item)]: action }));

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
    // On-mount fetch of the standing curation queue; a documented, intentional effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadObservations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canCurate]);

  const previewDocument = async () => {
    if (!canManage || !file || importing) return;
    setImporting(true);
    setImportError(null);
    setCommitResult(null);
    // A fresh understanding is a fresh set of items to decide — never carry a
    // stale decision from a previous document/preview into this one.
    setDecisions({});
    setSettled(false);
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
      // The human's duplicate decisions travel to the canonical writer alongside
      // the file. Only decided-and-flagged items are sent; the backend re-derives
      // the verdict and holds anything left undecided.
      // One identity quoted twice in a document is ONE decision, so the same key is
      // never sent twice (which would record the same human intent twice).
      const alreadySent = new Set<string>();
      const chosen = (preview?.workItems ?? [])
        .filter(
          (item) =>
            item.workType &&
            item.methodName &&
            (item.identityVerdict === 'IDENTICAL' ||
              item.identityVerdict === 'POSSIBLY_IDENTICAL') &&
            decisions[decisionKey(item)],
        )
        .filter((item) => {
          const key = decisionKey(item);
          if (alreadySent.has(key)) return false;
          alreadySent.add(key);
          return true;
        })
        .map((item) => ({
          workType: item.workType!.raw,
          methodName: item.methodName!.raw,
          action: decisions[decisionKey(item)],
        }));
      if (chosen.length > 0) body.append('decisions', JSON.stringify(chosen));
      const response = await apiFetch('/ahsp/document/commit', { method: 'POST', body });
      if (!response.ok) {
        setImportError('AHSP terbukti belum dapat disimpan. Coba lagi sebentar.');
        return;
      }
      const data = await response.json();
      setCommitResult(data);
      setPreview(data.knowledge ?? preview);
      // The decisions have been acted on. Clearing them stops a spent choice from
      // staying lit on screen and from riding a later commit of the same preview.
      setDecisions({});
      setSettled(true);
      await loadObservations();
    } catch {
      setImportError('AHSP terbukti tidak dapat dihubungi.');
    } finally {
      setImporting(false);
    }
  };

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

  const recognized = preview?.workItems.length ?? 0;
  const ready = preview?.workItems.filter((item) => item.status === 'READY').length ?? 0;
  const unresolved = preview ? recognized - ready : 0;

  // AUTOMATION BEFORE HUMAN INTERVENTION.
  //
  // An exact identity is deterministic: SIMPROK never stores it twice, whatever
  // the reader clicks. So a document full of AHSPs SIMPROK already holds must not
  // become a wall of identical decision blocks — it is aggregated into ONE line,
  // with ONE optional action that records the "I used the existing one" provenance
  // for all of them at once. POSSIBLY items are NEVER aggregated: each carries its
  // own candidates and evidence, so each stays a separate human decision.
  const identicalItems = (preview?.workItems ?? []).filter(
    (item) => item.status === 'READY' && item.identityVerdict === 'IDENTICAL',
  );
  // Whether an existing AHSP can be adopted is decided in ONE place — the display
  // module — never re-derived here, so the two can never drift apart.
  const adoptableIdentical = identicalItems.filter(
    (item) => describeSameness(item)?.canUseExisting === true,
  );
  const deletedIdentical = identicalItems.filter(
    (item) => describeSameness(item)?.canUseExisting !== true,
  );
  // Count IDENTITIES, not rows: one existing AHSP quoted twice in a document is
  // still one AHSP that already exists.
  const distinctIdentities = (items: PreviewItem[]) =>
    new Set(items.map(decisionKey)).size;
  const allIdenticalAdopted =
    adoptableIdentical.length > 0 &&
    adoptableIdentical.every((item) => decisions[decisionKey(item)] === 'USE_EXISTING');
  // A real toggle, not a latch: a mis-click must be undoable without discarding
  // every other decision on the page.
  const toggleAllExisting = () =>
    setDecisions((prev) => {
      const next = { ...prev };
      for (const item of adoptableIdentical) {
        if (allIdenticalAdopted) delete next[decisionKey(item)];
        else next[decisionKey(item)] = 'USE_EXISTING';
      }
      return next;
    });

  return (
    <main aria-label="Import AHSP" style={{ padding: 'var(--space-5, 1.25rem)' }}>
      <nav aria-label="Jejak navigasi" style={{ fontSize: 'var(--text-sm)', color: MUTED, marginBottom: 'var(--space-3)' }}>
        <Link to="/ahsp" style={{ color: MUTED, textDecoration: 'none' }}>AHSP</Link>
        <span style={{ margin: '0 var(--space-2)' }}>›</span>
        <span style={{ color: NAVY }}>Import AHSP</span>
      </nav>

      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: NAVY, margin: 0 }}>Import AHSP</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: 'var(--space-1) 0 0' }}>
            Unggah dokumen resmi, pahami isinya, tinjau hasilnya, lalu simpan yang terbukti.
          </p>
        </div>
        <Link to="/ahsp" style={outlineButton}>
          <ArrowLeft size={16} /> Kembali ke Daftar AHSP
        </Link>
      </header>

      {!canManage && !canCurate ? (
        <section className="simprok-honest-frame" role="alert" aria-label="Import tidak tersedia">
          <span className="simprok-honest-frame__badge">Tidak tersedia</span>
          <p>Workspace aktif Anda tidak memiliki kewenangan untuk mengimpor atau meninjau AHSP.</p>
        </section>
      ) : null}

      {/* Upload -> Pahami dokumen -> Tinjau hasil -> Simpan yang terbukti */}
      {canManage ? (
        <section aria-label="Unggah dan pahami dokumen" style={{ ...CARD, marginBottom: 'var(--space-4)' }}>
          <input
            type="file"
            accept=".xlsx"
            aria-label="Berkas AHSP resmi"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setCommitResult(null);
              setSettled(false);
              // A new file's items are new decisions — drop any prior ones so a
              // stale decision can never ride a different document to commit.
              setDecisions({});
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
              {adoptableIdentical.length > 0 ? (
                <p style={{ margin: '0 0 var(--space-2)', paddingLeft: 'var(--space-2)', borderLeft: `2px solid ${NAVY}`, color: NAVY }}>
                  <span style={{ fontWeight: 600 }}>{identicalAggregateLine(distinctIdentities(adoptableIdentical))}</span>
                  {settled ? null : (
                    <button
                      type="button"
                      aria-pressed={allIdenticalAdopted}
                      onClick={toggleAllExisting}
                      style={{ ...(allIdenticalAdopted ? primaryButton : outlineButton), padding: '0.15rem 0.6rem', marginLeft: 'var(--space-2)' }}
                    >
                      Gunakan yang sudah ada
                    </button>
                  )}
                </p>
              ) : null}
              {deletedIdentical.length > 0 ? (
                <p style={{ margin: '0 0 var(--space-2)', paddingLeft: 'var(--space-2)', borderLeft: `2px solid ${MUTED}`, color: MUTED }}>
                  {identicalDeletedAggregateLine(distinctIdentities(deletedIdentical))}
                </p>
              ) : null}
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {preview.workItems.map((item, index) => {
                  const candidateNames = item.status === 'READY' ? [] : previewCandidateNames(item.resources);
                  return (
                    <li key={index} style={{ marginBottom: 'var(--space-2)' }}>
                      {item.workType?.raw ?? '—'} — {item.methodName?.raw ?? '—'}
                      {item.status !== 'READY'
                        ? ` · ${explainAhspItemReasons(item.reasonCodes)}`
                        : item.identityVerdict === 'IDENTICAL'
                          // READY, but it will NOT be written — it already exists. Saying
                          // "siap digunakan" here would promise a save that never happens.
                          ? ' · sudah ada di SIMPROK'
                          : ' · siap digunakan'}
                      {candidateNames.length > 0 ? (
                        <span style={{ display: 'block', color: MUTED }}>
                          SIMPROK menemukan kemungkinan padanan: {candidateNames.slice(0, 4).join(', ')}
                          {candidateNames.length > 4 ? `, dan ${candidateNames.length - 4} lainnya` : ''}. Simpan untuk meninjaunya di bawah.
                        </span>
                      ) : null}
                      {(() => {
                        // Sameness and readiness are DIFFERENT questions. An item can be
                        // an exact twin of an AHSP SIMPROK already holds while its own
                        // components are still uncurated — the ordinary first import of
                        // an official document. So the reference is ALWAYS shown; only
                        // the decision is withheld below when the item could not be
                        // admitted anyway (commit refuses a non-READY item before it
                        // reads any decision, so a button there would land nowhere).
                        const sameness = describeSameness(item);
                        if (!sameness) return null;
                        const decidable = item.status === 'READY' && !settled;
                        if (sameness.verdict === 'IDENTICAL') {
                          // Spoken once, above, for all of them. Here only the door to the
                          // AHSP that already exists — and the deleted note when it applies,
                          // because that one IS exceptional and must be said.
                          return (
                            <span style={{ display: 'block', marginTop: 'var(--space-1)', paddingLeft: 'var(--space-2)', borderLeft: `2px solid ${NAVY}` }}>
                              {sameness.refs.map((ref, refIndex) => (
                                <span key={refIndex} style={{ display: 'block', color: MUTED }}>
                                  {/* A deleted AHSP has no room to open — naming it in
                                      plain abu is honest; a full-colour door would land
                                      on a record the detail route no longer returns. */}
                                  {ref.deleted ? (
                                    <span>AHSP yang cocok</span>
                                  ) : (
                                    <Link to={ref.openHref} style={{ color: BLUE }}>Buka AHSP yang ada</Link>
                                  )}
                                  {`: ${ref.title}`}{ref.detail ? ` · ${ref.detail}` : ''}
                                </span>
                              ))}
                              {sameness.refs.some((ref) => ref.deleted) ? (
                                <span style={{ display: 'block', color: MUTED }}>{sameness.guidance}</span>
                              ) : null}
                            </span>
                          );
                        }
                        const chosen = decisions[decisionKey(item)];
                        const decisionButton = (action: SamenessDecision, label: string) => (
                          <button
                            type="button"
                            aria-pressed={chosen === action}
                            onClick={() => setDecision(item, action)}
                            style={{ ...(chosen === action ? primaryButton : outlineButton), padding: '0.15rem 0.6rem' }}
                          >
                            {label}
                          </button>
                        );
                        return (
                          <span style={{ display: 'block', marginTop: 'var(--space-1)', paddingLeft: 'var(--space-2)', borderLeft: `2px solid ${UNGU}` }}>
                            <span style={{ display: 'block', fontWeight: 600, color: UNGU }}>{sameness.title}</span>
                            <span style={{ display: 'block', color: MUTED }}>{sameness.guidance}</span>
                            {sameness.refs.map((ref, refIndex) => (
                              <span key={refIndex} style={{ display: 'block', color: MUTED }}>
                                <Link to={ref.openHref} style={{ color: BLUE }}>Buka AHSP yang ada</Link>
                                {`: ${ref.title}`}{ref.detail ? ` · ${ref.detail}` : ''}
                              </span>
                            ))}
                            {/* The guidance asks the reader to compare, so never hide
                                that more padanan exist than the list shows. */}
                            {sameness.hiddenRefCount > 0 ? (
                              <span style={{ display: 'block', color: MUTED }}>
                                {`dan ${sameness.hiddenRefCount} padanan lainnya.`}
                              </span>
                            ) : null}
                            {decidable ? (
                              <span style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-1)', flexWrap: 'wrap' }}>
                                {sameness.canUseExisting ? decisionButton('USE_EXISTING', 'Gunakan yang sudah ada') : null}
                                {sameness.canKeepSeparate ? decisionButton('KEEP_SEPARATE', 'Simpan sebagai AHSP berbeda') : null}
                                {decisionButton('SKIP', 'Lewati')}
                              </span>
                            ) : null}
                          </span>
                        );
                      })()}
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

      {/* Manual create — relocated here from the list (the "AHSP Milik Saya" door), same POST /ahsp capability */}
      {canManage ? (
        <section aria-label="Buat AHSP milik saya" style={CARD}>
          <h2 style={{ fontSize: 'var(--text-lg)', color: NAVY, margin: '0 0 var(--space-1)' }}>Buat AHSP milik saya</h2>
          <p style={{ fontSize: 'var(--text-sm)', color: MUTED, margin: '0 0 var(--space-3)' }}>
            Tidak punya berkas? Buat AHSP milik Anda secara manual, lalu lengkapi komponennya di halaman detail.
          </p>
          <form onSubmit={createWorkspaceAhsp} style={{ maxWidth: '36rem' }}>
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
        </section>
      ) : null}
    </main>
  );
}

export default AhspImportPage;
