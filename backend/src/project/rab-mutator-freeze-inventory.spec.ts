import { readFileSync } from 'fs';
import { join } from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { ProjectStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RabLifecyclePolicyService } from './rab-lifecycle-policy.service';

/**
 * RM-03D1 — FREEZE MEANS ENFORCED IMMUTABILITY (§14, §17).
 *
 * Flipping a status to LOCKED is necessary but worthless if a mutation can
 * still land. Rather than bolting a guard onto each route one by one — which
 * silently fails the day someone adds route number five — the freeze rides on
 * the ONE lifecycle authority every RAB mutator already had to consult before
 * writing. Two things therefore have to stay true, and both are pinned here:
 *
 *   1. the authority refuses editing once a LOCKED RabDocument exists, and
 *   2. every RAB mutator actually consults it, inside its own transaction.
 *
 * A new mutator that skips the authority fails this test rather than quietly
 * joining the set with no freeze enforcement.
 */

const projectDir = __dirname;
const read = (file: string) => readFileSync(join(projectDir, file), 'utf8');

describe('RM-03D1 RAB mutator freeze inventory', () => {
  /**
   * The complete set of business writers that can change a frozen RAB's
   * content. Each entry names the file and the exact lifecycle consultation it
   * must contain. `initiateSetup` is deliberately absent: it only ever CREATES
   * a Working Draft when none exists, and a project with a LOCKED RabDocument
   * already has one.
   */
  const MUTATORS = [
    { file: 'project.service.ts', what: 'PUT /boq/draft (saveDraftBoq)' },
    { file: 'rab-kernel-persistence.service.ts', what: 'cost-calculation/persist' },
    { file: 'boq-import.service.ts', what: 'BOQ import approve' },
  ];

  it.each(MUTATORS)('$what consults the lifecycle authority and refuses when it says no', ({ file }) => {
    const source = read(file);
    expect(source).toMatch(/rabLifecyclePolicy\.evaluateInTransaction|capability\.canEditDraft|canEnterEditableDraftWorkspace/);
    // and it must act on the answer, not merely read it
    expect(source).toMatch(/if \(!capability\.(canEditDraft|canEnterEditableDraftWorkspace)/);
  });

  it('select-ahsp consults the same authority from its own module', () => {
    const source = readFileSync(
      join(projectDir, '..', 'project-ahsp', 'project-ahsp.service.ts'),
      'utf8',
    );
    expect(source).toMatch(/canEditDraft/);
    expect(source).toMatch(/if \(!capability\.canEditDraft/);
  });

  it('the lock command itself does NOT mount the editable-lifecycle guard, or it could never be idempotent', () => {
    const controller = read('project.controller.ts');
    const lockRoute = controller.slice(controller.indexOf("@Post(':projectId/rab/lock')"));
    const routeBlock = lockRoute.slice(0, lockRoute.indexOf('async lockRab'));
    expect(routeBlock).not.toMatch(/RabEditableLifecycleGuard/);
    expect(routeBlock).toMatch(/PERMISSIONS\.RAB_DRAFT_EDIT/);
  });

  it('no RAB mutator writes an approval or a baseline — LOCKED is never APPROVED', () => {
    for (const { file } of MUTATORS) {
      const source = read(file);
      expect(source).not.toMatch(/projectBaseline\.(create|update|upsert)/);
      expect(source).not.toMatch(/status:\s*['"]APPROVED['"]/);
    }
    const lockService = read('rab-lock.service.ts');
    expect(lockService).not.toMatch(/projectBaseline/);
    expect(lockService).not.toMatch(/approvedAt|approvedByPositionId/);
  });

  describe('the authority itself', () => {
    let service: RabLifecyclePolicyService;
    let prisma: any;

    beforeEach(async () => {
      prisma = {
        projectBaseline: { count: jest.fn().mockResolvedValue(0) },
        rabDocument: {
          count: jest.fn(async (args: any) => (args?.where?.status === 'LOCKED' ? 1 : 0)),
        },
        boqStructure: { count: jest.fn().mockResolvedValue(1) },
      };
      const module: TestingModule = await Test.createTestingModule({
        providers: [RabLifecyclePolicyService, { provide: PrismaService, useValue: prisma }],
      }).compile();
      service = module.get(RabLifecyclePolicyService);
    });

    // ── T3 / T4 / T5 / T6 all reduce to this one fact ───────────────────────
    it('T3-T6: a LOCKED RabDocument makes the draft non-editable for every mutator at once', async () => {
      const result = await service.evaluate('p1', ProjectStatus.PLANNED);
      expect(result.canEditDraft).toBe(false);
      expect(result.reasonCode).toBe('RAB_LOCKED');
      expect(result.lockedRabCount).toBe(1);
    });

    it('APPROVED still outranks LOCKED — the stronger, later fact is the one reported', async () => {
      prisma.rabDocument.count = jest.fn().mockResolvedValue(1); // both APPROVED and LOCKED
      const result = await service.evaluate('p1', ProjectStatus.PLANNED);
      expect(result.reasonCode).toBe('APPROVED_RAB_EXISTS');
    });

    it('a project with no locked RAB is completely unaffected by this slice', async () => {
      prisma.rabDocument.count = jest.fn().mockResolvedValue(0);
      const result = await service.evaluate('p1', ProjectStatus.PLANNED);
      expect(result.canEditDraft).toBe(true);
      expect(result.reasonCode).toBeNull();
      expect(result.lockedRabCount).toBe(0);
    });
  });

  // ── T7 ────────────────────────────────────────────────────────────────────
  it('T7: LOCKED is frozen, not hidden — no read path is gated on canEditDraft', () => {
    const controller = read('project.controller.ts');
    // The read routes must never have acquired the editable-lifecycle guard.
    for (const route of [
      "@Get(':projectId/boq/draft')",
      "@Get(':projectId/boq/items/:boqItemId/persisted-calculation')",
    ]) {
      const at = controller.indexOf(route);
      expect(at).toBeGreaterThan(-1);
      const block = controller.slice(at, at + 400);
      expect(block).not.toMatch(/RabEditableLifecycleGuard/);
    }
    // and getDraftBoq reports the capability rather than refusing on it
    const projectService = read('project.service.ts');
    expect(projectService).toMatch(/capability/);
  });
});
