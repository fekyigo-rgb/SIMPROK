import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export function ProjectWorkPage() {
  const { projectId } = useParams();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token || !projectId) return;

    fetch(`http://localhost:3000/projects/${projectId}/boq`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(data => {
        setItems(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch BOQ:', err);
        setItems([]);
        setLoading(false);
      });
  }, [token, projectId]);

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <button 
        onClick={() => navigate('/field')}
        style={{ background: 'none', border: 'none', color: 'var(--simprok-engineering-blue-600)', cursor: 'pointer', padding: 0, marginBottom: 'var(--space-4)', fontSize: 'var(--text-base)' }}
      >
        &larr; Kembali ke Daftar Proyek
      </button>
      
      <h2 style={{ fontSize: 'var(--text-2xl)', color: 'var(--simprok-engineering-blue-900)', marginBottom: 'var(--space-6)' }}>Daftar Pekerjaan</h2>
      
      {loading ? (
        <p>Memuat daftar pekerjaan...</p>
      ) : items.length === 0 ? (
        <p>Tidak ada pekerjaan (BOQ) yang ditemukan untuk proyek ini. Pastikan RAB Baseline sudah aktif.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {items.map(item => (
            <div 
              key={item.id}
              onClick={() => navigate(`/field/project/${projectId}/progress/${item.id}`)}
              style={{
                backgroundColor: 'white',
                padding: 'var(--space-6)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--simprok-engineering-blue-200)',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-600)', backgroundColor: 'var(--simprok-surface-light)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
                    WBS: {item.wbsCode}
                  </span>
                  <h3 style={{ margin: 'var(--space-2) 0 0 0', color: 'var(--simprok-engineering-blue-900)' }}>{item.name}</h3>
                </div>
              </div>
              <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-6)', fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)' }}>
                <div>
                  <strong>Target:</strong> {item.quantity} {item.unit}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
