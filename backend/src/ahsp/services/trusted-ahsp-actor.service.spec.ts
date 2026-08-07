import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TrustedAhspActorService } from './trusted-ahsp-actor.service';

/**
 * RM-03B — the AHSP actor must come from the canonical identity chain
 * (Account → ACTIVE WorkspaceMembership → ACTIVE User) and from nowhere else.
 */

const WS = 'workspace-a';
const MEMBERSHIP = 'membership-a';
const CONTEXT = { workspaceId: WS, membershipId: MEMBERSHIP };

const createService = (foundUser: { id: string } | null) => {
  const findFirst = jest.fn().mockResolvedValue(foundUser);
  const accessed = new Set<string>();
  const prisma = new Proxy(
    {},
    {
      get(_t, prop) {
        const key = String(prop);
        accessed.add(key);
        if (key !== 'user') {
          throw new Error(
            `TrustedAhspActorService touched an unexpected Prisma model "${key}" — ` +
              'actor resolution may read only the user identity chain.',
          );
        }
        return { findFirst };
      },
    },
  ) as unknown as PrismaService;
  return { service: new TrustedAhspActorService(prisma), findFirst, accessed };
};

describe('TrustedAhspActorService', () => {
  it('resolves the User belonging to the guard-verified membership', async () => {
    const { service, findFirst } = createService({ id: 'user-a' });
    await expect(service.resolveActorUserId(CONTEXT)).resolves.toBe('user-a');
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('requires ACTIVE account, ACTIVE membership, ACTIVE user, and a matching workspace', async () => {
    const { service, findFirst } = createService({ id: 'user-a' });
    await service.resolveActorUserId(CONTEXT);

    const { where } = findFirst.mock.calls[0][0];
    expect(where.workspaceMembershipId).toBe(MEMBERSHIP);
    expect(where.workspaceId).toBe(WS);
    expect(where.status).toBe('ACTIVE');
    expect(where.membership.status).toBe('ACTIVE');
    expect(where.membership.account.status).toBe('ACTIVE');
    // The membership's OWN workspace is re-checked, so a context whose two
    // halves disagree cannot resolve an actor.
    expect(where.membership.workspaceId).toBe(WS);
  });

  it('never looks a User up by a client-supplied id', async () => {
    const { service, findFirst } = createService({ id: 'user-a' });
    await service.resolveActorUserId(CONTEXT);
    const { where } = findFirst.mock.calls[0][0];
    // Identity is reached only through the membership chain — there is no
    // `id:` lookup that a request body could ever steer.
    expect(where.id).toBeUndefined();
  });

  it('fails closed when the membership has no active user profile — no fallback actor', async () => {
    const { service } = createService(null);
    await expect(service.resolveActorUserId(CONTEXT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.resolveActorUserId(CONTEXT)).rejects.toThrow(
      'NO_TRUSTED_USER_PROFILE',
    );
  });

  it.each([
    ['missing context', undefined],
    ['empty context', {}],
    ['workspace without membership', { workspaceId: WS }],
    ['membership without workspace', { membershipId: MEMBERSHIP }],
    ['non-string membership', { workspaceId: WS, membershipId: 42 }],
  ])('rejects an unusable workspace context: %s', async (_label, context) => {
    const { service } = createService({ id: 'user-a' });
    await expect(service.resolveActorUserId(context)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('reads only the user identity chain — no other Prisma model is touched', async () => {
    const { service, accessed } = createService({ id: 'user-a' });
    await service.resolveActorUserId(CONTEXT);
    expect(accessed).toEqual(new Set(['user']));
  });
});
