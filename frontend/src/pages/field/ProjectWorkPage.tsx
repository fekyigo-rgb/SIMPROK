/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../utils/apiClient';

type ErrorKind = 'unauthorized' | 'forbidden' | 'not-found' | 'workspace' | 'server' | 'network' | null;

export function ProjectWorkPage() {
  const { projectId } = useParams();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const { token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token || !projectId) return;

    apiFetch(`http://localhost:3000/projects/${projectId}/boq`)
      .then(res => {
        if (!res.ok) {
          setErrorStatus(res.status);
          if (res.status === 401) setErrorKind('unauthorized');
          else if (res.status === 403) setErrorKind('forbidden');
          else if (res.status === 404) setErrorKind('not-found');
          else if (res.status === 400) setErrorKind('workspace');
          else setErrorKind('server');
          setLoading(false);
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (data === null) return;
        setItems(Array.isArray(data) ? data : (data.items || []));
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch BOQ:', err);
        setErrorKind('network');
        setItems([]);
        setLoading(false);
      });
  }, [token, projectId]);

  let errorMessage = '';
  if (errorKind === 'unauthorized') errorMessage = 'Sesi Anda telah berakhir atau tidak valid. Silakan login kembali.';
  else if (errorKind === 'forbidden') errorMessage = 'Anda tidak memiliki akses ke proyek ini.';
  else if (errorKind === 'not-found') errorMessage = 'Proyek tidak ditemukan.';
  else if (errorKind === 'workspace') errorMessage = 'Konteks workspace belum valid. Pilih workspace kembali.';
  else if (errorKind === 'server' || errorKind === 'network') errorMessage = 'Data pekerjaan gagal dimuat. Coba lagi beberapa saat.';

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
      ) : errorKind ? (
        <div style={{ padding: 'var(--space-6)', backgroundColor: '#FEE2E2', color: '#991B1B', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ margin: '0 0 var(--space-2) 0' }}>Akses Ditolak ({errorStatus || 'Network'})</h3>
          <p style={{ margin: 0 }}>{errorMessage}</p>
        </div>
      ) : items.length === 0 ? (
        <p>Tidak ada pekerjaan (BOQ) yang ditemukan untuk proyek ini. Pastikan RAB Baseline sudah aktif.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {items.filter(item => item.itemType === 'WORK_ITEM').map(item => (
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
