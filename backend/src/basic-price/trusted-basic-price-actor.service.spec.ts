import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TrustedBasicPriceActorService } from './trusted-basic-price-actor.service';

/**
 * RM-03C — a workspace-private Basic Price has no verifier and no publisher,
 * so its write-time authority chain is the only authority chain it will ever
 * have. These tests pin that chain: server-derived, fail-closed, no fallback.
 */
describe('TrustedBasicPriceActorService', () => {
  const workspaceId = '20000000-0000-4000-8000-000000000001';
  const membershipId = '30000000-0000-4000-8000-000000000001';
  const accountId = '40000000-0000-4000-8000-000000000001';
  const userId = '50000000-0000-4000-8000-000000000001';

  let prisma: { user: { findFirst: jest.Mock } };
  let service: TrustedBasicPriceActorService;

  beforeEach(() => {
    prisma = { user: { findFirst: jest.fn() } };
    service = new TrustedBasicPriceActorService(prisma as any);
  });

  const resolveOk = () =>
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      membership: { accountId },
    });

  it('resolves the one live human behind the membership, and the server workspace', async () => {
    resolveOk();

    await expect(
      service.resolveActor({ workspaceId, membershipId }, accountId),
    ).resolves.toEqual({ accountId, userId, workspaceId });
  });

  it('walks the FULL identity chain: ACTIVE Account, ACTIVE membership, ACTIVE User', async () => {
    resolveOk();
    await service.resolveActor({ workspaceId, membershipId }, accountId);

    const where = prisma.user.findFirst.mock.calls[0][0].where;
    // User profile side.
    expect(where.workspaceMembershipId).toBe(membershipId);
    expect(where.workspaceId).toBe(workspaceId);
    expect(where.status).toBe('ACTIVE');
    // Membership side — re-asserted here, never assumed from the guard.
    expect(where.membership.status).toBe('ACTIVE');
    expect(where.membership.workspaceId).toBe(workspaceId);
    expect(where.membership.account.status).toBe('ACTIVE');
    // The membership must belong to the JWT account: a context whose two
    // halves disagree can never resolve.
    expect(where.membership.accountId).toBe(accountId);
  });

  it('refuses a missing or non-string workspace context — never guesses one', async () => {
    for (const context of [
      undefined,
      {},
      { workspaceId },
      { membershipId },
      { workspaceId: 123, membershipId },
      { workspaceId, membershipId: ['a'] },
    ]) {
      await expect(
        service.resolveActor(context, accountId),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('refuses a missing JWT account — there is no anonymous private-price author', async () => {
    for (const jwtAccountId of [undefined, null, '', 42]) {
      await expect(
        service.resolveActor({ workspaceId, membershipId }, jwtAccountId),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed when no live User profile matches — never falls back to the Account', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      service.resolveActor({ workspaceId, membershipId }, accountId),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('returns the account id from the MEMBERSHIP, not from the caller-supplied value', async () => {
    // Belt and braces: the query already binds membership.accountId to the JWT
    // account, and the returned value is read back off that membership rather
    // than echoed from the request.
    prisma.user.findFirst.mockResolvedValue({
      id: userId,
      membership: { accountId },
    });

    const actor = await service.resolveActor(
      { workspaceId, membershipId },
      accountId,
    );
    expect(actor.accountId).toBe(accountId);
    expect(actor.userId).toBe(userId);
    expect(actor.userId).not.toBe(actor.accountId);
  });
});
