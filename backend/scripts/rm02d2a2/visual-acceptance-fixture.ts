import {
  Prisma,
  PrismaClient,
  ResourceType,
  PriceSourceOrigin,
  PriceSourceType,
  PriceVerificationStatus,
  PriceFreshnessStatus,
} from '@prisma/client';
import { verifyE2EDatabase } from '../database-role-guards';

/**
 * RM02D2A2-REMEDIATION-03 — bounded, tagged visual-acceptance fixture for
 * Owner browser acceptance of the Basic Price Explorer.
 *
 * Creates exactly three GLOBAL (workspaceId=null), PUBLISHED+PUBLISHED
 * BasicPrice rows — one MATERIAL, one LABOR, one EQUIPMENT — so the
 * Explorer shows real, human content for any workspace the Owner logs
 * into. Never touches batch 271, simprok_test, or simprok_db:
 * verifyE2EDatabase() fails closed unless the live connection is exactly
 * simprok_e2e. Deterministically tagged by resource code
 * (RM02D2A2-VISUAL-*) so --cleanup can find and remove exactly these rows
 * (ResourceCatalog delete cascades its BasicPrice row) without touching
 * anything else. The shared Region row is reference data, not fixture
 * data, and is deliberately left in place by --cleanup.
 *
 * Usage: tsx scripts/rm02d2a2/visual-acceptance-fixture.ts --apply
 *        tsx scripts/rm02d2a2/visual-acceptance-fixture.ts --cleanup
 */

const REGION_CODE = 'DKI';
const REGION_NAME = 'DKI Jakarta';

const FIXTURES = [
  {
    resourceCode: 'RM02D2A2-VISUAL-MATERIAL-01',
    resourceName: 'Semen Portland Acceptance 50kg',
    type: ResourceType.MATERIAL,
    baseUnit: 'Zak',
    price: '62500.00',
    sourceOrigin: PriceSourceOrigin.GOVERNMENT,
    sourceType: PriceSourceType.REGULATION,
  },
  {
    resourceCode: 'RM02D2A2-VISUAL-LABOR-01',
    resourceName: 'Tukang Batu Acceptance',
    type: ResourceType.LABOR,
    baseUnit: 'OH',
    price: '150000.00',
    sourceOrigin: PriceSourceOrigin.STORE,
    sourceType: PriceSourceType.MARKET_SURVEY,
  },
  {
    resourceCode: 'RM02D2A2-VISUAL-EQUIPMENT-01',
    resourceName: 'Excavator Acceptance PC200',
    type: ResourceType.EQUIPMENT,
    baseUnit: 'Jam',
    price: '450000.00',
    sourceOrigin: PriceSourceOrigin.FIELD_REPORT,
    sourceType: PriceSourceType.MARKET_SURVEY,
  },
] as const;

const RESOURCE_CODES = FIXTURES.map((fixture) => fixture.resourceCode);

async function apply(prisma: PrismaClient): Promise<void> {
  const region = await prisma.region.upsert({
    where: { code: REGION_CODE },
    update: {},
    create: { code: REGION_CODE, name: REGION_NAME, isActive: true },
  });

  for (const fixture of FIXTURES) {
    const existing = await prisma.resourceCatalog.findFirst({
      where: { code: fixture.resourceCode, workspaceId: null },
    });
    const resource =
      existing ??
      (await prisma.resourceCatalog.create({
        data: {
          workspaceId: null,
          code: fixture.resourceCode,
          name: fixture.resourceName,
          type: fixture.type,
          baseUnit: fixture.baseUnit,
          status: 'ACTIVE',
        },
      }));

    // Idempotent re-apply: replace this fixture's own BasicPrice row rather
    // than accumulating duplicates on a second --apply run.
    await prisma.basicPrice.deleteMany({ where: { resourceId: resource.id } });
    await prisma.basicPrice.create({
      data: {
        resourceId: resource.id,
        workspaceId: null,
        organizationId: null,
        regionId: region.id,
        effectiveDate: new Date(),
        value: new Prisma.Decimal(fixture.price),
        sourceType: fixture.sourceType,
        verificationStatus: PriceVerificationStatus.PUBLISHED,
        sourceOrigin: fixture.sourceOrigin,
        freshnessStatus: PriceFreshnessStatus.CURRENT,
        status: 'PUBLISHED',
      },
    });

    console.log(`Fixture applied: ${fixture.resourceCode} (${fixture.type})`);
  }
}

async function cleanup(prisma: PrismaClient): Promise<void> {
  const resources = await prisma.resourceCatalog.findMany({
    where: { code: { in: RESOURCE_CODES }, workspaceId: null },
  });

  for (const resource of resources) {
    await prisma.resourceCatalog.delete({ where: { id: resource.id } }); // cascades the BasicPrice row
    console.log(`Fixture removed: ${resource.code}`);
  }

  if (resources.length === 0) {
    console.log('No visual-acceptance fixture rows found — nothing to remove.');
  }
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== '--apply' && mode !== '--cleanup') {
    throw new Error('Use an explicit mode: --apply or --cleanup');
  }

  await verifyE2EDatabase();

  const prisma = new PrismaClient();
  try {
    if (mode === '--apply') {
      await apply(prisma);
    } else {
      await cleanup(prisma);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Visual acceptance fixture FAIL: ${message}`);
  process.exitCode = 1;
});
