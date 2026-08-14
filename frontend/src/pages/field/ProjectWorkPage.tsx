/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../utils/apiClient';

type ErrorKind = 'unauthorized' | 'forbidden' | 'not-found' | 'workspace' | 'server' | 'network' | null;

export function ProjectWorkPage() {
  const { projectId } = useParams();
  const [monitoringData, setMonitoringData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>(null);
  const { token } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token || !projectId) return;

    apiFetch(`http://localhost:3000/progress/monitoring/${projectId}`)
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
        setMonitoringData(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch BOQ:', err);
        setErrorKind('network');
        setMonitoringData(null);
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
        <p>Memuat monitoring...</p>
      ) : errorKind ? (
        <div style={{ padding: 'var(--space-6)', backgroundColor: '#FEE2E2', color: '#991B1B', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ margin: '0 0 var(--space-2) 0' }}>Akses Ditolak ({errorStatus || 'Network'})</h3>
          <p style={{ margin: 0 }}>{errorMessage}</p>
        </div>
      ) : !monitoringData?.baseline ? (
        <div style={{ padding: 'var(--space-6)', backgroundColor: '#FEF3C7', color: '#92400E', borderRadius: 'var(--radius-lg)' }}>
          <h3 style={{ margin: '0 0 var(--space-2) 0' }}>Baseline Tidak Ditemukan</h3>
          <p style={{ margin: 0 }}>Tidak ada RAB Baseline yang aktif untuk proyek ini. Data tidak tersedia.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

          <div style={{ backgroundColor: '#F0F9FF', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid #BAE6FD' }}>
            <h3 style={{ margin: '0 0 var(--space-2) 0', color: '#0369A1', fontSize: 'var(--text-sm)' }}>Status Baseline Proyek</h3>
            <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', color: '#0C4A6E', fontSize: 'var(--text-sm)' }}>
              <li><strong>RAB Version:</strong> {monitoringData.baseline.versionNumber}</li>
              {monitoringData.unavailable?.includes('plannedStart') && <li><strong>Mulai:</strong> <em>UNAVAILABLE</em></li>}
              {monitoringData.unavailable?.includes('plannedFinish') && <li><strong>Selesai:</strong> <em>UNAVAILABLE</em></li>}
            </ul>
          </div>

          {(monitoringData.items || []).filter((item: any) => item.itemType === 'WORK_ITEM').map((item: any) => (
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
                <div style={{ flex: 1, backgroundColor: 'var(--simprok-surface-light)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--simprok-engineering-blue-500)', marginBottom: '4px' }}>Rencana (Baseline)</div>
                  <strong>{item.planned?.quantity} {item.planned?.unit}</strong>
                </div>
                <div style={{ flex: 1, backgroundColor: item.actual?.state === 'RECORDED' ? '#ECFCCB' : '#FEF2F2', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: item.actual?.state === 'RECORDED' ? '#4D7C0F' : '#B91C1C', marginBottom: '4px' }}>Realisasi (Actual)</div>
                  {item.actual?.state === 'RECORDED' ? (
                    <strong style={{ color: '#3F6212' }}>{item.actual.latestRecord?.installedQuantity} {item.planned?.unit}</strong>
                  ) : (
                    <em style={{ color: '#991B1B' }}>NOT YET RECORDED</em>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
