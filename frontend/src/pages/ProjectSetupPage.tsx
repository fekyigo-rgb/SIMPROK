import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch } from '../utils/apiClient';

const checkStatus = (status: number) => {
  if (status === 401) return 'Sesi Anda telah berakhir atau tidak valid. Silakan login kembali.';
  if (status === 403) return 'Anda tidak memiliki akses untuk membuka data ini.';
  if (status === 400) return 'Konteks workspace atau permintaan belum valid. Pilih workspace kembali.';
  return 'Data gagal dimuat. Coba lagi beberapa saat.';
};

const safeNumber = (val: any): number => {
  const num = Number(val);
  return Number.isNaN(num) ? 0 : num;
};

const generateTempId = () => 'TEMP-' + Math.random().toString(36).substr(2, 9);

interface BoqItemInput {
  tempId: string;
  parentTempId: string | null;
  itemType: 'FOLDER' | 'WORK_ITEM';
  wbsCode: string;
  name: string;
  quantity: string | number;
  unit: string;
  unitPrice: string | number;
}

export function ProjectSetupPage() {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [description, setDescription] = useState('');
  
  const [items, setItems] = useState<BoqItemInput[]>([]);
  
  const [submitting, setSubmitting] = useState(false);
  const { token, activeWorkspaceId } = useAuth();
  const navigate = useNavigate();

  const handleAddSection = () => {
    setItems([...items, { 
      tempId: generateTempId(), 
      parentTempId: null, 
      itemType: 'FOLDER', 
      wbsCode: '', 
      name: '', 
      quantity: 0, 
      unit: '', 
      unitPrice: 0 
    }]);
  };

  const handleAddItem = (parentTempId: string) => {
    // Insert item immediately after the parent or its existing children
    const newItems = [...items];
    const parentIndex = newItems.findIndex(i => i.tempId === parentTempId);
    if (parentIndex === -1) return;
    
    // Find the last item of this parent to insert after it
    let insertIndex = parentIndex + 1;
    while (insertIndex < newItems.length && newItems[insertIndex].parentTempId === parentTempId) {
      insertIndex++;
    }
    
    newItems.splice(insertIndex, 0, {
      tempId: generateTempId(),
      parentTempId,
      itemType: 'WORK_ITEM',
      wbsCode: '',
      name: '',
      quantity: 1,
      unit: 'ls',
      unitPrice: 0
    });
    setItems(newItems);
  };

  const handleRemoveItem = (index: number) => {
    const itemToRemove = items[index];
    let newItems = [...items];
    
    if (itemToRemove.itemType === 'FOLDER') {
      // Remove folder and all its children
      newItems = newItems.filter(i => i.tempId !== itemToRemove.tempId && i.parentTempId !== itemToRemove.tempId);
    } else {
      newItems.splice(index, 1);
    }
    setItems(newItems);
  };

  const handleChangeItem = (index: number, field: keyof BoqItemInput, value: string | number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  // Compute subtotals and grand total
  const subtotals: Record<string, number> = {};
  let totalEstimasi = 0;

  items.forEach(item => {
    if (item.itemType === 'WORK_ITEM' && item.parentTempId) {
      const lineTotal = safeNumber(item.quantity) * safeNumber(item.unitPrice);
      subtotals[item.parentTempId] = (subtotals[item.parentTempId] || 0) + lineTotal;
      totalEstimasi += lineTotal;
    }
  });

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !activeWorkspaceId) return;
    if (items.length === 0) {
      alert('Tambahkan minimal 1 Sub Judul / Item BOQ.');
      return;
    }

    // Domain validation
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.wbsCode.trim() || !item.name.trim()) {
        alert('Lengkapi Kode dan Nama untuk semua baris.');
        return;
      }
      if (item.itemType === 'WORK_ITEM') {
        if (!item.unit.trim()) {
          alert('Lengkapi Satuan untuk Item Pekerjaan.');
          return;
        }
        const vol = safeNumber(item.quantity);
        if (vol <= 0) {
          alert('Volume Item Pekerjaan harus lebih besar dari 0.');
          return;
        }
        const price = safeNumber(item.unitPrice);
        if (price < 0) {
          alert('Harga Satuan tidak boleh negatif.');
          return;
        }
      }
    }

    setSubmitting(true);
    try {
      // 1. Create Project
      const projRes = await apiFetch('http://localhost:3000/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, code, description, workspaceId: activeWorkspaceId })
      });
      if (!projRes.ok) throw new Error(checkStatus(projRes.status));
      const project = await projRes.json();

      // 2. Initiate Setup
      // DEBT-RAB-UNITPRICE-PERSISTENCE: Backend lacks separate unitPrice field in BoqItem.
      // We send the computed lineTotal (Jumlah) as plannedCost for items.
      const initRes = await apiFetch(`http://localhost:3000/projects/${project.id}/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map(item => ({
            tempId: item.tempId,
            parentTempId: item.parentTempId || undefined,
            itemType: item.itemType,
            wbsCode: item.wbsCode,
            name: item.name,
            quantity: item.itemType === 'FOLDER' ? 0 : safeNumber(item.quantity),
            unit: item.itemType === 'FOLDER' ? '' : item.unit,
            plannedCost: item.itemType === 'FOLDER' ? 0 : (safeNumber(item.quantity) * safeNumber(item.unitPrice))
          }))
        })
      });
      if (!initRes.ok) throw new Error(checkStatus(initRes.status));

      alert('RAB berhasil dibuat dan Baseline aktif!');
      navigate(`/project/${project.id}`);
    } catch (err: any) {
      alert(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', backgroundColor: 'white', padding: 'var(--space-8)', borderRadius: 'var(--radius-lg)' }}>
      <h2 style={{ fontSize: 'var(--text-2xl)', color: 'var(--simprok-engineering-blue-900)', marginBottom: 'var(--space-6)' }}>Workspace Penyusunan RAB</h2>
      <form onSubmit={handleSetup} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Nama Proyek</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} required style={{ width: '100%', padding: '8px' }}/>
          </div>
          <div>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Kode Proyek</label>
            <input type="text" value={code} onChange={(e) => setCode(e.target.value)} required style={{ width: '100%', padding: '8px' }}/>
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Deskripsi</label>
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', padding: '8px' }}/>
        </div>

        <div style={{ marginTop: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, color: 'var(--simprok-engineering-blue-900)' }}>Daftar RAB</h3>
          <button type="button" onClick={handleAddSection} style={{ padding: '8px 16px', backgroundColor: 'var(--simprok-engineering-blue-800)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            + Tambah Sub Judul
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 'var(--space-2)' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--simprok-engineering-blue-50)', textAlign: 'left' }}>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)' }}>Kode</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)' }}>Uraian Pekerjaan</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', width: '80px', textAlign: 'right' }}>Volume</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', width: '80px' }}>Satuan</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', width: '150px', textAlign: 'right' }}>Harga Satuan</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', width: '180px', textAlign: 'right' }}>Jumlah / Subtotal</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', width: '120px', textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const isSection = item.itemType === 'FOLDER';
                
                if (isSection) {
                  return (
                    <tr key={item.tempId} style={{ backgroundColor: 'var(--simprok-engineering-blue-50)', borderBottom: '2px solid var(--simprok-engineering-blue-200)' }}>
                      <td style={{ padding: '8px' }}>
                        <input type="text" value={item.wbsCode} onChange={(e) => handleChangeItem(index, 'wbsCode', e.target.value)} required style={{ width: '100%', padding: '6px', fontWeight: 'bold' }} placeholder="Cth: A" />
                      </td>
                      <td style={{ padding: '8px' }} colSpan={4}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <input type="text" value={item.name} onChange={(e) => handleChangeItem(index, 'name', e.target.value)} required style={{ flex: 1, padding: '6px', fontWeight: 'bold' }} placeholder="Nama Sub Judul Pekerjaan" />
                          <button type="button" onClick={() => handleAddItem(item.tempId)} style={{ padding: '6px 12px', backgroundColor: 'var(--simprok-engineering-blue-600)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
                            + Item
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: 'var(--simprok-engineering-blue-900)' }}>
                        Rp {(subtotals[item.tempId] || 0).toLocaleString()}
                      </td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <button type="button" onClick={() => handleRemoveItem(index)} style={{ padding: '6px', backgroundColor: 'transparent', color: 'var(--simprok-critical-red-600)', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                          Hapus Sub
                        </button>
                      </td>
                    </tr>
                  );
                }

                // WORK_ITEM row
                const lineTotal = safeNumber(item.quantity) * safeNumber(item.unitPrice);
                return (
                  <tr key={item.tempId} style={{ borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                    <td style={{ padding: '8px', paddingLeft: '24px' }}>
                      <input type="text" value={item.wbsCode} onChange={(e) => handleChangeItem(index, 'wbsCode', e.target.value)} required style={{ width: '100%', padding: '6px' }} placeholder="A.1" />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="text" value={item.name} onChange={(e) => handleChangeItem(index, 'name', e.target.value)} required style={{ width: '100%', padding: '6px' }} placeholder="Nama Item" />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="number" min="0.000001" step="any" value={item.quantity} onChange={(e) => handleChangeItem(index, 'quantity', e.target.value)} required style={{ width: '100%', padding: '6px', textAlign: 'right' }} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="text" value={item.unit} onChange={(e) => handleChangeItem(index, 'unit', e.target.value)} required style={{ width: '100%', padding: '6px' }} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input type="number" min="0" step="any" value={item.unitPrice} onChange={(e) => handleChangeItem(index, 'unitPrice', e.target.value)} required style={{ width: '100%', padding: '6px', textAlign: 'right' }} />
                    </td>
                    <td style={{ padding: '8px', textAlign: 'right', color: 'var(--simprok-engineering-blue-800)' }}>
                      Rp {lineTotal.toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <button type="button" onClick={() => handleRemoveItem(index)} style={{ padding: '6px', backgroundColor: 'var(--simprok-critical-red-100)', color: 'var(--simprok-critical-red-600)', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                        Hapus
                      </button>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
                    Belum ada RAB. Silakan tambah Sub Judul terlebih dahulu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', backgroundColor: 'var(--simprok-engineering-blue-900)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--text-xl)', fontWeight: 'bold', color: 'white' }}>Total Estimasi:</span>
          <span style={{ fontSize: 'var(--text-3xl)', fontWeight: 'bold', color: 'white' }}>
            Rp {totalEstimasi.toLocaleString()}
          </span>
        </div>

        <button type="submit" disabled={submitting} style={{ marginTop: 'var(--space-6)', padding: '16px', fontSize: 'var(--text-lg)', fontWeight: 'bold', backgroundColor: 'var(--simprok-engineering-blue-800)', color: 'white', border: 'none', borderRadius: '8px', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
          {submitting ? 'Menyimpan...' : 'Simpan & Aktifkan Baseline'}
        </button>
      </form>
    </div>
  );
}
