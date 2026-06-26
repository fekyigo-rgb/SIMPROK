import { AhspOwnershipPolicy, AhspEntity, OwnershipViolationError } from './ahsp-ownership.policy';

describe('AhspOwnershipPolicy', () => {
  let policy: AhspOwnershipPolicy;

  beforeEach(() => {
    policy = new AhspOwnershipPolicy();
  });

  const createBaseAhsp = (overrides?: Partial<AhspEntity>): AhspEntity => ({
    ownershipType: 'USER_ASSET',
    reviewStatus: 'PENDING',
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  });

  describe('General Guard Rails (Deleted & Archived)', () => {
    it('should throw when performing any action on a deleted AHSP', () => {
      const deletedAhsp = createBaseAhsp({ deletedAt: new Date() });

      expect(() => policy.canUpdate(deletedAhsp, 'reason')).toThrow(OwnershipViolationError);
      expect(() => policy.canRequestDeletion(deletedAhsp, 'reason')).toThrow(OwnershipViolationError);
      expect(() => policy.canArchive(deletedAhsp, 'reason')).toThrow(OwnershipViolationError);
      expect(() => policy.canTransfer(deletedAhsp, 'reason')).toThrow(OwnershipViolationError);
      expect(() => policy.canApprove(deletedAhsp)).toThrow(OwnershipViolationError);
    });

    it('should throw when performing any action on an archived AHSP', () => {
      const archivedAhsp = createBaseAhsp({ archivedAt: new Date() });

      expect(() => policy.canUpdate(archivedAhsp, 'reason')).toThrow(OwnershipViolationError);
      expect(() => policy.canRequestDeletion(archivedAhsp, 'reason')).toThrow(OwnershipViolationError);
      expect(() => policy.canArchive(archivedAhsp, 'reason')).toThrow(OwnershipViolationError);
      expect(() => policy.canTransfer(archivedAhsp, 'reason')).toThrow(OwnershipViolationError);
      expect(() => policy.canApprove(archivedAhsp)).toThrow(OwnershipViolationError);
    });
  });

  describe('canUpdate', () => {
    it('6. SIMPROK_ASSET cannot update', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'SIMPROK_ASSET' });
      expect(() => policy.canUpdate(ahsp, 'some reason')).toThrow('SIMPROK_ASSET cannot be updated.');
    });

    it('7. APPROVED_COMMUNITY_ASSET cannot update', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'APPROVED_COMMUNITY_ASSET' });
      expect(() => policy.canUpdate(ahsp, 'some reason')).toThrow('APPROVED_COMMUNITY_ASSET cannot be updated.');
    });

    it('5. USER_ASSET update requires reason', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'USER_ASSET' });
      expect(() => policy.canUpdate(ahsp, '')).toThrow('Reason is required to perform: update.');
      expect(() => policy.canUpdate(ahsp, '   ')).toThrow('Reason is required to perform: update.');
      expect(() => policy.canUpdate(ahsp, undefined)).toThrow('Reason is required to perform: update.');
    });

    it('USER_ASSET can update with valid reason', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'USER_ASSET' });
      expect(policy.canUpdate(ahsp, 'valid reason')).toBe(true);
    });
  });

  describe('canRequestDeletion', () => {
    it('1. SIMPROK_ASSET cannot request deletion', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'SIMPROK_ASSET' });
      expect(() => policy.canRequestDeletion(ahsp, 'reason')).toThrow('SIMPROK_ASSET cannot request deletion.');
    });

    it('2. APPROVED_COMMUNITY_ASSET cannot request deletion', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'APPROVED_COMMUNITY_ASSET' });
      expect(() => policy.canRequestDeletion(ahsp, 'reason')).toThrow('APPROVED_COMMUNITY_ASSET cannot request deletion.');
    });

    it('3. USER_ASSET can request deletion', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'USER_ASSET' });
      expect(policy.canRequestDeletion(ahsp, 'reason')).toBe(true);
    });

    it('USER_ASSET request deletion requires reason', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'USER_ASSET' });
      expect(() => policy.canRequestDeletion(ahsp, '')).toThrow('Reason is required to perform: request deletion.');
    });
  });

  describe('canArchive', () => {
    it('SIMPROK_ASSET cannot archive', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'SIMPROK_ASSET' });
      expect(() => policy.canArchive(ahsp, 'reason')).toThrow('SIMPROK_ASSET cannot be archived.');
    });

    it('APPROVED_COMMUNITY_ASSET cannot archive', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'APPROVED_COMMUNITY_ASSET' });
      expect(() => policy.canArchive(ahsp, 'reason')).toThrow('APPROVED_COMMUNITY_ASSET cannot be archived.');
    });

    it('USER_ASSET can archive with reason', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'USER_ASSET' });
      expect(policy.canArchive(ahsp, 'reason')).toBe(true);
    });

    it('USER_ASSET archive requires reason', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'USER_ASSET' });
      expect(() => policy.canArchive(ahsp, '')).toThrow('Reason is required to perform: archive.');
    });
  });

  describe('canTransfer', () => {
    it('SIMPROK_ASSET cannot transfer', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'SIMPROK_ASSET', reviewStatus: 'APPROVED' });
      expect(() => policy.canTransfer(ahsp, 'reason')).toThrow('SIMPROK_ASSET cannot be transferred.');
    });

    it('4. Ownership transfer requires APPROVED status', () => {
      const ahspPending = createBaseAhsp({ ownershipType: 'USER_ASSET', reviewStatus: 'PENDING' });
      const ahspRejected = createBaseAhsp({ ownershipType: 'USER_ASSET', reviewStatus: 'REJECTED' });

      expect(() => policy.canTransfer(ahspPending, 'reason')).toThrow('Ownership transfer requires APPROVED review status.');
      expect(() => policy.canTransfer(ahspRejected, 'reason')).toThrow('Ownership transfer requires APPROVED review status.');
    });

    it('USER_ASSET with APPROVED status can transfer with reason', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'USER_ASSET', reviewStatus: 'APPROVED' });
      expect(policy.canTransfer(ahsp, 'transfer reason')).toBe(true);
    });

    it('USER_ASSET transfer requires reason', () => {
      const ahsp = createBaseAhsp({ ownershipType: 'USER_ASSET', reviewStatus: 'APPROVED' });
      expect(() => policy.canTransfer(ahsp, '')).toThrow('Reason is required to perform: transfer.');
    });
  });

  describe('canApprove', () => {
    it('should return true for valid active status', () => {
      const ahsp = createBaseAhsp();
      expect(policy.canApprove(ahsp)).toBe(true);
    });
  });
});
