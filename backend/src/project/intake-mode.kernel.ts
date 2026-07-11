export type IntakeMode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'UNRESOLVED';

export type IntakeModeFacts = {
  boqDraftWorkItemCount: number;
  boqBaselineWorkItemCount: number;
  budgetBaseline: string | number | null;
  mainMaterialSpec: string | null;
};

export type IntakeModeResult = {
  boq: {
    status: 'AVAILABLE' | 'EMPTY';
    source: 'BASELINE' | 'DRAFT' | 'NONE';
    workItemCount: number;
    reasonCode: 'BOQ_BASELINE_WORK_ITEM_PRESENT' | 'BOQ_DRAFT_WORK_ITEM_PRESENT' | 'BOQ_NO_WORK_ITEM';
  };
  specification: {
    status: 'AVAILABLE' | 'MISSING';
    reasonCode: 'SPEC_TEXT_PRESENT' | 'SPEC_ABSENT';
  };
  pagu: {
    status: 'AVAILABLE' | 'MISSING' | 'NEEDS_CONFIRMATION';
    reasonCode: 'PAGU_POSITIVE' | 'PAGU_ZERO_NEEDS_CONFIRMATION' | 'PAGU_ABSENT' | 'PAGU_INVALID_NEGATIVE';
  };
  mode: IntakeMode;
  reasons: string[];
};

const toFiniteNumber = (value: string | number | null): number | null => {
  if (value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export function detectIntakeMode(facts: IntakeModeFacts): IntakeModeResult {
  const baselineCount = Math.max(0, Math.trunc(facts.boqBaselineWorkItemCount || 0));
  const draftCount = Math.max(0, Math.trunc(facts.boqDraftWorkItemCount || 0));
  const boq = baselineCount > 0
    ? {
        status: 'AVAILABLE' as const,
        source: 'BASELINE' as const,
        workItemCount: baselineCount,
        reasonCode: 'BOQ_BASELINE_WORK_ITEM_PRESENT' as const,
      }
    : draftCount > 0
      ? {
          status: 'AVAILABLE' as const,
          source: 'DRAFT' as const,
          workItemCount: draftCount,
          reasonCode: 'BOQ_DRAFT_WORK_ITEM_PRESENT' as const,
        }
      : {
          status: 'EMPTY' as const,
          source: 'NONE' as const,
          workItemCount: 0,
          reasonCode: 'BOQ_NO_WORK_ITEM' as const,
        };

  const specification = facts.mainMaterialSpec?.trim()
    ? { status: 'AVAILABLE' as const, reasonCode: 'SPEC_TEXT_PRESENT' as const }
    : { status: 'MISSING' as const, reasonCode: 'SPEC_ABSENT' as const };

  const budget = toFiniteNumber(facts.budgetBaseline);
  const pagu = budget === null
    ? { status: 'MISSING' as const, reasonCode: 'PAGU_ABSENT' as const }
    : budget < 0
      ? { status: 'NEEDS_CONFIRMATION' as const, reasonCode: 'PAGU_INVALID_NEGATIVE' as const }
      : budget === 0
        ? { status: 'NEEDS_CONFIRMATION' as const, reasonCode: 'PAGU_ZERO_NEEDS_CONFIRMATION' as const }
        : { status: 'AVAILABLE' as const, reasonCode: 'PAGU_POSITIVE' as const };

  let mode: IntakeMode = 'UNRESOLVED';
  if (pagu.status !== 'NEEDS_CONFIRMATION') {
    if (boq.status === 'AVAILABLE' && specification.status === 'AVAILABLE' && pagu.status === 'MISSING') mode = 'A';
    if (boq.status === 'AVAILABLE' && specification.status === 'MISSING' && pagu.status === 'MISSING') mode = 'B';
    if (boq.status === 'AVAILABLE' && specification.status === 'AVAILABLE' && pagu.status === 'AVAILABLE') mode = 'C';
    if (boq.status === 'AVAILABLE' && specification.status === 'MISSING' && pagu.status === 'AVAILABLE') mode = 'D';
    if (boq.status === 'EMPTY' && pagu.status === 'AVAILABLE') mode = 'E';
    if (boq.status === 'EMPTY' && pagu.status === 'MISSING') mode = 'F';
  }

  return {
    boq,
    specification,
    pagu,
    mode,
    reasons: [boq.reasonCode, specification.reasonCode, pagu.reasonCode],
  };
}
