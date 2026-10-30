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
      ((policy.scopeKind ?? 'AHSP_VERSION') !== 'AHSP_VERSION' || policy.ahspVersionId === scope.ahspVersionId) &&
      policy.percent !== null &&
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

export type AuxiliaryPolicySelection =
  | { status: 'SELECTED'; policy: any; tier: 'AHSP_VERSION' | 'CLASSIFICATION_NODE' | 'WORKSPACE_FALLBACK' }
  | { status: 'MISSING' | 'CONFLICT' | 'BLOCKED'; reasonCode: string };

const LEVEL_DEPTH: Record<string, number> = {
  JENIS_PENGADAAN: 1,
  KATEGORI: 2,
  SUBKATEGORI: 3,
  JENIS_PEKERJAAN: 4,
};

/** One selector for prospective resolution and the RAB save/pre-lock gate. */
export async function selectAuxiliaryEstimatePolicy(
  tx: any,
  scope: { workspaceId: string; ahspVersionId: string; asOf: Date },
): Promise<AuxiliaryPolicySelection> {
  const version = await tx.aHSPVersion.findUnique({
    where: { id: scope.ahspVersionId },
    select: {
      id: true,
      workspaceId: true,
      ahsp: {
        select: {
          classificationAssignments: {
            where: { isActive: true },
            select: {
              leafNode: {
                select: {
                  id: true, level: true, isActive: true, workspaceId: true,
                  parent: { select: {
                    id: true, level: true, isActive: true, workspaceId: true,
                    parent: { select: {
                      id: true, level: true, isActive: true, workspaceId: true,
                      parent: { select: { id: true, level: true, isActive: true, workspaceId: true } },
                    } },
                  } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!version || (version.workspaceId !== null && version.workspaceId !== scope.workspaceId)) {
    return { status: 'BLOCKED', reasonCode: 'AUXILIARY_ESTIMATE_POLICY_CROSS_WORKSPACE' };
  }

  const nodes = new Map<string, { id: string; depth: number }>();
  for (const assignment of version.ahsp.classificationAssignments) {
    let node: any = assignment.leafNode;
    let expectedDepth = LEVEL_DEPTH.JENIS_PEKERJAAN;
    const path: Array<{ id: string; depth: number }> = [];
    while (node) {
      // An inherited rate requires the complete, active canonical ancestry:
      // a malformed or inactive parent must not leave an eligible leaf behind.
      if (!node.isActive || LEVEL_DEPTH[node.level] !== expectedDepth ||
          (node.workspaceId !== null && node.workspaceId !== scope.workspaceId)) break;
      path.push({ id: node.id, depth: expectedDepth });
      expectedDepth -= 1;
      node = node.parent;
    }
    if (node != null || expectedDepth !== 0) continue;
    for (const canonical of path) nodes.set(canonical.id, canonical);
  }

  const policies = await tx.auxiliaryEquipmentEstimatePolicy.findMany({
    where: {
      workspaceId: scope.workspaceId,
      effectiveFrom: { lte: scope.asOf },
      OR: [
        { scopeKind: 'AHSP_VERSION', ahspVersionId: scope.ahspVersionId },
        ...(nodes.size ? [{ scopeKind: 'CLASSIFICATION_NODE', classificationNodeId: { in: [...nodes.keys()] } }] : []),
        { scopeKind: 'WORKSPACE_FALLBACK', ahspVersionId: null, classificationNodeId: null },
      ],
    },
    orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
    include: auxiliaryPolicyGovernanceInclude,
  });
  const current = policies.filter((policy: any) =>
    policy.effectiveUntil === null || policy.effectiveUntil >= scope.asOf);
  const direct = current.find((policy: any) => (policy.scopeKind ?? 'AHSP_VERSION') === 'AHSP_VERSION');
  if (direct) return policyVerdict(direct, scope, 'AHSP_VERSION');

  const classified = current.filter((policy: any) => policy.scopeKind === 'CLASSIFICATION_NODE');
  if (classified.length) {
    const maxDepth = Math.max(...classified.map((policy: any) => nodes.get(policy.classificationNodeId)?.depth ?? 0));
    const atDepth = classified.filter((policy: any) => nodes.get(policy.classificationNodeId)?.depth === maxDepth);
    const nodeIds = [...new Set(atDepth.map((policy: any) => policy.classificationNodeId))];
    if (nodeIds.length > 1) {
      return { status: 'CONFLICT', reasonCode: 'AUXILIARY_ESTIMATE_POLICY_CLASSIFICATION_CONFLICT' };
    }
    return policyVerdict(atDepth[0], scope, 'CLASSIFICATION_NODE');
  }
  const fallback = current.find((policy: any) => policy.scopeKind === 'WORKSPACE_FALLBACK');
  return fallback
    ? policyVerdict(fallback, scope, 'WORKSPACE_FALLBACK')
    : { status: 'MISSING', reasonCode: 'AUXILIARY_ESTIMATE_POLICY_MISSING' };
}

function policyVerdict(
  policy: any,
  scope: { workspaceId: string; ahspVersionId: string; asOf: Date },
  tier: 'AHSP_VERSION' | 'CLASSIFICATION_NODE' | 'WORKSPACE_FALLBACK',
): AuxiliaryPolicySelection {
  if (!approvedAuxiliaryPolicyIsGoverned(policy, scope)) {
    return { status: 'BLOCKED', reasonCode: 'AUXILIARY_ESTIMATE_POLICY_UNAUTHORIZED' };
  }
  return { status: 'SELECTED', policy, tier };
}
