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

interface BoqItemInput {
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
  
  const [items, setItems] = useState<BoqItemInput[]>([
    { wbsCode: 'WBS.1.1', name: 'Pekerjaan Persiapan', quantity: 1, unit: 'ls', unitPrice: 10000000 }
  ]);
  
  const [submitting, setSubmitting] = useState(false);
  const { token, activeWorkspaceId } = useAuth();
  const navigate = useNavigate();

  const handleAddItem = () => {
    setItems([...items, { wbsCode: '', name: '', quantity: 1, unit: 'ls', unitPrice: 0 }]);
  };

  const handleRemoveItem = (index: number) => {
    if (items.length <= 1) {
      alert('Minimal harus ada 1 Item BOQ.');
      return;
    }
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const handleChangeItem = (index: number, field: keyof BoqItemInput, value: string | number) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  // Compute row totals safely
  const rowTotals = items.map(item => safeNumber(item.quantity) * safeNumber(item.unitPrice));
  const totalEstimasi = rowTotals.reduce((sum, val) => sum + val, 0);

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || !activeWorkspaceId) return;
    if (items.length === 0) {
      alert('Tambahkan minimal 1 Item BOQ.');
      return;
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
      // We send the computed lineTotal (Jumlah) as plannedCost.
      const initRes = await apiFetch(`http://localhost:3000/projects/${project.id}/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item, idx) => ({
            wbsCode: item.wbsCode,
            name: item.name,
            quantity: safeNumber(item.quantity),
            unit: item.unit,
            plannedCost: rowTotals[idx] // send Jumlah as plannedCost
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
          <h3 style={{ margin: 0, color: 'var(--simprok-engineering-blue-900)' }}>Daftar Item BOQ</h3>
          <button type="button" onClick={handleAddItem} style={{ padding: '8px 16px', backgroundColor: 'var(--simprok-engineering-blue-800)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            + Tambah Item
          </button>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 'var(--space-2)' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--simprok-engineering-blue-50)', textAlign: 'left' }}>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)' }}>WBS/Kode</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)' }}>Nama Item</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', width: '80px', textAlign: 'right' }}>Volume</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', width: '80px' }}>Satuan</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', width: '150px', textAlign: 'right' }}>Harga Satuan</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', width: '180px', textAlign: 'right' }}>Jumlah</th>
                <th style={{ padding: '12px', borderBottom: '2px solid var(--simprok-engineering-blue-200)', width: '80px', textAlign: 'center' }}>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={index} style={{ borderBottom: '1px solid var(--simprok-engineering-blue-100)' }}>
                  <td style={{ padding: '8px' }}>
                    <input type="text" value={item.wbsCode} onChange={(e) => handleChangeItem(index, 'wbsCode', e.target.value)} required style={{ width: '100%', padding: '6px' }} />
                  </td>
                  <td style={{ padding: '8px' }}>
                    <input type="text" value={item.name} onChange={(e) => handleChangeItem(index, 'name', e.target.value)} required style={{ width: '100%', padding: '6px' }} />
                  </td>
                  <td style={{ padding: '8px' }}>
                    <input type="number" step="any" value={item.quantity} onChange={(e) => handleChangeItem(index, 'quantity', e.target.value)} required style={{ width: '100%', padding: '6px', textAlign: 'right' }} />
                  </td>
                  <td style={{ padding: '8px' }}>
                    <input type="text" value={item.unit} onChange={(e) => handleChangeItem(index, 'unit', e.target.value)} required style={{ width: '100%', padding: '6px' }} />
                  </td>
                  <td style={{ padding: '8px' }}>
                    <input type="number" step="any" value={item.unitPrice} onChange={(e) => handleChangeItem(index, 'unitPrice', e.target.value)} required style={{ width: '100%', padding: '6px', textAlign: 'right' }} />
                  </td>
                  <td style={{ padding: '8px', textAlign: 'right', fontWeight: 'bold', color: 'var(--simprok-engineering-blue-800)' }}>
                    Rp {rowTotals[index].toLocaleString()}
                  </td>
                  <td style={{ padding: '8px', textAlign: 'center' }}>
                    <button type="button" onClick={() => handleRemoveItem(index)} disabled={items.length <= 1} style={{ padding: '6px', backgroundColor: items.length <= 1 ? '#ccc' : 'var(--simprok-critical-red-100)', color: items.length <= 1 ? '#666' : 'var(--simprok-critical-red-600)', border: 'none', borderRadius: '4px', cursor: items.length <= 1 ? 'not-allowed' : 'pointer' }}>
                      Hapus
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-4)', backgroundColor: 'var(--simprok-engineering-blue-50)', borderRadius: 'var(--radius-md)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--text-lg)', fontWeight: 'bold', color: 'var(--simprok-engineering-blue-900)' }}>Total Estimasi:</span>
          <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 'bold', color: 'var(--simprok-engineering-blue-800)' }}>
            Rp {totalEstimasi.toLocaleString()}
          </span>
        </div>

        <button type="submit" disabled={submitting} style={{ marginTop: 'var(--space-6)', padding: '16px', fontSize: 'var(--text-lg)', fontWeight: 'bold', backgroundColor: 'var(--simprok-engineering-blue-900)', color: 'white', border: 'none', borderRadius: '8px', cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
          {submitting ? 'Menyimpan...' : 'Simpan & Aktifkan Baseline'}
        </button>
      </form>
    </div>
  );
}
