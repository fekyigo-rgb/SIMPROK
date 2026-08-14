import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProjectService } from './project.service';
import { RabLifecyclePolicyService } from './rab-lifecycle-policy.service';
import {
  RAB_STRUCTURE_REASON,
  validateAndOrderRabStructure,
} from './rab-structure-preflight';

/**
 * RAB-FOCUS-01 §21 — the hostile structural matrix.
 *
 * Two halves, deliberately:
 *
 *   the VALIDATOR is proven directly, because that is where the graph law
 *   lives and it must be sound wherever it is called;
 *
 *   the SAVE BOUNDARY is then driven with the same malformed documents to
 *   prove the thing that actually matters — that a rejection costs the
 *   persisted RAB nothing. Not "an error was raised", but "no destructive
 *   statement was ever issued".
 *
 * These assume the client is untrusted. Every payload below is one a stale,
 * buggy or deliberately crafted caller could send.
 */

const folder = (tempId: string, parentTempId: string | null = null, sortOrder?: number) => ({
  tempId,
  parentTempId,
  itemType: 'FOLDER',
  name: tempId,
  ...(sortOrder === undefined ? {} : { sortOrder }),
});
const item = (tempId: string, parentTempId: string | null = null, sortOrder?: number) => ({
  tempId,
  parentTempId,
  itemType: 'WORK_ITEM',
  name: tempId,
  quantity: 1,
  unit: 'm',
  ...(sortOrder === undefined ? {} : { sortOrder }),
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════

describe('RAB structural preflight — the graph law', () => {
  it('accepts a valid tree and returns it parent-first', () => {
    const ordered = validateAndOrderRabStructure([
      folder('SUB', null, 1),
      item('A', null, 0),
      item('C', 'SUB', 0),
      item('D', 'SUB', 1),
    ]);
    expect(ordered.map((entry) => entry.row.tempId)).toEqual(['A', 'SUB', 'C', 'D']);
  });

  /**
   * The case that must NOT be confused with corruption: structural truth is a
   * graph, and a graph does not have a first element. A child listed before
   * its parent is a perfectly sound document.
   */
  it('accepts a valid payload whose child is listed BEFORE its parent', () => {
    const ordered = validateAndOrderRabStructure([
      item('C', 'SUB', 0),
      item('A', null, 0),
      folder('SUB', null, 1),
    ]);
    expect(ordered.map((entry) => entry.row.tempId)).toEqual(['A', 'SUB', 'C']);
    // And every parent genuinely precedes its own children.
    const position = new Map(ordered.map((entry, i) => [entry.row.tempId, i]));
    for (const { row } of ordered) {
      if (row.parentTempId) {
        expect(position.get(row.parentTempId)!).toBeLessThan(position.get(row.tempId)!);
      }
    }
  });

  it('S1 rejects duplicate tempId', () => {
    expect(() => validateAndOrderRabStructure([item('A'), item('A')])).toThrow(
      ConflictException,
    );
  });

  // ── §9: the internal root bucket must not live in the client's key space ──

  it('treats "ROOT" as an ordinary row identity, not an internal marker', () => {
    const ordered = validateAndOrderRabStructure([
      folder('ROOT', null, 0),
      item('CHILD', 'ROOT', 0),
    ]);
    expect(ordered.map((entry) => entry.row.tempId)).toEqual(['ROOT', 'CHILD']);
    // CHILD is still the child of the REAL row named ROOT.
    expect(ordered[1].row.parentTempId).toBe('ROOT');
  });

  it('keeps a row named "ROOT" separate from the document\'s actual roots', () => {
    // If the root bucket were keyed by the string "ROOT", these three real
    // roots would be handed to the ROOT row as its children and the walk would
    // revisit them. Every row must appear exactly once, at its true depth.
    const ordered = validateAndOrderRabStructure([
      folder('ROOT', null, 0),
      item('other-root-a', null, 1),
      item('other-root-b', null, 2),
      item('CHILD', 'ROOT', 0),
    ]);
    expect(ordered.map((entry) => entry.row.tempId)).toEqual([
      'ROOT',
      'CHILD',
      'other-root-a',
      'other-root-b',
    ]);
    expect(ordered).toHaveLength(4);
    expect(new Set(ordered.map((e) => e.row.tempId)).size).toBe(4);
  });

  it('survives the same collision under a NUL-bearing identity too', () => {
    // Any string a client can send is fair game as an identity, control
    // characters included; only `null` is outside that space.
    const weird = '\u0000ROOT';
    const ordered = validateAndOrderRabStructure([
      folder(weird, null, 0),
      item('c', weird, 0),
      item('real-root', null, 1),
    ]);
    expect(ordered.map((e) => e.row.tempId)).toEqual([weird, 'c', 'real-root']);
  });

  it('§10 rejects a blank or whitespace-only identity', () => {
    expect(() => validateAndOrderRabStructure([item('')])).toThrow(
      new BadRequestException(RAB_STRUCTURE_REASON.BLANK_TEMP_ID),
    );
    expect(() => validateAndOrderRabStructure([item('   ')])).toThrow(
      new BadRequestException(RAB_STRUCTURE_REASON.BLANK_TEMP_ID),
    );
  });

  it('§10 reports a blank parent reference as missing, never as "root"', () => {
    // Silently promoting the row to the top of the document would be one
    // structural truth quietly replaced by another.
    expect(() =>
      validateAndOrderRabStructure([folder('SUB'), { ...item('A'), parentTempId: '' }]),
    ).toThrow(new BadRequestException(RAB_STRUCTURE_REASON.PARENT_NOT_FOUND));
  });

  it('S2 rejects a parent that is not in this payload', () => {
    expect(() => validateAndOrderRabStructure([item('A', 'ghost')])).toThrow(
      new BadRequestException(RAB_STRUCTURE_REASON.PARENT_NOT_FOUND),
    );
  });

  it('S3 rejects a row that is its own parent', () => {
    expect(() => validateAndOrderRabStructure([item('A', 'A')])).toThrow(
      new BadRequestException(RAB_STRUCTURE_REASON.SELF_PARENT),
    );
  });

  it('S4 rejects a two-node cycle', () => {
    expect(() =>
      validateAndOrderRabStructure([folder('A', 'B'), folder('B', 'A')]),
    ).toThrow(new BadRequestException(RAB_STRUCTURE_REASON.CYCLE));
  });

  it('S4 rejects a three-node cycle', () => {
    expect(() =>
      validateAndOrderRabStructure([folder('A', 'C'), folder('B', 'A'), folder('C', 'B')]),
    ).toThrow(new BadRequestException(RAB_STRUCTURE_REASON.CYCLE));
  });

  it('S4 rejects a cycle that hangs off an otherwise valid tree', () => {
    expect(() =>
      validateAndOrderRabStructure([
        folder('ROOT'),
        item('OK', 'ROOT'),
        folder('X', 'Y'),
        folder('Y', 'X'),
      ]),
    ).toThrow(new BadRequestException(RAB_STRUCTURE_REASON.CYCLE));
  });

  it('S6 rejects a WORK_ITEM used as a parent, which canonical RAB law forbids', () => {
    expect(() =>
      validateAndOrderRabStructure([item('PARENT'), item('CHILD', 'PARENT')]),
    ).toThrow(new BadRequestException(RAB_STRUCTURE_REASON.INVALID_PARENT_TYPE));
  });

  it('S6 allows a Sub Judul to own children', () => {
    expect(() =>
      validateAndOrderRabStructure([folder('SUB'), item('CHILD', 'SUB')]),
    ).not.toThrow();
  });

  // ── S7 EFFECTIVE ORDER: what is CHECKED must be what is WRITTEN ──────────
  //
  // saveDraftBoq persists `row.sortOrder ?? payloadIndex`. Checking only the
  // rows that state a sortOrder therefore left a gap: an omitted row whose
  // payload index happens to equal a sibling's explicit claim resolves to the
  // same number, and two siblings land on one position.

  it('S7-E1 rejects a mixed omitted/explicit collision on the EFFECTIVE value', () => {
    // A omits sortOrder and sits at payload index 0 → effective 0.
    // B explicitly claims 0 → effective 0. Both would persist 0.
    expect(() =>
      validateAndOrderRabStructure([item('A'), item('B', null, 0)]),
    ).toThrow(new BadRequestException(RAB_STRUCTURE_REASON.AMBIGUOUS_ORDER));
  });

  it('S7-E3 allows the same effective value under DIFFERENT parents', () => {
    // Not siblings, so not a collision — the invariant is per sibling group,
    // never global.
    const ordered = validateAndOrderRabStructure([
      folder('P1', null, 0),
      folder('P2', null, 1),
      item('a', 'P1', 0),
      item('b', 'P2', 0),
    ]);
    const effective = new Map(
      ordered.map((e) => [e.row.tempId, e.effectiveSortOrder]),
    );
    expect(effective.get('a')).toBe(0);
    expect(effective.get('b')).toBe(0);
  });

  it('S7-E4 keeps an all-omitted payload legal, resolved by payload order', () => {
    const ordered = validateAndOrderRabStructure([item('A'), item('B'), item('C')]);
    expect(ordered.map((e) => [e.row.tempId, e.effectiveSortOrder])).toEqual([
      ['A', 0],
      ['B', 1],
      ['C', 2],
    ]);
  });

  it('S7-E5 preserves sparse explicit values — no silent densifying', () => {
    const ordered = validateAndOrderRabStructure([
      item('A', null, 2),
      item('B', null, 5),
      item('C', null, 9),
    ]);
    expect(ordered.map((e) => e.effectiveSortOrder)).toEqual([2, 5, 9]);
  });

  it('S7-E7 resolves effective order correctly for a child-before-parent payload', () => {
    const ordered = validateAndOrderRabStructure([
      item('C', 'SUB'),   // payload index 0 → effective 0 inside SUB
      item('A'),          // payload index 1 → effective 1 at root
      folder('SUB'),      // payload index 2 → effective 2 at root
    ]);
    expect(ordered.map((e) => [e.row.tempId, e.effectiveSortOrder])).toEqual([
      ['A', 1],
      ['SUB', 2],
      ['C', 0],
    ]);
  });

  it('S7 rejects two siblings explicitly claiming the same position', () => {
    expect(() =>
      validateAndOrderRabStructure([item('A', null, 3), item('B', null, 3)]),
    ).toThrow(new BadRequestException(RAB_STRUCTURE_REASON.AMBIGUOUS_ORDER));
  });

  it('S7 allows the same position under DIFFERENT parents — they are not siblings', () => {
    expect(() =>
      validateAndOrderRabStructure([
        folder('S1', null, 0),
        folder('S2', null, 1),
        item('A', 'S1', 0),
        item('B', 'S2', 0),
      ]),
    ).not.toThrow();
  });

  it('S7 leaves the existing omit-sortOrder contract intact', () => {
    // Omitting sortOrder is not a claim; payload order decides, deterministically.
    const ordered = validateAndOrderRabStructure([item('A'), item('B'), item('C')]);
    expect(ordered.map((entry) => entry.row.tempId)).toEqual(['A', 'B', 'C']);
  });

  it('orders siblings deterministically regardless of payload order', () => {
    const forward = validateAndOrderRabStructure([
      item('A', null, 2),
      item('B', null, 0),
      item('C', null, 1),
    ]);
    const reversed = validateAndOrderRabStructure([
      item('C', null, 1),
      item('A', null, 2),
      item('B', null, 0),
    ]);
    expect(forward.map((e) => e.row.tempId)).toEqual(['B', 'C', 'A']);
    expect(reversed.map((e) => e.row.tempId)).toEqual(['B', 'C', 'A']);
  });

  it('preserves each row payload index, so the sortOrder fallback is unchanged', () => {
    const ordered = validateAndOrderRabStructure([
      item('C', 'SUB'),
      item('A'),
      folder('SUB'),
    ]);
    expect(ordered.map((e) => [e.row.tempId, e.payloadIndex])).toEqual([
      ['A', 1],
      ['SUB', 2],
      ['C', 0],
    ]);
  });

  it('emits every row exactly once for a deep chain', () => {
    const rows = [folder('n0')];
    for (let i = 1; i < 400; i += 1) rows.push(folder(`n${i}`, `n${i - 1}`));
    const ordered = validateAndOrderRabStructure(rows.slice().reverse());
    expect(ordered).toHaveLength(400);
    expect(new Set(ordered.map((e) => e.row.tempId)).size).toBe(400);
    // Deep, so a recursive walk would risk the stack; this one is iterative.
    expect(ordered[0].row.tempId).toBe('n0');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE SAVE BOUNDARY — zero-mutation proof (§8)
// ═══════════════════════════════════════════════════════════════════════════

describe('saveDraftBoq structural fail-closed — zero mutation', () => {
  const STRUCTURE_ID = 'structure-1';

  /**
   * A MANUAL row on purpose. A SERVER_COST_KERNEL row would trip the existing
   * §4.1 omission guard first — correctly, since these hostile payloads never
   * reference it — and that earlier rejection would hide whether the
   * structural preflight does its own job. The kernel guard keeps its own
   * proof in project.service.spec.ts and is re-checked below.
   */
  const existingRow = () => ({
    id: 'existing-1',
    boqStructureId: STRUCTURE_ID,
    itemType: 'WORK_ITEM',
    quantity: new Prisma.Decimal('5'),
    unit: 'M1',
    unitPrice: new Prisma.Decimal('200000.00'),
    lineTotal: new Prisma.Decimal('1000000.00'),
    ahspVersionId: null,
    ahspSnapshotId: null,
    priceOrigin: 'MANUAL_CLIENT',
    calculationOccurrenceId: null,
    calculationAsOfDate: null,
    calculatedAt: null,
    calculationPolicyVersion: null,
  });

  const existingKernelRow = () => ({
    ...existingRow(),
    id: 'kernel-1',
    ahspVersionId: 'ahsp-version-1',
    priceOrigin: 'SERVER_COST_KERNEL',
    calculationOccurrenceId: 'occurrence-1',
    calculationAsOfDate: new Date('2026-07-31'),
    calculatedAt: new Date('2026-07-31T01:00:00.000Z'),
    calculationPolicyVersion: 'RAB_KERNEL_PERSISTENCE_GRADE_A_V1',
  });

  function createHarness(existingItems: unknown[]) {
    const boqItemCreate = jest.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: 'new-row', ...data }),
    );
    const boqItemDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const boqItemUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'project-1', status: 'PLANNED' }]),
      projectBaseline: { count: jest.fn().mockResolvedValue(0) },
      rabDocument: {
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
      },
      boqStructure: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue({
          id: STRUCTURE_ID,
          projectId: 'project-1',
          name: 'Working Draft',
          status: 'DRAFT',
        }),
      },
      boqItem: {
        findMany: jest.fn().mockResolvedValue(existingItems),
        updateMany: boqItemUpdateMany,
        deleteMany: boqItemDeleteMany,
        create: boqItemCreate,
      },
    };
    const prisma = {
      $transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
      aHSPSnapshot: { findMany: jest.fn().mockResolvedValue([]) },
      aHSPVersion: { findMany: jest.fn().mockResolvedValue([]) },
      projectAhspOccurrence: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new ProjectService(
      prisma as any,
      {} as any,
      new RabLifecyclePolicyService({} as any),
    );
    return { service, boqItemCreate, boqItemDeleteMany, boqItemUpdateMany };
  }

  const save = (service: ProjectService, rows: Record<string, unknown>[]) =>
    service.saveDraftBoq('project-1', { rows } as any, rows);

  /** Every destructive statement saveDraftBoq can issue, in one assertion. */
  const expectNothingWritten = (h: ReturnType<typeof createHarness>) => {
    expect(h.boqItemUpdateMany).not.toHaveBeenCalled();
    expect(h.boqItemDeleteMany).not.toHaveBeenCalled();
    expect(h.boqItemCreate).not.toHaveBeenCalled();
  };

  const HOSTILE: Array<[string, Record<string, unknown>[], string]> = [
    ['a parent that does not exist', [item('A', 'ghost')], RAB_STRUCTURE_REASON.PARENT_NOT_FOUND],
    ['a self-parent', [item('A', 'A')], RAB_STRUCTURE_REASON.SELF_PARENT],
    ['a two-node cycle', [folder('A', 'B'), folder('B', 'A')], RAB_STRUCTURE_REASON.CYCLE],
    [
      'a three-node cycle',
      [folder('A', 'C'), folder('B', 'A'), folder('C', 'B')],
      RAB_STRUCTURE_REASON.CYCLE,
    ],
    [
      'a WORK_ITEM used as a parent',
      [item('P'), item('C', 'P')],
      RAB_STRUCTURE_REASON.INVALID_PARENT_TYPE,
    ],
    [
      'two siblings claiming one position',
      [item('A', null, 1), item('B', null, 1)],
      RAB_STRUCTURE_REASON.AMBIGUOUS_ORDER,
    ],
  ];

  it.each(HOSTILE)(
    'rejects %s and writes absolutely nothing',
    async (_label, rows, reason) => {
      const harness = createHarness([existingRow()]);
      await expect(save(harness.service, rows)).rejects.toMatchObject({
        response: expect.objectContaining({ message: reason }),
      });
      expectNothingWritten(harness);
    },
  );

  it('rejects a duplicate tempId and writes absolutely nothing', async () => {
    const harness = createHarness([existingRow()]);
    await expect(save(harness.service, [item('A'), item('A')])).rejects.toBeInstanceOf(
      ConflictException,
    );
    expectNothingWritten(harness);
  });

  it('a rejected save leaves the existing rows untouched — they were only read', async () => {
    const harness = createHarness([existingRow()]);
    await expect(save(harness.service, [item('A', 'ghost')])).rejects.toBeTruthy();
    expectNothingWritten(harness);
  });

  /**
   * The pre-existing kernel protection must still fire first and still leave
   * nothing written — the structural preflight was added beside it, not in
   * front of it.
   */
  it('still refuses to silently drop an existing server-authored row', async () => {
    const harness = createHarness([existingKernelRow()]);
    await expect(save(harness.service, [item('unrelated')])).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'SERVER_ROW_OMISSION_REQUIRES_EXPLICIT_COMMAND',
      }),
    });
    expectNothingWritten(harness);
  });

  it('S7-E2 rejects a mixed fallback collision and writes absolutely nothing', () => {
    // The runtime half of S7-E1: the same payload driven through the real save
    // boundary must cost the persisted RAB nothing.
    const harness = createHarness([existingRow()]);
    return expect(save(harness.service, [item('A'), item('B', null, 0)]))
      .rejects.toMatchObject({
        response: expect.objectContaining({
          message: RAB_STRUCTURE_REASON.AMBIGUOUS_ORDER,
        }),
      })
      .then(() => expectNothingWritten(harness));
  });

  /**
   * §13 — THE CLOSURE ITSELF.
   *
   * Not "the request succeeded", but: the number the validator proved unique is
   * the number that reached BoqItem.sortOrder, row for row. If these two ever
   * drift apart again, the server is accepting one order and storing another.
   */
  it('§13 VALIDATED ORDER = PERSISTED ORDER, row for row', async () => {
    // Deliberately mixed: explicit, omitted, sparse, nested, and listed with a
    // child before its parent — everything the resolver has to reconcile.
    const payload = [
      item('c1', 'SUB'),          // omitted → payload index 0
      item('root-a', null, 7),    // explicit sparse
      folder('SUB', null, 8),     // explicit
      item('c2', 'SUB', 5),       // explicit, inside SUB
      item('root-b'),             // omitted → payload index 4
    ];

    const validated = validateAndOrderRabStructure(payload);
    const expected = new Map(
      validated.map((entry) => [entry.row.tempId, entry.effectiveSortOrder]),
    );
    // Sanity on the resolver itself before trusting it as the oracle.
    expect([...expected.entries()].sort()).toEqual([
      ['SUB', 8],
      ['c1', 0],
      ['c2', 5],
      ['root-a', 7],
      ['root-b', 4],
    ]);

    const harness = createHarness([]);
    await save(harness.service, payload);

    const persisted = harness.boqItemCreate.mock.calls.map((call) => call[0].data);
    expect(persisted).toHaveLength(payload.length);
    for (const row of persisted) {
      expect(row.sortOrder).toBe(expected.get(row.name as string));
    }
  });

  /**
   * The counterpart that keeps the guard honest: a lawful document whose child
   * happens to be listed first must still be accepted and persisted with its
   * real parent — never silently re-rooted, which is the defect this whole
   * preflight exists to end.
   */
  it('accepts a lawful child-before-parent payload and persists the real parent', async () => {
    const harness = createHarness([]);
    await save(harness.service, [item('C', 'SUB'), folder('SUB')]);

    expect(harness.boqItemDeleteMany).toHaveBeenCalledTimes(1);
    const created = harness.boqItemCreate.mock.calls.map((call) => call[0].data);
    expect(created.map((row: any) => row.name)).toEqual(['SUB', 'C']);
    // The child landed inside SUB, not at the root.
    expect(created[1].parentId).toBe('new-row');
    expect(created[1].parentId).not.toBeNull();
  });
});
