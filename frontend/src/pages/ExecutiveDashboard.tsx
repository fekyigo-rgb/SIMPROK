import { ProjectCard } from '../components/organisms/ProjectCard';
import { ExecutiveHaiku } from '../components/molecules/ExecutiveHaiku';

export function ExecutiveDashboard() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
      
      {/* DNA-03: Executive Haiku — The Light before the data */}
      <ExecutiveHaiku 
        text="Physical progress is steady at 45%, but a 60-day owner payment delay is creating severe liquidity friction for subcontractors."
        certaintyLevel="C3"
      />

      {/* The Window (ProjectCard) */}
      <section>
        <h3 style={{ fontSize: 'var(--text-lg)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-4)' }}>
          Project Ground Truth
        </h3>
        <ProjectCard 
          projectName="Jakarta-Bandung High Speed Rail Foundation"
          projectCode="PRJ-HSR-2026"
          projectManager="Budi Santoso, ST."
        />
      </section>

    </div>
  );
}

