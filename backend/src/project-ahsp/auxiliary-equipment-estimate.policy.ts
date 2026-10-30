import { Prisma } from '@prisma/client';

export const AUXILIARY_ESTIMATE_APPROVAL_AUTHORITY =
  'AHSP_AUXILIARY_EQUIPMENT_ESTIMATE_APPROVE';

export function normalizedAuxiliaryName(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('id-ID');
}

export function approvedAuxiliaryPolicyIsGoverned(
  policy: any,
  scope: { workspaceId: string; ahspVersionId: string; asOf: Date },
): boolean {
  const approvedAt = policy?.approvedAt instanceof Date ? policy.approvedAt : null;
  const assignment = policy?.approvedByPositionAssignment;
  const authority = policy?.approvedByPositionAuthority;
  try {
    return Boolean(
      scope.asOf instanceof Date && !Number.isNaN(scope.asOf.getTime()) &&
      approvedAt !== null && approvedAt.getTime() <= scope.asOf.getTime() &&
      policy?.effectiveFrom instanceof Date && policy.effectiveFrom <= scope.asOf &&
      (policy.effectiveUntil === null || (policy.effectiveUntil instanceof Date && policy.effectiveUntil >= scope.asOf)) &&
      policy?.decision === 'APPROVED' && policy.workspaceId === scope.workspaceId &&
      policy.ahspVersionId === scope.ahspVersionId && policy.percent !== null &&
      new Prisma.Decimal(policy.percent).greaterThan(0) &&
      new Prisma.Decimal(policy.percent).lessThanOrEqualTo(100) &&
      policy.approvalReference && policy.evidenceReference && approvedAt &&
      policy.approvalAuthorityCode === AUXILIARY_ESTIMATE_APPROVAL_AUTHORITY &&
      policy.approvedByPosition?.workspaceId === scope.workspaceId &&
      assignment?.positionId === policy.approvedByPositionId &&
      assignment?.user?.membership?.accountId === policy.approvedByAccountId &&
      assignment?.user?.workspaceId === scope.workspaceId &&
      assignment?.user?.membership?.workspaceId === scope.workspaceId &&
      assignment?.assignedAt <= approvedAt &&
      (assignment.removedAt === null || assignment.removedAt >= approvedAt) &&
      authority?.positionId === policy.approvedByPositionId &&
      authority?.authority?.code === AUXILIARY_ESTIMATE_APPROVAL_AUTHORITY &&
      authority?.assignedAt <= approvedAt &&
      (authority.revokedAt === null || authority.revokedAt >= approvedAt)
    );
  } catch {
    return false;
  }
}

export const auxiliaryPolicyGovernanceInclude = {
  approvedByPosition: true,
  approvedByPositionAssignment: { include: { user: { include: { membership: true } } } },
  approvedByPositionAuthority: { include: { authority: true } },
} as const;
