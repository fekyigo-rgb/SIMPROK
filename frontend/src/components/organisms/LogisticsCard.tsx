import { CertaintyBadge } from '../atoms/CertaintyBadge';
import { NumericFact } from '../atoms/NumericFact';

interface LogisticsCardProps {
  contractId: string;
  contractorName: string;
  originalContractValue: number;
  currentContractValue: number; // Termasuk adendum
  executionStatus: 'PENDING_PO' | 'EXECUTED' | 'DISBURSED';
  lastDisbursementDate?: string;
}

export function LogisticsCard({
  contractId,
  contractorName,
  originalContractValue,
  currentContractValue,
  executionStatus,
  lastDisbursementDate
}: LogisticsCardProps) {

  const isExecuted = executionStatus === 'EXECUTED' || executionStatus === 'DISBURSED';
  const isPending = executionStatus === 'PENDING_PO';
  const certainty = isExecuted ? 'C5' : 'C2';

  return (
    <div className="simprok-fact-card" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: 'var(--space-4)',
      borderTop: isExecuted ? '4px solid var(--simprok-success-green-600)' : '4px dashed var(--simprok-engineering-blue-200)',
      backgroundColor: 'var(--simprok-white)'
    }}>
      
      {/* Header: Contract Identity */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--simprok-engineering-blue-100)', paddingBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)', fontFamily: 'var(--font-mono)' }}>
            {contractId}
          </span>
          <h3 style={{ fontSize: 'var(--text-lg)', color: 'var(--simprok-engineering-blue-900)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>
            {contractorName}
          </h3>
        </div>
        <CertaintyBadge level={certainty} />
      </div>

      {/* Body: Financial Reality */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Original Value</span>
          <NumericFact value={originalContractValue} prefix="Rp " certaintyLevel="C5" size="sm" />
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', paddingLeft: 'var(--space-4)', borderLeft: '1px solid var(--simprok-engineering-blue-100)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Current Value (Inc. Addendums)</span>
          <NumericFact value={currentContractValue} prefix="Rp " certaintyLevel="C5" size="md" />
        </div>
      </div>

      {/* Footer: Execution Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--simprok-engineering-blue-100)' }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Logistics Status</span>
          <span style={{ 
            fontSize: 'var(--text-sm)', 
            fontWeight: 'var(--weight-bold)',
            color: isPending ? 'var(--simprok-engineering-blue-600)' : 'var(--simprok-success-green-600)'
          }}>
            {executionStatus.replace('_', ' ')}
          </span>
        </div>
        
        {lastDisbursementDate && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Last Disbursement</span>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-900)', fontFamily: 'var(--font-mono)' }}>
              {lastDisbursementDate}
            </span>
          </div>
        )}
      </div>

    </div>
  );
}
