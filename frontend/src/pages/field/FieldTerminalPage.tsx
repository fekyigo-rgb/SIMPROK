/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../utils/apiClient';

export function FieldTerminalPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { token, activeWorkspaceId } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token || !activeWorkspaceId) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    apiFetch(`http://localhost:3000/projects/workspace/${activeWorkspaceId}`)
      .then(res => {
        if (!res.ok) {
          const status = res.status;
          let msg = 'Data gagal dimuat. Coba lagi beberapa saat.';
          if (status === 401) msg = 'Sesi Anda telah berakhir atau tidak valid. Silakan login kembali.';
          else if (status === 403) msg = 'Anda tidak memiliki akses untuk membuka data ini.';
          else if (status === 400) msg = 'Konteks workspace atau permintaan belum valid. Pilih workspace kembali.';
          else if (status === 404) msg = 'Data tidak ditemukan.';
          throw new Error(msg);
        }
        return res.json();
      })
      .then(data => {
        setProjects(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch projects:', err);
        setError(err.message || 'Data gagal dimuat. Coba lagi beberapa saat.');
        setProjects([]);
        setLoading(false);
      });
  }, [token, activeWorkspaceId]);

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-2xl)', color: 'var(--simprok-engineering-blue-900)', margin: 0 }}>Pilih Proyek</h2>
        <button 
          onClick={() => navigate('/')}
          style={{ background: 'none', border: '1px solid var(--simprok-engineering-blue-200)', borderRadius: '4px', padding: '6px 12px', color: 'var(--simprok-engineering-blue-700)', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
          ← Return to Workspace
        </button>
      </div>
      
      {loading ? (
        <p>Memuat daftar proyek...</p>
      ) : error ? (
        <p>{error}</p>
      ) : projects.length === 0 ? (
        <p>Tidak ada proyek yang ditugaskan kepada Anda.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {projects.map(p => (
            <div 
              key={p.id}
              onClick={() => navigate(`/field/project/${p.id}`)}
              style={{
                backgroundColor: 'white',
                padding: 'var(--space-6)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--simprok-engineering-blue-200)',
                cursor: 'pointer',
                boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
              }}
            >
              <h3 style={{ margin: '0 0 var(--space-2) 0', color: 'var(--simprok-engineering-blue-900)' }}>{p.name}</h3>
              <p style={{ margin: 0, color: 'var(--simprok-engineering-blue-700)', fontSize: 'var(--text-sm)' }}>Kode: {p.code}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
