export interface AhspEntity {
  ownershipType: 'SIMPROK_ASSET' | 'APPROVED_COMMUNITY_ASSET' | 'USER_ASSET';
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  archivedAt: Date | null;
  deletedAt: Date | null;
}

export class OwnershipViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnershipViolationError';
  }
}

export class AhspOwnershipPolicy {
  canUpdate(ahsp: AhspEntity, reason?: string): boolean {
    this.ensureNotDeleted(ahsp, 'update');
    this.ensureNotArchived(ahsp, 'update');

    if (ahsp.ownershipType === 'SIMPROK_ASSET') {
      throw new OwnershipViolationError('SIMPROK_ASSET cannot be updated.');
    }
    if (ahsp.ownershipType === 'APPROVED_COMMUNITY_ASSET') {
      throw new OwnershipViolationError('APPROVED_COMMUNITY_ASSET cannot be updated.');
    }

    this.ensureReasonProvided(reason, 'update');
    return true;
  }

  canRequestDeletion(ahsp: AhspEntity, reason?: string): boolean {
    this.ensureNotDeleted(ahsp, 'request deletion');
    this.ensureNotArchived(ahsp, 'request deletion');

    if (ahsp.ownershipType === 'SIMPROK_ASSET') {
      throw new OwnershipViolationError('SIMPROK_ASSET cannot request deletion.');
    }
    if (ahsp.ownershipType === 'APPROVED_COMMUNITY_ASSET') {
      throw new OwnershipViolationError('APPROVED_COMMUNITY_ASSET cannot request deletion.');
    }

    this.ensureReasonProvided(reason, 'request deletion');
    return true;
  }

  canArchive(ahsp: AhspEntity, reason?: string): boolean {
    this.ensureNotDeleted(ahsp, 'archive');
    this.ensureNotArchived(ahsp, 'archive again');

    if (ahsp.ownershipType === 'SIMPROK_ASSET') {
      throw new OwnershipViolationError('SIMPROK_ASSET cannot be archived.');
    }
    if (ahsp.ownershipType === 'APPROVED_COMMUNITY_ASSET') {
      throw new OwnershipViolationError('APPROVED_COMMUNITY_ASSET cannot be archived.');
    }

    this.ensureReasonProvided(reason, 'archive');
    return true;
  }

  canTransfer(ahsp: AhspEntity, reason?: string): boolean {
    this.ensureNotDeleted(ahsp, 'transfer');
    this.ensureNotArchived(ahsp, 'transfer');

    if (ahsp.ownershipType === 'SIMPROK_ASSET') {
      throw new OwnershipViolationError('SIMPROK_ASSET cannot be transferred.');
    }
    if (ahsp.reviewStatus !== 'APPROVED') {
      throw new OwnershipViolationError('Ownership transfer requires APPROVED review status.');
    }

    this.ensureReasonProvided(reason, 'transfer');
    return true;
  }

  canApprove(ahsp: AhspEntity): boolean {
    this.ensureNotDeleted(ahsp, 'approve');
    this.ensureNotArchived(ahsp, 'approve');
    return true;
  }

  private ensureNotDeleted(ahsp: AhspEntity, action: string): void {
    if (ahsp.deletedAt !== null) {
      throw new OwnershipViolationError(`Deleted AHSP cannot perform: ${action}.`);
    }
  }

  private ensureNotArchived(ahsp: AhspEntity, action: string): void {
    if (ahsp.archivedAt !== null) {
      throw new OwnershipViolationError(`Archived AHSP cannot perform: ${action}.`);
    }
  }

  private ensureReasonProvided(reason?: string, action?: string): void {
    if (!reason || !reason.trim()) {
      throw new OwnershipViolationError(`Reason is required to perform: ${action || 'mutation'}.`);
    }
  }
}
