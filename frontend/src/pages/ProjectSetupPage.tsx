import { type FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../utils/apiClient';
import { NumericFact } from '../components/atoms/NumericFact';
import { ArrowRight, MapPin, Send, Sparkles, X } from 'lucide-react';

const requiredPreparationFields = [
  'Nama Proyek',
  'Negara',
  'Provinsi',
  'Kota/Kabupaten',
  'Kecamatan',
  'Kelurahan/Desa',
  'Alamat Detail',
  'Tahun Anggaran / Tahun Harga',
  'Pemilik / Instansi',
];

const kategoriOptions = [
  'Pengadaan Barang',
  'Pekerjaan Konstruksi',
  'Jasa Konsultansi Badan Usaha Non Konstruksi',
  'Jasa Konsultansi Badan Usaha Konstruksi',
  'Jasa Konsultansi Perorangan Non Konstruksi',
  'Jasa Konsultansi Perorangan Konstruksi',
  'Jasa Lainnya',
  'Pekerjaan Konstruksi Terintegrasi',
];

// Bidang Pekerjaan hanya untuk kategori konstruksi pelaksana fisik.
const kategoriDenganBidang = [
  'Pekerjaan Konstruksi',
  'Pekerjaan Konstruksi Terintegrasi',
];

const bidangPekerjaanOptions = [
  'Bidang Bina Marga',
  'Bidang Bina Marga 2025',
  'Bidang Cipta Karya',
  'Bidang Perumahan dan Kawasan Permukiman',
  'Bidang Sumber Daya Air',
  'Bidang Umum',
  'Lainnya',
];

export function ProjectSetupPage() {
  const navigate = useNavigate();
  const { token, activeWorkspaceId } = useAuth();
  const [interactionText, setInteractionText] = useState('');
  const [interactionStatus, setInteractionStatus] = useState('Engine belum aktif');
  const [selectedKategori, setSelectedKategori] = useState('');
  const [selectedBidang, setSelectedBidang] = useState<string[]>([]);
  const [preparationData, setPreparationData] = useState<Record<string, string>>({});
  const [projectCode, setProjectCode] = useState('');
  const [budgetCeiling, setBudgetCeiling] = useState('');
  const [mainMaterialSpec, setMainMaterialSpec] = useState('');
  const [draftStatus, setDraftStatus] = useState('Belum ada draft project yang dibuat.');
  const [draftError, setDraftError] = useState('');
  const [creatingDraft, setCreatingDraft] = useState(false);

  const showBidang = kategoriDenganBidang.includes(selectedKategori);

  const handleKategoriChange = (value: string) => {
    setSelectedKategori(value);
    // Bila kategori berpindah ke non-konstruksi, kosongkan bidang agar jujur.
    if (!kategoriDenganBidang.includes(value)) {
      setSelectedBidang([]);
    }
  };

  const handleBidangChange = (bidang: string) => {
    setSelectedBidang(prev =>
      prev.includes(bidang) ? prev.filter(b => b !== bidang) : [...prev, bidang]
    );
  };

  const handleInteraction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setInteractionStatus('Engine belum aktif. Konteks belum diproses. Ruang sudah disiapkan.');
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

    return [
      'Draft project dibuat dari Persiapan RAB. Belum baseline resmi dan belum RAB final.',
      `Kategori: ${selectedKategori}`,
      showBidang ? `Bidang Pekerjaan: ${selectedBidang.join(', ')}` : null,
      interactionText.trim() ? `Konteks Lapangan: ${interactionText.trim()}` : null,
      ...filledFields,
    ].filter(Boolean).join('\n');
  };

  const normalizeBudgetCeiling = () => {
    const trimmed = budgetCeiling.trim();
    if (!trimmed) return { value: undefined };
    if (!/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/.test(trimmed)) {
      return { error: 'Pagu Anggaran harus angka tanpa separator ribuan, tidak negatif, dan maksimal 2 angka desimal.' };
    }
    return { value: trimmed };
  };

  const validateDraftInput = () => {
    const workspaceId = getRequestWorkspaceId(activeWorkspaceId);
    if (!token || !workspaceId) {
      return 'Sesi atau workspace belum aktif. Silakan login dan pilih workspace kembali.';
    }

    const projectName = preparationData['Nama Proyek']?.trim();
    if (!projectName) return 'Nama pekerjaan/proyek wajib diisi.';
    if (!selectedKategori) return 'Kategori pengadaan wajib dipilih.';
    if (showBidang && selectedBidang.length === 0) return 'Bidang pekerjaan wajib dipilih untuk kategori konstruksi.';
    const budgetValidation = normalizeBudgetCeiling();
    if (budgetValidation.error) return budgetValidation.error;

    return null;
  };

  const handleCreateDraftProject = async () => {
    const validationError = validateDraftInput();
    if (validationError) {
      setDraftError(validationError);
      setDraftStatus('Draft project belum dibuat.');
      return;
    }

    setCreatingDraft(true);
    setDraftError('');
    setDraftStatus('Membuat draft project. Belum baseline resmi.');

    try {
      const workspaceId = getRequestWorkspaceId(activeWorkspaceId);
      if (!workspaceId) {
        throw new Error('Draft project belum dapat dibuat. Workspace context belum tersedia.');
      }

      const normalizedBudget = normalizeBudgetCeiling().value;
      const normalizedSpec = mainMaterialSpec.trim();
      const draftPayload = {
        name: preparationData['Nama Proyek'].trim(),
        code: buildDraftProjectCode(),
        description: buildDraftDescription(),
        workspaceId,
        ...(normalizedBudget ? { budgetBaseline: normalizedBudget } : {}),
        ...(normalizedSpec ? { mainMaterialSpec: normalizedSpec } : {}),
      };

      const response = await apiFetch('/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftPayload),
      });

      if (!response.ok) {
        throw new Error(await readApiErrorMessage(response));
      }

      const project = await response.json();
      const projectId = project?.id || project?.projectId;
      if (!projectId) {
        throw new Error('Project draft berhasil dibuat, tetapi projectId tidak ditemukan pada response API.');
      }

      setDraftStatus('Draft project dibuat. Masuk ke Ruang Kerja RAB. Belum baseline resmi.');
      navigate(`/project/${projectId}/rab/workspace`);
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : 'Project draft belum dapat dibuat. Periksa koneksi/API atau data wajib.');
      setDraftStatus('Project draft belum dapat dibuat.');
    } finally {
      setCreatingDraft(false);
    }
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
            <div className="simprok-rab-form__section">
              <span className="simprok-rab-form__label">Wajib diisi</span>
              <div className="simprok-rab-form__grid">
                {requiredPreparationFields.map((field) => (
                  <label key={field} className={field === 'Alamat Detail' ? 'simprok-rab-field simprok-rab-field--wide' : 'simprok-rab-field'}>
                    <span>{field}</span>
                    {field === 'Alamat Detail' ? (
                      <textarea
                        rows={3}
                        value={preparationData[field] || ''}
                        onChange={(event) => updatePreparationField(field, event.target.value)}
                        placeholder="Isi sesuai lokasi pekerjaan"
                      />
                    ) : (
                      <input
                        type={field.includes('Tahun') ? 'number' : 'text'}
                        value={preparationData[field] || ''}
                        onChange={(event) => updatePreparationField(field, event.target.value)}
                        placeholder="Belum diisi"
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>

            <div className="simprok-rab-form__section">
              <span className="simprok-rab-form__label">Arah Perhitungan SIMPROK</span>
              <div className="simprok-rab-form__grid">
                <label className="simprok-rab-field simprok-rab-field--kategori">
                  <span>Kategori</span>
                  <select value={selectedKategori} onChange={(e) => handleKategoriChange(e.target.value)}>
                    <option value="">Pilih Kategori...</option>
                    {kategoriOptions.map((kategori) => (
                      <option key={kategori} value={kategori}>{kategori}</option>
                    ))}
                  </select>
                </label>

                {showBidang ? (
                  <div className="simprok-rab-field simprok-rab-field--wide simprok-bidang-block">
                    <span>Bidang Pekerjaan</span>
                    <div className="simprok-multi-select">
                      {bidangPekerjaanOptions.map((bidang) => (
                        <label key={bidang} className="simprok-multi-select__item">
                          <input
                            type="checkbox"
                            checked={selectedBidang.includes(bidang)}
                            onChange={() => handleBidangChange(bidang)}
                          />
                          <span>{bidang}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="simprok-rab-form__section">
              <span className="simprok-rab-form__label">Data Pendukung Opsional</span>
              <div className="simprok-rab-form__grid">
                <label className="simprok-rab-field">
                  <span>Kode Proyek / Kode RAB</span>
                  <input
                    type="text"
                    value={projectCode}
                    onChange={(event) => setProjectCode(event.target.value)}
                    placeholder="Otomatis bila pola tersedia"
                  />
                </label>
                <label className="simprok-rab-field">
                  <span>Pagu Anggaran</span>
                  <input
                    type="number"
                    value={budgetCeiling}
                    onChange={(event) => setBudgetCeiling(event.target.value)}
                    placeholder="Opsional"
                  />
                </label>
                <label className="simprok-rab-field simprok-rab-field--wide">
                  <span>Spesifikasi Material Utama</span>
                  <textarea
                    rows={2}
                    value={mainMaterialSpec}
                    onChange={(event) => setMainMaterialSpec(event.target.value)}
                    placeholder="Contoh: Keramik Tipe A, Granit Tipe C, Gypsum Jenis A, Kabel Tipe D..."
                  />
                </label>
              </div>
            </div>
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
              title="Kirim konteks ke Ruang Interaksi SIMPROK"
              aria-label="Kirim konteks ke Ruang Interaksi SIMPROK"
              data-route="/?ruang=interaksi-simprok"
            >
              <Send size={18} aria-hidden="true" />
              Kirim Konteks
            </button>
            <p className="simprok-rab-chat__status">{interactionStatus}</p>
          </form>
        </aside>
      </div>

      <footer className="simprok-rab-prep__footer">
        <div style={{ flex: '1 1 260px', color: draftError ? '#C0392B' : '#16294B', fontSize: '0.9rem' }}>
          <strong>Status Draft:</strong> {draftError || draftStatus}
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
          disabled={creatingDraft}
          title="Buat draft project dan lanjut ke Ruang Kerja RAB"
          aria-label="Buat draft project dan lanjut ke Ruang Kerja RAB"
          data-route="/project/:projectId/rab/workspace"
        >
          {creatingDraft ? 'Membuat Draft...' : 'Lanjut ke Ruang Kerja RAB'}
          <ArrowRight size={18} aria-hidden="true" />
        </button>
      </footer>
    </div>
  );
}

const checkStatus = (status: number) => {
  if (status === 401) return 'Sesi Anda telah berakhir atau tidak valid. Silakan login kembali.';
  if (status === 403) return 'Anda tidak memiliki akses untuk membuka data ini.';
  if (status === 400) return 'Konteks workspace atau permintaan belum valid. Pilih workspace kembali.';
  return 'Data gagal dimuat. Coba lagi beberapa saat.';
};

const getRequestWorkspaceId = (activeWorkspaceId: string | null) => {
  if (typeof window === 'undefined') return activeWorkspaceId;
  return localStorage.getItem('simprok_workspace') || activeWorkspaceId;
};

const readApiErrorMessage = async (response: Response) => {
  const fallback = checkStatus(response.status);

  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const payload = await response.json();
      const message = Array.isArray(payload?.message)
        ? payload.message.join(', ')
        : payload?.message || payload?.error;
      return `Draft project belum dapat dibuat. API menolak request: ${response.status}. ${message || fallback}`;
    }

    const text = await response.text();
    return `Draft project belum dapat dibuat. API menolak request: ${response.status}. ${text || fallback}`;
  } catch {
    return `Draft project belum dapat dibuat. API menolak request: ${response.status}. ${fallback}`;
  }
};

type BoqItemType = 'FOLDER' | 'WORK_ITEM' | 'NOTE';

type BoqItemField = keyof BoqItemInput;

interface BoqItemInput {
  tempId: string;
  parentTempId: string | null;
  itemType: BoqItemType;
  wbsCode: string;
  name: string;
  quantity: string | number;
  unit: string;
  unitPrice: string | number;
  collapsed?: boolean;
  sortOrder: number;
}

interface BoqTreeNode extends BoqItemInput {
  children: BoqTreeNode[];
  depth: number;
}

interface VisibleRow {
  node: BoqTreeNode;
  subtotal: number;
}

const generateTempId = () => 'TEMP-' + Math.random().toString(36).slice(2, 11);

const createItem = (itemType: BoqItemType, parentTempId: string | null, sortOrder: number): BoqItemInput => ({
  tempId: generateTempId(),
  parentTempId,
  itemType,
  wbsCode: '',
  name: '',
  quantity: itemType === 'WORK_ITEM' ? 1 : 0,
  unit: itemType === 'WORK_ITEM' ? 'ls' : '',
  unitPrice: 0,
  collapsed: false,
  sortOrder,
});

const toFiniteNumber = (value: string | number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const safeDisplayNumber = (value: string | number): number => {
  const parsed = toFiniteNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatRupiah = (value: number) => `Rp ${value.toLocaleString('id-ID')}`;

const lineTotal = (item: BoqItemInput): number => {
  if (item.itemType !== 'WORK_ITEM') return 0;
  return safeDisplayNumber(item.quantity) * safeDisplayNumber(item.unitPrice);
};

const buildTree = (items: BoqItemInput[]): BoqTreeNode[] => {
  const nodeMap = new Map<string, BoqTreeNode>();
  const roots: BoqTreeNode[] = [];

  items.forEach((item) => {
    nodeMap.set(item.tempId, { ...item, children: [], depth: 0 });
  });

  items.forEach((item) => {
    const node = nodeMap.get(item.tempId);
    if (!node) return;

    if (item.parentTempId) {
      const parent = nodeMap.get(item.parentTempId);
      if (parent) {
        node.depth = parent.depth + 1;
        parent.children.push(node);
        return;
      }
    }

    roots.push(node);
  });

  const assignDepth = (nodes: BoqTreeNode[], depth: number) => {
    nodes.forEach((node) => {
      node.depth = depth;
      assignDepth(node.children, depth + 1);
    });
  };

  assignDepth(roots, 0);
  return roots;
};

const subtotal = (node: BoqTreeNode): number => {
  if (node.itemType === 'WORK_ITEM') return lineTotal(node);
  if (node.itemType === 'NOTE') return 0;
  return node.children.reduce((sum, child) => sum + subtotal(child), 0);
};

const grandTotal = (roots: BoqTreeNode[]): number => roots.reduce((sum, node) => sum + subtotal(node), 0);

const flatWorkItemTotal = (items: BoqItemInput[]): number => items.reduce((sum, item) => sum + lineTotal(item), 0);

const flattenPreorder = (roots: BoqTreeNode[]): BoqTreeNode[] => {
  const result: BoqTreeNode[] = [];
  const visit = (node: BoqTreeNode) => {
    result.push(node);
    node.children.forEach(visit);
  };
  roots.forEach(visit);
  return result;
};

const collectVisibleRows = (roots: BoqTreeNode[]): VisibleRow[] => {
  const rows: VisibleRow[] = [];

  const visit = (node: BoqTreeNode) => {
    rows.push({ node, subtotal: subtotal(node) });
    if (!node.collapsed) {
      node.children.forEach(visit);
    }
  };

  roots.forEach(visit);
  return rows;
};

const collectDescendantIds = (items: BoqItemInput[], tempId: string): Set<string> => {
  const ids = new Set<string>([tempId]);
  let changed = true;

  while (changed) {
    changed = false;
    items.forEach((item) => {
      if (item.parentTempId && ids.has(item.parentTempId) && !ids.has(item.tempId)) {
        ids.add(item.tempId);
        changed = true;
      }
    });
  }

  return ids;
};

const findInsertIndexAfterSubtree = (items: BoqItemInput[], parentTempId: string | null) => {
  if (!parentTempId) return items.length;

  const parentIndex = items.findIndex((item) => item.tempId === parentTempId);
  if (parentIndex === -1) return items.length;

  const descendants = collectDescendantIds(items, parentTempId);
  let insertIndex = parentIndex + 1;

  while (insertIndex < items.length && descendants.has(items[insertIndex].tempId)) {
    insertIndex += 1;
  }

  return insertIndex;
};

const toOrderedItems = (roots: BoqTreeNode[]): BoqItemInput[] => flattenPreorder(roots).map((node, index) => ({
  tempId: node.tempId,
  parentTempId: node.parentTempId,
  itemType: node.itemType,
  wbsCode: node.wbsCode,
  name: node.name,
  quantity: node.quantity,
  unit: node.unit,
  unitPrice: node.unitPrice,
  collapsed: node.collapsed,
  sortOrder: index,
}));

const findSiblingList = (nodes: BoqTreeNode[], tempId: string): BoqTreeNode[] | null => {
  if (nodes.some((node) => node.tempId === tempId)) return nodes;

  for (const node of nodes) {
    const found = findSiblingList(node.children, tempId);
    if (found) return found;
  }

  return null;
};

const canMoveSibling = (items: BoqItemInput[], tempId: string, direction: 'up' | 'down') => {
  const siblings = findSiblingList(buildTree(items), tempId);
  if (!siblings) return false;

  const index = siblings.findIndex((node) => node.tempId === tempId);
  if (index === -1) return false;

  return direction === 'up' ? index > 0 : index < siblings.length - 1;
};

const moveSibling = (items: BoqItemInput[], tempId: string, direction: 'up' | 'down') => {
  const roots = buildTree(items);
  const siblings = findSiblingList(roots, tempId);
  if (!siblings) return items;

  const index = siblings.findIndex((node) => node.tempId === tempId);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || targetIndex < 0 || targetIndex >= siblings.length) return items;

  [siblings[index], siblings[targetIndex]] = [siblings[targetIndex], siblings[index]];
  return toOrderedItems(roots);
};

const buttonStyle = (variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'secondary') => {
  const base = {
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '12px',
    padding: '4px 7px',
    whiteSpace: 'nowrap' as const,
  };

  if (variant === 'primary') return { ...base, backgroundColor: 'var(--simprok-engineering-blue-800)', color: 'white' };
  if (variant === 'danger') return { ...base, backgroundColor: 'var(--simprok-critical-red-100)', color: 'var(--simprok-critical-red-600)' };
  if (variant === 'ghost') return { ...base, backgroundColor: 'transparent', color: 'var(--simprok-engineering-blue-700)', border: '1px solid var(--simprok-engineering-blue-200)' };
  return { ...base, backgroundColor: 'var(--simprok-engineering-blue-50)', color: 'var(--simprok-engineering-blue-900)', border: '1px solid var(--simprok-engineering-blue-200)' };
};

export function LegacyRabWorkspacePage() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  const [items, setItems] = useState<BoqItemInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { token, activeWorkspaceId } = useAuth();
  const navigate = useNavigate();

  const roots = useMemo(() => buildTree(items), [items]);
  const visibleRows = useMemo(() => collectVisibleRows(roots), [roots]);
  const totalEstimasi = useMemo(() => grandTotal(roots), [roots]);
  const flatTotal = useMemo(() => flatWorkItemTotal(items), [items]);

  const addRow = (itemType: BoqItemType, parentTempId: string | null) => {
    if (parentTempId) {
      const parent = items.find((item) => item.tempId === parentTempId);
      if (!parent || parent.itemType !== 'FOLDER') return;
    }

    setItems((current) => {
      const insertIndex = findInsertIndexAfterSubtree(current, parentTempId);
      const next = [...current];
      next.splice(insertIndex, 0, createItem(itemType, parentTempId, current.length));
      return next;
    });
  };

  const removeRow = (tempId: string) => {
    setItems((current) => {
      const deletedIds = collectDescendantIds(current, tempId);
      return current.filter((item) => !deletedIds.has(item.tempId) && (!item.parentTempId || !deletedIds.has(item.parentTempId)));
    });
  };

  const updateItem = (tempId: string, field: BoqItemField, value: string | number | boolean) => {
    setItems((current) => current.map((item) => (item.tempId === tempId ? { ...item, [field]: value } : item)));
  };

  const toggleCollapse = (tempId: string) => {
    setItems((current) => current.map((item) => (item.tempId === tempId ? { ...item, collapsed: !item.collapsed } : item)));
  };

  const moveRow = (tempId: string, direction: 'up' | 'down') => {
    setItems((current) => moveSibling(current, tempId, direction));
  };

  const validateRows = (orderedRows: BoqTreeNode[]) => {
    if (orderedRows.length === 0) return 'Tambahkan minimal 1 Sub Judul, Item, atau Catatan RAB.';

    for (const item of orderedRows) {
      const rowName = item.name.trim() || item.wbsCode.trim() || 'baris RAB';

      if (!item.name.trim()) return `Lengkapi Uraian untuk ${rowName}.`;
      if (item.itemType !== 'NOTE' && !item.wbsCode.trim()) return `Lengkapi Kode untuk ${rowName}.`;

      if (item.itemType === 'WORK_ITEM') {
        const quantity = toFiniteNumber(item.quantity);
        const unitPrice = toFiniteNumber(item.unitPrice);

        if (!Number.isFinite(quantity) || quantity <= 0) return `Volume ${rowName} harus angka lebih besar dari 0.`;
        if (!item.unit.trim()) return `Lengkapi Satuan untuk ${rowName}.`;
        if (!Number.isFinite(unitPrice) || unitPrice < 0) return `Harga Satuan ${rowName} harus angka 0 atau lebih.`;
        if (!Number.isFinite(quantity * unitPrice)) return `Jumlah ${rowName} tidak valid.`;
      }
    }

    return null;
  };

  const buildPayload = () => {
    const orderedRows = flattenPreorder(buildTree(items));
    return orderedRows.map((item, index) => {
      const isWorkItem = item.itemType === 'WORK_ITEM';
      const quantity = isWorkItem ? toFiniteNumber(item.quantity) : 0;
      const unitPrice = isWorkItem ? toFiniteNumber(item.unitPrice) : 0;

      return {
        tempId: item.tempId,
        parentTempId: item.parentTempId || undefined,
        itemType: item.itemType,
        wbsCode: item.itemType === 'NOTE' && !item.wbsCode.trim() ? '-' : item.wbsCode.trim(),
        name: item.name.trim(),
        quantity: isWorkItem ? quantity : 0,
        unit: isWorkItem ? item.unit.trim() : '',
        unitPrice: isWorkItem ? unitPrice : 0,
        plannedCost: isWorkItem ? quantity * unitPrice : 0,
        sortOrder: index,
      };
    });
  };

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !activeWorkspaceId) return;

    const orderedRows = flattenPreorder(buildTree(items));
    const validationError = validateRows(orderedRows);
    if (validationError) {
      alert(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const projRes = await apiFetch('http://localhost:3000/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code, description, workspaceId: activeWorkspaceId }),
      });
      if (!projRes.ok) throw new Error(checkStatus(projRes.status));
      const project = await projRes.json();

      const initRes = await apiFetch(`http://localhost:3000/projects/${project.id}/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: buildPayload() }),
      });
      if (!initRes.ok) throw new Error(checkStatus(initRes.status));

      alert('RAB berhasil dibuat dan Baseline aktif!');
      navigate(`/project/${project.id}`);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Data gagal dimuat. Coba lagi beberapa saat.');
      setSubmitting(false);
    }
  };

  const renderRow = ({ node, subtotal: rowSubtotal }: VisibleRow) => {
    const isFolder = node.itemType === 'FOLDER';
    const isWorkItem = node.itemType === 'WORK_ITEM';
    const isNote = node.itemType === 'NOTE';
    const hasChildren = node.children.length > 0;
    const rowLineTotal = lineTotal(node);
    const canMoveUp = canMoveSibling(items, node.tempId, 'up');
    const canMoveDown = canMoveSibling(items, node.tempId, 'down');

    return (
      <tr
        key={node.tempId}
        style={{
          backgroundColor: isFolder ? 'var(--simprok-engineering-blue-50)' : isNote ? '#F8FAFC' : 'white',
          borderBottom: '1px solid var(--simprok-engineering-blue-100)',
        }}
      >
        <td style={{ padding: '2px 4px', width: '40px', textAlign: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
            <button type="button" disabled={!canMoveUp} onClick={() => moveRow(node.tempId, 'up')} style={{ border: 'none', background: 'transparent', padding: '0 4px', cursor: canMoveUp ? 'pointer' : 'not-allowed', opacity: canMoveUp ? 1 : 0.3, fontSize: '14px', lineHeight: 1 }} title="Naik">▲</button>
            <button type="button" disabled={!canMoveDown} onClick={() => moveRow(node.tempId, 'down')} style={{ border: 'none', background: 'transparent', padding: '0 4px', cursor: canMoveDown ? 'pointer' : 'not-allowed', opacity: canMoveDown ? 1 : 0.3, fontSize: '14px', lineHeight: 1 }} title="Turun">▼</button>
          </div>
        </td>
        <td style={{ padding: '2px 4px', minWidth: '130px' }}>
          <input
            type="text"
            value={node.wbsCode}
            onChange={(e) => updateItem(node.tempId, 'wbsCode', e.target.value)}
            required={!isNote}
            style={{ width: '100%', padding: '2px 4px', fontWeight: isFolder ? 'bold' : 'normal' }}
            placeholder={isNote ? 'Opsional' : 'Kode'}
          />
        </td>
        <td style={{ padding: '2px 4px', minWidth: '280px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', paddingLeft: `${node.depth * 18}px` }}>
            {node.depth > 0 && <span style={{ color: 'var(--simprok-engineering-blue-300)', marginRight: '2px', fontWeight: 'bold' }}>└</span>}
            {isFolder ? (
              <button type="button" onClick={() => toggleCollapse(node.tempId)} style={{ ...buttonStyle('ghost'), padding: '2px 4px', fontSize: '11px' }}>
                {node.collapsed ? 'Buka' : 'Tutup'}
              </button>
            ) : (
              <span style={{ width: '38px', color: 'var(--simprok-engineering-blue-500)', fontSize: '11px', textAlign: 'center' }}>
                {isNote ? 'Cttn' : 'Item'}
              </span>
            )}
            <input
              type="text"
              value={node.name}
              onChange={(e) => updateItem(node.tempId, 'name', e.target.value)}
              required
              style={{ flex: 1, minWidth: 0, padding: '2px 4px', fontWeight: isFolder ? 'bold' : 'normal' }}
              placeholder={isNote ? 'Isi catatan' : 'Uraian pekerjaan'}
            />
          </div>
        </td>
        <td style={{ padding: '2px 4px', width: '100px' }}>
          {isWorkItem && (
            <input
              type="number"
              min="0.000001"
              step="any"
              value={node.quantity}
              onChange={(e) => updateItem(node.tempId, 'quantity', e.target.value)}
              required
              style={{ width: '100%', padding: '2px 4px', textAlign: 'right' }}
            />
          )}
        </td>
        <td style={{ padding: '2px 4px', width: '90px' }}>
          {isWorkItem && (
            <input
              type="text"
              value={node.unit}
              onChange={(e) => updateItem(node.tempId, 'unit', e.target.value)}
              required
              style={{ width: '100%', padding: '2px 4px' }}
            />
          )}
        </td>
        <td style={{ padding: '2px 4px', width: '150px' }}>
          {isWorkItem && (
            <input
              type="number"
              min="0"
              step="any"
              value={node.unitPrice}
              onChange={(e) => updateItem(node.tempId, 'unitPrice', e.target.value)}
              required
              style={{ width: '100%', padding: '2px 4px', textAlign: 'right' }}
            />
          )}
        </td>
        <td style={{ padding: '2px 4px', width: '170px', textAlign: 'right', fontWeight: isFolder ? 'bold' : 600, color: 'var(--simprok-engineering-blue-900)' }}>
          {isFolder ? formatRupiah(rowSubtotal) : isWorkItem ? formatRupiah(rowLineTotal) : '-'}
        </td>
        <td style={{ padding: '2px 4px', minWidth: '160px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', justifyContent: 'flex-end', alignItems: 'center' }}>
            {isFolder && (
              <>
                <button type="button" title="Tambah Sub Judul Anak" onClick={() => addRow('FOLDER', node.tempId)} style={{ ...buttonStyle('secondary'), padding: '2px 4px', fontSize: '11px' }}>+ Sub Judul</button>
                <button type="button" title="Tambah Item" onClick={() => addRow('WORK_ITEM', node.tempId)} style={{ ...buttonStyle('primary'), padding: '2px 4px', fontSize: '11px' }}>+ Item</button>
                <button type="button" title="Tambah Catatan" onClick={() => addRow('NOTE', node.tempId)} style={{ ...buttonStyle('secondary'), padding: '2px 4px', fontSize: '11px' }}>+ Catatan</button>
                {hasChildren && <span style={{ alignSelf: 'center', color: 'var(--simprok-engineering-blue-600)', fontSize: '10px' }}>{node.children.length}</span>}
              </>
            )}
            <button type="button" title={isFolder ? 'Hapus Subtree' : 'Hapus'} onClick={() => removeRow(node.tempId)} style={{ ...buttonStyle('danger'), padding: '2px 4px', fontSize: '14px', background: 'transparent', border: 'none', color: '#dc2626' }}>
              🗑
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', backgroundColor: 'white', padding: 'var(--space-8)', borderRadius: 'var(--radius-lg)' }}>
      <h2 style={{ fontSize: 'var(--text-2xl)', color: 'var(--simprok-engineering-blue-900)', marginBottom: 'var(--space-6)' }}>Workspace Penyusunan RAB</h2>
      <form onSubmit={handleSetup} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
          <div>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Nama Proyek</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Kode Proyek</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} required style={{ width: '100%', padding: '8px' }} />
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Deskripsi</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', padding: '8px' }} />
        </div>

        <div style={{ marginTop: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, color: 'var(--simprok-engineering-blue-900)' }}>Daftar RAB</h3>
          </div>
          <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
            <button type="button" onClick={() => addRow('FOLDER', null)} style={buttonStyle('secondary')}>+ Tambah Sub Judul</button>
          </div>
        </div>

        <div style={{ overflowX: 'auto', border: '1px solid var(--simprok-engineering-blue-100)', borderRadius: '8px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1100px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--simprok-engineering-blue-50)', textAlign: 'left', fontSize: '12px' }}>
                <th style={{ padding: '4px', width: '30px', borderBottom: '2px solid var(--simprok-engineering-blue-200)' }}></th>
                <th style={{ padding: '4px', borderBottom: '2px solid var(--simprok-engineering-blue-200)' }}>Kode</th>
                <th style={{ padding: '4px', borderBottom: '2px solid var(--simprok-engineering-blue-200)' }}>Uraian / Catatan</th>
                <th style={{ padding: '4px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', textAlign: 'right', width: '80px' }}>Volume</th>
                <th style={{ padding: '4px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', width: '60px' }}>Sat</th>
                <th style={{ padding: '4px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', textAlign: 'right', width: '120px' }}>Harga Satuan</th>
                <th style={{ padding: '4px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', textAlign: 'right', width: '140px' }}>Jumlah / Subtotal</th>
                <th style={{ padding: '4px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', textAlign: 'right', width: '160px' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(renderRow)}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
                    Belum ada RAB. Tambahkan Sub Judul, Item, atau Catatan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', backgroundColor: 'var(--simprok-engineering-blue-900)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <div>
            <span style={{ display: 'block', fontSize: 'var(--text-xl)', fontWeight: 'bold', color: 'white' }}>Total Estimasi</span>
            <span style={{ display: 'block', fontSize: '12px', color: 'var(--simprok-engineering-blue-100)' }}>
              Subtotal hirarki: {formatRupiah(totalEstimasi)} | Sum item: {formatRupiah(flatTotal)}
            </span>
          </div>
          <div style={{ color: 'white' }}>
            <NumericFact value={formatRupiah(totalEstimasi)} size="xl" />
          </div>
        </div>

        <button type="submit" disabled={submitting} style={{ marginTop: 'var(--space-6)', padding: '16px', fontSize: 'var(--text-lg)', fontWeight: 'bold', backgroundColor: 'var(--simprok-engineering-blue-800)', color: 'white', border: 'none', borderRadius: '8px', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
          {submitting ? 'Menyimpan...' : 'Simpan & Aktifkan Baseline'}
        </button>
      </form>
    </div>
  );
}
