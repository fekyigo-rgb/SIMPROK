import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  PERMISSIONS_ALL_KEY,
  PERMISSIONS_KEY,
} from '../common/decorators/permissions.decorator';
import { ResourceObservationController } from './resource-observation.controller';

/**
 * IQL-01 second holder — the permission boundary, route by route. The existing
 * PermissionsGuard reads @Permissions with OR semantics, so "DECIDE or
 * QUESTION_APPROVE" opens a route to either holder and to nobody else.
 */
describe('ResourceObservationController — permission boundary', () => {
  const DECIDE = 'AHSP_RESOURCE_IDENTITY_DECIDE';
  const JUDGE = 'AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE';
  const required = (handler: keyof ResourceObservationController) =>
    Reflect.getMetadata(
      PERMISSIONS_KEY,
      ResourceObservationController.prototype[handler],
    ) as string[];

  it.each(['listQuestions', 'approveQuestion', 'rejectQuestion'] as const)(
    '%s is open to a curator OR the second holder — nothing wider',
    (handler) => {
      expect(required(handler)).toEqual([DECIDE, JUDGE]);
      expect(
        Reflect.getMetadata(
          PERMISSIONS_ALL_KEY,
          ResourceObservationController.prototype[handler],
        ),
      ).toBeUndefined();
    },
  );

  it.each([
    'list',
    'curateExisting',
    'curateNew',
    'readNameReviews',
    'appendNameReview',
    'supersedeQuestion',
    'revokeQuestion',
    'correctCatalogName',
  ] as const)(
    '%s stays curator-only: the second holder can never decide rows, teach, revoke or supersede',
    (handler) => {
      expect(required(handler)).toEqual([DECIDE]);
    },
  );

  it('listQuestions derives the curator doors from the ONE permission resolver', async () => {
    const listQuestions = jest.fn(() => Promise.resolve([]));
    const resolve = jest.fn();
    const controller = new ResourceObservationController(
      { listQuestions } as never,
      { resolve } as never,
      {} as never,
      {} as never,
    );
    const request = {
      user: { id: 'acct-verifier' },
      workspaceContext: { workspaceId: 'ws-A' },
    };

    resolve.mockResolvedValueOnce({ membershipId: 'm', permissions: [JUDGE] });
    await controller.listQuestions(request);
    expect(resolve).toHaveBeenLastCalledWith('acct-verifier', 'ws-A');
    expect(listQuestions).toHaveBeenLastCalledWith('ws-A', 'acct-verifier', {
      mayDecide: false,
    });

    resolve.mockResolvedValueOnce({
      membershipId: 'm',
      permissions: [DECIDE, JUDGE],
    });
    await controller.listQuestions(request);
    expect(listQuestions).toHaveBeenLastCalledWith('ws-A', 'acct-verifier', {
      mayDecide: true,
    });

    // No membership resolved → fail closed: judging doors only.
    resolve.mockResolvedValueOnce(null);
    await controller.listQuestions(request);
    expect(listQuestions).toHaveBeenLastCalledWith('ws-A', 'acct-verifier', {
      mayDecide: false,
    });
  });

  it('binds name-review read/write to guard-derived workspace and actor only', async () => {
    const read = jest.fn().mockResolvedValue({ currentVersion: 0 });
    const append = jest.fn().mockResolvedValue({ version: 1 });
    const controller = new ResourceObservationController(
      {} as never,
      {} as never,
      {} as never,
      { read, append } as never,
    );
    const request = {
      user: { id: 'acct-curator' },
      workspaceContext: { workspaceId: 'ws-A' },
    };

    await controller.readNameReviews(request, 'obs-1');
    expect(read).toHaveBeenCalledWith('ws-A', 'obs-1');

    await controller.appendNameReview(request, 'obs-1', {
      expectedVersion: 0,
      sourceFactsFingerprint: 'a'.repeat(64),
      reviewedName: 'FLAT BED TRUCK 4 TON',
      reason: 'Transposisi huruf.',
      evidence: 'Judul sumber.',
    });
    expect(append).toHaveBeenCalledWith({
      workspaceId: 'ws-A',
      observationId: 'obs-1',
      actorAccountId: 'acct-curator',
      expectedVersion: 0,
      expectedSourceFactsFingerprint: 'a'.repeat(64),
      reviewedName: 'FLAT BED TRUCK 4 TON',
      reason: 'Transposisi huruf.',
      evidence: 'Judul sumber.',
    });
  });
});


describe('BP-C3 shared catalog curation — real PermissionsGuard boundary (no database writes)', () => {
  const guardedRoutes = [
    'correctCatalogName',
    'readNameReviews',
    'appendNameReview',
  ] as const;

  const setupGuard = (
    handler: (typeof guardedRoutes)[number],
    workspaceId = 'workspace-a',
  ) => {
    const resolver = { resolve: jest.fn() };
    const guard = new PermissionsGuard(
      new Reflector(),
      resolver as never,
    );
    const request: any = {
      user: { id: 'account-a' },
      headers: { 'x-workspace-id': workspaceId },
      query: {},
      params: {},
      method: handler === 'readNameReviews' ? 'GET' : 'POST',
      route: { path: '/resource-observations/_guarded' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ResourceObservationController.prototype[handler],
      getClass: () => ResourceObservationController,
    } as never;
    return { guard, resolver, request, context };
  };

  it.each(guardedRoutes)(
    '%s denies question-only/noncurator actor BEFORE any service call',
    async (handler) => {
      const x = setupGuard(handler);
      x.resolver.resolve.mockResolvedValue({
        membershipId: 'membership-a',
        permissions: ['AHSP_RESOURCE_IDENTITY_QUESTION_APPROVE'],
      });
      await expect(x.guard.canActivate(x.context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(x.resolver.resolve).toHaveBeenCalledWith(
        'account-a',
        'workspace-a',
      );
      expect(x.request.workspaceContext).toBeUndefined();
    },
  );

  it.each(guardedRoutes)(
    '%s denies workspace without membership even for a catalog-curator role elsewhere',
    async (handler) => {
      const x = setupGuard(handler, 'workspace-foreign');
      x.resolver.resolve.mockResolvedValue(null);
      await expect(x.guard.canActivate(x.context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(x.resolver.resolve).toHaveBeenCalledWith(
        'account-a',
        'workspace-foreign',
      );
      expect(x.request.workspaceContext).toBeUndefined();
    },
  );

  it.each(guardedRoutes)(
    '%s accepts curator only in its resolved workspace, with no mutation',
    async (handler) => {
      const x = setupGuard(handler);
      x.resolver.resolve.mockResolvedValue({
        membershipId: 'membership-a',
        permissions: ['AHSP_RESOURCE_IDENTITY_DECIDE'],
      });
      await expect(x.guard.canActivate(x.context)).resolves.toBe(true);
      expect(x.request.workspaceContext).toEqual({
        workspaceId: 'workspace-a',
        membershipId: 'membership-a',
      });
    },
  );
});
