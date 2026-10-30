import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ProjectIntakeClassificationFields } from '../components/project/ProjectIntakeClassificationFields';
import { apiFetch } from '../utils/apiClient';
import { ProjectIntakeLocationFields } from '../components/project/ProjectIntakeLocationFields';
import type { ProjectVocabularyPath } from '../utils/projectIntakeVocabulary';
import { composeDraftDescription, fieldContextAcknowledgement, readSavedFieldContext, readDraftPreparationFields } from '../utils/projectIntakeSelection';
import { readRabRecovery, writeRabRecovery } from '../utils/rabProvisionalRecovery';
import { ArrowRight, MapPin, Sparkles, X } from 'lucide-react';

const requiredPreparationFields = [
  'Nama Proyek',
  'Tahun Anggaran / Tahun Harga',
  'Pemilik / Instansi',
];

function LocalProjectSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token, activeWorkspaceId, account } = useAuth();
  // Visible only to the same account and workspace after a 401/session expiry.
  const recoverableRab = readRabRecovery<unknown>(account?.id, activeWorkspaceId);
  const backflowRequested = (location.state as { rabBackflow?: unknown } | null)?.rabBackflow === true;
  const backflowProject = backflowRequested ? recoverableRab?.preparedProject ?? null : null;
  const savedContext = backflowProject ? readSavedFieldContext(backflowProject.description) : null;
  // Recover generated fields only from the unambiguous final form block.
  // Never infer labels from unrestricted multiline address text.
  const restoredFields = backflowProject ? readDraftPreparationFields(backflowProject.description) : null;
  const [interactionText, setInteractionText] = useState(savedContext?.state === 'present' ? savedContext.text : '');
  const [interactionStatus, setInteractionStatus] = useState('Engine belum aktif');
  const [classificationNodeIds, setClassificationNodeIds] = useState<string[] | null>(null);
  const [classificationVocabularyPaths, setClassificationVocabularyPaths] = useState<ProjectVocabularyPath[]>([]);
  const [classificationBlocked, setClassificationBlocked] = useState<string | null>('Memuat klasifikasi resmi.');
  const [classificationChangeAcknowledged, setClassificationChangeAcknowledged] = useState(false);
  const [selectedLocationRegionIds, setSelectedLocationRegionIds] = useState<string[]>([]);
  const [locationBlocked, setLocationBlocked] = useState<string | null>('Memuat wilayah resmi.');
  const [preparationData, setPreparationData] = useState<Record<string, string>>(() => backflowProject ? ({
    'Nama Proyek': backflowProject.name,
    'Tahun Anggaran / Tahun Harga': restoredFields?.year ?? '',
    'Pemilik / Instansi': restoredFields?.owner ?? '',
    'Alamat Detail': restoredFields?.address ?? '',
  }) : ({} as Record<string, string>));
  const [projectCode, setProjectCode] = useState(backflowProject ? (recoverableRab?.projectCode ?? backflowProject.code) : '');
  const [budgetCeiling, setBudgetCeiling] = useState(backflowProject?.budgetBaseline ?? '');
  const [mainMaterialSpec, setMainMaterialSpec] = useState(backflowProject?.mainMaterialSpec ?? '');
  const [inputError, setInputError] = useState('');

  const handleClassificationChange = useCallback(
    (state: { classificationNodeIds: string[] | null; classificationVocabularyPaths: ProjectVocabularyPath[]; blockedReason: string | null }) => {
      setClassificationNodeIds(state.classificationNodeIds);
      setClassificationVocabularyPaths(state.classificationVocabularyPaths);
      setClassificationBlocked(state.blockedReason);
      setClassificationChangeAcknowledged(false);
    },
    [],
  );

  const handleLocationChange = useCallback(
    (state: { locationRegionIds: string[]; blockedReason: string | null }) => {
      setSelectedLocationRegionIds(state.locationRegionIds);
      setLocationBlocked(state.blockedReason);
    },
    [],
  );

  const handleInteraction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInteractionStatus(fieldContextAcknowledgement(interactionText).status);
  };

  const updatePreparationField = (field: string, value: string) => {
    setPreparationData((current) => ({ ...current, [field]: value }));
  };

  const buildDraftProjectCode = () => {
    const explicitCode = projectCode.trim();
    if (explicitCode) return explicitCode;

    const rawName = preparationData['Nama Proyek']?.trim() || 'RAB';
    const slug = rawName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20);
    const uniqueSuffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.toUpperCase();

    return `${slug || 'RAB'}-${uniqueSuffix}`;
  };

  const buildDraftDescription = () => {
    const filledFields = requiredPreparationFields
      .map((field) => `${field}: ${preparationData[field]?.trim() || 'Belum diisi'}`);

    const address = preparationData['Alamat Detail']?.trim();
    const fieldContext = fieldContextAcknowledgement(interactionText).descriptiveContext;
    return composeDraftDescription({
      address: address || null,
      fieldContext,
      preparationLines: filledFields,
    });
  };

  const normalizeBudgetCeiling = () => {
    const trimmed = budgetCeiling.trim();
    if (!trimmed) return { value: undefined };
    if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(trimmed)) {
      return { error: 'Pagu Anggaran harus angka tanpa separator ribuan, tidak negatif, dan maksimal 2 angka desimal.' };
    }
    return { value: trimmed };
  };

  const sameIds = (a: string[], b: string[]) =>
    JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
  const samePaths = (a: ProjectVocabularyPath[], b: ProjectVocabularyPath[]) =>
    JSON.stringify(a.map((value) => JSON.stringify(value)).sort()) ===
    JSON.stringify(b.map((value) => JSON.stringify(value)).sort());
  const classificationChanged = Boolean(backflowProject && classificationNodeIds &&
    (!sameIds(classificationNodeIds, backflowProject.classificationNodeIds) ||
      !samePaths(classificationVocabularyPaths, backflowProject.classificationVocabularyPaths)));

  const validateDraftInput = () => {
    const workspaceId = getRequestWorkspaceId(activeWorkspaceId);
    if (!token || !workspaceId) {
      return 'Sesi atau workspace belum aktif. Silakan login dan pilih workspace kembali.';
    }

    if (backflowProject && !restoredFields) return 'Data persiapan lama tidak dapat dibaca dengan pasti. RAB lokal tetap dilindungi; jangan timpa draft ini.';
    const projectName = preparationData['Nama Proyek']?.trim();
    if (!projectName) return 'Nama pekerjaan/proyek wajib diisi.';
    if (classificationBlocked) return classificationBlocked;
    if (!classificationNodeIds) {
      return 'Jenis Pengadaan dan minimal satu Kategori wajib dipilih. Subkategori memperjelas prioritas bila dipilih.';
    }
    if (classificationChanged && !classificationChangeAcknowledged) {
      return 'Sebagian klasifikasi berbeda dari draft awal. Periksa pilihan dan konfirmasikan perubahan klasifikasi terlebih dahulu.';
    }
    if (locationBlocked) return locationBlocked;
    if (selectedLocationRegionIds.length === 0) return 'Pilih minimal satu lokasi resmi.';
    const budgetValidation = normalizeBudgetCeiling();
    if (budgetValidation.error) return budgetValidation.error;

    return null;
  };

  // Persiapan RAB is a LOCAL intent, never a database write.
  const handleCreateDraftProject = () => {
    if (backflowRequested && !recoverableRab) {
      setInputError('Konteks RAB lokal tidak dapat dipulihkan. Jangan memulai proyek baru; periksa sesi atau workspace sebelumnya.');
      return;
    }
    if (recoverableRab && !backflowProject) {
      setInputError('Masih ada RAB lokal belum disimpan. Lanjutkan RAB tersebut; jika ingin memulai yang baru, gunakan Buang Perubahan Lokal dan Keluar dari Ruang Kerja RAB terlebih dahulu.');
      return;
    }
    const validationError = validateDraftInput();
    if (validationError) { setInputError(validationError); return; }
    const workspaceId = getRequestWorkspaceId(activeWorkspaceId);
    if (!workspaceId || !classificationNodeIds) {
      setInputError('Konteks workspace atau klasifikasi resmi belum lengkap.');
      return;
    }
    const selectedClassificationIds = classificationNodeIds;
    const normalizedBudget = normalizeBudgetCeiling().value;
    const normalizedSpec = mainMaterialSpec.trim();
      const draftPayload = {
        name: preparationData['Nama Proyek'].trim(),
        code: buildDraftProjectCode(),
        description: buildDraftDescription(),
        workspaceId,
        classificationNodeIds: selectedClassificationIds,
        classificationVocabularyPaths,
        locationRegionIds: selectedLocationRegionIds,
        ...(normalizedBudget ? { budgetBaseline: normalizedBudget } : {}),
        ...(normalizedSpec ? { mainMaterialSpec: normalizedSpec } : {}),
      };
    if (backflowProject && recoverableRab) {
      // Revise only the matching account/workspace's original draft; keep all rows,
      // volumes, prices and identity intact. Fail closed on a competing draft.
      const backupOk = writeRabRecovery(account?.id, activeWorkspaceId,
        { ...recoverableRab, preparedProject: draftPayload, projectCode: draftPayload.code },
        backflowProject);
      const verified = backupOk ? readRabRecovery<unknown>(account?.id, activeWorkspaceId) : null;
      if (!verified || JSON.stringify(verified.preparedProject) !== JSON.stringify(draftPayload) ||
          JSON.stringify(verified.rows) !== JSON.stringify(recoverableRab.rows)) {
        setInputError('Pembaharuan data persiapan belum terverifikasi. RAB lama tetap dilindungi; jangan tinggalkan halaman.');
        return;
      }
    }
    setInputError('');
    navigate('/project/new/rab/workspace', { state: { preparedProject: draftPayload } });
  };

  return (
    <div className="simprok-rab-prep">
      <header className="simprok-rab-prep__header">
        <div>
          <div className="simprok-rab-prep__breadcrumb" aria-label="Breadcrumb">
            <span>SIMPROK</span>
            <span>/</span>
            <span>Buat RAB</span>
            <span>/</span>
            <strong>Persiapan RAB</strong>
          </div>
          <h1>Persiapan RAB</h1>
          <p>Lengkapi data pekerjaan dan konteks lapangan sebelum masuk ke Ruang Kerja RAB.</p>
          {recoverableRab ? (
            <button type="button" onClick={() => navigate('/project/new/rab/workspace')}
              aria-label="Lanjutkan RAB Lokal Belum Disimpan">
              Lanjutkan RAB belum disimpan: {recoverableRab.preparedProject.name}
            </button>
          ) : null}
        </div>
        <div className="simprok-rab-prep__status" title="Ruang Transisi RAB" aria-label="Ruang Transisi RAB">
          Ruang Transisi RAB
        </div>
      </header>

      <div className="simprok-rab-prep__grid">
        <section className="simprok-rab-card simprok-rab-form-card" aria-label="Data Pekerjaan">
          <div className="simprok-rab-card__heading">
            <MapPin size={22} aria-hidden="true" />
            <div>
              <h2>Data Pekerjaan</h2>
            </div>
          </div>

          <form className="simprok-rab-form">
            <section className="simprok-rab-room" aria-label="Informasi Proyek">
              <h3>Informasi Proyek</h3>
              <label className="simprok-rab-field simprok-rab-field--wide">
                <span className="simprok-rab-field__title">
                  <span>Nama Proyek</span>
                  <span className="simprok-rab-room__mark" aria-hidden="true">Wajib</span>
                </span>
                <input
                  type="text"
                  required
                  aria-required="true"
                  value={preparationData['Nama Proyek'] || ''}
                  onChange={(event) => updatePreparationField('Nama Proyek', event.target.value)}
                  placeholder="Belum diisi"
                />
              </label>
              <div className="simprok-rab-identity">
                <div className="simprok-rab-identity__column">
                  <label className="simprok-rab-field">
                    <span className="simprok-rab-field__title">
                      <span>Tahun Anggaran / Tahun Harga</span>
                      <span className="simprok-rab-room__mark" aria-hidden="true">Wajib</span>
                    </span>
                    <input
                      type="number"
                      required
                      aria-required="true"
                      value={preparationData['Tahun Anggaran / Tahun Harga'] || ''}
                      onChange={(event) => updatePreparationField('Tahun Anggaran / Tahun Harga', event.target.value)}
                      placeholder="Belum diisi"
                    />
                  </label>
                  <label className="simprok-rab-field">
                    <span className="simprok-rab-field__title">
                      <span>Pemilik / Instansi</span>
                      <span className="simprok-rab-room__mark" aria-hidden="true">Wajib</span>
                    </span>
                    <input
                      type="text"
                      required
                      aria-required="true"
                      value={preparationData['Pemilik / Instansi'] || ''}
                      onChange={(event) => updatePreparationField('Pemilik / Instansi', event.target.value)}
                      placeholder="Belum diisi"
                    />
                  </label>
                </div>
                <div className="simprok-rab-identity__column">
                  <label className="simprok-rab-field">
                    <span className="simprok-rab-field__title">
                      <span>Pagu Anggaran</span>
                      <span className="simprok-rab-room__mark simprok-rab-room__mark--optional" aria-hidden="true">Opsional</span>
                    </span>
                    <input
                      type="number"
                      value={budgetCeiling}
                      onChange={(event) => setBudgetCeiling(event.target.value)}
                      placeholder="Opsional"
                    />
                  </label>
                  <label className="simprok-rab-field simprok-rab-code-help">
                    <span className="simprok-rab-field__title">
                      <span>Kode Proyek / Kode RAB</span>
                      <span className="simprok-rab-room__mark simprok-rab-room__mark--optional" aria-hidden="true">Opsional</span>
                    </span>
                    <input
                      type="text"
                      value={projectCode}
                      onChange={(event) => setProjectCode(event.target.value)}
                      placeholder="Isi kode jika tersedia"
                      aria-describedby="project-code-draft-note"
                    />
                    <span id="project-code-draft-note" role="tooltip" className="simprok-rab-code-help__tip">
                      Jika kosong, SIMPROK membuat kode draft unik.
                    </span>
                  </label>
                </div>
              </div>
            </section>

            <section className="simprok-rab-room" aria-label="Klasifikasi Resmi">
              <h3>Klasifikasi Resmi</h3>
              <div className="simprok-rab-form__grid">
                <ProjectIntakeClassificationFields onChange={handleClassificationChange} initialPreparedProject={backflowProject} />
                {classificationChanged && !classificationBlocked ? (
                  <div className="simprok-rab-validation-alert" role="alert">
                    <strong>Klasifikasi berbeda dari draft sebelumnya.</strong>
                    <p>Periksa kembali kategori dan subkategori yang dipilih. SIMPROK tidak akan membuang pilihan lama secara diam-diam.</p>
                    <button type="button" onClick={() => setClassificationChangeAcknowledged(true)}
                      disabled={classificationChangeAcknowledged}
                      aria-label="Konfirmasi perubahan klasifikasi">
                      {classificationChangeAcknowledged ? 'Perubahan telah dikonfirmasi' : 'Saya menyetujui perubahan klasifikasi'}
                    </button>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="simprok-rab-room" aria-label="Lokasi Resmi">
              <h3>Lokasi Resmi</h3>
              <div className="simprok-rab-form__grid">
                <ProjectIntakeLocationFields onChange={handleLocationChange} initialRegionIds={backflowProject?.locationRegionIds} />
              </div>
            </section>

            <section className="simprok-rab-room" aria-label="Alamat Detail">
              <h3>Alamat Detail</h3>
              <p className="simprok-rab-room__note">
                Keterangan tambahan lokasi. Tidak menggantikan pilihan wilayah resmi.
              </p>
              <label className="simprok-rab-field">
                <span className="simprok-rab-field__title">
                  <span>Alamat Detail</span>
                  <span className="simprok-rab-room__mark simprok-rab-room__mark--optional" aria-hidden="true">Opsional</span>
                </span>
                <textarea
                  rows={3}
                  value={preparationData['Alamat Detail'] || ''}
                  onChange={(event) => updatePreparationField('Alamat Detail', event.target.value)}
                  placeholder="Keterangan alamat, bukan identitas wilayah"
                />
              </label>
            </section>

            <section className="simprok-rab-room" aria-label="Data Pendukung">
              <h3>Data Pendukung</h3>
              <label className="simprok-rab-field">
                <span className="simprok-rab-field__title">
                  <span>Spesifikasi Material Utama</span>
                  <span className="simprok-rab-room__mark simprok-rab-room__mark--optional" aria-hidden="true">Opsional</span>
                </span>
                <textarea
                  rows={2}
                  value={mainMaterialSpec}
                  onChange={(event) => setMainMaterialSpec(event.target.value)}
                  placeholder="Contoh: Keramik Tipe A, Granit Tipe C, Gypsum Jenis A, Kabel Tipe D..."
                />
              </label>
            </section>
          </form>
        </section>

        <aside className="simprok-rab-card simprok-rab-interaction" aria-label="Ruang Interaksi SIMPROK">
          <img
            src="/brand/simprok-symbol.png"
            alt=""
            className="simprok-rab-watermark"
            aria-hidden="true"
          />
          <div className="simprok-rab-card__heading">
            <div className="simprok-rab-avatar-frame">
              <img
                src="/brand/simprok-symbol.png"
                alt="Logo SIMPROK"
                className="simprok-rab-avatar"
              />
            </div>
            <div>
              <h2>Ruang Interaksi SIMPROK</h2>
            </div>
          </div>

          <div className="simprok-rab-engine-frame">
            <span className="simprok-honest-frame__badge">Siklus Proyek: Konteks Awal</span>
            <Sparkles size={22} aria-hidden="true" />
            <p>Siklus berjalan maju. Ruang Interaksi akan mengawal Anda dari estimasi hingga realisasi, memperkaya AHSP dan Basic Price (engine belum aktif).</p>
          </div>

          <form className="simprok-rab-chat" onSubmit={handleInteraction}>
            <label>
              <span>Ceritakan kondisi akses, logistik, risiko, metode pelaksanaan, atau hal khusus lapangan yang belum tertulis di data pekerjaan.</span>
              <textarea
                rows={6}
                value={interactionText}
                onChange={(event) => setInteractionText(event.target.value)}
                placeholder="Contoh: pekerjaan jalan lingkungan, akses material sempit, area dekat drainase, curah hujan tinggi bulan depan..."
              />
            </label>
            <button
              type="submit"
              title="Tahan keterangan di ruang ini. Belum dikirim dan belum dianalisis."
              aria-label="Tahan keterangan di ruang ini. Belum dikirim dan belum dianalisis."
              data-route="/?ruang=interaksi-simprok"
            >
              Tahan keterangan
            </button>
            <p className="simprok-rab-chat__status">{interactionStatus}</p>
          </form>
        </aside>
      </div>

      <footer className="simprok-rab-prep__footer">
        <div style={{ flex: '1 1 260px', color: inputError ? '#C0392B' : '#16294B', fontSize: '0.9rem' }}>
          <strong>Status Draft:</strong> {inputError || 'Belum disimpan. Lengkapi persiapan, lalu lanjut untuk menyusun RAB secara lokal.'}
        </div>
        <button
          className="simprok-rab-action simprok-rab-action--secondary"
          onClick={() => navigate('/')}
          title="Kembali ke Beranda"
          aria-label="Kembali ke Beranda"
          data-route="/"
        >
          <X size={18} aria-hidden="true" />
          Kembali ke Beranda
        </button>
        <button
          className="simprok-rab-action simprok-rab-action--primary"
          onClick={handleCreateDraftProject}
          title="Lanjut ke Ruang Kerja RAB (belum menyimpan)"
          aria-label="Lanjut ke Ruang Kerja RAB"
          data-route="/project/new/rab/workspace"
        >
          Lanjut ke Ruang Kerja RAB
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </footer>
    </div>
  );
}

const getRequestWorkspaceId = (activeWorkspaceId: string | null) => {
  if (typeof window === 'undefined') return activeWorkspaceId;
  return localStorage.getItem('simprok_workspace') || activeWorkspaceId;
};

/**
 * RAB-37: same canonical Preparation page for both local drafts and saved
 * projects. The saved variant reuses the existing intake-region picker and
 * canonical Project intake-context API; it does NOT create a second project.
 */
type SavedIntakeContext = {
  budgetBaseline: string | number | null;
  mainMaterialSpec: string | null;
  classificationSelections: Array<{ id: string; name: string; code: string }>;
  locationSelections: Array<{ id: string; name: string; code: string }>;
};
type SavedProjectIdentity = {
  id: string;
  name: string;
  code: string;
  status: string;
  description?: string | null;
  address?: string | null;
  rabLifecycle?: { canEditDraft: boolean; reasonCode: string | null };
};

const sameSavedRegionIds = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join('|') === [...b].sort().join('|');

function SavedRabPreparation({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { token, activeWorkspaceId, hasPermission } = useAuth();
  const returnPath = `/project/${projectId}/rab/workspace`;
  const [loaded, setLoaded] = useState<{
    project: SavedProjectIdentity;
    context: SavedIntakeContext;
  } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [reloadIndex, setReloadIndex] = useState(0);
  const [selectedLocationRegionIds, setSelectedLocationRegionIds] = useState<string[]>([]);
  const [locationBlocked, setLocationBlocked] = useState<string | null>('Memuat wilayah resmi.');
  const [budgetCeiling, setBudgetCeiling] = useState('');
  const [mainMaterialSpec, setMainMaterialSpec] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const skipBlockRef = useRef(false);

  const loadContext = async () => {
    const [projectResponse, contextResponse] = await Promise.all([
      apiFetch(`/projects/${projectId}`),
      apiFetch(`/projects/${projectId}/intake-context`),
    ]);
    if (!projectResponse.ok || !contextResponse.ok) {
      throw new Error('Konteks proyek tersimpan tidak dapat dibaca atau akses ditolak.');
    }
    const project = await projectResponse.json() as SavedProjectIdentity;
    const context = await contextResponse.json() as SavedIntakeContext;
    if (!project || project.id !== projectId || !Array.isArray(context.locationSelections) ||
        !Array.isArray(context.classificationSelections) ||
        context.locationSelections.some((region) => !region.id)) {
      throw new Error('Data Persiapan RAB tidak valid; pekerjaan lama tidak diubah.');
    }
    return { project, context };
  };

  useEffect(() => {
    let alive = true;
    setLoadError('');
    setLoaded(null);
    void loadContext().then((result) => {
      if (!alive) return;
      setLoaded(result);
      setBudgetCeiling(result.context.budgetBaseline == null ? '' : String(result.context.budgetBaseline));
      setMainMaterialSpec(result.context.mainMaterialSpec ?? '');
      setSelectedLocationRegionIds(result.context.locationSelections.map((region) => region.id));
      setRevision((value) => value + 1);
    }).catch((error: unknown) => {
      if (alive) setLoadError(error instanceof Error ? error.message : 'Data proyek tidak dapat dimuat.');
    });
    return () => { alive = false; };
    // Project ID is authoritative; a separate saved Project requires fresh data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, token, activeWorkspaceId, reloadIndex]);

  const initialRegionIds = loaded?.context.locationSelections.map((region) => region.id) ?? [];
  // A picker restoring the saved 13 regions has not changed anything yet.
  const locationChanged = loaded !== null && !locationBlocked &&
    !sameSavedRegionIds(selectedLocationRegionIds, initialRegionIds);
  const budgetChanged = loaded !== null &&
    budgetCeiling.trim() !== (loaded.context.budgetBaseline == null ? '' : String(loaded.context.budgetBaseline));
  const specChanged = loaded !== null &&
    mainMaterialSpec.trim() !== (loaded.context.mainMaterialSpec ?? '').trim();
  const changed = locationChanged || budgetChanged || specChanged;
  // Read-only opening is lawful for PROJECT_VIEW; editing still requires
  // the existing backend-matched PROJECT_CREATE permission and lifecycle.
  const contextEditable = hasPermission('PROJECT_CREATE') &&
    loaded?.project.rabLifecycle?.canEditDraft === true;
  const preparedFields = loaded?.project.description
    ? readDraftPreparationFields(loaded.project.description) : null;

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !skipBlockRef.current && changed &&
    currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (saving) { blocker.reset(); return; }
    const leave = window.confirm('Perubahan persiapan belum disimpan. Tinggalkan tanpa menyimpan? RAB tersimpan di server tidak akan dihapus.');
    if (leave) blocker.proceed();
    else blocker.reset();
  }, [blocker, saving]);

  const handleLocationChange = useCallback(
    (state: { locationRegionIds: string[]; blockedReason: string | null }) => {
      setSelectedLocationRegionIds(state.locationRegionIds);
      setLocationBlocked(state.blockedReason);
      setConfirmationOpen(false);
    },
    [],
  );

  const submitChanges = async () => {
    if (!loaded || !token || !activeWorkspaceId || saving || locationBlocked ||
        !contextEditable || !changed || !confirmationOpen) return;
    if (locationChanged && selectedLocationRegionIds.length === 0) {
      setSaveStatus('Pilih sekurangnya satu lokasi resmi. Tidak ada perubahan tersimpan.');
      return;
    }
    if (budgetCeiling.trim() && !/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(budgetCeiling.trim())) {
      setSaveStatus('Pagu Anggaran harus bilangan sah, maksimal dua desimal.');
      return;
    }
    setSaving(true);
    setSaveStatus('');
    try {
      const payload: Record<string, unknown> = {};
      if (budgetChanged) payload.budgetBaseline = budgetCeiling.trim() || null;
      if (specChanged) payload.mainMaterialSpec = mainMaterialSpec.trim() || null;
      if (locationChanged) {
        payload.locationRegionIds = selectedLocationRegionIds;
        payload.expectedLocationRegionIds = initialRegionIds;
      }
      const response = await apiFetch(`/projects/${projectId}/intake-context`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(response.status === 409
          ? 'Konteks proyek berubah atau sudah terkunci. Muat ulang dan periksa sebelum menyimpan.'
          : `Penyimpanan persiapan ditolak oleh server (HTTP ${response.status}).`);
      }
      // Do not claim success before the canonical server re-read agrees.
      const verified = await loadContext();
      const verifiedIds = verified.context.locationSelections.map((region) => region.id);
      if (locationChanged && !sameSavedRegionIds(verifiedIds, selectedLocationRegionIds)) {
        throw new Error('Pilihan lokasi belum cocok setelah dibaca ulang. Periksa status proyek.');
      }
      if (budgetChanged && String(verified.context.budgetBaseline ?? '') !== budgetCeiling.trim()) {
        throw new Error('Pagu yang dibaca ulang belum cocok dengan permintaan.');
      }
      if (specChanged && (verified.context.mainMaterialSpec ?? '') !== (mainMaterialSpec.trim() || '')) {
        throw new Error('Spesifikasi yang dibaca ulang belum cocok dengan permintaan.');
      }
      setLoaded(verified);
      setSelectedLocationRegionIds(verifiedIds);
      setBudgetCeiling(verified.context.budgetBaseline == null ? '' : String(verified.context.budgetBaseline));
      setMainMaterialSpec(verified.context.mainMaterialSpec ?? '');
      setRevision((value) => value + 1);
      setConfirmationOpen(false);
      setSaveStatus('Data Persiapan RAB tersimpan dan dibaca ulang dari proyek yang sama. Baris BOQ dan occurrence AHSP sebelumnya tetap utuh.');
    } catch (error) {
      setSaveStatus(error instanceof Error ? error.message : 'Penyimpanan belum dapat dibuktikan.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="simprok-rab-prep">
      <header className="simprok-rab-prep__header">
        <div>
          <div className="simprok-rab-prep__breadcrumb">
            <span>SIMPROK</span><span>/</span><span>RAB Tersimpan</span><span>/</span>
            <strong>Persiapan RAB</strong>
          </div>
          <h1>Persiapan RAB</h1>
          <p>Periksa dan ubah konteks pada proyek yang sama, tanpa membuat RAB baru.</p>
        </div>
        <div className="simprok-rab-prep__status">Ruang Transisi RAB</div>
      </header>
      {loadError ? (
        <div className="simprok-rab-validation-alert" role="alert">
          {loadError}
          <button type="button" onClick={() => setReloadIndex((n) => n + 1)}>Periksa koneksi dan muat ulang halaman</button>
        </div>
      ) : null}
      {!loaded ? (
        <p role="status">Memuat Persiapan RAB tersimpan dan pilihan lokasi resmi...</p>
      ) : (
        <>
          <div className="simprok-rab-prep__grid">
            <section className="simprok-rab-card simprok-rab-form-card" aria-label="Data Pekerjaan">
              <div className="simprok-rab-card__heading">
                <MapPin size={22} aria-hidden="true" />
                <div><h2>Data Pekerjaan</h2></div>
              </div>
              <section className="simprok-rab-room" aria-label="Informasi Proyek">
                <h3>Informasi Proyek</h3>
                <p><strong>{loaded.project.name}</strong></p>
                <p>Kode proyek: {loaded.project.code} · Status: {loaded.project.status}</p>
                <p>Tahun Anggaran / Tahun Harga: {preparedFields?.year ?? 'Belum tersedia'}</p>
                <p>Pemilik / Instansi: {preparedFields?.owner ?? 'Belum tersedia'}</p>
                <p>Identitas proyek tersimpan tetap; perubahan nama atau klasifikasi memerlukan kewenangan proyek tersendiri.</p>
                {!hasPermission('PROJECT_CREATE') ? <p role="status">Mode baca saja: akun ini tidak memiliki izin mengubah persiapan proyek.</p> : null}
                <label className="simprok-rab-field">
                  <span>Pagu Anggaran (opsional)</span>
                  <input value={budgetCeiling} disabled={saving || !contextEditable}
                    onChange={(event) => { setBudgetCeiling(event.target.value); setConfirmationOpen(false); }}
                    placeholder="Contoh: 150000000.00" />
                </label>
              </section>
              <section className="simprok-rab-room" aria-label="Klasifikasi Resmi">
                <h3>Klasifikasi Resmi</h3>
                <p>{loaded.context.classificationSelections.length
                  ? loaded.context.classificationSelections.map((x) => x.name).join(' · ')
                  : 'Belum ada klasifikasi tersimpan.'}</p>
                <small>Klasifikasi existing dibaca dari server, tidak diputuskan ulang.</small>
              </section>
              <section className="simprok-rab-room" aria-label="Lokasi Resmi">
                <h3>Lokasi Resmi</h3>
                <p>Wilayah tersimpan: {initialRegionIds.length}. Perubahan tidak akan menimpa histori harga dan AHSP lama.</p>
                {contextEditable ? (
                  <ProjectIntakeLocationFields
                    key={`${projectId}-${revision}`}
                    initialRegionIds={initialRegionIds}
                    onChange={handleLocationChange}
                  />
                ) : (
                  <p role="status">RAB tidak dalam kondisi draft yang dapat diubah. Lokasi tetap dapat dibaca, tetapi tidak dapat diubah melalui jalur ini.</p>
                )}
              </section>
              <section className="simprok-rab-room" aria-label="Alamat Detail">
                <h3>Alamat Detail</h3>
                <p>{preparedFields?.address || loaded.project.address || 'Belum tersedia'}</p>
                <small>Alamat lama dibaca dari proyek tersimpan; tidak ditulis ulang sebagai alamat baru.</small>
              </section>
              <section className="simprok-rab-room" aria-label="Data Pendukung">
                <h3>Data Pendukung</h3>
                <label className="simprok-rab-field">
                  <span>Spesifikasi Material Utama (opsional)</span>
                  <textarea value={mainMaterialSpec} disabled={saving || !contextEditable}
                    onChange={(event) => { setMainMaterialSpec(event.target.value); setConfirmationOpen(false); }}
                    placeholder="Spesifikasi yang ditetapkan pengguna" />
                </label>
              </section>
            </section>
          </div>
          <div className="simprok-rab-validation-alert simprok-rab-validation-alert--info">
            <strong>Pengamanan RAB tersimpan</strong>
            <p>Perubahan lokasi dapat memengaruhi pencarian AHSP dan Basic Price berikutnya. Keputusan occurrence, harga, dan BOQ yang sudah tersimpan tidak dihitung ulang otomatis. Pengikatan/perhitungan berikutnya menggunakan pengaman existing dan memerlukan bukti baru.</p>
            {locationChanged ? <p>Lokasi akan berubah dari {initialRegionIds.length} pilihan menjadi {selectedLocationRegionIds.length} pilihan. Tidak ada perubahan sebelum Anda mengonfirmasi dan menyimpan.</p> : null}
          </div>
          {saveStatus ? <p role="status">{saveStatus}</p> : null}
          {confirmationOpen && changed ? (
            <div className="simprok-rab-validation-alert" role="alertdialog" aria-label="Konfirmasi perubahan persiapan">
              <strong>Konfirmasi perubahan Persiapan RAB</strong>
              <p>Data proyek yang sama akan diperbarui secara resmi. Riwayat AHSP dan harga sebelumnya tidak diubah atau dihapus. Pilihan lokasi baru digunakan hanya untuk keputusan harga berikutnya.</p>
              <button type="button" disabled={saving || !!locationBlocked} onClick={() => void submitChanges()}>
                {saving ? 'Menyimpan...' : 'Konfirmasi dan Simpan Perubahan'}
              </button>
              <button type="button" disabled={saving} onClick={() => setConfirmationOpen(false)}>Batal</button>
            </div>
          ) : null}
          <footer className="simprok-rab-prep__footer">
            <button type="button" className="simprok-rab-action simprok-rab-action--secondary"
              disabled={saving} onClick={() => navigate(returnPath)}>
              <X size={18} /> Kembali ke Ruang Kerja RAB
            </button>
            <button type="button" className="simprok-rab-action simprok-rab-action--primary"
              disabled={!contextEditable || !changed || saving || !!locationBlocked || confirmationOpen}
              onClick={() => { setSaveStatus(''); setConfirmationOpen(true); }}>
              Simpan Perubahan Persiapan <ArrowRight size={18} />
            </button>
          </footer>
        </>
      )}
    </div>
  );
}

export function ProjectSetupPage() {
  const { projectId } = useParams();
  return projectId ? <SavedRabPreparation projectId={projectId} /> : <LocalProjectSetupPage />;
}
