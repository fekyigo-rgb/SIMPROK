import { CertaintyBadge } from '../components/atoms/CertaintyBadge';
import { RiskIndicator } from '../components/atoms/RiskIndicator';
import { GloryAccent } from '../components/atoms/GloryAccent';
import { Button } from '../components/atoms/Button';
import { NumericFact } from '../components/atoms/NumericFact';

import { FactHeader } from '../components/molecules/FactHeader';
import { InsightHeader } from '../components/molecules/InsightHeader';
import { DeviationSignal } from '../components/molecules/DeviationSignal';

import { ProgressCard } from '../components/organisms/ProgressCard';
import { RiskCard } from '../components/organisms/RiskCard';
import { ForecastCard } from '../components/organisms/ForecastCard';
import { ApprovalCard } from '../components/organisms/ApprovalCard';
import { RecommendationCard } from '../components/organisms/RecommendationCard';
import { ProjectCard } from '../components/organisms/ProjectCard';

export function ShowcasePage() {
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ marginBottom: 'var(--space-12)' }}>
        <h1 style={{ fontSize: 'var(--text-4xl)', fontWeight: 'var(--weight-bold)', marginBottom: 'var(--space-2)' }}>
          SIMPROK Design System Showcase
        </h1>
        <p style={{ color: 'var(--simprok-engineering-blue-700)', fontSize: 'var(--text-lg)' }}>
          COMPONENT MUSEUM
        </p>
      </header>

      <section style={{ marginBottom: 'var(--space-12)' }}>
        <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-6)' }}>
          1. Atom: CertaintyBadge
        </h2>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <CertaintyBadge level="C0" />
          <CertaintyBadge level="C1" />
          <CertaintyBadge level="C2" />
          <CertaintyBadge level="C3" />
          <CertaintyBadge level="C4" />
          <CertaintyBadge level="C5" />
        </div>
      </section>

      <section style={{ marginBottom: 'var(--space-12)' }}>
        <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-6)' }}>
          2. Atom: RiskIndicator
        </h2>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          <RiskIndicator severity="LOW" message="Minor variance detected" />
          <RiskIndicator severity="MEDIUM" message="Schedule slipping by 2 days" />
          <RiskIndicator severity="HIGH" message="Budget overrun threshold approaching" />
          <RiskIndicator severity="CRITICAL" message="Critical Path Blocked" />
        </div>
      </section>

      <section style={{ marginBottom: 'var(--space-12)' }}>
        <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-6)' }}>
          3. Atom: GloryAccent
        </h2>
        <div style={{ display: 'flex', gap: 'var(--space-4)', flexDirection: 'column' }}>
          <div className="simprok-insight-card">
            <GloryAccent label="Recommendation">
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-900)' }}>
                Substitute specified material with equivalent local alternative to recover 4 days.
              </p>
            </GloryAccent>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 'var(--space-12)' }}>
        <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-6)' }}>
          4. Atom: Button
        </h2>
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
          <Button variant="primary">Approve Recommendation</Button>
          <Button variant="secondary">Request Alternatives</Button>
          <Button variant="override">Override (Manual Entry)</Button>
        </div>
      </section>

      <section style={{ marginBottom: 'var(--space-12)' }}>
        <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-6)' }}>
          5. Atom: NumericFact
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="simprok-fact-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Project Baseline Budget</span>
            <NumericFact value="15.000.000.000" prefix="Rp " certaintyLevel="C5" size="lg" />
          </div>
          <div className="simprok-fact-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Estimated Cost to Complete</span>
            <NumericFact value="2.500.000.000" prefix="Rp " certaintyLevel="C1" size="lg" />
          </div>
        </div>
      </section>

      <section style={{ marginBottom: 'var(--space-12)' }}>
        <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-6)', marginTop: 'var(--space-12)', borderTop: '2px solid var(--simprok-engineering-blue-200)', paddingTop: 'var(--space-6)' }}>
          PHASE B: MOLECULES
        </h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-8)' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-medium)' }}>FactHeader (RULE-MOL-001)</h3>
            <div className="simprok-fact-card">
              <FactHeader 
                label="Baseline Budget" 
                value="25.000.000.000" 
                prefix="Rp " 
                certaintyLevel="C5" 
              />
            </div>
            <div className="simprok-fact-card">
              <FactHeader 
                label="Schedule Performance Index" 
                value="0.92" 
                certaintyLevel="C3" 
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-medium)' }}>InsightHeader (RULE-MOL-002)</h3>
            <div className="simprok-insight-card">
              <InsightHeader 
                label="AI Recommendation" 
                title="Accelerate Zone B Foundation" 
                description="Simulations show a 68% probability of recovering 5 days of critical path delay."
              />
            </div>
          </div>

        </div>

        <div style={{ marginTop: 'var(--space-8)' }}>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-medium)', marginBottom: 'var(--space-6)' }}>DeviationSignal (RULE-MOL-003)</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
            <DeviationSignal 
              label="Concrete Pouring Volume" 
              plannedValue={1200} 
              actualValue={1150} 
              unit=" m3" 
            />
            <DeviationSignal 
              label="Accident Rate" 
              plannedValue={0} 
              actualValue={1} 
              lowerIsBetter={true} 
            />
          </div>


        </div>

      </section>

      <section style={{ marginBottom: 'var(--space-12)' }}>
        <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-6)', marginTop: 'var(--space-12)', borderTop: '2px solid var(--simprok-engineering-blue-200)', paddingTop: 'var(--space-6)' }}>
          PHASE C: ORGANISMS
        </h2>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 500px)', gap: 'var(--space-8)' }}>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-medium)' }}>ProgressCard</h3>
            <ProgressCard 
              itemName="Foundation & Substructure"
              itemCode="WBS-1.2.0"
              weight={15.4}
              plannedProgress={12.0}
              actualProgress={10.5}
              plannedCost={1500000000}
              actualCost={1650000000}
              certaintyLevel="C3"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-medium)' }}>RiskCard</h3>
            <RiskCard 
              title="Supply Chain Disruption (Steel)"
              category="Material Procurement"
              trigger="Port strike delaying shipment of high-tensile steel by 14 days."
              probability={75}
              impact={850000000}
              severity="CRITICAL"
              status="ACTIVE"
              owner="Logistics Dept."
              detectionDate="2026-06-18"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-medium)' }}>ForecastCard</h3>
            <ForecastCard 
              title="If current SPI (0.85) continues"
              scenarioDescription="Linear projection based on the last 30 days of performance without intervention."
              eac={27500000000}
              etc={12500000000}
              projectedFinishDate="2027-03-15"
              confidencePercentage={82}
              certaintyLevel="C2"
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-medium)' }}>ApprovalCard (Decision Record)</h3>
            <ApprovalCard 
              approverName="Ir. Hendra Kusuma, MT"
              position="Project Director"
              authorityLevel="Level 1 Authority"
              status="APPROVED"
              approvalDate="2026-06-19 14:30:00"
              notes="Approved with the condition that QA reports are submitted daily for the next 7 days."
              decisionRecordId="AUTH-202606-889"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-medium)' }}>ApprovalCard (Action Required)</h3>
            <ApprovalCard 
              approverName="You"
              position="Chief Executive"
              authorityLevel="Executive Authority"
              status="PENDING"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', gridColumn: '1 / -1' }}>
            <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-medium)' }}>RecommendationCard</h3>
            <div style={{ maxWidth: '600px' }}>
              <RecommendationCard 
                realityStatement="Critical Path activity 'Foundation Pouring' is delayed by 5 days. Current SPI is 0.85."
                understandingStatement="Delay caused by 3 days of unexpected heavy rain and 2 days of logistics failure for cement delivery."
                options={[
                  {
                    id: 'opt1',
                    title: 'Accelerate with Night Shift (Concrete Team)',
                    impactDescription: 'Recovers 4 days. Estimated cost increase: Rp 125,000,000. Probability of success: 85%.',
                    isPrimary: true
                  },
                  {
                    id: 'opt2',
                    title: 'Change Material to Pre-cast Concrete',
                    impactDescription: 'Recovers 5 days. Estimated cost increase: Rp 350,000,000. Requires Level 2 Design Approval.',
                    isPrimary: false
                  }
                ]}
              />
            </div>
          </div>

        </div>

      </section>

      <section style={{ marginBottom: 'var(--space-12)' }}>
        <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-6)', marginTop: 'var(--space-12)', borderTop: '2px solid var(--simprok-engineering-blue-200)', paddingTop: 'var(--space-6)' }}>
          PHASE C (FINAL): PROJECT CARD (GRAMMAR AGGREGATOR)
        </h2>
        
        <ProjectCard 
          projectName="Jakarta-Bandung High Speed Rail Foundation"
          projectCode="PRJ-HSR-2026"
          projectManager="Budi Santoso, ST."
        />

      </section>

    </div>
  );
}
