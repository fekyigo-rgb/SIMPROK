import {
  classifyReimport,
  interpretationsDiffer,
  INTERPRETATION_SIBLING_ORDER_BY,
  selectInterpretationSibling,
} from './basic-price-reimport.law';

/**
 * SMART RE-IMPORT — permanent classification matrix (R-1..R-7, R-9 shape).
 *
 * Tenant isolation (R-8) cannot be proved from this pure function: a foreign
 * batch must never BECOME an input. That is asserted on the intake service,
 * which is the only place that may look up history.
 */
describe('SMART RE-IMPORT classification law', () => {
  const INCOMING = 'incoming-batch';
  const EXISTING = 'existing-batch';

  it('R-1 EXACT_EXISTING: same source + same interpretation → use existing, no update batch', () => {
    const relation = classifyReimport({
      exactOwnedBatchId: EXISTING,
      interpretationSiblingId: 'other-reading',
      sourceStreamSiblingId: 'other-source',
      incomingBatchId: INCOMING,
    });
    expect(relation).toEqual({
      classification: 'EXACT_EXISTING',
      existingBatchId: EXISTING,
      updateBatchId: null,
      difference: 'NONE',
    });
  });

  it('R-2 INTERPRETATION_UPDATE: same bytes, different lawful reading', () => {
    const relation = classifyReimport({
      exactOwnedBatchId: null,
      interpretationSiblingId: EXISTING,
      sourceStreamSiblingId: null,
      incomingBatchId: INCOMING,
    });
    expect(relation).toEqual({
      classification: 'INTERPRETATION_UPDATE',
      existingBatchId: EXISTING,
      updateBatchId: INCOMING,
      difference: 'READING',
    });
  });

  it('R-6 filename is not an input — unproven relation stays NEW', () => {
    const relation = classifyReimport({
      exactOwnedBatchId: null,
      interpretationSiblingId: null,
      sourceStreamSiblingId: null,
      incomingBatchId: INCOMING,
    });
    expect(relation.classification).toBe('NEW_OR_UNPROVEN');
    expect(relation.existingBatchId).toBeNull();
    expect(relation.updateBatchId).toBeNull();
    expect(Object.keys(relation)).not.toContain('fileName');
  });

  it('R-7 SOURCE_UPDATE: only when an existing source-stream sibling is proven', () => {
    const relation = classifyReimport({
      exactOwnedBatchId: null,
      interpretationSiblingId: null,
      sourceStreamSiblingId: EXISTING,
      incomingBatchId: INCOMING,
    });
    expect(relation).toEqual({
      classification: 'SOURCE_UPDATE',
      existingBatchId: EXISTING,
      updateBatchId: INCOMING,
      difference: 'SOURCE_CONTENT',
    });
  });

  it('R-7 NOT_APPLICABLE shape: no source-stream proof → not SOURCE_UPDATE', () => {
    const relation = classifyReimport({
      exactOwnedBatchId: null,
      interpretationSiblingId: null,
      sourceStreamSiblingId: null,
      incomingBatchId: INCOMING,
    });
    expect(relation.classification).not.toBe('SOURCE_UPDATE');
  });

  it('R-9 the classification never implies a mutation of the existing batch', () => {
    const update = classifyReimport({
      exactOwnedBatchId: null,
      interpretationSiblingId: EXISTING,
      sourceStreamSiblingId: null,
      incomingBatchId: INCOMING,
    });
    expect(update.existingBatchId).toBe(EXISTING);
    expect(update.updateBatchId).toBe(INCOMING);
    expect(update.existingBatchId).not.toBe(update.updateBatchId);
  });

  it('interpretationsDiffer is exact field inequality — never a similarity guess', () => {
    const material = {
      resourceNameColumn: 2,
      sourceUnitColumn: 4,
      declaredSection: 'MATERIAL' as const,
    };
    const labor = { ...material, declaredSection: 'LABOR' as const };
    const same = { ...material };
    expect(interpretationsDiffer(material, labor)).toBe(true);
    expect(interpretationsDiffer(material, same)).toBe(false);
    expect(
      interpretationsDiffer(material, {
        resourceNameColumn: 2,
        sourceUnitColumn: 2,
        declaredSection: 'MATERIAL',
      }),
    ).toBe(true);
  });

  const incoming = {
    resourceNameColumn: 2,
    sourceUnitColumn: 4,
    declaredSection: 'MATERIAL',
  };

  const sibling = (
    id: string,
    createdAt: string,
    reading: {
      resourceNameColumn: number;
      sourceUnitColumn: number;
      declaredSection: string;
    } = {
      resourceNameColumn: 4,
      sourceUnitColumn: 2,
      declaredSection: 'LABOR',
    },
  ) => ({
    id,
    createdAt: new Date(createdAt),
    ...reading,
  });

  it('selects the newest differing sibling even when insertion order is the opposite', () => {
    /**
     * Three comparable siblings. Insertion order is oldest-first in the
     * array; expected winner is the newest that differs from incoming.
     * A same-reading row is newer still and must be skipped.
     */
    const inserted = [
      sibling('oldest-differ', '2026-01-01T00:00:00.000Z'),
      sibling('middle-differ', '2026-01-02T00:00:00.000Z', {
        resourceNameColumn: 2,
        sourceUnitColumn: 4,
        declaredSection: 'LABOR',
      }),
      sibling('newest-same', '2026-01-03T00:00:00.000Z', incoming),
      sibling('expected-winner', '2026-01-04T00:00:00.000Z'),
    ];
    expect(inserted[0].id).toBe('oldest-differ');
    const chosen = selectInterpretationSibling(inserted, incoming);
    expect(chosen).toBe('expected-winner');
    for (let i = 0; i < 20; i += 1) {
      expect(selectInterpretationSibling(inserted, incoming)).toBe(
        'expected-winner',
      );
    }
  });

  it('breaks createdAt ties on id descending, not array position', () => {
    const tied = '2026-01-01T00:00:00.000Z';
    const lowerId = sibling('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tied);
    const higherId = sibling('ffffffff-ffff-4fff-8fff-ffffffffffff', tied);
    expect(selectInterpretationSibling([lowerId, higherId], incoming)).toBe(
      higherId.id,
    );
    expect(selectInterpretationSibling([higherId, lowerId], incoming)).toBe(
      higherId.id,
    );
    for (let i = 0; i < 20; i += 1) {
      expect(
        selectInterpretationSibling(
          i % 2 === 0 ? [lowerId, higherId] : [higherId, lowerId],
          incoming,
        ),
      ).toBe(higherId.id);
    }
  });

  it('INTERPRETATION_SIBLING_ORDER_BY is createdAt desc then id desc', () => {
    expect(INTERPRETATION_SIBLING_ORDER_BY).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });
});
