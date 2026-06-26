import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export function SubmitProgressPage() {
  const { projectId, boqItemId } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  
  const [quantity, setQuantity] = useState('');
  const [workDate, setWorkDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [boqItem, setBoqItem] = useState<any>(null);

  useEffect(() => {
    if (!token || !projectId || !boqItemId) return;
    fetch(`http://localhost:3000/projects/${projectId}/boq`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        if (data && data.items) {
          const item = data.items.find((i: any) => i.id === boqItemId);
          setBoqItem(item);
        }
      })
      .catch(err => console.error(err));
  }, [token, projectId, boqItemId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quantity || !workDate) {
      alert('Volume dan Tanggal wajib diisi!');
      return;
    }

    setSubmitting(true);
    
    const payload = {
      projectId,
      entries: [
        {
          boqItemId,
          installedQuantity: parseFloat(quantity),
          workDate,
          notes: notes || undefined,
          photoUrl: photoUrl || undefined
        }
      ]
    };

    try {
      const res = await fetch(`http://localhost:3000/projects/${projectId}/progress/field`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.message || 'Gagal mengirim progress');
      }

      alert('Progress berhasil dikirim ke SIMPROK!');
      navigate(`/field/project/${projectId}`);
    } catch (err: any) {
      alert(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: 'white', padding: 'var(--space-8)', borderRadius: 'var(--radius-lg)', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
      <button 
        onClick={() => navigate(`/field/project/${projectId}`)}
        style={{ background: 'none', border: 'none', color: 'var(--simprok-engineering-blue-600)', cursor: 'pointer', padding: 0, marginBottom: 'var(--space-6)', fontSize: 'var(--text-base)' }}
      >
        &larr; Kembali
      </button>

      <h2 style={{ fontSize: 'var(--text-2xl)', color: 'var(--simprok-engineering-blue-900)', marginBottom: 'var(--space-6)' }}>Lapor Progress Harian</h2>

      {boqItem && (
        <div style={{ marginBottom: 'var(--space-6)', padding: 'var(--space-4)', backgroundColor: 'var(--simprok-engineering-blue-50)', borderLeft: '4px solid var(--simprok-engineering-blue-500)', borderRadius: '4px' }}>
          <h3 style={{ margin: '0 0 8px 0', color: 'var(--simprok-engineering-blue-900)', fontSize: 'var(--text-lg)' }}>
            {boqItem.wbsCode} - {boqItem.name}
          </h3>
          <div style={{ display: 'flex', gap: '16px', color: 'var(--simprok-engineering-blue-700)', fontSize: 'var(--text-sm)' }}>
            <div><strong>Target:</strong> {boqItem.quantity} {boqItem.unit}</div>
            <div><strong>Satuan:</strong> {boqItem.unit}</div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
        <div>
          <label style={{ display: 'block', marginBottom: 'var(--space-2)', fontWeight: 'var(--weight-medium)', color: 'var(--simprok-engineering-blue-900)' }}>
            Tanggal Pekerjaan
          </label>
          <input 
            type="date" 
            value={workDate}
            onChange={(e) => setWorkDate(e.target.value)}
            style={{ width: '100%', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--simprok-engineering-blue-200)', fontSize: 'var(--text-base)' }}
            required
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 'var(--space-2)', fontWeight: 'var(--weight-medium)', color: 'var(--simprok-engineering-blue-900)' }}>
            Volume Aktual (Selesai)
          </label>
          <input 
            type="number" 
            step="0.01"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="Contoh: 15.5"
            style={{ width: '100%', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--simprok-engineering-blue-200)', fontSize: 'var(--text-base)' }}
            required
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 'var(--space-2)', fontWeight: 'var(--weight-medium)', color: 'var(--simprok-engineering-blue-900)' }}>
            Catatan Lapangan
          </label>
          <textarea 
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Kondisi cuaca, kendala, atau keterangan tambahan..."
            rows={4}
            style={{ width: '100%', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--simprok-engineering-blue-200)', fontSize: 'var(--text-base)', resize: 'vertical' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 'var(--space-2)', fontWeight: 'var(--weight-medium)', color: 'var(--simprok-engineering-blue-900)' }}>
            Bukti Foto (URL)
          </label>
          <input 
            type="url" 
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="https://example.com/photo.jpg"
            style={{ width: '100%', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--simprok-engineering-blue-200)', fontSize: 'var(--text-base)' }}
          />
          <p style={{ margin: 'var(--space-1) 0 0 0', fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-600)' }}>
            *Untuk sementara gunakan link URL gambar. Integrasi kamera menyusul.
          </p>
        </div>

        <button 
          type="submit" 
          disabled={submitting}
          style={{ 
            marginTop: 'var(--space-4)',
            padding: 'var(--space-4)', 
            backgroundColor: 'var(--simprok-engineering-blue-600)', 
            color: 'white', 
            border: 'none', 
            borderRadius: 'var(--radius-md)', 
            fontSize: 'var(--text-lg)',
            fontWeight: 'var(--weight-semibold)',
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.7 : 1
          }}
        >
          {submitting ? 'Mengirim...' : 'Kirim Laporan'}
        </button>
      </form>
    </div>
  );
}
