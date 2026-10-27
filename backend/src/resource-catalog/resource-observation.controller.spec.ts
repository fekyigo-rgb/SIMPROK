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
