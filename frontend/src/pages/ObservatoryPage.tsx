import { useEffect, useState } from 'react';
import { ProjectCard } from '../components/organisms/ProjectCard';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../utils/apiClient';

export function ObservatoryPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const { token, activeWorkspaceId, activeRoles } = useAuth();

  useEffect(() => {
    if (!token || !activeWorkspaceId) return;

    setLoading(true);
    setError(null);
    
    apiFetch('http://localhost:3000/projects')
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
        setLoading(false);
      });
  }, [token, activeWorkspaceId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      
      {/* Welcome Greeting */}
      <div style={{ backgroundColor: 'var(--simprok-bright-sky-blue-50)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--simprok-bright-sky-blue-200)' }}>
        <p style={{ margin: 0, color: 'var(--simprok-engineering-blue-900)', fontSize: 'var(--text-md)', fontWeight: 'var(--weight-medium)' }}>
          Selamat datang. Pilih ruang kerja yang ingin Anda lanjutkan.
        </p>
      </div>

      {/* PORTFOLIO DOORS: Entry points to War Rooms */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h3 style={{ fontSize: 'var(--text-lg)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
            Ikhtisar Proyek
          </h3>
          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            <button 
              onClick={() => navigate('/field')}
              style={{ padding: '8px 16px', backgroundColor: 'var(--simprok-engineering-blue-100)', color: 'var(--simprok-engineering-blue-900)', border: '1px solid var(--simprok-engineering-blue-300)', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
              Pantau / Lapor Progress
            </button>
            {activeRoles.some(r => ['DIRECTOR', 'OWNER'].includes(r)) && (
              <button 
                onClick={() => navigate('/project/new')}
                style={{ padding: '8px 16px', backgroundColor: 'var(--simprok-bright-sky-blue-600)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                + Buat RAB Baru
              </button>
            )}
          </div>
        </div>
        
        {loading ? (
          <p>Loading portfolio intelligence...</p>
        ) : error ? (
          <p>{error}</p>
        ) : projects.length === 0 ? (
          <p>No active projects found. The database is empty.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 'var(--space-4)' }}>
            {projects.map(p => (
              <ProjectCard 
                key={p.id}
                id={p.id}
                projectCode={p.code}
                projectName={p.name}
                projectManager="System Assigned" // Will be fetched from RBAC later
                status={p.status || 'HEALTHY'} // Fallback
              />
            ))}
          </div>
        )}
      </section>

    </div>
  );
}
