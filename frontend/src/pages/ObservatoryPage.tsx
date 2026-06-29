import { useEffect, useState } from 'react';
import { ExecutiveHaiku } from '../components/molecules/ExecutiveHaiku';
import { ProjectCard } from '../components/organisms/ProjectCard';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export function ObservatoryPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const { token, activeWorkspaceId } = useAuth();

  useEffect(() => {
    if (!token || !activeWorkspaceId) return;

    setLoading(true);
    setError(null);
    
    fetch('http://localhost:3000/projects', {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-workspace-id': activeWorkspaceId,
      }
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch projects');
        return res.json();
      })
      .then(data => {
        setProjects(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to fetch projects:', err);
        setError('Unable to load projects');
        setLoading(false);
      });
  }, [token, activeWorkspaceId]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      
      {/* DNA-03: Executive Haiku — Only shows when evidence is verified */}
      <ExecutiveHaiku 
        text="Portfolio intelligence engine is not yet activated. Project list reflects live database records. Navigate to a War Room to observe verified project reality."
        certaintyLevel="C4"
      />

      {/* PORTFOLIO DOORS: Entry points to War Rooms */}
      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
          <h3 style={{ fontSize: 'var(--text-lg)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
            Active Projects Portfolio
          </h3>
          <button 
            onClick={() => navigate('/project/new')}
            style={{ padding: '8px 16px', backgroundColor: 'var(--simprok-bright-sky-blue-600)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
            + Start New Project
          </button>
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
