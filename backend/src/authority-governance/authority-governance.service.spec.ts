// AUTHORITY GOVERNANCE — the deterministic half.
//
// Concurrency is proven against real Postgres in
// test/acceptance/authority-governance.e2e-spec.ts. What is proven HERE is what
// a database cannot show: the fail-closed input gates, the replay/conflict
// decision, and the boundaries this service must never cross — no second
// resolver, no self-grant shortcut, no projectId, no AuthorityService.

import { readFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import {
  AUTHORITY_GOVERNANCE_REFUSAL,
  AuthorityGovernanceService,
} from './authority-governance.service';

const SOURCE = readFileSync(
  join(__dirname, 'authority-governance.service.ts'),
  'utf8',
);
const MODULE_SOURCE = readFileSync(
  join(__dirname, 'authority-governance.module.ts'),
  'utf8',
);

/** Comments describe the law; only code may be judged as behaviour. */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const POSITION = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const AUTHORITY_ID = '33333333-3333-4333-8333-333333333333';

describe('AuthorityGovernanceService', () => {
  let service: AuthorityGovernanceService;
  let prisma: any;
  let tx: any;

  const ceremony = (over: Record<string, unknown> = {}) => ({
    positionId: POSITION,
    authorityCode: 'GOVERNED_POWER',
    executedByAccountId: ACTOR,
    ownerAuthorizationReference: 'OWNER-AUTH-0001',
    reason: 'unit ceremony',
    idempotencyKey: 'ceremony-1',
    ...over,
  });

  beforeEach(() => {
    tx = {
      authorityGovernanceDecision: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({
          id: 'decision-1',
          decidedAt: new Date('2026-09-04T00:00:00.000Z'),
          ...data,
        })),
      },
      positionAuthority: { upsert: jest.fn().mockResolvedValue({}) },
      position: { findUnique: jest.fn().mockResolvedValue({ id: POSITION }) },
      account: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
      authority: { findUnique: jest.fn().mockResolvedValue({ id: AUTHORITY_ID }) },
    };
    prisma = {
      $transaction: jest.fn((cb: (client: unknown) => unknown) => cb(tx)),
      authorityGovernanceDecision: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new AuthorityGovernanceService(prisma);
  });

  // ── FAIL-CLOSED INPUT GATES ─────────────────────────────────────────────

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['blank', '   '],
  ])('%s Owner authorization is refused BEFORE any read', async (_l, value) => {
    await expect(
      service.grant(ceremony({ ownerAuthorizationReference: value }) as never),
    ).rejects.toThrow(AUTHORITY_GOVERNANCE_REFUSAL.OWNER_AUTHORIZATION_REQUIRED);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['idempotencyKey', AUTHORITY_GOVERNANCE_REFUSAL.IDEMPOTENCY_KEY_REQUIRED],
    ['positionId', AUTHORITY_GOVERNANCE_REFUSAL.POSITION_REQUIRED],
    ['executedByAccountId', AUTHORITY_GOVERNANCE_REFUSAL.ACTOR_REQUIRED],
    ['authorityCode', AUTHORITY_GOVERNANCE_REFUSAL.AUTHORITY_REQUIRED],
  ])('a blank %s is refused before any read', async (field, refusal) => {
    await expect(
      service.grant(ceremony({ [field]: '  ' }) as never),
    ).rejects.toThrow(refusal);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('an unknown Position, actor or Authority is refused, and nothing is written', async () => {
    tx.position.findUnique.mockResolvedValue(null);
    await expect(service.grant(ceremony())).rejects.toThrow(
      AUTHORITY_GOVERNANCE_REFUSAL.POSITION_NOT_FOUND,
    );
    expect(tx.authorityGovernanceDecision.create).not.toHaveBeenCalled();
    expect(tx.positionAuthority.upsert).not.toHaveBeenCalled();
  });

  it('an inactive actor cannot execute a ceremony', async () => {
    tx.account.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
    await expect(service.grant(ceremony())).rejects.toThrow(
      AUTHORITY_GOVERNANCE_REFUSAL.ACTOR_INACTIVE,
    );
    expect(tx.authorityGovernanceDecision.create).not.toHaveBeenCalled();
  });

  // ── THE ATOMIC PAIR ─────────────────────────────────────────────────────

  it('a GRANT appends provenance AND moves current state, in ONE transaction', async () => {
    await service.grant(ceremony());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.authorityGovernanceDecision.create).toHaveBeenCalledTimes(1);
    expect(tx.positionAuthority.upsert).toHaveBeenCalledTimes(1);

    const data = tx.authorityGovernanceDecision.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      positionId: POSITION,
      authorityId: AUTHORITY_ID,
      action: 'GRANT',
      generation: 1,
      previousDecisionId: null,
      executedByAccountId: ACTOR,
      ownerAuthorizationReference: 'OWNER-AUTH-0001',
      idempotencyKey: 'ceremony-1',
    });
    expect(data.commandFingerprint).toMatch(/^[0-9a-f]{64}$/);

    const state = tx.positionAuthority.upsert.mock.calls[0][0];
    expect(state.update).toEqual({ isActive: true, revokedAt: null });
  });

  it('a REVOKE sets isActive false WITH a revokedAt — the DB CHECK shape', async () => {
    tx.authorityGovernanceDecision.findFirst.mockResolvedValue({
      id: 'd1',
      generation: 1,
      action: 'GRANT',
    });
    await service.revoke(ceremony({ idempotencyKey: 'ceremony-2' }));

    const data = tx.authorityGovernanceDecision.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ action: 'REVOKE', generation: 2, previousDecisionId: 'd1' });

    const state = tx.positionAuthority.upsert.mock.calls[0][0];
    expect(state.update.isActive).toBe(false);
    expect(state.update.revokedAt).toBeInstanceOf(Date);
  });

  it('history is only ever appended — the service has no update or delete of a decision', () => {
    expect(codeOnly(SOURCE)).not.toMatch(
      /authorityGovernanceDecision\.(update|updateMany|delete|deleteMany|upsert)/,
    );
  });

  // ── REPLAY / CONFLICT ───────────────────────────────────────────────────

  it('a replay of the same command returns the settled row and writes nothing', async () => {
    const settled = {
      id: 'winner',
      generation: 1,
      commandFingerprint: (service as any).fingerprint(ceremony(), 'GRANT'),
    };
    tx.authorityGovernanceDecision.findUnique.mockResolvedValue(settled);

    const result: any = await service.grant(ceremony());
    expect(result.id).toBe('winner');
    expect(tx.authorityGovernanceDecision.create).not.toHaveBeenCalled();
    expect(tx.positionAuthority.upsert).not.toHaveBeenCalled();
  });

  it('the same key carrying a different command is refused BY NAME', async () => {
    tx.authorityGovernanceDecision.findUnique.mockResolvedValue({
      id: 'winner',
      generation: 1,
      commandFingerprint: 'an-entirely-different-command',
    });
    await expect(service.grant(ceremony())).rejects.toThrow(
      AUTHORITY_GOVERNANCE_REFUSAL.COMMAND_FINGERPRINT_CONFLICT,
    );
    expect(tx.positionAuthority.upsert).not.toHaveBeenCalled();
  });

  it('a transition that would not change the state is refused', async () => {
    tx.authorityGovernanceDecision.findFirst.mockResolvedValue({
      id: 'd1', generation: 1, action: 'GRANT',
    });
    await expect(service.grant(ceremony({ idempotencyKey: 'again' }))).rejects.toThrow(
      AUTHORITY_GOVERNANCE_REFUSAL.DECISION_WOULD_NOT_CHANGE_STATE,
    );
  });

  it('a replay whose winner commits mid-transaction returns the winner row', async () => {
    // The state gate is ALSO a replay boundary: read 1 misses, read 2 hits.
    const winner = {
      id: 'winner',
      generation: 1,
      action: 'GRANT',
      commandFingerprint: (service as any).fingerprint(ceremony(), 'GRANT'),
    };
    tx.authorityGovernanceDecision.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    tx.authorityGovernanceDecision.findFirst.mockResolvedValue(winner);

    const settled: any = await service.grant(ceremony());
    expect(settled.id).toBe('winner');
    expect(tx.authorityGovernanceDecision.create).not.toHaveBeenCalled();
  });

  // ── ERROR CLASSIFICATION ────────────────────────────────────────────────

  const p2002 = (target: string[]) =>
    new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
      meta: { target },
    });

  it('a lost generation race whose command landed resolves idempotently', async () => {
    tx.authorityGovernanceDecision.create.mockRejectedValue(
      p2002(['positionId', 'authorityId', 'generation']),
    );
    prisma.authorityGovernanceDecision.findUnique.mockResolvedValue({
      id: 'winner',
      commandFingerprint: (service as any).fingerprint(ceremony(), 'GRANT'),
    });
    const settled: any = await service.grant(ceremony());
    expect(settled.id).toBe('winner');
  });

  it('a concurrent replay on the idempotency index resolves to the winner row', async () => {
    tx.authorityGovernanceDecision.create.mockRejectedValue(p2002(['idempotencyKey']));
    prisma.authorityGovernanceDecision.findUnique.mockResolvedValue({
      id: 'winner',
      commandFingerprint: (service as any).fingerprint(ceremony(), 'GRANT'),
    });
    const settled: any = await service.grant(ceremony());
    expect(settled.id).toBe('winner');
  });

  it('an UNRELATED unique violation is never swallowed', async () => {
    tx.authorityGovernanceDecision.create.mockRejectedValue(p2002(['someOtherColumn']));
    await expect(service.grant(ceremony())).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
  });

  // ── THE BOUNDARIES THIS SERVICE MUST NEVER CROSS ────────────────────────

  it('NO SELF-GRANT SHORTCUT — the actor is never compared to the target seat', () => {
    // Occupying the target Position must never become evidence that the actor
    // may grant to it. The absence of any such comparison is the proof.
    const code = codeOnly(SOURCE);
    expect(code).not.toMatch(/executedByAccountId\s*===\s*/);
    expect(code).not.toMatch(/===\s*ceremony\.positionId/);
    expect(code).not.toMatch(/positionAssignment/i);
    expect(code).not.toMatch(/selfGrant|isSelf/i);
  });

  it('NO SECOND RESOLVER — it never answers whether anyone holds a power', () => {
    const code = codeOnly(SOURCE);
    expect(code).not.toMatch(/\bholds\b|\bresolve\b|\bcanAct\b/);
    // The current-state relation is written, never queried for entitlement.
    expect(code).not.toMatch(/positionAuthority\.(findFirst|findMany|count)/);
  });

  it('NO AuthorityService, NO ApprovalMatrix, NO FormalDecision, NO project scope', () => {
    const code = codeOnly(SOURCE);
    for (const forbidden of [
      'AuthorityService',
      'approvalMatrix',
      'formalDecision',
      'projectId',
      'projectAssignment',
      'workspaceId',
    ]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it('NO HTTP SURFACE — and the module is deliberately not wired into AppModule', () => {
    const code = codeOnly(SOURCE);
    for (const forbidden of ['@Controller', '@Post', '@Get', '@Cron', '@OnEvent', 'OnModuleInit']) {
      expect(code).not.toContain(forbidden);
      expect(codeOnly(MODULE_SOURCE)).not.toContain(forbidden);
    }
    expect(codeOnly(MODULE_SOURCE)).not.toContain('controllers');
    const app = readFileSync(join(__dirname, '..', 'app.module.ts'), 'utf8');
    expect(app).not.toContain('AuthorityGovernanceModule');
  });

  it('the Owner authorization is recorded, never verified', () => {
    const code = codeOnly(SOURCE);
    expect(code).toContain('ownerAuthorizationReference');
    for (const forbidden of ['verifySignature', 'createVerify', 'jwt.verify', 'publicKey']) {
      expect(code).not.toContain(forbidden);
    }
  });
});
