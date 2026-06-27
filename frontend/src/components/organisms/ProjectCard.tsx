import { useNavigate } from 'react-router-dom';

interface ProjectCardProps {
  id: string;
  projectName: string;
  projectCode: string;
  projectManager: string;
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
}

export function ProjectCard({
  id,
  projectName,
  projectCode,
  projectManager,
  status
}: ProjectCardProps) {
  const navigate = useNavigate();

  let borderColor = 'var(--simprok-engineering-blue-200)';
  let accentColor = 'var(--simprok-engineering-blue-500)';
  
  if (status === 'CRITICAL') {
    borderColor = 'var(--simprok-critical-red-600)';
    accentColor = 'var(--simprok-critical-red-600)';
  } else if (status === 'HEALTHY') {
    borderColor = 'var(--simprok-engineering-blue-200)';
    accentColor = 'var(--simprok-success-green-600)';
  }

  return (
    <div 
      onClick={() => navigate(`/project/${id}`)}
      style={{ 
        backgroundColor: 'var(--simprok-white)', 
        border: `1px solid ${borderColor}`,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 'var(--radius-sm)', 
        padding: 'var(--space-4)',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        boxShadow: 'var(--elevation-1)',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = 'var(--elevation-2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--elevation-1)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)', fontFamily: 'var(--font-mono)' }}>{projectCode}</span>
        <span style={{ fontSize: 'var(--text-xs)', color: accentColor, fontWeight: 'var(--weight-bold)' }}>{status}</span>
      </div>
      <h4 style={{ fontSize: 'var(--text-base)', color: 'var(--simprok-engineering-blue-900)', margin: 0 }}>
        {projectName}
      </h4>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)' }}>
        PM: {projectManager}
      </span>
    </div>
  );
}
