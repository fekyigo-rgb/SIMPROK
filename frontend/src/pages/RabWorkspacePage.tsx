import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronsLeft,
  ChevronsRight,
  FileDown,
  FileInput,
  FolderOpen,
  ListChecks,
  LockKeyhole,
  Printer,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../utils/apiClient';
import type { DashboardOutletContext } from '../components/layout/DashboardLayout';

type RabRowType = 'folder' | 'item' | 'note';

interface RabRow {
  id: string;
  parentId: string | null;
  type: RabRowType;
  name: string;
  ahspCode: string;
  category: string;
  unit: string;
  unitPrice: number;
  manualUnitPrice: boolean;
  manualAhsp: boolean;
  sortOrder: number;
}

interface BoqItemResponse {
  id: string;
  parentId?: string | null;
  itemType: 'FOLDER' | 'WORK_ITEM' | 'NOTE';
  wbsCode: string;
  name: string;
  quantity?: string | number | null;
  unit?: string | null;
  unitPrice?: string | number | null;
  sortOrder?: number | null;
  ahspVersionId?: string | null;
  ahspSnapshotId?: string | null;
}

interface NumberedRabRow extends RabRow {
  number: string;
  depth: number;
}

const localDraftRows: RabRow[] = [
  { id: 'prep', parentId: null, type: 'folder', name: 'Pekerjaan Persiapan', ahspCode: '', category: 'Subjudul', unit: '', unitPrice: 0, manualUnitPrice: false, manualAhsp: false, sortOrder: 0 },
  { id: 'cleaning', parentId: 'prep', type: 'item', name: 'Pembersihan lahan ringan', ahspCode: '6.1.1.01', category: 'Standby', unit: 'm2', unitPrice: 15000, manualUnitPrice: false, manualAhsp: false, sortOrder: 1 },
  { id: 'temporary-fence', parentId: 'prep', type: 'item', name: 'Pembuatan pagar sementara seng gelombang', ahspCode: '6.1.2.05', category: 'Standby', unit: 'm', unitPrice: 265000, manualUnitPrice: true, manualAhsp: true, sortOrder: 2 },
  { id: 'note-access', parentId: 'prep', type: 'note', name: 'Catatan: harga pagar disesuaikan kondisi lapangan basah.', ahspCode: '', category: 'Catatan', unit: '', unitPrice: 0, manualUnitPrice: false, manualAhsp: false, sortOrder: 3 },
  { id: 'earthwork', parentId: null, type: 'folder', name: 'Pekerjaan Tanah', ahspCode: '', category: 'Subjudul', unit: '', unitPrice: 0, manualUnitPrice: false, manualAhsp: false, sortOrder: 4 },
  { id: 'excavation', parentId: 'earthwork', type: 'item', name: 'Galian tanah biasa sedalam 1 m', ahspCode: '6.2.3.01', category: 'Standby', unit: 'm3', unitPrice: 120000, manualUnitPrice: false, manualAhsp: false, sortOrder: 5 },
  { id: 'backfill', parentId: 'earthwork', type: 'item', name: 'Urugan tanah kembali', ahspCode: '', category: 'Standby', unit: 'm3', unitPrice: 45000, manualUnitPrice: false, manualAhsp: false, sortOrder: 6 },
];

const localDraftVolumes: Record<string, number> = {
  cleaning: 150,
  'temporary-fence': 50,
  excavation: 240,
  backfill: 80,
};

const formatRupiah = (value: number) => `Rp ${Math.round(value).toLocaleString('id-ID')}`;

const toNumber = (value: string | number | null | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildNumberedRows = (rows: RabRow[]): NumberedRabRow[] => {
  const sortedRows = [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
  const childrenByParent = sortedRows.reduce<Record<string, RabRow[]>>((acc, row) => {
    const key = row.parentId || 'root';
    acc[key] = [...(acc[key] || []), row];
    return acc;
  }, {});
  const result: NumberedRabRow[] = [];

  const visit = (parentId: string | null, prefix: number[], depth: number) => {
    const children = childrenByParent[parentId || 'root'] || [];
    children.forEach((row, index) => {
      const numberParts = [...prefix, index + 1];
      const number = row.type === 'note' ? '' : numberParts.join('.');
      result.push({ ...row, number, depth });
      visit(row.id, numberParts, depth + 1);
    });
  };

  visit(null, [], 0);
  return result;
};

const mapBoqToRows = (items: BoqItemResponse[]) => items
  .map((item, index): RabRow => ({
    id: item.id,
    parentId: item.parentId || null,
    type: item.itemType === 'FOLDER' ? 'folder' : item.itemType === 'NOTE' ? 'note' : 'item',
    name: item.name,
    ahspCode: item.ahspVersionId || item.ahspSnapshotId ? item.wbsCode.trim() : '',
    category: item.itemType === 'FOLDER' ? 'Subjudul' : item.itemType === 'NOTE' ? 'Catatan' : 'Standby',
    unit: item.unit || '',
    unitPrice: toNumber(item.unitPrice),
    manualUnitPrice: false,
    manualAhsp: false,
    sortOrder: item.sortOrder ?? index,
  }));

const moveWithinSiblings = (rows: RabRow[], rowId: string, direction: 'up' | 'down') => {
  const row = rows.find((item) => item.id === rowId);
  if (!row) return rows;

  const siblings = rows
    .filter((item) => item.parentId === row.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const index = siblings.findIndex((item) => item.id === rowId);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return rows;

  const current = siblings[index];
  const target = siblings[targetIndex];
  return rows.map((item) => {
    if (item.id === current.id) return { ...item, sortOrder: target.sortOrder };
    if (item.id === target.id) return { ...item, sortOrder: current.sortOrder };
    return item;
  });
};

const createRow = (type: RabRowType, parentId: string | null, sortOrder: number): RabRow => ({
  id: `local-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  parentId,
  type,
  name: type === 'folder' ? 'Sub Judul Baru' : type === 'note' ? 'Catatan baru' : 'Item pekerjaan baru',
  ahspCode: type === 'item' ? '' : '',
  category: type === 'folder' ? 'Subjudul' : type === 'note' ? 'Catatan' : 'Standby',
  unit: type === 'item' ? 'ls' : '',
  unitPrice: 0,
  manualUnitPrice: type === 'item',
  manualAhsp: false,
  sortOrder,
});

export function RabWorkspacePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const layoutContext = useOutletContext<DashboardOutletContext | null>();
  const projectId = searchParams.get('projectId');
  const [rows, setRows] = useState<RabRow[]>(localDraftRows);
  const [volumes, setVolumes] = useState<Record<string, number>>(localDraftVolumes);
  const [unitPrices, setUnitPrices] = useState<Record<string, number>>(
    localDraftRows.reduce<Record<string, number>>((acc, row) => {
      if (row.type === 'item') acc[row.id] = row.unitPrice;
      return acc;
    }, {}),
  );
  const [selectedRowId, setSelectedRowId] = useState('excavation');
  const [marginPercent, setMarginPercent] = useState(10);
  const [ppnPercent, setPpnPercent] = useState(11);
  const [statusMessage, setStatusMessage] = useState(projectId ? 'Memuat BOQ baseline aktif...' : 'Draft lokal, belum tersimpan permanen');

  useEffect(() => {
    if (!projectId) {
      Promise.resolve().then(() => {
        setRows(localDraftRows);
        setVolumes(localDraftVolumes);
        setUnitPrices(localDraftRows.reduce<Record<string, number>>((acc, row) => {
          if (row.type === 'item') acc[row.id] = row.unitPrice;
          return acc;
        }, {}));
        setSelectedRowId('excavation');
        setStatusMessage('Draft lokal, belum tersimpan permanen');
      });
      return;
    }

    Promise.resolve()
      .then(() => apiFetch(`http://localhost:3000/projects/${projectId}/boq`))
      .then((response) => {
        if (!response.ok) throw new Error('BOQ baseline aktif belum dapat dimuat.');
        return response.json();
      })
      .then((data) => {
        const items = Array.isArray(data) ? data as BoqItemResponse[] : [];
        const mappedRows = mapBoqToRows(items);
        const nextVolumes = items.reduce<Record<string, number>>((acc, item) => {
          acc[item.id] = toNumber(item.quantity);
          return acc;
        }, {});
        const nextUnitPrices = mappedRows.reduce<Record<string, number>>((acc, row) => {
          if (row.type === 'item') acc[row.id] = row.unitPrice;
          return acc;
        }, {});
        setRows(mappedRows.length > 0 ? mappedRows : localDraftRows);
        setVolumes(mappedRows.length > 0 ? nextVolumes : localDraftVolumes);
        setUnitPrices(mappedRows.length > 0 ? nextUnitPrices : localDraftRows.reduce<Record<string, number>>((acc, row) => {
          if (row.type === 'item') acc[row.id] = row.unitPrice;
          return acc;
        }, {}));
        setSelectedRowId(mappedRows.find((row) => row.type === 'item')?.id || 'excavation');
        setStatusMessage(mappedRows.length > 0 ? 'Data BOQ dibaca read-only. Edit tetap draft lokal.' : 'BOQ kosong. Menampilkan draft lokal, belum tersimpan permanen.');
      })
      .catch((error: unknown) => {
        console.error('Failed to fetch RAB BOQ:', error);
        setRows(localDraftRows);
        setVolumes(localDraftVolumes);
        setUnitPrices(localDraftRows.reduce<Record<string, number>>((acc, row) => {
          if (row.type === 'item') acc[row.id] = row.unitPrice;
          return acc;
        }, {}));
        setSelectedRowId('excavation');
        setStatusMessage('BOQ belum tersambung. Draft lokal, belum tersimpan permanen.');
      });
  }, [projectId]);

  const numberedRows = useMemo(() => buildNumberedRows(rows), [rows]);
  const selectedItem = useMemo(() => {
    const row = numberedRows.find((item) => item.id === selectedRowId);
    return row?.type === 'item' ? row : null;
  }, [numberedRows, selectedRowId]);
  const negativeRows = useMemo(() => new Set(rows
    .filter((row) => row.type === 'item' && ((volumes[row.id] || 0) < 0 || (unitPrices[row.id] ?? row.unitPrice) < 0))
    .map((row) => row.id)), [rows, unitPrices, volumes]);
  const hasNegativeValue = negativeRows.size > 0;

  const subtotal = useMemo(() => rows.reduce((sum, row) => {
    if (row.type !== 'item') return sum;
    return sum + (volumes[row.id] || 0) * (unitPrices[row.id] ?? row.unitPrice);
  }, 0), [rows, unitPrices, volumes]);

  const margin = subtotal * (marginPercent / 100);
  const ppn = (subtotal + margin) * (ppnPercent / 100);
  const grandTotal = subtotal + margin + ppn;
  const [showBackflowWarning, setShowBackflowWarning] = useState(false);

  const openPlaceholder = (action: string) => {
    setStatusMessage(`${action}: fitur disiapkan, belum aktif. Draft lokal, belum tersimpan permanen.`);
  };

  const handlePickAhsp = () => {
    setStatusMessage('Pemilihan AHSP belum tersambung. Ruang pilihan AHSP sudah disiapkan.');
  };

  const activateRow = (rowId: string) => {
    setSelectedRowId(rowId);
  };

  const handleRowClick = (rowId: string, event: MouseEvent<HTMLTableRowElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, a')) return;
    activateRow(rowId);
  };

  const handleDraftGate = (label: string) => {
    if (hasNegativeValue) {
      setStatusMessage(`${label} diblokir oleh penjaga frontend: volume dan harga satuan tidak boleh minus. Endpoint update backend belum ada.`);
      return;
    }
    setStatusMessage(`${label}: draft lokal, belum tersimpan permanen. Endpoint update backend belum ada.`);
  };

  const addChild = (parentId: string | null, type: RabRowType) => {
    const newRow = createRow(type, parentId, Math.max(0, ...rows.map((row) => row.sortOrder)) + 1);
    setRows((current) => [...current, newRow]);
    if (type === 'item') setUnitPrices((current) => ({ ...current, [newRow.id]: 0 }));
    setStatusMessage(`${type === 'folder' ? 'Sub Judul' : type === 'note' ? 'Catatan' : 'Item'} ditambahkan sebagai draft lokal.`);
  };

  const removeRow = (rowId: string) => {
    setRows((current) => {
      const idsToRemove = new Set<string>([rowId]);
      let changed = true;
      while (changed) {
        changed = false;
        current.forEach((row) => {
          if (row.parentId && idsToRemove.has(row.parentId) && !idsToRemove.has(row.id)) {
            idsToRemove.add(row.id);
            changed = true;
          }
        });
      }
      return current.filter((row) => !idsToRemove.has(row.id));
    });
    setUnitPrices((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== rowId)));
    setStatusMessage('Baris dihapus dari draft lokal. Belum tersimpan permanen.');
  };

  const updateRowName = (rowId: string, name: string) => {
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, name } : row));
  };

  return (
    <div className="simprok-rab-workspace">
      <div className="simprok-rab-focus-nav" aria-label="Navigasi Ruang Kerja RAB">
        <button onClick={() => navigate('/')} title="Kembali ke Beranda" aria-label="Kembali ke Beranda" data-route="/">
          <ArrowLeft size={17} /> Kembali
        </button>
        <button onClick={() => setShowBackflowWarning(!showBackflowWarning)} title="Ubah Data Pekerjaan" aria-label="Ubah Data Pekerjaan" className="simprok-rab-nav-secondary">
          Ubah Data Pekerjaan
        </button>
        <button onClick={() => layoutContext?.toggleSidebar()} title="Tampilkan atau sembunyikan menu" aria-label="Tampilkan atau sembunyikan menu" data-route="/?ruang=ruang-kerja-rab">
          {layoutContext?.isSidebarVisible ? <ChevronsLeft size={17} /> : <ChevronsRight size={17} />} Menu
        </button>
      </div>

      <header className="simprok-rab-workspace__header">
        <div>
          <div className="simprok-rab-workspace__eyebrow">SIMPROK / Buat RAB / Ruang Kerja RAB</div>
          <h1>Ruang Kerja RAB</h1>
          <p>{projectId ? 'BOQ baseline aktif dibaca read-only dari proyek. Edit halaman ini tetap draft lokal.' : 'Tidak ada projectId. Menampilkan contoh kerja frontend sebagai draft lokal, belum tersimpan permanen.'}</p>
        </div>
        <span className="simprok-rab-workspace__status">{statusMessage}</span>
      </header>

      <section className="simprok-rab-toolbar" aria-label="Aksi Ruang Kerja RAB">
        <button onClick={() => openPlaceholder('Import BOQ')} title="Import BOQ - belum tersambung" aria-label="Import BOQ - belum tersambung" data-route="/?ruang=import-boq"><FileInput size={17} /> Import BOQ</button>
        <button onClick={() => openPlaceholder('Cari AHSP')} title="Cari AHSP - engine belum aktif" aria-label="Cari AHSP - engine belum aktif" data-route="/?ruang=cari-ahsp"><Search size={17} /> Cari AHSP</button>
        <button onClick={() => openPlaceholder('Export')} title="Export - belum tersambung" aria-label="Export - belum tersambung" data-route="/?ruang=export-rab"><FileDown size={17} /> Export</button>
        <button onClick={() => openPlaceholder('Print')} title="Print - belum tersambung" aria-label="Print - belum tersambung" data-route="/?ruang=print-rab"><Printer size={17} /> Print</button>
        <button className="simprok-rab-toolbar__save" onClick={() => handleDraftGate('Simpan Draft')} title="Simpan Draft - draft lokal" aria-label="Simpan Draft - draft lokal" data-route="/?ruang=simpan-draft" aria-disabled={hasNegativeValue}><Save size={17} /> Simpan Draft</button>
        <button className="simprok-rab-toolbar__lock" onClick={() => handleDraftGate('Kunci RAB')} title="Kunci RAB - menunggu data" aria-label="Kunci RAB - menunggu data" data-route="/?ruang=kunci-rab" aria-disabled={hasNegativeValue}><LockKeyhole size={17} /> Kunci RAB</button>
      </section>
      {hasNegativeValue ? (
        <div className="simprok-rab-validation-alert" role="alert">
          Ada nilai minus pada Volume atau Harga Satuan. Layar memblokir Simpan Draft dan Kunci RAB sampai diperbaiki. Ini penjaga frontend; endpoint update backend belum ada.
        </div>
      ) : null}

      {showBackflowWarning ? (
        <div className="simprok-rab-validation-alert simprok-rab-validation-alert--info" role="alert">
          <strong>Peringatan Navigasi (Draft Lokal)</strong>
          <p>Perubahan data pekerjaan dapat memengaruhi rekomendasi AHSP, Basic Price, Execution Factor, dan total RAB. Item RAB yang sudah dibuat tetap dipertahankan.</p>
          <p><em>Navigasi kembali ke Persiapan RAB ditahan sementara agar isi RAB lokal tidak hilang. Backflow penuh menunggu penyimpanan draft/persistence siap.</em></p>
          <button onClick={() => setShowBackflowWarning(false)} className="simprok-rab-action simprok-rab-action--secondary" style={{ marginTop: '10px' }}>Tutup Peringatan</button>
        </div>
      ) : null}

      <main className="simprok-rab-workspace__body">
        <section className="simprok-rab-sheet" aria-label="Tabel RAB">
          <div className="simprok-rab-sheet__label">
            <strong>Draft RAB</strong>
            <span>{projectId ? 'Read-only dari BOQ aktif, edit lokal' : 'Contoh kerja frontend'}</span>
          </div>

          <div className="simprok-rab-table-wrap">
            <table className="simprok-rab-table">
              <thead>
                <tr>
                  <th className="simprok-rab-col-atur">Atur</th>
                  <th className="simprok-rab-col-no">No</th>
                  <th>AHSP / Kategori</th>
                  <th>Uraian Pekerjaan</th>
                  <th>Volume</th>
                  <th>Satuan</th>
                  <th>Harga Satuan</th>
                  <th>Jumlah</th>
                  <th className="simprok-rab-col-aksi">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {numberedRows.map((row) => {
                  const unitPrice = unitPrices[row.id] ?? row.unitPrice;
                  const amount = row.type === 'item' ? (volumes[row.id] || 0) * unitPrice : 0;
                  const selected = row.id === selectedRowId;
                  const hasNegativeRowValue = negativeRows.has(row.id);

                  if (row.type === 'note') {
                    return (
                      <tr key={row.id} className="simprok-rab-row simprok-rab-row--note">
                        <td>
                          <div className="simprok-rab-row-move">
                            <button onClick={() => setRows((current) => moveWithinSiblings(current, row.id, 'up'))} title="Pindah baris ke atas" aria-label="Pindah baris ke atas"><ArrowUp size={14} /></button>
                            <button onClick={() => setRows((current) => moveWithinSiblings(current, row.id, 'down'))} title="Pindah baris ke bawah" aria-label="Pindah baris ke bawah"><ArrowDown size={14} /></button>
                          </div>
                        </td>
                        <td></td>
                        <td></td>
                        <td colSpan={5} style={{ paddingLeft: `${row.depth * 18 + 12}px` }}>
                          <input className="simprok-rab-description-input" value={row.name} onChange={(event) => updateRowName(row.id, event.target.value)} aria-label="Uraian catatan" />
                        </td>
                        <td><button className="simprok-rab-delete" onClick={() => removeRow(row.id)} title="Hapus catatan" aria-label="Hapus catatan"><Trash2 size={15} /></button></td>
                      </tr>
                    );
                  }

                  return (
                    <tr
                      key={row.id}
                      className={['simprok-rab-row', row.type === 'folder' ? 'simprok-rab-row--folder' : '', selected ? 'simprok-rab-row--selected' : '', hasNegativeRowValue ? 'simprok-rab-row--invalid' : ''].filter(Boolean).join(' ')}
                      onClick={(event) => handleRowClick(row.id, event)}
                    >
                      <td>
                        <div className="simprok-rab-row-move">
                          <button onClick={() => setRows((current) => moveWithinSiblings(current, row.id, 'up'))} title="Pindah baris ke atas" aria-label="Pindah baris ke atas"><ArrowUp size={14} /></button>
                          <button onClick={() => setRows((current) => moveWithinSiblings(current, row.id, 'down'))} title="Pindah baris ke bawah" aria-label="Pindah baris ke bawah"><ArrowDown size={14} /></button>
                        </div>
                      </td>
                      <td className="simprok-rab-row__number">{row.number}</td>
                      <td>
                        {row.type === 'item' ? (
                          <div className="simprok-rab-ahsp-cell">
                            {row.ahspCode ? (
                              <button
                                className="simprok-rab-ahsp-code"
                                onClick={() => activateRow(row.id)}
                                title="Buka Detail Analisa AHSP"
                                aria-label={`Buka AHSP ${row.ahspCode}`}
                                data-route={`/?ruang=detail-ahsp-${row.id}`}
                              >
                                {row.ahspCode}
                              </button>
                            ) : (
                              <button
                                className="simprok-rab-ahsp-pick"
                                onClick={() => activateRow(row.id)}
                                title="Pilih AHSP"
                                aria-label="Pilih AHSP"
                                data-route={`/?ruang=pilih-ahsp-${row.id}`}
                              >
                                Pilih AHSP
                              </button>
                            )}
                            {row.manualAhsp ? (
                              <span className="simprok-rab-ahsp-badge simprok-rab-ahsp-badge--manual">MANUAL</span>
                            ) : null}
                            <span className="simprok-rab-ahsp-badge">
                              {row.ahspCode ? 'Standby' : 'Menunggu rekomendasi'}
                            </span>
                          </div>
                        ) : row.type === 'folder' ? (
                          <small>{row.category}</small>
                        ) : null}
                      </td>
                      <td style={{ paddingLeft: `${row.depth * 18 + 12}px` }}>
                        <span className="simprok-rab-row__name">
                          {row.type === 'folder' ? <FolderOpen size={16} /> : null}
                          <input className="simprok-rab-description-input" value={row.name} onChange={(event) => updateRowName(row.id, event.target.value)} aria-label={`Uraian ${row.type === 'folder' ? 'sub judul' : 'item pekerjaan'}`} />
                        </span>
                      </td>
                      <td>{row.type === 'item' ? <input className={(volumes[row.id] || 0) < 0 ? 'simprok-rab-number-invalid' : ''} type="number" step="0.01" value={volumes[row.id] || 0} onChange={(event) => setVolumes((current) => ({ ...current, [row.id]: Number(event.target.value) }))} aria-label={`Volume ${row.name}`} /> : null}</td>
                      <td>{row.unit}</td>
                      <td>
                        {row.type === 'item' ? (
                          <span className="simprok-rab-price-cell">
                            <input className={(unitPrices[row.id] ?? row.unitPrice) < 0 ? 'simprok-rab-number-invalid' : ''} type="number" step="1" value={unitPrices[row.id] ?? row.unitPrice} onChange={(event) => setUnitPrices((current) => ({ ...current, [row.id]: Number(event.target.value) }))} aria-label={`Harga satuan ${row.name}`} />
                            {row.manualUnitPrice ? <span className="simprok-rab-manual-chip">MANUAL</span> : null}
                          </span>
                        ) : null}
                      </td>
                      <td>{row.type === 'item' ? formatRupiah(amount) : ''}</td>
                      <td>
                        <div className="simprok-rab-row-actions">
                          {row.type === 'folder' ? (
                            <>
                              <button className="simprok-rab-add-sub" onClick={() => addChild(row.id, 'folder')} title="Tambah Sub Judul" aria-label="Tambah Sub Judul">+ Sub Judul</button>
                              <button className="simprok-rab-add-item" onClick={() => addChild(row.id, 'item')} title="Tambah Item" aria-label="Tambah Item">+ Item</button>
                            </>
                          ) : row.type === 'item' ? (
                            <button className="simprok-rab-table-action" onClick={() => setSelectedRowId(row.id)} title="Buka Detail Analisa AHSP" aria-label="Buka Detail Analisa AHSP" data-route={`/?ruang=detail-ahsp-${row.id}`}>Detail</button>
                          ) : null}
                          <button className="simprok-rab-delete" onClick={() => removeRow(row.id)} title="Hapus baris" aria-label="Hapus baris"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="simprok-rab-recap-zone" aria-label="Rekapitulasi Biaya RAB">
            <button className="simprok-rab-recap__ef" onClick={() => openPlaceholder('Atur Execution Factor')} title="Atur Execution Factor - engine belum aktif" aria-label="Atur Execution Factor - engine belum aktif" data-route="/?ruang=execution-factor">
              <Sparkles size={16} />
              <strong>Rekomendasi — Execution Factor</strong>
              <span>menunggu mesin, ruang sudah disiapkan</span>
            </button>
            <div className="simprok-rab-recap">
              <h3 className="simprok-rab-recap__title">Rekapitulasi Biaya</h3>
              <div className="simprok-rab-recap__rows">
                <div className="simprok-rab-recap__row simprok-rab-recap__row--plain">
                  <span className="simprok-rab-recap__label">Total / Biaya Langsung</span>
                  <strong className="simprok-rab-recap__value">{formatRupiah(subtotal)}</strong>
                </div>
                <div className="simprok-rab-recap__row">
                  <span className="simprok-rab-recap__label">Margin / Profit</span>
                  <span className="simprok-rab-recap__input-wrap">
                    <input type="number" min="0" value={marginPercent} onChange={(event) => setMarginPercent(Number(event.target.value))} aria-label="Persentase margin" />
                    <span>%</span>
                  </span>
                  <strong className="simprok-rab-recap__value">{formatRupiah(margin)}</strong>
                </div>
                <div className="simprok-rab-recap__row">
                  <span className="simprok-rab-recap__label">Pajak / PPN</span>
                  <span className="simprok-rab-recap__input-wrap">
                    <input type="number" min="0" value={ppnPercent} onChange={(event) => setPpnPercent(Number(event.target.value))} aria-label="Persentase PPN" />
                    <span>%</span>
                  </span>
                  <strong className="simprok-rab-recap__value">{formatRupiah(ppn)}</strong>
                </div>
                <div className="simprok-rab-recap__divider" role="presentation" />
                <div className="simprok-rab-recap__row simprok-rab-recap__row--grand">
                  <span className="simprok-rab-recap__label">Grand Total Estimasi</span>
                  <strong className="simprok-rab-recap__value">{formatRupiah(grandTotal)}</strong>
                </div>
              </div>
            </div>
          </footer>
        </section>

        <aside className="simprok-ahsp-drawer" aria-label="Detail Analisa AHSP">
          <div className="simprok-ahsp-drawer__header">
            <div>
              <h2>Detail Analisa AHSP</h2>
            </div>
            <button onClick={() => setSelectedRowId('')} title="Tutup panel" aria-label="Tutup panel" data-route="/?ruang=ruang-kerja-rab"><X size={17} /></button>
          </div>

          {selectedItem ? (
            <>
              <div className="simprok-ahsp-drawer__selected">
                <strong>{selectedItem.name}</strong>
                <small>{selectedItem.number} - {selectedItem.unit || 'satuan menunggu data'}</small>
              </div>
              <div className="simprok-ahsp-meta">
                <div><span>Kode AHSP</span><strong>{selectedItem.ahspCode || 'Belum dipilih'}</strong></div>
                <div><span>Status AHSP</span><strong>{selectedItem.ahspCode ? 'Standby' : 'Engine belum aktif'}</strong></div>
                <div><span>Sumber Harga</span><strong>Belum tersambung</strong></div>
                <div><span>Persistensi</span><strong>Draft lokal</strong></div>
              </div>
              <div className="simprok-ahsp-drawer__frame">
                <span className="simprok-honest-frame__badge">Engine belum aktif</span>
                <p>Komponen tenaga, bahan, alat, koefisien, dan Basic Price akan tampil setelah engine AHSP tersambung. Angka detail tidak dibuat palsu.</p>
              </div>
              <button className="simprok-execution-factor" onClick={() => openPlaceholder('Atur Execution Factor')} title="Atur Execution Factor - engine belum aktif" aria-label="Atur Execution Factor - engine belum aktif" data-route="/?ruang=execution-factor">
                <Sparkles size={18} />
                <span><strong>Atur Execution Factor</strong><small>Rekomendasi kondisi lapangan menunggu mesin.</small></span>
              </button>
              <div className="simprok-ahsp-total">
                <span>Total Harga Satuan</span>
                <strong>{formatRupiah(unitPrices[selectedItem.id] ?? selectedItem.unitPrice)}</strong>
              </div>
              <button className="simprok-ahsp-drawer__primary" onClick={handlePickAhsp} title="Pilih / Ganti AHSP - belum tersambung" aria-label="Pilih / Ganti AHSP - belum tersambung" data-route="/?ruang=pilih-ganti-ahsp">
                <ListChecks size={17} /> Pilih / Ganti AHSP
              </button>
            </>
          ) : (
            <div className="simprok-ahsp-drawer__frame">
              <span className="simprok-honest-frame__badge">Standby</span>
              <p>Pilih item pekerjaan untuk membuka detail analisa AHSP.</p>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
