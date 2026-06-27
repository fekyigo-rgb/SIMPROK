import { Button } from '../atoms/Button';

interface ApprovalCardProps {
  approverName: string;
  position: string;
  authorityLevel: string; // e.g., 'Level 1: Executive', 'Level 2: Director'
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  approvalDate?: string;
  notes?: string;
  decisionRecordId?: string;
}

export function ApprovalCard({
  approverName,
  position,
  authorityLevel,
  status,
  approvalDate,
  notes,
  decisionRecordId
}: ApprovalCardProps) {
  
  const isApproved = status === 'APPROVED';
  const isPending = status === 'PENDING';
  const isRejected = status === 'REJECTED';

  return (
    <div className={`simprok-authority-card${isPending ? ' simprok-authority-card--pending' : ''}${isApproved ? ' simprok-authority-card--approved' : ''}${isRejected ? ' simprok-authority-card--rejected' : ''}`} style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: 'var(--space-4)'
    }}>
      {/* Header: Status and Authority Level */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--simprok-engineering-blue-100)', paddingBottom: 'var(--space-3)' }}>
        <span style={{ 
          fontSize: 'var(--text-xs)', 
          fontWeight: 'var(--weight-bold)', 
          letterSpacing: '0.05em', 
          color: isApproved ? 'var(--simprok-success-green-600)' : isRejected ? 'var(--simprok-critical-red-600)' : 'var(--simprok-engineering-blue-700)',
          textTransform: 'uppercase'
        }}>
          {status}
        </span>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)', fontFamily: 'var(--font-mono)' }}>
          {authorityLevel}
        </span>
      </div>

      {/* Body: Human Accountability */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <h4 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-bold)', color: 'var(--simprok-engineering-blue-900)', margin: 0 }}>
          {approverName}
        </h4>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-800)', fontWeight: 'var(--weight-medium)' }}>
          {position}
        </span>
        
        {notes && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-700)', fontStyle: 'italic', marginTop: 'var(--space-2)', paddingLeft: 'var(--space-3)', borderLeft: '2px solid var(--simprok-engineering-blue-200)' }}>
            "{notes}"
          </p>
        )}
      </div>

      {/* Footer: Date, Record ID, and Actions if Pending */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--simprok-engineering-blue-100)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          {approvalDate ? (
            <>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Decision Date</span>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--simprok-engineering-blue-900)', fontFamily: 'var(--font-mono)' }}>{approvalDate}</span>
            </>
          ) : (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)' }}>Awaiting Decision</span>
          )}
          {decisionRecordId && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--simprok-engineering-blue-700)', fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
              Record ID: {decisionRecordId}
            </span>
          )}
        </div>

        {isPending && (
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="secondary">Reject</Button>
            <Button variant="primary">Approve</Button>
          </div>
        )}
      </div>
    </div>
  );
}
