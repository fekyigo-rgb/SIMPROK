import { detectIntakeMode, IntakeModeFacts } from './intake-mode.kernel';

const baseFacts: IntakeModeFacts = {
  boqDraftWorkItemCount: 0,
  boqBaselineWorkItemCount: 0,
  budgetBaseline: null,
  mainMaterialSpec: null,
};

describe('detectIntakeMode', () => {
  it.each([
    ['A', { boqBaselineWorkItemCount: 1, mainMaterialSpec: 'Beton', budgetBaseline: null }],
    ['B', { boqBaselineWorkItemCount: 1, mainMaterialSpec: null, budgetBaseline: null }],
    ['C', { boqBaselineWorkItemCount: 1, mainMaterialSpec: 'Beton', budgetBaseline: '1' }],
    ['D', { boqBaselineWorkItemCount: 1, mainMaterialSpec: null, budgetBaseline: '1' }],
    ['E', { boqBaselineWorkItemCount: 0, mainMaterialSpec: 'Beton', budgetBaseline: '1' }],
    ['E', { boqBaselineWorkItemCount: 0, mainMaterialSpec: null, budgetBaseline: '1' }],
    ['F', { boqBaselineWorkItemCount: 0, mainMaterialSpec: 'Beton', budgetBaseline: null }],
    ['F', { boqBaselineWorkItemCount: 0, mainMaterialSpec: null, budgetBaseline: null }],
  ])('returns mode %s', (mode, facts) => {
    expect(detectIntakeMode({ ...baseFacts, ...facts }).mode).toBe(mode);
  });

  it('returns UNRESOLVED for zero pagu', () => {
    const result = detectIntakeMode({ ...baseFacts, budgetBaseline: '0' });
    expect(result.mode).toBe('UNRESOLVED');
    expect(result.pagu.reasonCode).toBe('PAGU_ZERO_NEEDS_CONFIRMATION');
  });

  it('uses draft-only WORK_ITEM as BOQ AVAILABLE', () => {
    const result = detectIntakeMode({ ...baseFacts, boqDraftWorkItemCount: 1 });
    expect(result.boq).toMatchObject({ status: 'AVAILABLE', source: 'DRAFT', workItemCount: 1 });
  });

  it('uses baseline-only WORK_ITEM as BOQ AVAILABLE', () => {
    const result = detectIntakeMode({ ...baseFacts, boqBaselineWorkItemCount: 1 });
    expect(result.boq).toMatchObject({ status: 'AVAILABLE', source: 'BASELINE', workItemCount: 1 });
  });

  it('prioritizes baseline over draft when both exist', () => {
    const result = detectIntakeMode({ ...baseFacts, boqBaselineWorkItemCount: 2, boqDraftWorkItemCount: 3 });
    expect(result.boq).toMatchObject({ status: 'AVAILABLE', source: 'BASELINE', workItemCount: 2 });
  });

  it.each([
    ['FOLDER-only', 0, 0],
    ['NOTE-only', 0, 0],
    ['FOLDER + NOTE', 0, 0],
  ])('treats %s as BOQ EMPTY because kernel only receives WORK_ITEM counts', (_label, baseline, draft) => {
    const result = detectIntakeMode({ ...baseFacts, boqBaselineWorkItemCount: baseline, boqDraftWorkItemCount: draft });
    expect(result.boq).toMatchObject({ status: 'EMPTY', source: 'NONE', reasonCode: 'BOQ_NO_WORK_ITEM' });
  });

  it('treats incomplete WORK_ITEM as available when count is present', () => {
    const result = detectIntakeMode({ ...baseFacts, boqDraftWorkItemCount: 1 });
    expect(result.boq.status).toBe('AVAILABLE');
  });

  it('treats whitespace specification as missing', () => {
    const result = detectIntakeMode({ ...baseFacts, mainMaterialSpec: '   ' });
    expect(result.specification).toEqual({ status: 'MISSING', reasonCode: 'SPEC_ABSENT' });
  });

  it('handles negative pagu defensively as unresolved', () => {
    const result = detectIntakeMode({ ...baseFacts, budgetBaseline: '-1' });
    expect(result.mode).toBe('UNRESOLVED');
    expect(result.pagu.reasonCode).toBe('PAGU_INVALID_NEGATIVE');
  });
});
