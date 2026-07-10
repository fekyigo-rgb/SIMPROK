import { type MouseEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
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

interface DraftRecapResponse {
  subtotal?: string | number | null;
  marginPercent?: string | number | null;
  marginAmount?: string | number | null;
  ppnPercent?: string | number | null;
  taxPercent?: string | number | null;
  taxAmount?: string | number | null;
  grandTotal?: string | number | null;
}

interface DraftBoqResponse {
  structureId: string | null;
  items: BoqItemResponse[];
  recap?: DraftRecapResponse | null;
}

interface NumberedRabRow extends RabRow {
  number: string;
  depth: number;
}


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

const normalizeSortOrders = (rows: RabRow[]): RabRow[] => {
  const byParent = new Map<string | null, RabRow[]>();
  for (const row of rows) {
    const key = row.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(row);
  }
  const updated: RabRow[] = [];
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.sortOrder - b.sortOrder);
    siblings.forEach((row, i) => updated.push({ ...row, sortOrder: i }));
  }
  return updated;
};

const indentRow = (rows: RabRow[], rowId: string): RabRow[] => {
  const row = rows.find((r) => r.id === rowId);
  if (!row) return rows;
  const siblings = rows
    .filter((r) => r.parentId === row.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const rowIndex = siblings.findIndex((r) => r.id === rowId);
  if (rowIndex <= 0) return rows;
  const newParent = siblings[rowIndex - 1];
  if (newParent.type !== 'folder') return rows;
  const newSiblings = rows.filter((r) => r.parentId === newParent.id);
  const maxSort = newSiblings.length > 0 ? Math.max(...newSiblings.map((r) => r.sortOrder)) + 1 : 0;
  return normalizeSortOrders(
    rows.map((r) => (r.id === rowId ? { ...r, parentId: newParent.id, sortOrder: maxSort } : r)),
  );
};

const outdentRow = (rows: RabRow[], rowId: string): RabRow[] => {
  const row = rows.find((r) => r.id === rowId);
  if (!row || row.parentId === null) return rows;
  const parent = rows.find((r) => r.id === row.parentId);
  if (!parent) return rows;
  return normalizeSortOrders(
    rows.map((r) =>
      r.id === rowId ? { ...r, parentId: parent.parentId, sortOrder: parent.sortOrder + 0.5 } : r,
    ),
  );
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
  const { projectId: routeProjectId } = useParams();
  const [searchParams] = useSearchParams();
  const layoutContext = useOutletContext<DashboardOutletContext | null>();
  const projectId = routeProjectId || searchParams.get('projectId');
  const [rows, setRows] = useState<RabRow[]>([]);
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [unitPrices, setUnitPrices] = useState<Record<string, number>>({});
  const [selectedRowId, setSelectedRowId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [marginPercent, setMarginPercent] = useState(10);
  const [ppnPercent, setPpnPercent] = useState(11);
  const [statusMessage, setStatusMessage] = useState(projectId ? 'Memuat draft...' : 'Tidak ada project aktif.');

  const applyRecap = (recap?: DraftRecapResponse | null) => {
    if (!recap) return;
    if (recap.marginPercent !== null && recap.marginPercent !== undefined) {
      setMarginPercent(toNumber(recap.marginPercent));
    }
    const persistedPpnPercent = recap.taxPercent ?? recap.ppnPercent;
    if (persistedPpnPercent !== null && persistedPpnPercent !== undefined) {
      setPpnPercent(toNumber(persistedPpnPercent));
    }
  };

  const applyRows = (items: BoqItemResponse[]) => {
    const mappedRows = mapBoqToRows(items);
    const nextVolumes = items.reduce<Record<string, number>>((acc, item) => {
      acc[item.id] = toNumber(item.quantity);
      return acc;
    }, {});
    const nextUnitPrices = mappedRows.reduce<Record<string, number>>((acc, row) => {
      if (row.type === 'item') acc[row.id] = row.unitPrice;
      return acc;
    }, {});
    setRows(mappedRows);
    setVolumes(nextVolumes);
    setUnitPrices(nextUnitPrices);
    setSelectedRowId(mappedRows.find((row) => row.type === 'item')?.id || '');
  };

  useEffect(() => {
    if (!projectId) {
      setRows([]);
      setVolumes({});
      setUnitPrices({});
      setSelectedRowId('');
      setStatusMessage('Tidak ada project aktif. Navigasi dari Proyek Saya untuk membuka ruang kerja.');
      return;
    }

    apiFetch(`/projects/${projectId}/boq/draft`)
      .then((response) => {
        if (!response.ok) throw new Error('draft-load-failed');
        return response.json();
      })
      .then((data: DraftBoqResponse) => {
        applyRecap(data.recap);
        if (data.items.length > 0) {
          applyRows(data.items);
          setStatusMessage('Draft tersimpan dimuat. Ruang kerja siap.');
        } else {
          // No saved draft — seed from baseline if available, else empty
          return apiFetch(`/projects/${projectId}/boq`)
            .then((r) => r.ok ? r.json() : [])
            .then((baseline: unknown) => {
              const baselineItems = Array.isArray(baseline) ? baseline as BoqItemResponse[] : [];
              if (baselineItems.length > 0) {
                applyRows(baselineItems);
                setStatusMessage('Draft kosong. Data baseline dimuat sebagai titik awal — klik Simpan Draft untuk menyimpan perubahan.');
              } else {
                setRows([]);
                setVolumes({});
                setUnitPrices({});
                setSelectedRowId('');
                setStatusMessage('Draft kosong. Tambahkan item pekerjaan, lalu klik Simpan Draft.');
              }
            });
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load RAB draft:', error);
        setRows([]);
        setVolumes({});
        setUnitPrices({});
        setSelectedRowId('');
        setStatusMessage('Gagal memuat draft. Periksa koneksi backend dan coba lagi.');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const siblingsByParent = useMemo(() => {
    const map = new Map<string | null, RabRow[]>();
    for (const row of rows) {
      const key = row.parentId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    for (const siblings of map.values()) {
      siblings.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [rows]);

  const subtotal = useMemo(() => rows.reduce((sum, row) => {
    if (row.type !== 'item') return sum;
    return sum + (volumes[row.id] || 0) * (unitPrices[row.id] ?? row.unitPrice);
  }, 0), [rows, unitPrices, volumes]);

  const margin = subtotal * (marginPercent / 100);
  const ppn = (subtotal + margin) * (ppnPercent / 100);
  const grandTotal = subtotal + margin + ppn;
  const [showBackflowWarning, setShowBackflowWarning] = useState(false);

  const openPlaceholder = (action: string) => {
    setStatusMessage(`${action}: fitur disiapkan, belum aktif.`);
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

  const handleSaveDraft = () => {
    if (hasNegativeValue) {
      setStatusMessage('Simpan diblokir: volume dan harga satuan tidak boleh minus.');
      return;
    }
    if (!projectId) {
      setStatusMessage('Tidak ada project aktif — tidak bisa menyimpan.');
      return;
    }
    if (isSaving) return;

    setIsSaving(true);
    setStatusMessage('Menyimpan draft...');

    const payload = {
      marginPercent,
      ppnPercent,
      taxPercent: ppnPercent,
      rows: rows.map((row, index) => ({
        tempId: row.id,
        parentTempId: row.parentId,
        itemType: row.type === 'folder' ? 'FOLDER' : row.type === 'note' ? 'NOTE' : 'WORK_ITEM',
        name: row.name,
        wbsCode: row.ahspCode || '',
        quantity: volumes[row.id] ?? 0,
        unit: row.unit,
        unitPrice: unitPrices[row.id] ?? row.unitPrice,
        sortOrder: row.sortOrder ?? index,
      })),
    };

    apiFetch(`/projects/${projectId}/boq/draft`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((fresh: DraftBoqResponse) => {
        applyRecap(fresh.recap);
        const mappedRows = mapBoqToRows(fresh.items);
        const nextVolumes = fresh.items.reduce<Record<string, number>>((acc, item) => {
          acc[item.id] = toNumber(item.quantity);
          return acc;
        }, {});
        const nextUnitPrices = mappedRows.reduce<Record<string, number>>((acc, row) => {
          if (row.type === 'item') acc[row.id] = row.unitPrice;
          return acc;
        }, {});
        const currentSelected = selectedRowId;
        setRows(mappedRows);
        setVolumes(nextVolumes);
        setUnitPrices(nextUnitPrices);
        setSelectedRowId(
          mappedRows.find((r) => r.id === currentSelected)?.id ||
          mappedRows.find((r) => r.type === 'item')?.id ||
          '',
        );
        setStatusMessage(`Draft tersimpan — ${new Date().toLocaleTimeString('id-ID')}.`);
      })
      .catch(() => {
        setStatusMessage('Gagal menyimpan draft. Coba lagi.');
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const addChild = (parentId: string | null, type: RabRowType) => {
    const newRow = createRow(type, parentId, Math.max(0, ...rows.map((row) => row.sortOrder)) + 1);
    setRows((current) => [...current, newRow]);
    if (type === 'item') setUnitPrices((current) => ({ ...current, [newRow.id]: 0 }));
    setStatusMessage(`${type === 'folder' ? 'Sub Judul' : type === 'note' ? 'Catatan' : 'Item'} ditambahkan. Klik Simpan Draft untuk menyimpan.`);
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
    setStatusMessage('Baris dihapus. Klik Simpan Draft untuk menyimpan perubahan.');
  };

  const updateRowName = (rowId: string, name: string) => {
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, name } : row));
  };

  const updateRowUnit = (rowId: string, unit: string) => {
    setRows((current) => current.map((row) => row.id === rowId ? { ...row, unit } : row));
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
          <p>{projectId ? `Project: ${projectId}. Ruang kerja draft RAB — edit dan simpan sebelum baseline resmi.` : 'Tidak ada project aktif. Navigasi dari Proyek Saya untuk membuka ruang kerja.'}</p>
        </div>
        <span className="simprok-rab-workspace__status">{statusMessage}</span>
      </header>

      <section className="simprok-rab-toolbar" aria-label="Aksi Ruang Kerja RAB">
        <button onClick={() => navigate('/first-real-input-preview?tab=boq')} title="Preview Import BOQ (Data Contoh)" aria-label="Preview Import BOQ" data-route="/?ruang=import-boq"><FileInput size={17} /> Import BOQ (Preview)</button>
        <button onClick={() => navigate('/first-real-input-preview?tab=ahsp')} title="Preview Cari AHSP (Data Contoh)" aria-label="Preview Cari AHSP" data-route="/?ruang=cari-ahsp"><Search size={17} /> Cari AHSP (Preview)</button>
        <button onClick={() => openPlaceholder('Export')} title="Export - belum tersambung" aria-label="Export - belum tersambung" data-route="/?ruang=export-rab"><FileDown size={17} /> Export</button>
        <button onClick={() => openPlaceholder('Print')} title="Print - belum tersambung" aria-label="Print - belum tersambung" data-route="/?ruang=print-rab"><Printer size={17} /> Print</button>
        <button className="simprok-rab-toolbar__save" onClick={handleSaveDraft} title={isSaving ? 'Menyimpan...' : 'Simpan Draft ke server'} aria-label="Simpan Draft" data-route="/?ruang=simpan-draft" aria-disabled={hasNegativeValue || isSaving || !projectId}><Save size={17} /> {isSaving ? 'Menyimpan...' : 'Simpan Draft'}</button>
        <button className="simprok-rab-toolbar__lock" onClick={() => openPlaceholder('Kunci RAB')} title="Kunci RAB - menunggu mesin finalisasi" aria-label="Kunci RAB - belum aktif" data-route="/?ruang=kunci-rab" aria-disabled={true}><LockKeyhole size={17} /> Kunci RAB</button>
      </section>
      {hasNegativeValue ? (
        <div className="simprok-rab-validation-alert" role="alert">
          Ada nilai minus pada Volume atau Harga Satuan. Perbaiki sebelum menyimpan draft.
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
            <span>{projectId ? 'Draft tersimpan di server — edit bebas, simpan kapan saja' : 'Tidak ada project aktif'}</span>
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
                {numberedRows.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <div className="simprok-rab-empty-state" role="status">
                        <p><strong>Draft RAB masih kosong.</strong></p>
                        <p>Tambahkan Sub Judul atau Item pekerjaan untuk mulai menyusun RAB.</p>
                        <div className="simprok-rab-empty-state__actions">
                          <button className="simprok-rab-add-sub" onClick={() => addChild(null, 'folder')} aria-label="Tambah Sub Judul ke draft">+ Sub Judul</button>
                          <button className="simprok-rab-add-item" onClick={() => addChild(null, 'item')} aria-label="Tambah Item pekerjaan ke draft">+ Item</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
                {numberedRows.map((row) => {
                  const unitPrice = unitPrices[row.id] ?? row.unitPrice;
                  const amount = row.type === 'item' ? (volumes[row.id] || 0) * unitPrice : 0;
                  const selected = row.id === selectedRowId;
                  const hasNegativeRowValue = negativeRows.has(row.id);
                  const siblings = siblingsByParent.get(row.parentId) ?? [];
                  const siblingIndex = siblings.findIndex((r) => r.id === row.id);
                  const prevSibling = siblingIndex > 0 ? siblings[siblingIndex - 1] : null;
                  const canIndent = prevSibling !== null && prevSibling.type === 'folder';
                  const canOutdent = row.parentId !== null;

                  if (row.type === 'note') {
                    return (
                      <tr key={row.id} className="simprok-rab-row simprok-rab-row--note">
                        <td>
                          <div className="simprok-rab-row-move">
                            <button onClick={() => setRows((current) => moveWithinSiblings(current, row.id, 'up'))} title="Pindah baris ke atas" aria-label="Pindah baris ke atas"><ArrowUp size={14} /></button>
                            <button onClick={() => setRows((current) => indentRow(current, row.id))} disabled={!canIndent} title="Jadikan sub-bagian" aria-label="Jadikan sub-bagian"><ArrowRight size={14} /></button>
                            <button onClick={() => setRows((current) => moveWithinSiblings(current, row.id, 'down'))} title="Pindah baris ke bawah" aria-label="Pindah baris ke bawah"><ArrowDown size={14} /></button>
                            <button onClick={() => setRows((current) => outdentRow(current, row.id))} disabled={!canOutdent} title="Naikkan tingkat" aria-label="Naikkan tingkat"><ArrowLeft size={14} /></button>
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
                          <button onClick={() => setRows((current) => indentRow(current, row.id))} disabled={!canIndent} title="Jadikan sub-bagian" aria-label="Jadikan sub-bagian"><ArrowRight size={14} /></button>
                          <button onClick={() => setRows((current) => moveWithinSiblings(current, row.id, 'down'))} title="Pindah baris ke bawah" aria-label="Pindah baris ke bawah"><ArrowDown size={14} /></button>
                          <button onClick={() => setRows((current) => outdentRow(current, row.id))} disabled={!canOutdent} title="Naikkan tingkat" aria-label="Naikkan tingkat"><ArrowLeft size={14} /></button>
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
                      <td>{row.type === 'item' ? <input className="simprok-rab-description-input" value={row.unit} onChange={(event) => updateRowUnit(row.id, event.target.value)} aria-label={`Satuan ${row.name}`} /> : null}</td>
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

        {selectedItem ? (
          <aside className="simprok-ahsp-drawer" aria-label="Detail Analisa AHSP">
            <div className="simprok-ahsp-drawer__header">
              <div>
                <h2>Detail Analisa AHSP</h2>
              </div>
              <button onClick={() => setSelectedRowId('')} title="Tutup panel" aria-label="Tutup panel"><X size={17} /></button>
            </div>
            <div className="simprok-ahsp-drawer__selected">
              <strong>{selectedItem.name}</strong>
              <small>{selectedItem.number} - {selectedItem.unit || 'satuan menunggu data'}</small>
            </div>
            <div className="simprok-ahsp-meta">
              <div><span>Kode AHSP</span><strong>{selectedItem.ahspCode || 'Belum dipilih'}</strong></div>
              <div><span>Status AHSP</span><strong>{selectedItem.ahspCode ? 'Standby' : 'Engine belum aktif'}</strong></div>
              <div><span>Sumber Harga</span><strong>Belum tersambung</strong></div>
              <div><span>Persistensi</span><strong>{projectId ? 'Draft tersimpan di server' : 'Belum ada project aktif'}</strong></div>
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
          </aside>
        ) : null}
      </main>
    </div>
  );
}
