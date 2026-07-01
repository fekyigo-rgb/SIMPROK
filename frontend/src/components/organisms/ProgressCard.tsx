import { FactHeader } from '../molecules/FactHeader';
import { DeviationSignal } from '../molecules/DeviationSignal';

interface ProgressCardProps {
  itemName: string;
  itemCode: string;
  weight: number;
  plannedProgress: number | null; // Percentage
  actualProgress: number; // Percentage
  plannedCost: number;
  actualCost: number;
  actualCostRecorded?: boolean; // If false: field has not submitted actual cost
  certaintyLevel?: 'C0' | 'C1' | 'C2' | 'C3' | 'C4' | 'C5';
}

export function ProgressCard({
  itemName,
  itemCode,
  weight,
  plannedProgress,
  actualProgress,
  plannedCost,
  actualCost,
  actualCostRecorded = true,
  certaintyLevel = 'C3'
}: ProgressCardProps) {
  return (
    <div className="simprok-fact-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Structural Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--simprok-engineering-blue-100)', paddingBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)', fontFamily: 'var(--font-mono)' }}>{itemCode}</span>
          <h3 style={{ fontSize: 'var(--text-lg)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>{itemName}</h3>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Weight</span>
          <span className="simprok-numeric certainty-c5" style={{ fontSize: 'var(--text-sm)' }}>{weight.toFixed(2)}%</span>
        </div>
      </div>

      {/* Progress Measurement */}
      <DeviationSignal 
        label="Schedule Measurement"
        plannedValue={plannedProgress}
        actualValue={actualProgress}
        unit="%"
        lowerIsBetter={false}
      />

      {/* Financial Measurement */}
      {actualCostRecorded ? (
        <DeviationSignal 
          label="Cost Measurement"
          plannedValue={plannedCost}
          actualValue={actualCost}
          lowerIsBetter={true}
        />
      ) : (
        <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--simprok-engineering-blue-50)', borderRadius: 'var(--radius-sm)', border: '1px dashed var(--simprok-engineering-blue-300)' }}>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-bold)', color: 'var(--simprok-engineering-blue-700)', display: 'block', marginBottom: '4px' }}>COST MEASUREMENT</span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-500)', fontStyle: 'italic' }}>⚠ NOT RECORDED — Awaiting Field Input</span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-400)', display: 'block', marginTop: '2px' }}>Planned: {plannedCost.toLocaleString()}</span>
        </div>
      )}

      {/* Overall Assessment Fact */}
      <div style={{ paddingTop: 'var(--space-4)', borderTop: '1px solid var(--simprok-engineering-blue-100)' }}>
        <FactHeader 
          label="Measurement Certainty"
          value={actualProgress.toFixed(2)}
          suffix="%"
          certaintyLevel={certaintyLevel}
        />
      </div>
    </div>
  );
}
