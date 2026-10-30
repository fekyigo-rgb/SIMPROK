import { Prisma } from '@prisma/client';
import { selectAuxiliaryEstimatePolicy } from './auxiliary-equipment-estimate.policy';

const asOf = new Date('2026-10-30T00:00:00.000Z');
const workspaceId = 'w1';
const ahspVersionId = 'v1';
const scope = { workspaceId, ahspVersionId, asOf };
const approvalDate = new Date('2026-10-01T00:00:00.000Z');

function policy(
  tier: 'AHSP_VERSION' | 'CLASSIFICATION_NODE' | 'WORKSPACE_FALLBACK',
  id: string,
  options: Record<string, any> = {},
): any {
  return {
    id, workspaceId, scopeKind: tier,
    ahspVersionId: tier === 'AHSP_VERSION' ? 'v1' : null,
    classificationNodeId: tier === 'CLASSIFICATION_NODE' ? 'sub1' : null,
    version: 1, decision: 'APPROVED', percent: new Prisma.Decimal('2.5'),
    evidenceReference: 'SYNTHETIC_APPROVED_EVIDENCE',
    approvalReference: 'SYNTHETIC_OWNER_APPROVAL',
    approvalAuthorityCode: 'AHSP_AUXILIARY_EQUIPMENT_ESTIMATE_APPROVE',
    approvedByAccountId: 'a1', approvedByPositionId: 'pos1',
    approvedByPositionAssignmentId: 'assign1',
    approvedByPositionAuthorityId: 'authority1',
    approvedAt: approvalDate,
    effectiveFrom: approvalDate, effectiveUntil: null,
    createdAt: approvalDate,
    approvedByPosition: { id: 'pos1', workspaceId },
    approvedByPositionAssignment: {
      id: 'assign1', positionId: 'pos1', assignedAt: new Date('2026-01-01'),
      removedAt: null, user: { workspaceId, membership: { accountId: 'a1', workspaceId } },
    },
    approvedByPositionAuthority: {
      id: 'authority1', positionId: 'pos1', assignedAt: new Date('2026-01-01'),
      revokedAt: null, authority: { code: 'AHSP_AUXILIARY_EQUIPMENT_ESTIMATE_APPROVE' },
    },
    ...options,
  };
}

function chain(leaf: string, sub = 'sub1') {
  return {
    id: leaf, level: 'JENIS_PEKERJAAN', isActive: true, workspaceId: null,
    parent: {
      id: sub, level: 'SUBKATEGORI', isActive: true, workspaceId: null,
      parent: {
        id: 'cat1', level: 'KATEGORI', isActive: true, workspaceId: null,
        parent: { id: 'root1', level: 'JENIS_PENGADAAN', isActive: true, workspaceId: null },
      },
    },
  };
}

function harness(policies: any[], nodes = [chain('leaf1')], ownerWorkspace = 'w1') {
  const version = {
    id: ahspVersionId, workspaceId: ownerWorkspace,
    ahsp: { classificationAssignments: nodes.map((leafNode) => ({ leafNode })) },
  };
  const tx = {
    aHSPVersion: { findUnique: jest.fn().mockResolvedValue(version) },
    auxiliaryEquipmentEstimatePolicy: {
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        const allowed = where.OR;
        return policies.filter((p) => {
          if (p.workspaceId !== where.workspaceId || p.effectiveFrom > where.effectiveFrom.lte) return false;
          return allowed.some((part: any) => {
            if (part.scopeKind !== p.scopeKind) return false;
            if (part.scopeKind === 'AHSP_VERSION') return p.ahspVersionId === part.ahspVersionId;
            if (part.scopeKind === 'CLASSIFICATION_NODE')
              return part.classificationNodeId.in.includes(p.classificationNodeId);
            return p.ahspVersionId === null && p.classificationNodeId === null;
          });
        }).sort((a,b) => b.version - a.version);
      }),
    },
  };
  return { tx, run: () => selectAuxiliaryEstimatePolicy(tx, scope) };
}

describe('ABLS-02 automatic policy tier inheritance (no project approval interaction)', () => {
  it('selects centrally approved workspace fallback with no AHSP classification', async () => {
    const fallback = policy('WORKSPACE_FALLBACK', 'f1');
    const { run, tx } = harness([fallback], []);
    const result = await run();
    expect(result).toMatchObject({ status: 'SELECTED', tier: 'WORKSPACE_FALLBACK', policy: { id: 'f1' } });
    expect(tx.auxiliaryEquipmentEstimatePolicy.findMany).toHaveBeenCalledTimes(1);
  });

  it('prefers exact AHSP-version policy over specific group and fallback', async () => {
    const result = await harness([
      policy('WORKSPACE_FALLBACK','f1'),
      policy('CLASSIFICATION_NODE','g1'),
      policy('AHSP_VERSION','v1'),
    ]).run();
    expect(result).toMatchObject({ status: 'SELECTED', tier: 'AHSP_VERSION', policy: { id: 'v1' } });
  });

  it('prefers deeper canonical classification policy over a broader group and fallback', async () => {
    const result = await harness([
      policy('WORKSPACE_FALLBACK','f1'),
      policy('CLASSIFICATION_NODE','c1', { classificationNodeId:'cat1' }),
      policy('CLASSIFICATION_NODE','s1', { classificationNodeId:'sub1' }),
    ]).run();
    expect(result).toMatchObject({ status: 'SELECTED', tier: 'CLASSIFICATION_NODE', policy: { id: 's1' } });
  });

  it('does not invent group eligibility from a free-text AHSP description', async () => {
    const result = await harness([
      policy('CLASSIFICATION_NODE','s1'),
      policy('WORKSPACE_FALLBACK','f1'),
    ], []).run();
    expect(result).toMatchObject({ status: 'SELECTED', tier: 'WORKSPACE_FALLBACK', policy: { id: 'f1' } });
  });

  it('holds rather than randomly choosing two equally deep classification paths', async () => {
    const result = await harness([
      policy('CLASSIFICATION_NODE','s1',{classificationNodeId:'sub1'}),
      policy('CLASSIFICATION_NODE','s2',{classificationNodeId:'sub2'}),
      policy('WORKSPACE_FALLBACK','f1'),
    ], [chain('leaf1','sub1'), chain('leaf2','sub2')]).run();
    expect(result).toMatchObject({ status: 'CONFLICT', reasonCode: 'AUXILIARY_ESTIMATE_POLICY_CLASSIFICATION_CONFLICT' });
  });

  it('blocks revoked direct authority instead of silently using fallback', async () => {
    const result = await harness([
      policy('AHSP_VERSION','v1',{decision:'REVOKED',percent:null}),
      policy('WORKSPACE_FALLBACK','f1'),
    ]).run();
    expect(result).toMatchObject({ status: 'BLOCKED' });
  });

  it('blocks a future-dated approval even when its effectiveFrom predates calculation', async () => {
    const result = await harness([
      policy('WORKSPACE_FALLBACK','f1',{approvedAt:new Date('2026-11-01')}),
    ]).run();
    expect(result).toMatchObject({ status: 'BLOCKED' });
  });

  it('prevents cross-workspace AHSP usage', async () => {
    const result = await harness([policy('WORKSPACE_FALLBACK','f1')], [], 'other-workspace').run();
    expect(result).toMatchObject({ status: 'BLOCKED', reasonCode:'AUXILIARY_ESTIMATE_POLICY_CROSS_WORKSPACE' });
  });

  it('never inherits a policy belonging to another workspace', async () => {
    const result = await harness([
      policy('WORKSPACE_FALLBACK','f1',{workspaceId:'other-workspace'}),
    ], []).run();
    expect(result).toMatchObject({ status: 'MISSING' });
  });

  it('uses newest applicable approved version within the same scope', async () => {
    const result = await harness([
      policy('WORKSPACE_FALLBACK','f1',{version:1}),
      policy('WORKSPACE_FALLBACK','f2',{version:2}),
    ], []).run();
    expect(result).toMatchObject({ status:'SELECTED', policy:{id:'f2'} });
  });

  it('does not backdate an expired policy or fabricate a percentage', async () => {
    const result = await harness([
      policy('WORKSPACE_FALLBACK','f1',{effectiveUntil:new Date('2026-10-25')}),
    ], []).run();
    expect(result).toMatchObject({status:'MISSING'});
  });

  it('requires an active canonical node chain for inheritance', async () => {
    const inactive = chain('leaf1');
    inactive.parent.isActive = false;
    const result = await harness([
      policy('CLASSIFICATION_NODE','g1'),
      policy('WORKSPACE_FALLBACK','f1'),
    ], [inactive]).run();
    expect(result).toMatchObject({status:'SELECTED',tier:'WORKSPACE_FALLBACK'});
  });

  it('does not inherit even leaf-level rate when its canonical parent is inactive', async () => {
    const inactive = chain('leaf1');
    inactive.parent.isActive = false;
    const result = await harness([
      policy('CLASSIFICATION_NODE','leaf-rate',{classificationNodeId:'leaf1'}),
      policy('WORKSPACE_FALLBACK','safe-fallback'),
    ], [inactive]).run();
    expect(result).toMatchObject({status:'SELECTED',tier:'WORKSPACE_FALLBACK',policy:{id:'safe-fallback'}});
  });

  it('refuses malformed canonical level order instead of claiming inherited certainty', async () => {
    const malformed = chain('leaf1');
    malformed.parent.level = 'KATEGORI';
    const result = await harness([
      policy('CLASSIFICATION_NODE','leaf-rate',{classificationNodeId:'leaf1'}),
      policy('WORKSPACE_FALLBACK','safe-fallback'),
    ], [malformed]).run();
    expect(result).toMatchObject({status:'SELECTED',tier:'WORKSPACE_FALLBACK',policy:{id:'safe-fallback'}});
  });

  it('permits a uniquely approved active canonical leaf policy', async () => {
    const result = await harness([
      policy('CLASSIFICATION_NODE','leaf-rate',{classificationNodeId:'leaf1'}),
      policy('CLASSIFICATION_NODE','sub-rate',{classificationNodeId:'sub1'}),
      policy('WORKSPACE_FALLBACK','safe-fallback'),
    ]).run();
    expect(result).toMatchObject({status:'SELECTED',tier:'CLASSIFICATION_NODE',policy:{id:'leaf-rate'}});
  });

  it('blocks unauthorized workspace fallback without requiring an end-user prompt', async () => {
    const result = await harness([
      policy('WORKSPACE_FALLBACK','f1',{approvedByPositionAuthority:{id:'authority1',positionId:'pos1',assignedAt:new Date('2026-01-01'),revokedAt:new Date('2026-09-01'),authority:{code:'AHSP_AUXILIARY_EQUIPMENT_ESTIMATE_APPROVE'}}}),
    ], []).run();
    expect(result).toMatchObject({status:'BLOCKED'});
  });
});
