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
