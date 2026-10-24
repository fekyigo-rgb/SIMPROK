import { type FormEvent, useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ProjectIntakeClassificationFields } from '../components/project/ProjectIntakeClassificationFields';
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

export function ProjectSetupPage() {
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
