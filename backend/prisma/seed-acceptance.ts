import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const PASSWORD = 'Test1234!';
const SALT_ROUNDS = 10;

const ids = {
  permissionProjectView: '10000000-0000-4000-8000-000000000001',
  orgA: '10000000-0000-4000-8000-000000000002',
  orgB: '10000000-0000-4000-8000-000000000003',
  workspaceA: '10000000-0000-4000-8000-000000000004',
  workspaceB: '10000000-0000-4000-8000-000000000005',
  roleAcceptanceMember: '10000000-0000-4000-8000-000000000006',
  accountAssigned: '10000000-0000-4000-8000-000000000007',
  accountNonassigned: '10000000-0000-4000-8000-000000000008',
  accountCrosstenant: '10000000-0000-4000-8000-000000000009',
  membershipAssigned: '10000000-0000-4000-8000-000000000010',
  membershipNonassigned: '10000000-0000-4000-8000-000000000011',
  membershipCrosstenant: '10000000-0000-4000-8000-000000000012',
  userAssigned: '10000000-0000-4000-8000-000000000013',
  userNonassigned: '10000000-0000-4000-8000-000000000014',
  userCrosstenant: '10000000-0000-4000-8000-000000000015',
  membershipRoleAssigned: '10000000-0000-4000-8000-000000000016',
  membershipRoleNonassigned: '10000000-0000-4000-8000-000000000017',
  projectX: '10000000-0000-4000-8000-000000000018',
  projectAssignmentAssigned: '10000000-0000-4000-8000-000000000019',
  roleForeman: '10000000-0000-4000-8000-000000000020',
  accountForeman: '10000000-0000-4000-8000-000000000021',
  membershipForeman: '10000000-0000-4000-8000-000000000022',
  userForeman: '10000000-0000-4000-8000-000000000023',
  membershipRoleForeman: '10000000-0000-4000-8000-000000000024',
  projectAssignmentForeman: '10000000-0000-4000-8000-000000000025',
  permissionBasicPriceView: '10000000-0000-4000-8000-000000000026',
  permissionProjectCreate: '10000000-0000-4000-8000-000000000027',
  permissionAuthorityView: '10000000-0000-4000-8000-000000000028',
  permissionAuthorityManage: '10000000-0000-4000-8000-000000000029',
  permissionApprovalMatrixManage: '10000000-0000-4000-8000-000000000030',
  permissionApprovalMatrixView: '10000000-0000-4000-8000-000000000031',
  permissionAuthorityAssign: '10000000-0000-4000-8000-000000000032',
  permissionObservatoryView: '10000000-0000-4000-8000-000000000033',
  permissionFieldProgressSubmit: '10000000-0000-4000-8000-000000000034',
  permissionRabView: '10000000-0000-4000-8000-000000000035',
  permissionRabDraftEdit: '10000000-0000-4000-8000-000000000036',
  projectRabDraftProof: '10000000-0000-4000-8000-000000000037',
  projectAssignmentRabDraftProof: '10000000-0000-4000-8000-000000000038',
  boqStructureRabDraftProof: '10000000-0000-4000-8000-000000000039',
  roleAcceptanceProjectCreator: '10000000-0000-4000-8000-000000000040',
  membershipRoleAssignedProjectCreator: '10000000-0000-4000-8000-000000000041',
  roleAcceptanceFrontendDoorDirector: '10000000-0000-4000-8000-000000000042',
  membershipRoleAssignedFrontendDoorDirector: '10000000-0000-4000-8000-000000000043',
  projectMonitoringProof: '10000000-0000-4000-8000-000000000044',
  projectAssignmentMonitoringProof: '10000000-0000-4000-8000-000000000045',
  boqStructureMonitoringProof: '10000000-0000-4000-8000-000000000046',
  boqItemMonitoringPositive: '10000000-0000-4000-8000-000000000047',
  boqItemMonitoringAbsent: '10000000-0000-4000-8000-000000000048',
  boqItemMonitoringZero: '10000000-0000-4000-8000-000000000049',
  rabMonitoringProof: '10000000-0000-4000-8000-000000000050',
  baselineMonitoringProof: '10000000-0000-4000-8000-000000000051',
  progressReportMonitoringProof: '10000000-0000-4000-8000-000000000052',
  progressEntryMonitoringPositive: '10000000-0000-4000-8000-000000000053',
  progressEntryMonitoringZero: '10000000-0000-4000-8000-000000000054',
  positionForemanProgressAuthority: '10000000-0000-4000-8000-000000000055',
  positionAssignmentForemanProgressAuthority: '10000000-0000-4000-8000-000000000056',
  authorityProgressVerify: '10000000-0000-4000-8000-000000000057',
  authorityProgressCorrect: '10000000-0000-4000-8000-000000000058',
  authorityProgressAccept: '10000000-0000-4000-8000-000000000059',
  projectAssignmentForemanMonitoringProof: '10000000-0000-4000-8000-000000000060',
};

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, SALT_ROUNDS);

  const permission = await prisma.permission.upsert({
    where: { code: 'PROJECT_VIEW' },
    update: { name: 'View Projects' },
    create: {
      id: ids.permissionProjectView,
      code: 'PROJECT_VIEW',
      name: 'View Projects',
    },
  });

  const canonicalPermissions = [
    {
      id: ids.permissionBasicPriceView,
      code: 'BASIC_PRICE_VIEW',
      name: 'Basic Price View',
    },
    {
      id: ids.permissionProjectCreate,
      code: 'PROJECT_CREATE',
      name: 'Project Create',
    },
    {
      id: ids.permissionAuthorityView,
      code: 'AUTHORITY_VIEW',
      name: 'Auth View',
    },
    {
      id: ids.permissionAuthorityManage,
      code: 'AUTHORITY_MANAGE',
      name: 'Auth Manage',
    },
    {
      id: ids.permissionApprovalMatrixManage,
      code: 'APPROVAL_MATRIX_MANAGE',
      name: 'App Manage',
    },
    {
      id: ids.permissionApprovalMatrixView,
      code: 'APPROVAL_MATRIX_VIEW',
      name: 'App View',
    },
    {
      id: ids.permissionAuthorityAssign,
      code: 'AUTHORITY_ASSIGN',
      name: 'Auth Assign',
    },
    {
      id: ids.permissionObservatoryView,
      code: 'OBSERVATORY_VIEW',
      name: 'Observatory View',
    },
    {
      id: ids.permissionFieldProgressSubmit,
      code: 'FIELD_PROGRESS_SUBMIT',
      name: 'Submit Progress',
    },
    { id: ids.permissionRabView, code: 'RAB_VIEW', name: 'RAB View' },
    { id: ids.permissionRabDraftEdit, code: 'RAB_DRAFT_EDIT', name: 'RAB Draft Edit' },
  ];

  await Promise.all(
    canonicalPermissions.map((canonicalPermission) =>
      prisma.permission.upsert({
        where: { code: canonicalPermission.code },
        update: { name: canonicalPermission.name },
        create: canonicalPermission,
      }),
    ),
  );

  const orgA = await prisma.organization.upsert({
    where: { id: ids.orgA },
    update: { name: 'Org-A', type: 'COMPANY' },
    create: {
      id: ids.orgA,
      name: 'Org-A',
      type: 'COMPANY',
    },
  });

  const orgB = await prisma.organization.upsert({
    where: { id: ids.orgB },
    update: { name: 'Org-B', type: 'COMPANY' },
    create: {
      id: ids.orgB,
      name: 'Org-B',
      type: 'COMPANY',
    },
  });

  const workspaceA = await prisma.workspace.upsert({
    where: { id: ids.workspaceA },
    update: {
      name: 'Workspace-A',
      organizationId: orgA.id,
    },
    create: {
      id: ids.workspaceA,
      name: 'Workspace-A',
      organizationId: orgA.id,
    },
  });

  const workspaceB = await prisma.workspace.upsert({
    where: { id: ids.workspaceB },
    update: {
      name: 'Workspace-B',
      organizationId: orgB.id,
    },
    create: {
      id: ids.workspaceB,
      name: 'Workspace-B',
      organizationId: orgB.id,
    },
  });

  const role = await prisma.role.upsert({
    where: {
      workspaceId_code: {
        workspaceId: workspaceA.id,
        code: 'ACCEPTANCE_MEMBER',
      },
    },
    update: {
      name: 'Acceptance Member',
      description: 'Acceptance test member role',
      isSystem: false,
    },
    create: {
      id: ids.roleAcceptanceMember,
      workspaceId: workspaceA.id,
      code: 'ACCEPTANCE_MEMBER',
      name: 'Acceptance Member',
      description: 'Acceptance test member role',
      isSystem: false,
    },
  });

  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: role.id,
        permissionId: permission.id,
      },
    },
    update: {},
    create: {
      roleId: role.id,
      permissionId: permission.id,
    },
  });

  for (const permissionId of [ids.permissionRabView, ids.permissionRabDraftEdit]) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId } },
      update: {},
      create: { roleId: role.id, permissionId },
    });
  }

  const assignedAccount = await prisma.account.upsert({
    where: { email: 'assigned@test.local' },
    update: {
      passwordHash,
      displayName: 'Assigned Acceptance User',
      status: 'ACTIVE',
    },
    create: {
      id: ids.accountAssigned,
      email: 'assigned@test.local',
      passwordHash,
      displayName: 'Assigned Acceptance User',
      status: 'ACTIVE',
    },
  });

  const nonassignedAccount = await prisma.account.upsert({
    where: { email: 'nonassigned@test.local' },
    update: {
      passwordHash,
      displayName: 'Nonassigned Acceptance User',
      status: 'ACTIVE',
    },
    create: {
      id: ids.accountNonassigned,
      email: 'nonassigned@test.local',
      passwordHash,
      displayName: 'Nonassigned Acceptance User',
      status: 'ACTIVE',
    },
  });

  const crosstenantAccount = await prisma.account.upsert({
    where: { email: 'crosstenant@test.local' },
    update: {
      passwordHash,
      displayName: 'Cross-Tenant Acceptance User',
      status: 'ACTIVE',
    },
    create: {
      id: ids.accountCrosstenant,
      email: 'crosstenant@test.local',
      passwordHash,
      displayName: 'Cross-Tenant Acceptance User',
      status: 'ACTIVE',
    },
  });

  const assignedMembership = await prisma.workspaceMembership.upsert({
    where: {
      accountId_workspaceId: {
        accountId: assignedAccount.id,
        workspaceId: workspaceA.id,
      },
    },
    update: { status: 'ACTIVE' },
    create: {
      id: ids.membershipAssigned,
      accountId: assignedAccount.id,
      workspaceId: workspaceA.id,
      status: 'ACTIVE',
    },
  });

  // Second, additional role granting PROJECT_CREATE to assigned@test.local
  // specifically — not added to the shared ACCEPTANCE_MEMBER role, so
  // nonassigned@test.local (which also holds ACCEPTANCE_MEMBER) does not
  // gain PROJECT_CREATE as a side effect. This lets assigned@test.local
  // (PROJECT_CREATE + RAB_VIEW + RAB_DRAFT_EDIT together) run the full
  // Buat Proyek -> Lanjutkan Draft -> Import BOQ browser journey end to end.
  const roleAcceptanceProjectCreator = await prisma.role.upsert({
    where: {
      workspaceId_code: {
        workspaceId: workspaceA.id,
        code: 'ACCEPTANCE_PROJECT_CREATOR',
      },
    },
    update: {
      name: 'Acceptance Project Creator',
      description: 'Grants PROJECT_CREATE to the assigned acceptance member only',
      isSystem: false,
    },
    create: {
      id: ids.roleAcceptanceProjectCreator,
      workspaceId: workspaceA.id,
      code: 'ACCEPTANCE_PROJECT_CREATOR',
      name: 'Acceptance Project Creator',
      description: 'Grants PROJECT_CREATE to the assigned acceptance member only',
      isSystem: false,
    },
  });

  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: roleAcceptanceProjectCreator.id, permissionId: ids.permissionProjectCreate } },
    update: {},
    create: { roleId: roleAcceptanceProjectCreator.id, permissionId: ids.permissionProjectCreate },
  });

  await prisma.membershipRole.upsert({
    where: { id: ids.membershipRoleAssignedProjectCreator },
    update: {
      workspaceMembershipId: assignedMembership.id,
      roleId: roleAcceptanceProjectCreator.id,
      isActive: true,
      endDate: null,
    },
    create: {
      id: ids.membershipRoleAssignedProjectCreator,
      workspaceMembershipId: assignedMembership.id,
      roleId: roleAcceptanceProjectCreator.id,
      isActive: true,
    },
  });

  // The "Buat RAB" frontend door (Sidebar / ObservatoryPage -> /project/new)
  // is gated by RoleRoute checking literal role codes DIRECTOR/OWNER in
  // activeRoles (frontend/src/components/layout/ProtectedRoute.tsx), which
  // is entirely separate from the backend RBAC PROJECT_CREATE permission
  // above. This role carries zero permissions of its own — it exists only
  // to satisfy that frontend role-code check, so it grants no additional
  // backend authority. Without it, RAB_LIFECYCLE-06's PROJECT_CREATE grant
  // is necessary but not sufficient to reach the create-project UI.
  const roleAcceptanceFrontendDoorDirector = await prisma.role.upsert({
    where: {
      workspaceId_code: {
        workspaceId: workspaceA.id,
        code: 'DIRECTOR',
      },
    },
    update: {
      name: 'Acceptance Frontend Door (DIRECTOR)',
      description: 'Zero backend permissions — satisfies the frontend RoleRoute(DIRECTOR/OWNER) check only, for assigned@test.local',
      isSystem: false,
    },
    create: {
      id: ids.roleAcceptanceFrontendDoorDirector,
      workspaceId: workspaceA.id,
      code: 'DIRECTOR',
      name: 'Acceptance Frontend Door (DIRECTOR)',
      description: 'Zero backend permissions — satisfies the frontend RoleRoute(DIRECTOR/OWNER) check only, for assigned@test.local',
      isSystem: false,
    },
  });

  await prisma.membershipRole.upsert({
    where: { id: ids.membershipRoleAssignedFrontendDoorDirector },
    update: {
      workspaceMembershipId: assignedMembership.id,
      roleId: roleAcceptanceFrontendDoorDirector.id,
      isActive: true,
      endDate: null,
    },
    create: {
      id: ids.membershipRoleAssignedFrontendDoorDirector,
      workspaceMembershipId: assignedMembership.id,
      roleId: roleAcceptanceFrontendDoorDirector.id,
      isActive: true,
    },
  });

  const nonassignedMembership = await prisma.workspaceMembership.upsert({
    where: {
      accountId_workspaceId: {
        accountId: nonassignedAccount.id,
        workspaceId: workspaceA.id,
      },
    },
    update: { status: 'ACTIVE' },
    create: {
      id: ids.membershipNonassigned,
      accountId: nonassignedAccount.id,
      workspaceId: workspaceA.id,
      status: 'ACTIVE',
    },
  });

  const crosstenantMembership = await prisma.workspaceMembership.upsert({
    where: {
      accountId_workspaceId: {
        accountId: crosstenantAccount.id,
        workspaceId: workspaceB.id,
      },
    },
    update: { status: 'ACTIVE' },
    create: {
      id: ids.membershipCrosstenant,
      accountId: crosstenantAccount.id,
      workspaceId: workspaceB.id,
      status: 'ACTIVE',
    },
  });

  await prisma.user.upsert({
    where: { workspaceMembershipId: assignedMembership.id },
    update: {
      workspaceId: workspaceA.id,
      fullName: 'Assigned Acceptance User',
      status: 'ACTIVE',
    },
    create: {
      id: ids.userAssigned,
      workspaceMembershipId: assignedMembership.id,
      workspaceId: workspaceA.id,
      fullName: 'Assigned Acceptance User',
      status: 'ACTIVE',
    },
  });

  await prisma.user.upsert({
    where: { workspaceMembershipId: nonassignedMembership.id },
    update: {
      workspaceId: workspaceA.id,
      fullName: 'Nonassigned Acceptance User',
      status: 'ACTIVE',
    },
    create: {
      id: ids.userNonassigned,
      workspaceMembershipId: nonassignedMembership.id,
      workspaceId: workspaceA.id,
      fullName: 'Nonassigned Acceptance User',
      status: 'ACTIVE',
    },
  });

  await prisma.user.upsert({
    where: { workspaceMembershipId: crosstenantMembership.id },
    update: {
      workspaceId: workspaceB.id,
      fullName: 'Cross-Tenant Acceptance User',
      status: 'ACTIVE',
    },
    create: {
      id: ids.userCrosstenant,
      workspaceMembershipId: crosstenantMembership.id,
      workspaceId: workspaceB.id,
      fullName: 'Cross-Tenant Acceptance User',
      status: 'ACTIVE',
    },
  });

  await prisma.membershipRole.upsert({
    where: { id: ids.membershipRoleAssigned },
    update: {
      workspaceMembershipId: assignedMembership.id,
      roleId: role.id,
      isActive: true,
      endDate: null,
    },
    create: {
      id: ids.membershipRoleAssigned,
      workspaceMembershipId: assignedMembership.id,
      roleId: role.id,
      isActive: true,
    },
  });

  await prisma.membershipRole.upsert({
    where: { id: ids.membershipRoleNonassigned },
    update: {
      workspaceMembershipId: nonassignedMembership.id,
      roleId: role.id,
      isActive: true,
      endDate: null,
    },
    create: {
      id: ids.membershipRoleNonassigned,
      workspaceMembershipId: nonassignedMembership.id,
      roleId: role.id,
      isActive: true,
    },
  });

  const project = await prisma.project.upsert({
    where: {
      workspaceId_code: {
        workspaceId: workspaceA.id,
        code: 'ACC-X',
      },
    },
    update: {
      organizationId: orgA.id,
      name: 'Acceptance Project X',
      status: 'ACTIVE',
    },
    create: {
      id: ids.projectX,
      workspaceId: workspaceA.id,
      organizationId: orgA.id,
      code: 'ACC-X',
      name: 'Acceptance Project X',
      status: 'ACTIVE',
    },
  });

  await prisma.projectAssignment.upsert({
    where: {
      workspaceMembershipId_projectId: {
        workspaceMembershipId: assignedMembership.id,
        projectId: project.id,
      },
    },
    update: {
      roleInProject: 'PROJECT_MANAGER',
      isPrimaryAssignment: true,
      status: 'ASSIGNED',
      revokedAt: null,
    },
    create: {
      id: ids.projectAssignmentAssigned,
      workspaceMembershipId: assignedMembership.id,
      projectId: project.id,
      roleInProject: 'PROJECT_MANAGER',
      isPrimaryAssignment: true,
      status: 'ASSIGNED',
    },
  });

  // MON-02A-BROWSER-PROOF: deterministic acceptance-only truth fixture.
  // It preserves ACC-X as the canonical ACTIVE-without-baseline negative
  // fixture while exercising the real guarded Monitoring read path with one
  // positive Actual, one absent Actual, and one explicitly recorded zero.
  const monitoringProject = await prisma.project.upsert({
    where: {
      workspaceId_code: {
        workspaceId: workspaceA.id,
        code: 'MON-02A-PROOF',
      },
    },
    update: {
      organizationId: orgA.id,
      name: 'MON-02A Monitoring Truth Proof',
      status: 'ACTIVE',
    },
    create: {
      id: ids.projectMonitoringProof,
      workspaceId: workspaceA.id,
      organizationId: orgA.id,
      code: 'MON-02A-PROOF',
      name: 'MON-02A Monitoring Truth Proof',
      status: 'ACTIVE',
    },
  });

  await prisma.projectAssignment.upsert({
    where: {
      workspaceMembershipId_projectId: {
        workspaceMembershipId: assignedMembership.id,
        projectId: monitoringProject.id,
      },
    },
    update: {
      roleInProject: 'PROJECT_MANAGER',
      isPrimaryAssignment: false,
      status: 'ASSIGNED',
      revokedAt: null,
    },
    create: {
      id: ids.projectAssignmentMonitoringProof,
      workspaceMembershipId: assignedMembership.id,
      projectId: monitoringProject.id,
      roleInProject: 'PROJECT_MANAGER',
      isPrimaryAssignment: false,
      status: 'ASSIGNED',
    },
  });

  const monitoringBoq = await prisma.boqStructure.upsert({
    where: { id: ids.boqStructureMonitoringProof },
    update: {
      projectId: monitoringProject.id,
      name: 'MON-02A Approved BOQ',
      version: 1,
      status: 'APPROVED',
    },
    create: {
      id: ids.boqStructureMonitoringProof,
      projectId: monitoringProject.id,
      name: 'MON-02A Approved BOQ',
      version: 1,
      status: 'APPROVED',
    },
  });

  const monitoringItems = [
    {
      id: ids.boqItemMonitoringPositive,
      wbsCode: '1.1',
      name: 'Recorded Positive Actual',
      quantity: 10,
      sortOrder: 1,
    },
    {
      id: ids.boqItemMonitoringAbsent,
      wbsCode: '1.2',
      name: 'Not Yet Recorded Actual',
      quantity: 8,
      sortOrder: 2,
    },
    {
      id: ids.boqItemMonitoringZero,
      wbsCode: '1.3',
      name: 'Recorded Zero Actual',
      quantity: 6,
      sortOrder: 3,
    },
  ] as const;

  for (const item of monitoringItems) {
    await prisma.boqItem.upsert({
      where: { id: item.id },
      update: {
        boqStructureId: monitoringBoq.id,
        wbsCode: item.wbsCode,
        name: item.name,
        itemType: 'WORK_ITEM',
        quantity: item.quantity,
        unit: 'm3',
        sortOrder: item.sortOrder,
      },
      create: {
        id: item.id,
        boqStructureId: monitoringBoq.id,
        wbsCode: item.wbsCode,
        name: item.name,
        itemType: 'WORK_ITEM',
        quantity: item.quantity,
        unit: 'm3',
        sortOrder: item.sortOrder,
      },
    });
  }

  const monitoringRab = await prisma.rabDocument.upsert({
    where: { id: ids.rabMonitoringProof },
    update: {
      projectId: monitoringProject.id,
      boqStructureId: monitoringBoq.id,
      version: 1,
      name: 'MON-02A Approved RAB',
      totalBaseCost: 1000,
      totalFinalCost: 1000,
      status: 'APPROVED',
    },
    create: {
      id: ids.rabMonitoringProof,
      projectId: monitoringProject.id,
      boqStructureId: monitoringBoq.id,
      version: 1,
      name: 'MON-02A Approved RAB',
      totalBaseCost: 1000,
      totalFinalCost: 1000,
      status: 'APPROVED',
    },
  });

  const monitoringBaseline = await prisma.projectBaseline.upsert({
    where: { id: ids.baselineMonitoringProof },
    update: {
      projectId: monitoringProject.id,
      rabDocumentId: monitoringRab.id,
      versionNumber: 1,
      status: 'ACTIVE',
      approvedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
    create: {
      id: ids.baselineMonitoringProof,
      projectId: monitoringProject.id,
      rabDocumentId: monitoringRab.id,
      versionNumber: 1,
      status: 'ACTIVE',
      approvedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  });

  const monitoringReport = await prisma.progressReport.upsert({
    where: { id: ids.progressReportMonitoringProof },
    update: {
      projectId: monitoringProject.id,
      baselineId: monitoringBaseline.id,
      periodStartDate: new Date('2026-08-01T00:00:00.000Z'),
      periodEndDate: new Date('2026-08-01T00:00:00.000Z'),
      status: 'SUBMITTED',
    },
    create: {
      id: ids.progressReportMonitoringProof,
      projectId: monitoringProject.id,
      baselineId: monitoringBaseline.id,
      periodStartDate: new Date('2026-08-01T00:00:00.000Z'),
      periodEndDate: new Date('2026-08-01T00:00:00.000Z'),
      status: 'SUBMITTED',
    },
  });

  const monitoringActuals = [
    {
      id: ids.progressEntryMonitoringPositive,
      boqItemId: ids.boqItemMonitoringPositive,
      installedQuantity: 2,
    },
    {
      id: ids.progressEntryMonitoringZero,
      boqItemId: ids.boqItemMonitoringZero,
      installedQuantity: 0,
    },
  ] as const;

  for (const actual of monitoringActuals) {
    await prisma.progressEntry.upsert({
      where: { id: actual.id },
      update: {
        progressReportId: monitoringReport.id,
        boqItemId: actual.boqItemId,
        installedQuantity: actual.installedQuantity,
        actualCost: null,
        earnedValue: null,
        captureMethod: 'ACCEPTANCE_FIXTURE',
        recordedByAccountId: assignedAccount.id,
        recordedByMembershipId: assignedMembership.id,
        workDate: new Date('2026-08-01T00:00:00.000Z'),
      },
      create: {
        id: actual.id,
        progressReportId: monitoringReport.id,
        boqItemId: actual.boqItemId,
        installedQuantity: actual.installedQuantity,
        actualCost: null,
        earnedValue: null,
        captureMethod: 'ACCEPTANCE_FIXTURE',
        recordedByAccountId: assignedAccount.id,
        recordedByMembershipId: assignedMembership.id,
        workDate: new Date('2026-08-01T00:00:00.000Z'),
      },
    });
  }


  const roleForeman = await prisma.role.upsert({
    where: {
      workspaceId_code: {
        workspaceId: workspaceA.id,
        code: 'FOREMAN',
      },
    },
    update: {
      name: 'Foreman',
      description: 'Field terminal actor',
      isSystem: false,
    },
    create: {
      id: ids.roleForeman,
      workspaceId: workspaceA.id,
      code: 'FOREMAN',
      name: 'Foreman',
      description: 'Field terminal actor',
      isSystem: false,
    },
  });

  const foremanAccount = await prisma.account.upsert({
    where: { email: 'foreman@test.local' },
    update: {
      passwordHash,
      displayName: 'Foreman Test Actor',
      status: 'ACTIVE',
    },
    create: {
      id: ids.accountForeman,
      email: 'foreman@test.local',
      passwordHash,
      displayName: 'Foreman Test Actor',
      status: 'ACTIVE',
    },
  });

  const foremanMembership = await prisma.workspaceMembership.upsert({
    where: {
      accountId_workspaceId: {
        accountId: foremanAccount.id,
        workspaceId: workspaceA.id,
      },
    },
    update: { status: 'ACTIVE' },
    create: {
      id: ids.membershipForeman,
      accountId: foremanAccount.id,
      workspaceId: workspaceA.id,
      status: 'ACTIVE',
    },
  });

  await prisma.user.upsert({
    where: { workspaceMembershipId: foremanMembership.id },
    update: {
      workspaceId: workspaceA.id,
      fullName: 'Foreman Test Actor',
      status: 'ACTIVE',
    },
    create: {
      id: ids.userForeman,
      workspaceMembershipId: foremanMembership.id,
      workspaceId: workspaceA.id,
      fullName: 'Foreman Test Actor',
      status: 'ACTIVE',
    },
  });

  await prisma.membershipRole.upsert({
    where: { id: ids.membershipRoleForeman },
    update: {
      workspaceMembershipId: foremanMembership.id,
      roleId: roleForeman.id,
      isActive: true,
      endDate: null,
    },
    create: {
      id: ids.membershipRoleForeman,
      workspaceMembershipId: foremanMembership.id,
      roleId: roleForeman.id,
      isActive: true,
    },
  });

  await prisma.projectAssignment.upsert({
    where: {
      workspaceMembershipId_projectId: {
        workspaceMembershipId: foremanMembership.id,
        projectId: project.id,
      },
    },
    update: {
      roleInProject: 'FOREMAN',
      isPrimaryAssignment: true,
      status: 'ASSIGNED',
      revokedAt: null,
    },
    create: {
      id: ids.projectAssignmentForeman,
      workspaceMembershipId: foremanMembership.id,
      projectId: project.id,
      roleInProject: 'FOREMAN',
      isPrimaryAssignment: true,
      status: 'ASSIGNED',
    },
  });

  await prisma.projectAssignment.upsert({
    where: {
      workspaceMembershipId_projectId: {
        workspaceMembershipId: foremanMembership.id,
        projectId: monitoringProject.id,
      },
    },
    update: { roleInProject: 'FOREMAN', isPrimaryAssignment: false, status: 'ASSIGNED', revokedAt: null },
    create: {
      id: ids.projectAssignmentForemanMonitoringProof,
      workspaceMembershipId: foremanMembership.id,
      projectId: monitoringProject.id,
      roleInProject: 'FOREMAN',
      isPrimaryAssignment: false,
      status: 'ASSIGNED',
    },
  });

  const progressAuthorityPosition = await prisma.position.upsert({
    where: { id: ids.positionForemanProgressAuthority },
    update: { workspaceId: workspaceA.id, code: 'FIELD_PROGRESS_AUTHORITY', name: 'Configured Field Progress Authority' },
    create: { id: ids.positionForemanProgressAuthority, workspaceId: workspaceA.id, code: 'FIELD_PROGRESS_AUTHORITY', name: 'Configured Field Progress Authority' },
  });
  await prisma.positionAssignment.upsert({
    where: { id: ids.positionAssignmentForemanProgressAuthority },
    update: { positionId: progressAuthorityPosition.id, userId: ids.userForeman, isActive: true, removedAt: null },
    create: { id: ids.positionAssignmentForemanProgressAuthority, positionId: progressAuthorityPosition.id, userId: ids.userForeman, isActive: true },
  });
  for (const configuredAuthority of [
    { id: ids.authorityProgressVerify, code: 'FIELD_PROGRESS_VERIFY', name: 'Verify Field Progress' },
    { id: ids.authorityProgressCorrect, code: 'FIELD_PROGRESS_CORRECT', name: 'Correct Field Progress' },
    { id: ids.authorityProgressAccept, code: 'FIELD_PROGRESS_ACCEPT', name: 'Accept Field Progress' },
  ]) {
    const authority = await prisma.authority.upsert({
      where: { code: configuredAuthority.code },
      update: { name: configuredAuthority.name },
      create: configuredAuthority,
    });
    await prisma.positionAuthority.upsert({
      where: { positionId_authorityId: { positionId: progressAuthorityPosition.id, authorityId: authority.id } },
      update: {},
      create: { positionId: progressAuthorityPosition.id, authorityId: authority.id },
    });
  }


  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: roleForeman.id,
        permissionId: permission.id,
      },
    },
    update: {},
    create: {
      roleId: roleForeman.id,
      permissionId: permission.id,
    },
  });
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: roleForeman.id,
        permissionId: ids.permissionFieldProgressSubmit,
      },
    },
    update: {},
    create: {
      roleId: roleForeman.id,
      permissionId: ids.permissionFieldProgressSubmit,
    },
  });

  // RAB-DRAFT-PROOF: lawful positive fixture for the RAB draft-lifecycle proof.
  // assigned@test.local reaches this via Proyek Saya -> Lanjutkan/Mulai RAB ->
  // Ruang Kerja RAB, never a direct URL. No baseline, no approved RAB, no
  // progress report, no initiateSetup call — exactly one empty Working Draft.
  const rabDraftProofProject = await prisma.project.upsert({
    where: {
      workspaceId_code: {
        workspaceId: workspaceA.id,
        code: 'RAB-DRAFT-PROOF',
      },
    },
    update: {
      organizationId: orgA.id,
      name: 'RAB Draft Import Proof',
    },
    create: {
      id: ids.projectRabDraftProof,
      workspaceId: workspaceA.id,
      organizationId: orgA.id,
      code: 'RAB-DRAFT-PROOF',
      name: 'RAB Draft Import Proof',
      status: 'PLANNED',
    },
  });

  await prisma.projectAssignment.upsert({
    where: {
      workspaceMembershipId_projectId: {
        workspaceMembershipId: assignedMembership.id,
        projectId: rabDraftProofProject.id,
      },
    },
    update: {
      roleInProject: 'PROJECT_MANAGER',
      status: 'ASSIGNED',
      revokedAt: null,
    },
    create: {
      id: ids.projectAssignmentRabDraftProof,
      workspaceMembershipId: assignedMembership.id,
      projectId: rabDraftProofProject.id,
      roleInProject: 'PROJECT_MANAGER',
      isPrimaryAssignment: false,
      status: 'ASSIGNED',
    },
  });

  // Idempotent by design: only creates the Working Draft if this project has
  // none yet. A re-seed must never touch a draft that already has real rows
  // from a browser-proof import.
  const existingRabDraftProofDrafts = await prisma.boqStructure.findMany({
    where: { projectId: rabDraftProofProject.id, name: 'Working Draft', status: 'DRAFT' },
    select: { id: true },
  });
  if (existingRabDraftProofDrafts.length === 0) {
    await prisma.boqStructure.create({
      data: {
        id: ids.boqStructureRabDraftProof,
        projectId: rabDraftProofProject.id,
        name: 'Working Draft',
        version: 1,
        status: 'DRAFT',
      },
    });
  }

  console.log('Acceptance seed complete');
  console.log({
    projectCode: project.code,
    projectId: project.id,
    workspaceAId: workspaceA.id,
    accounts: [
      assignedAccount.email,
      nonassignedAccount.email,
      crosstenantAccount.email,
      foremanAccount.email,
    ],
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
