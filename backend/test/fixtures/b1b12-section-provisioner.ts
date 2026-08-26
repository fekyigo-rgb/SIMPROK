import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';

import {
  GOLDEN_FIXTURE_ID,
  GOLDEN_FIXTURE_LABELS,
  GOLDEN_PARSER_CONTRACT_VERSION,
  GoldenCatalogIdentity,
  GoldenEvidence,
  MATRIX_COLUMN,
  OWNER_FIXTURE_QUANTITY,
  buildCatalogIdentities,
} from './b1b12-golden-workbook.fixture';

/**
 * TEST_FIXTURE_ONLY — the ONE materialisation of the Owner browser section.
 *
 * Both callers use this and only this:
 *   · b1b12-owner-browser-section.e2e-spec.ts  — proves the section is true
 *   · scripts/b1b12/provision-owner-browser-rehearsal.ts — puts it in front of
 *     the Owner's browser
 *
 * They must never be able to build two different sections; what the Owner
 * opens is byte-for-byte what the acceptance proof asserted. That is the whole
 * reason this module exists instead of a second copy in the script.
 *
 * EVERY FIGURE IS PRODUCED BY SIMPROK. This module writes no unit price, no
 * line total and no recap. It creates prerequisite reference data (workspace,
 * region, catalog, Basic Price through its real lifecycle, AHSP versions) and
 * then drives the SAME production routes the browser drives:
 *   PUT  /projects/:id/boq/draft
 *   POST /projects/:id/ahsp-occurrences/boq-items/:id/select-ahsp
 *   POST /projects/:id/boq/items/:id/cost-calculation/persist
 */

export interface MaterialisedRow {
  item: string;
  boqItemId: string;
  wbsCode: string;
  ahspVersionId: string;
  persistStatus: number;
  persistReason: string | null;
  unitPrice: string | null;
  lineTotal: string | null;
  /** Resources SIMPROK could not prove, with the reason a human must close. */
  unresolved: Array<{ ref: string; type: string; unit: string; reasons: string[] }>;
}

export interface ProvisionedSection {
  tag: string;
  workspaceId: string;
  organizationId: string;
  regionId: string;
  projectId: string;
  projectName: string;
  structureId: string;
  editorEmail: string;
  viewerEmail: string;
  membershipIds: string[];
  accountIds: string[];
  permissionIds: string[];
  identities: GoldenCatalogIdentity[];
  versionIdByItem: Map<string, string>;
  rows: MaterialisedRow[];
}

export interface ProvisionInput {
  app: INestApplication;
  prisma: PrismaClient;
  golden: GoldenEvidence;
  /** Unique per run, so parallel fixtures never collide. */
  tag: string;
  /** Password for the fixture accounts. Never logged by this module. */
  password: string;
  /** Business pricing date, ISO date-only. */
  asOf: string;
  /** Human-readable project name the Owner will look for. */
  projectName: string;
}

/** 03_PRICE_SNAPSHOT: the field survey is effective from this date. */
const PRICE_EFFECTIVE_DATE = new Date('2026-08-12T00:00:00.000Z');

export async function provisionB1B12Section(
  input: ProvisionInput,
): Promise<ProvisionedSection> {
  const { app, prisma, golden, tag, password, asOf, projectName } = input;
  const identities = buildCatalogIdentities(golden.resources);

  const permissionIds: string[] = [];
  const accountIds: string[] = [];
  const membershipIds: string[] = [];
  const catalogIdByKey = new Map<string, string>();
  const versionIdByItem = new Map<string, string>();
  const rows: MaterialisedRow[] = [];

  const organization = await prisma.organization.create({
    data: { name: `${tag} Org`, type: 'COMPANY' },
  });
  const workspace = await prisma.workspace.create({
    data: { name: `${tag} WS`, organizationId: organization.id },
  });
  const workspaceId = workspace.id;
  const organizationId = organization.id;

  // V-011 / G4: Jakarta Selatan is the declared applicability scope of the
  // field survey. REGION_REQUIRED stays intact; the region is real.
  const region = await prisma.region.create({
    data: { code: `${tag}-JAKSEL`, name: 'Jakarta Selatan', isActive: true },
  });
  const regionId = region.id;

  const ensurePermission = async (code: string) => {
    const permission =
      (await prisma.permission.findUnique({ where: { code } })) ??
      (await prisma.permission.create({
        data: { code, name: `${tag} ${code}`, description: GOLDEN_FIXTURE_LABELS },
      }));
    if (permission.name.startsWith(tag)) permissionIds.push(permission.id);
    return permission;
  };

  const createActor = async (suffix: string, permissionCodes: string[]) => {
    const permissions = await Promise.all(permissionCodes.map(ensurePermission));
    const email = `${tag}.${suffix}@simprok.test`.toLowerCase();
    const account = await prisma.account.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(password, 10),
        displayName: suffix,
        status: 'ACTIVE',
      },
    });
    accountIds.push(account.id);
    const role = await prisma.role.create({
      data: {
        workspaceId,
        code: `${tag}_${suffix.toUpperCase()}`,
        name: `${tag} ${suffix}`,
        rolePermissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
      },
    });
    const membership = await prisma.workspaceMembership.create({
      data: {
        accountId: account.id,
        workspaceId,
        status: 'ACTIVE',
        membershipRoles: { create: [{ roleId: role.id }] },
      },
    });
    membershipIds.push(membership.id);
    await prisma.user.create({
      data: {
        workspaceMembershipId: membership.id,
        workspaceId,
        fullName: suffix,
        status: 'ACTIVE',
      },
    });
    return { membershipId: membership.id, email };
  };

  const login = async (email: string) => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    return response.body.access_token as string;
  };

  const editor = await createActor('editor', [
    'RAB_DRAFT_EDIT',
    'PROJECT_VIEW',
    'RAB_VIEW',
    'AHSP_VIEW',
    // THE BASIC PRICE DOOR, MADE EXERCISABLE.
    //
    // This fixture granted only BASIC_PRICE_VERIFY and BASIC_PRICE_PUBLISH — the
    // two permissions its own B1-B12 assertions needed — so NO actor in the
    // rehearsal database could import a price list at all. The Owner opening
    // /basic-price/import on this environment was answered 403 by
    // PermissionsGuard before intake ever saw the workbook, which the browser
    // then mis-rendered as SIMPROK declining to guess about the file.
    //
    // The guard was right and the fixture was incomplete. A rehearsal
    // environment exists to exercise the real product, so the editor now holds
    // the three permissions the import journey actually requires. This grants
    // nothing that production does not already define, and weakens no check.
    'BASIC_PRICE_IMPORT',
    'BASIC_PRICE_RESOLVE',
    'BASIC_PRICE_REVIEW_VIEW',
    // AND THE TWO ROOMS THE JOURNEY GREW AFTERWARDS — the same defect one step
    // further down the corridor.
    //
    // The three grants above carried a reviewer as far as the review room and
    // stopped there, because that was where the product stopped when they were
    // written. The journey now continues: `Simpan & Gunakan` materializes the
    // finished rows as workspace-private Basic Prices (BASIC_PRICE_SUBMIT, the
    // same authority `submit` holds — see the keep-private route's own note),
    // and the person then goes to the Basic Price Explorer to see them
    // (BASIC_PRICE_VIEW). Without these two the rehearsal editor met a 403 at
    // the exact moment their prices were supposed to become usable, and the
    // Explorer showed nothing — a fixture one step behind the door again.
    //
    // This grants nothing production does not already define and weakens no
    // check: both codes are existing permissions, enforced by the same
    // PermissionsGuard, on the same workspace boundary.
    'BASIC_PRICE_SUBMIT',
    'BASIC_PRICE_VIEW',
  ]);
  const viewer = await createActor('viewer', [
    'RAB_VIEW',
    'PROJECT_VIEW',
    'AHSP_VIEW',
  ]);
  await createActor('verifier', ['BASIC_PRICE_VERIFY']);
  await createActor('publisher', ['BASIC_PRICE_PUBLISH']);

  const editorToken = await login(editor.email);
  const verifierToken = await login(`${tag}.verifier@simprok.test`.toLowerCase());
  const publisherToken = await login(`${tag}.publisher@simprok.test`.toLowerCase());

  /**
   * A PUBLISHED, TRACEABLE field Basic Price — minted the way the product mints
   * one. The Gate-2A persist gate refuses any price it cannot trace end-to-end
   * through submission → ACCEPT (verifier) → PUBLISH (a distinct publisher), so
   * both transitions run through their real HTTP routes.
   *
   * Provenance is the pack's own (03_PRICE_SNAPSHOT / 09_PRICE_POLICY):
   * FIELD_REPORT + MARKET_SURVEY, scoped to Jakarta Selatan. It is never
   * relabelled as an official government price.
   */
  const publishFieldPrice = async (resourceCatalogId: string, value: string) => {
    const submission = await prisma.priceSubmission.create({
      data: {
        workspaceId,
        organizationId,
        resourceId: resourceCatalogId,
        regionId,
        sourceOrigin: 'FIELD_REPORT',
        sourceType: 'MARKET_SURVEY',
        status: 'UNDER_REVIEW',
      },
    });
    const revision = await prisma.priceSubmissionRevision.create({
      data: {
        submissionId: submission.id,
        revisionNumber: 1,
        value,
        effectiveDate: PRICE_EFFECTIVE_DATE,
        validationPassed: true,
      },
    });
    await prisma.priceSubmission.update({
      where: { id: submission.id },
      data: { currentRevisionId: revision.id },
    });
    const review = await prisma.priceSubmissionReview.create({
      data: {
        priceSubmissionId: submission.id,
        workspaceId,
        organizationId,
        slaState: 'OPEN',
        openedAt: new Date(),
      },
    });
    const accepted = await request(app.getHttpServer())
      .post(`/basic-price-reviews/${review.id}/accept`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .set('x-workspace-id', workspaceId)
      .send({})
      .expect(201);
    const basicPriceId = accepted.body.basicPriceId as string;
    await request(app.getHttpServer())
      .post(`/basic-price-publications/${basicPriceId}/publish`)
      .set('Authorization', `Bearer ${publisherToken}`)
      .set('x-workspace-id', workspaceId)
      .expect(201);
    return basicPriceId;
  };

  const project = await prisma.project.create({
    data: {
      workspaceId,
      organizationId,
      code: `${tag}-B1B12`,
      name: projectName,
      description: `${GOLDEN_FIXTURE_ID} · ${GOLDEN_FIXTURE_LABELS}`,
      status: 'PLANNED',
    },
  });
  const projectId = project.id;
  for (const membershipId of [editor.membershipId, viewer.membershipId]) {
    await prisma.projectAssignment.create({
      data: {
        workspaceMembershipId: membershipId,
        projectId,
        roleInProject: 'MEMBER',
        isPrimaryAssignment: true,
        status: 'ASSIGNED',
      },
    });
  }

  // ── Reference data: one catalog identity per fact the evidence states ──
  for (const identity of identities) {
    const catalog = await prisma.resourceCatalog.create({
      data: {
        workspaceId,
        // ResourceCatalog.code is SIMPROK's OWN canonical code namespace and is
        // unique per workspace. The pack's "L01"/"M279" are SOURCE codes, and
        // the source states several distinct (name, unit) identities under one
        // of them — "Mortar" M279 is priced per m3 and per kg. Writing a source
        // code here would assert a canonical identity the evidence does not
        // support, and would collide. The source code is kept where it belongs:
        // as `rawCode` on the provenance sighting.
        code: null,
        name: identity.name,
        type: identity.resourceType as never,
        baseUnit: identity.baseUnit,
      },
    });
    catalogIdByKey.set(identity.key, catalog.id);

    // Every raw spelling, preserved where the model exists for exactly that:
    // provenance. A sighting can nominate a candidate; it never asserts one.
    for (const sighting of identity.sightings) {
      await prisma.resourceSourceIdentity.create({
        data: {
          workspaceId,
          resourceCatalogId: catalog.id,
          rawName: sighting.rawText,
          rawCode: identity.resourceCode === '' ? null : identity.resourceCode,
          rawUnit: identity.baseUnit,
          sourceSection: identity.resourceType as never,
          sourceFileName: golden.fileName,
          // The domain's canonical storage convention is 64 UPPERCASE hex
          // characters, enforced by a CHECK constraint. Same digest, the shape
          // this table has always required.
          sourceSha256: golden.sha256.toUpperCase(),
          parserContractVersion: GOLDEN_PARSER_CONTRACT_VERSION,
          sheetName: '02_RESOURCE_MATRIX',
          sourceRowNumber: sighting.sourceRow,
          // The exact cells this text came from, so a human can open the
          // workbook and land on the row being talked about.
          sourceNameCellAddress: `${MATRIX_COLUMN.rawResourceText}${sighting.sourceRow}`,
          sourceCodeCellAddress:
            identity.resourceCode === ''
              ? null
              : `${MATRIX_COLUMN.resourceCode}${sighting.sourceRow}`,
          sourceUnitCellAddress: `${MATRIX_COLUMN.rawUnit}${sighting.sourceRow}`,
        },
      });
    }

    await publishFieldPrice(catalog.id, identity.publishedUnitPrice);
  }

  // ── One immutable AHSP version per B-item, from the pack's own identity ──
  for (const item of golden.items) {
    const ahsp = await prisma.aHSP.create({
      data: {
        workspaceId,
        workType: item.officialDescription,
        methodType: 'MANUAL',
        locationType: 'GENERAL',
        methodName: `${item.code} ${item.item}`,
      },
    });
    const version = await prisma.aHSPVersion.create({
      data: {
        ahspId: ahsp.id,
        workspaceId,
        versionNumber: 1,
        outputUnit: item.canonicalUnit,
        effectiveDate: PRICE_EFFECTIVE_DATE,
        regulationReference:
          `AHSP Bina Marga 2026 ${item.code} · ${item.item} · ` +
          `${item.goldenPackStatus} · ${GOLDEN_FIXTURE_ID}`,
      },
    });
    versionIdByItem.set(item.item, version.id);

    for (const resource of golden.resources.filter((r) => r.item === item.item)) {
      await prisma.aHSPResource.create({
        data: {
          ahspVersionId: version.id,
          resourceId: resource.canonicalCandidate,
          resourceType: resource.resourceType as never,
          coefficient: resource.coefficient,
          baseUnit: resource.rawUnit,
        },
      });
    }
  }

  // ── The BOQ section, through the route the RAB workspace itself calls ──
  const draft = await request(app.getHttpServer())
    .put(`/projects/${projectId}/boq/draft`)
    .set('Authorization', `Bearer ${editorToken}`)
    .send({
      rows: golden.items.map((item, index) => ({
        tempId: item.item,
        itemType: 'WORK_ITEM',
        wbsCode: `1.${index + 1}`,
        name: item.officialDescription,
        quantity: Number(OWNER_FIXTURE_QUANTITY[item.item]),
        unit: item.canonicalUnit,
        sortOrder: index + 1,
      })),
    })
    .expect(200);
  const structureId = draft.body.structureId as string;
  const savedByWbs = new Map<string, any>(
    (draft.body.items as any[]).map((row) => [row.wbsCode, row]),
  );

  // ── Selection + money, per row, each through the real command ──
  for (const [index, item] of golden.items.entries()) {
    const wbsCode = `1.${index + 1}`;
    const saved = savedByWbs.get(wbsCode);
    const ahspVersionId = versionIdByItem.get(item.item)!;

    await request(app.getHttpServer())
      .post(`/projects/${projectId}/ahsp-occurrences/boq-items/${saved.id}/select-ahsp`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        ahspVersionId,
        businessPricingAsOfDate: asOf,
        referenceRegionId: regionId,
        idempotencyKey: `${tag}-${item.item}`,
      });

    const persist = await request(app.getHttpServer())
      .post(`/projects/${projectId}/boq/items/${saved.id}/cost-calculation/persist`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ calculationAsOfDate: asOf });

    const stored = await prisma.boqItem.findUniqueOrThrow({
      where: { id: saved.id },
    });
    const occurrence = await prisma.projectAhspOccurrence.findFirst({
      where: { projectId, ahspVersionId },
      include: { resourceResolutions: true },
    });
    rows.push({
      item: item.item,
      boqItemId: saved.id,
      wbsCode,
      ahspVersionId,
      persistStatus: persist.status,
      persistReason:
        persist.status >= 400
          ? ((persist.body?.message ?? JSON.stringify(persist.body)) as string)
          : null,
      unitPrice: stored.unitPrice?.toString() ?? null,
      lineTotal: stored.lineTotal?.toString() ?? null,
      unresolved: (occurrence?.resourceResolutions ?? [])
        .filter((resolution) => resolution.status !== 'RESOLVED')
        .map((resolution) => ({
          ref: resolution.rawAhspResourceRef,
          type: resolution.rawAhspResourceType,
          unit: resolution.ahspUnit,
          reasons: [...resolution.reasonCodes],
        })),
    });
  }

  return {
    tag,
    workspaceId,
    organizationId,
    regionId,
    projectId,
    projectName,
    structureId,
    editorEmail: editor.email,
    viewerEmail: viewer.email,
    membershipIds,
    accountIds,
    permissionIds,
    identities,
    versionIdByItem,
    rows,
  };
}

/** Human-readable evidence of exactly what was materialised. */
export function describeSection(section: ProvisionedSection): string {
  const lines = [
    `[${GOLDEN_FIXTURE_ID}] project="${section.projectName}"`,
    `  projectId=${section.projectId} structureId=${section.structureId}`,
  ];
  for (const row of section.rows) {
    lines.push(
      `  ${row.item.padEnd(3)} ${row.persistStatus === 201 ? 'PRICED  ' : 'WITHHELD'} ` +
        `unitPrice=${row.unitPrice ?? '-'} lineTotal=${row.lineTotal ?? '-'} ` +
        `${row.persistReason ?? ''}`,
    );
    for (const unresolved of row.unresolved) {
      lines.push(
        `        ↳ "${unresolved.ref}" (${unresolved.type}, ${unresolved.unit}) → ` +
          unresolved.reasons.join('+'),
      );
    }
  }
  return lines.join('\n');
}

/** Removes exactly what `provisionB1B12Section` created, and nothing else. */
export async function teardownB1B12Section(
  prisma: PrismaClient,
  section: ProvisionedSection,
): Promise<void> {
  const { workspaceId, projectId, membershipIds, accountIds, permissionIds } = section;
  const structures = await prisma.boqStructure.findMany({ where: { projectId } });
  const structureIds = structures.map((s) => s.id);
  await prisma.boqItem.updateMany({
    where: { boqStructureId: { in: structureIds } },
    data: { parentId: null },
  });
  await prisma.boqItem.deleteMany({ where: { boqStructureId: { in: structureIds } } });
  await prisma.rabDocument.deleteMany({ where: { projectId } });
  await prisma.projectAhspResourceResolution.deleteMany({
    where: { occurrence: { projectId } },
  });
  await prisma.projectAhspOccurrence.deleteMany({ where: { projectId } });
  await prisma.boqStructure.deleteMany({ where: { projectId } });
  await prisma.aHSPResource.deleteMany({ where: { ahspVersion: { workspaceId } } });
  await prisma.aHSPVersion.deleteMany({ where: { workspaceId } });
  await prisma.aHSPAuditLog.deleteMany({ where: { ahsp: { workspaceId } } });
  await prisma.aHSP.deleteMany({ where: { workspaceId } });
  await prisma.projectAssignment.deleteMany({
    where: { workspaceMembershipId: { in: membershipIds } },
  });
  await prisma.project.deleteMany({ where: { workspaceId } });

  await prisma.basicPricePublicationAudit.deleteMany({
    where: { basicPrice: { workspaceId } },
  });
  await prisma.basicPrice.deleteMany({ where: { workspaceId } });
  await prisma.priceSubmissionAudit.deleteMany({
    where: { submission: { workspaceId } },
  });
  await prisma.priceSubmissionReviewDecision.deleteMany({
    where: { review: { workspaceId } },
  });
  await prisma.priceSubmissionReview.deleteMany({ where: { workspaceId } });
  await prisma.priceSubmission.updateMany({
    where: { workspaceId },
    data: { currentRevisionId: null },
  });
  await prisma.priceSubmissionRevision.deleteMany({
    where: { submission: { workspaceId } },
  });
  await prisma.priceSubmission.deleteMany({ where: { workspaceId } });
  await prisma.resourceSourceIdentity.deleteMany({ where: { workspaceId } });
  await prisma.resourceCatalog.deleteMany({ where: { workspaceId } });

  await prisma.membershipRole.deleteMany({
    where: { workspaceMembershipId: { in: membershipIds } },
  });
  await prisma.user.deleteMany({
    where: { workspaceMembershipId: { in: membershipIds } },
  });
  await prisma.workspaceMembership.deleteMany({ where: { id: { in: membershipIds } } });
  await prisma.rolePermission.deleteMany({ where: { role: { workspaceId } } });
  await prisma.role.deleteMany({ where: { workspaceId } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.permission.deleteMany({ where: { id: { in: permissionIds } } });
  await prisma.region.deleteMany({ where: { id: section.regionId } });
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
  await prisma.organization.deleteMany({ where: { id: section.organizationId } });
}
