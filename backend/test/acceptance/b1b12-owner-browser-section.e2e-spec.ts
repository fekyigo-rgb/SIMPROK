import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import {
  GoldenEvidence,
  OWNER_FIXTURE_QUANTITY,
  ambiguousCatalogNames,
  isGoldenRequested,
  loadGoldenEvidence,
} from '../fixtures/b1b12-golden-workbook.fixture';
import {
  MaterialisedRow,
  ProvisionedSection,
  describeSection,
  provisionB1B12Section,
  teardownB1B12Section,
} from '../fixtures/b1b12-section-provisioner';

/**
 * B1B12-BROWSER-BRIDGE-01 — ONE VALID RAB SECTION, proven against a real
 * PostgreSQL database and built through the SAME routes the browser uses.
 *
 * WHAT THIS PROVES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * It proves that the Golden Bina Marga / Drainase B1-B12 evidence can become
 * twelve independent, browser-visible RAB rows whose money is produced by the
 * existing Cost Kernel, and that the section stays HONEST where the evidence
 * itself is not conclusive.
 *
 * It does not prove BOQ→AHSP matching intelligence, and it does not claim the
 * Owner's verification quantities are field quantities — 08_BOQ_SECTION of the
 * pack records every quantity as "NOT PROVIDED", and the fixture adds QUANTITY
 * ONLY. No description, unit, coefficient, price or anomaly is rewritten.
 *
 * The section is built by `provisionB1B12Section`, which is the SAME code the
 * rehearsal provisioner runs. What the Owner opens in a browser is therefore
 * the very thing this file asserts — not a second materialisation that merely
 * resembles it.
 *
 * Requires the Owner's byte-verified workbook:
 *   B1B12_GOLDEN_WORKBOOK_PATH=<dir>/GOLDEN_DATA_PACK_BINA_MARGA_DRAINASE_B1_B12_v1.2.xlsx
 * Unset → skipped by name. Set but wrong → FAILURE, never a skip.
 *
 * Runs against simprok_e2e only. Every fixture row is deleted in afterAll.
 */

const describeGolden = isGoldenRequested() ? describe : describe.skip;

describeGolden('B1B12 Owner browser section (e2e)', () => {
  const prisma = new PrismaClient();
  const tag = `B1B12BR${Date.now()}`;
  const password = 'B1B12BrowserBridge!';
  const asOf = '2026-08-13';

  let app: INestApplication;
  let golden: GoldenEvidence;
  let section: ProvisionedSection;
  let viewerToken: string;

  let projectId: string;
  let structureId: string;
  let workspaceId: string;
  let regionId: string;
  let rows: MaterialisedRow[];

  /**
   * The kernel's own unit price for a row, UNROUNDED — recomputed from the
   * frozen resolutions that occurrence actually holds. Used to state the
   * rounding law exactly, never to write anything.
   */
  const exactKernelUnitPrice = async (row: MaterialisedRow) => {
    const occurrence = await prisma.projectAhspOccurrence.findFirstOrThrow({
      where: { projectId, ahspVersionId: row.ahspVersionId },
      include: { resourceResolutions: true },
    });
    return occurrence.resourceResolutions.reduce(
      (sum, resolution) =>
        sum.add(
          new Prisma.Decimal(resolution.ahspCoefficient).mul(
            new Prisma.Decimal(resolution.adaptedPriceValue ?? 0),
          ),
        ),
      new Prisma.Decimal(0),
    );
  };

  beforeAll(async () => {
    golden = await loadGoldenEvidence();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    section = await provisionB1B12Section({
      app,
      prisma,
      golden,
      tag,
      password,
      asOf,
      projectName: `OWNER BROWSER — B1B12 GOLDEN SECTION ${tag}`,
    });

    ({ projectId, structureId, workspaceId, regionId, rows } = section);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: section.viewerEmail, password })
      .expect(201);
    viewerToken = login.body.access_token as string;

    // One place the whole run can be read from, so the Owner package and this
    // proof can never describe two different materialisations.
    // eslint-disable-next-line no-console
    console.log(`\n${describeSection(section)}`);
  }, 900_000);

  afterAll(async () => {
    if (!app) return;
    await teardownB1B12Section(prisma, section);
    await app.close();
    await prisma.$disconnect();
  }, 300_000);

  // ── EVIDENCE INTEGRITY ────────────────────────────────────────────────────
  it('reads the exact locked Golden v1.2 bytes, and nothing else', () => {
    expect({ size: golden.size, sha256: golden.sha256 }).toEqual({
      size: 59451,
      sha256: '3e8393a7e9f730eb7aa7dc50c0fd50603c9912148d1dd6c566f662cf6e5023ff',
    });
    expect(golden.items).toHaveLength(12);
    expect(golden.resources).toHaveLength(159);
  });

  it('materialises the source evidence verbatim — no description, unit or coefficient is rewritten', async () => {
    const versions = await prisma.aHSPVersion.findMany({
      where: { workspaceId },
      include: { ahsp: true, resources: true },
    });
    expect(versions).toHaveLength(12);

    for (const item of golden.items) {
      const version = versions.find((v) => v.id === section.versionIdByItem.get(item.item))!;
      // Official description, byte-for-byte.
      expect(version.ahsp.workType).toBe(item.officialDescription);
      // The AHSP's own output unit is the pack's canonical unit, not prose.
      expect(version.outputUnit).toBe(item.canonicalUnit);
      expect(version.regulationReference).toContain(item.code);

      const expected = golden.resources.filter((r) => r.item === item.item);
      expect(version.resources).toHaveLength(expected.length);
      for (const source of expected) {
        const stored = version.resources.find(
          (r) =>
            r.resourceId === source.canonicalCandidate &&
            r.baseUnit === source.rawUnit &&
            r.coefficient.toString() === new Prisma.Decimal(source.coefficient).toString(),
        );
        // The raw source unit survives: "M'", "bh/M'", "Ls", "jam" are stored
        // as the document wrote them. The kernel supplies the meaning.
        expect(stored).toBeDefined();
      }
    }
    // B1-B2 are cubic metres, B3-B12 linear metres — the pack's own split.
    expect(golden.items.filter((i) => i.canonicalUnit === 'm3').map((i) => i.item)).toEqual([
      'B1',
      'B2',
    ]);
    expect(golden.items.filter((i) => i.canonicalUnit === 'm')).toHaveLength(10);
  });

  it('preserves every raw spelling as provenance, including the source typos', async () => {
    const sightings = await prisma.resourceSourceIdentity.findMany({
      where: { workspaceId },
    });
    expect(sightings).toHaveLength(159);
    expect(
      sightings.every((s) => s.sourceSha256 === golden.sha256.toUpperCase()),
    ).toBe(true);
    // The pack records these verbatim; SIMPROK stores them verbatim too.
    const rawNames = new Set(sightings.map((s) => s.rawName));
    for (const typo of ['Sernen M12', 'Morfar M279', 'lmbunan Pilihan M09']) {
      expect(rawNames.has(typo)).toBe(true);
    }
  });

  // ── A. ROW COUNT ──────────────────────────────────────────────────────────
  it('A: exactly 12 B1-B12 WORK_ITEM rows exist in ONE BOQ structure', async () => {
    const items = await prisma.boqItem.findMany({
      where: { boqStructureId: structureId },
      orderBy: { sortOrder: 'asc' },
    });
    expect(items).toHaveLength(12);
    expect(items.every((row) => row.itemType === 'WORK_ITEM')).toBe(true);
    expect(new Set(items.map((row) => row.id)).size).toBe(12);
    expect(items.map((row) => row.name)).toEqual(
      golden.items.map((item) => item.officialDescription),
    );
    const structures = await prisma.boqStructure.findMany({ where: { projectId } });
    expect(structures).toHaveLength(1);
  });

  // ── B. QUANTITY ───────────────────────────────────────────────────────────
  it('B: every row carries EXACTLY the Owner-authorised verification quantity', async () => {
    const items = await prisma.boqItem.findMany({
      where: { boqStructureId: structureId },
      orderBy: { sortOrder: 'asc' },
    });
    for (const [index, item] of golden.items.entries()) {
      const stored = items[index];
      expect(
        new Prisma.Decimal(stored.quantity).equals(
          new Prisma.Decimal(OWNER_FIXTURE_QUANTITY[item.item]),
        ),
      ).toBe(true);
      expect(stored.unit).toBe(item.canonicalUnit);
    }
  });

  // ── C. SOURCE IDENTITY ────────────────────────────────────────────────────
  it('C: each row is bound to the AHSP version carrying its own Golden code', async () => {
    const items = await prisma.boqItem.findMany({
      where: { boqStructureId: structureId },
      orderBy: { sortOrder: 'asc' },
      include: { ahspVersion: { include: { ahsp: true } } },
    });
    for (const [index, item] of golden.items.entries()) {
      expect(items[index].ahspVersionId).toBe(section.versionIdByItem.get(item.item));
      expect(items[index].ahspVersion?.regulationReference).toContain(item.code);
      expect(items[index].ahspVersion?.ahsp.workType).toBe(item.officialDescription);
    }
  });

  // ── D. INDEPENDENT CALCULATION CONTEXT ────────────────────────────────────
  it('D: 12 rows never share an AHSP version or an occurrence', async () => {
    const items = await prisma.boqItem.findMany({
      where: { boqStructureId: structureId },
    });
    expect(new Set(items.map((row) => row.ahspVersionId)).size).toBe(12);

    const occurrences = await prisma.projectAhspOccurrence.findMany({
      where: { projectId },
    });
    // One occurrence per row, each minted by the real resolver.
    expect(occurrences).toHaveLength(12);
    expect(new Set(occurrences.map((o) => o.ahspVersionId)).size).toBe(12);

    const bound = items
      .map((row) => row.calculationOccurrenceId ?? row.workingOccurrenceId)
      .filter((id): id is string => id !== null);
    expect(bound).toHaveLength(12);
    expect(new Set(bound).size).toBe(12);
  });

  // ── E. VALID-ROW ARITHMETIC ───────────────────────────────────────────────
  it('E: every priced row satisfies lineTotal = quantity × persisted unitPrice, and SIMPROK computed both', async () => {
    const priced = rows.filter((row) => row.persistStatus === 201);
    // The section must actually contain proven work — a section where nothing
    // priced would satisfy the arithmetic vacuously.
    expect(priced.length).toBeGreaterThan(0);

    for (const row of priced) {
      const stored = await prisma.boqItem.findUniqueOrThrow({
        where: { id: row.boqItemId },
      });
      expect(stored.priceOrigin).toBe('SERVER_COST_KERNEL');
      expect(stored.unitPrice).not.toBeNull();
      expect(stored.calculationOccurrenceId).not.toBeNull();

      const quantity = new Prisma.Decimal(stored.quantity);
      const unitPrice = new Prisma.Decimal(stored.unitPrice!);
      const lineTotal = new Prisma.Decimal(stored.lineTotal!);

      // THE EXISTING ROUNDING LAW, stated exactly: the Cost Kernel multiplies
      // the EXACT unit price by the volume and money is rounded ONCE, at the
      // persistence boundary. Rounding first and multiplying second would be a
      // different (and worse) number, so the proof must use the same order the
      // product uses — `quantity × displayed unitPrice` is an approximation of
      // this figure, never its definition.
      const exactUnitPrice = await exactKernelUnitPrice(row);
      expect(
        lineTotal.equals(
          quantity
            .mul(exactUnitPrice)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        ),
      ).toBe(true);
      expect(
        unitPrice.equals(
          exactUnitPrice.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        ),
      ).toBe(true);
      // …and the displayed figures are still coherent with each other: the
      // gap between the two orders can only ever be sub-cent per unit.
      expect(
        lineTotal.minus(quantity.mul(unitPrice)).abs().lessThanOrEqualTo(
          quantity.mul(new Prisma.Decimal('0.005')).add(new Prisma.Decimal('0.01')),
        ),
      ).toBe(true);

      // …and the kernel reproduces itself from the frozen provenance.
      const proof = await request(app.getHttpServer())
        .get(`/projects/${projectId}/boq/items/${row.boqItemId}/persisted-calculation`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      expect(proof.body.status).toBe('VERIFIED');
      expect(proof.body.integrity).toEqual({
        unitPriceMatches: true,
        lineTotalMatches: true,
        allResourceCostsReproduced: true,
      });
    }
  });

  /**
   * TWO INDEPENDENT CALCULATORS, ONE NUMBER.
   *
   * 04_PUBLISHED_SUMMARY carries the pack's own recalculation of each
   * analysis's base unit price ("Oracle D"), worked out in the workbook, by
   * the Owner, before SIMPROK ever saw the data. Nothing here is written from
   * it — it is only compared against.
   *
   * This is the difference between a fixture that asserts its own expectation
   * and a proof: agreement to the cent means SIMPROK's Cost Kernel and the
   * Owner's oracle reached the same figure from the same evidence, separately.
   */
  it('E2: SIMPROK’s unit price matches the Golden pack’s own independent oracle, to the cent', async () => {
    const priced = rows.filter((row) => row.persistStatus === 201);
    const compared: string[] = [];
    for (const row of priced) {
      const oracle = golden.oracleBaseUnitPrice[row.item];
      expect(oracle).toBeDefined();
      const stored = await prisma.boqItem.findUniqueOrThrow({
        where: { id: row.boqItemId },
      });
      expect(
        new Prisma.Decimal(stored.unitPrice!).equals(
          new Prisma.Decimal(oracle).toDecimalPlaces(
            2,
            Prisma.Decimal.ROUND_HALF_UP,
          ),
        ),
      ).toBe(true);
      compared.push(row.item);
    }
    expect(compared.length).toBe(priced.length);
  });

  it('E3: that unit price is the kernel’s own Σ(coefficient × resolved price) — never a fixture constant', async () => {
    for (const row of rows.filter((r) => r.persistStatus === 201)) {
      const stored = await prisma.boqItem.findUniqueOrThrow({
        where: { id: row.boqItemId },
      });
      const exact = await exactKernelUnitPrice(row);
      expect(
        new Prisma.Decimal(stored.unitPrice!).equals(
          exact.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        ),
      ).toBe(true);
      // Every resource the analysis declares took part — none skipped.
      const occurrence = await prisma.projectAhspOccurrence.findFirstOrThrow({
        where: { projectId, ahspVersionId: row.ahspVersionId },
        include: { resourceResolutions: true },
      });
      expect(occurrence.resourceResolutions).toHaveLength(
        golden.resources.filter((r) => r.item === row.item).length,
      );
    }
  });

  it('E4: an Alat Bantu line stated at Rp0 is carried as a resolved zero, not as a missing price', async () => {
    const zeroRows = golden.resources.filter(
      (r) => r.canonicalCandidate === 'Alat Bantu',
    );
    expect(zeroRows).toHaveLength(12);
    expect(zeroRows.every((r) => r.publishedUnitPrice === '0')).toBe(true);

    const resolutions = await prisma.projectAhspResourceResolution.findMany({
      where: { occurrence: { projectId }, rawAhspResourceRef: 'Alat Bantu' },
    });
    expect(resolutions).toHaveLength(12);
    for (const resolution of resolutions) {
      expect(resolution.status).toBe('RESOLVED');
      expect(resolution.adaptedPriceValue).not.toBeNull();
      expect(new Prisma.Decimal(resolution.adaptedPriceValue!).isZero()).toBe(true);
    }
  });

  // ── F. RECAP ──────────────────────────────────────────────────────────────
  it('F: the recap the browser reads obeys the existing RAB recap law, and never states a partial total', async () => {
    const draft = await request(app.getHttpServer())
      .get(`/projects/${projectId}/boq/draft`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    expect(draft.body.items).toHaveLength(12);
    const anyUnpriced = (draft.body.items as any[]).some(
      (row) => row.itemType === 'WORK_ITEM' && row.unitPrice === null,
    );
    const recap = draft.body.recap;

    if (anyUnpriced) {
      // FAIL-CLOSED ON FACT: no grand total may be stated while part of the
      // section is unproven. A partial sum is a false total, not a small one.
      expect(recap.pricingStatus).toBe('INCOMPLETE');
      expect(recap.subtotal).toBeNull();
      expect(recap.grandTotal).toBeNull();
      const rab = await prisma.rabDocument.findFirst({
        where: { projectId, boqStructureId: structureId, status: 'DRAFT' },
      });
      expect(rab?.totalBaseCost ?? null).toBeNull();
      expect(rab?.totalFinalCost ?? null).toBeNull();
    } else {
      expect(recap.pricingStatus).toBe('COMPLETE');
      const subtotal = (draft.body.items as any[])
        .filter((row) => row.itemType === 'WORK_ITEM')
        .reduce(
          (sum, row) => sum.add(new Prisma.Decimal(row.lineTotal)),
          new Prisma.Decimal(0),
        );
      expect(new Prisma.Decimal(recap.subtotal).equals(subtotal)).toBe(true);
      const margin = subtotal.mul(new Prisma.Decimal(recap.marginPercent)).div(100);
      const tax = subtotal
        .add(margin)
        .mul(new Prisma.Decimal(recap.taxPercent))
        .div(100);
      expect(
        new Prisma.Decimal(recap.grandTotal).equals(
          subtotal.add(margin).add(tax).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
        ),
      ).toBe(true);
    }
  });

  // ── G. RELOAD ─────────────────────────────────────────────────────────────
  it('G: a hard reload loses nothing — count, quantity, AHSP linkage, money, trust state and recap all survive', async () => {
    const read = () =>
      request(app.getHttpServer())
        .get(`/projects/${projectId}/boq/draft`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);

    const first = await read();
    const second = await read();
    // Named explicitly: a reload that returns 200 with no rows is exactly the
    // failure this test exists to catch, and it must not surface as a
    // TypeError three lines further down.
    for (const [label, response] of [
      ['first', first],
      ['second', second],
    ] as const) {
      expect({
        read: label,
        hasItems: Array.isArray(response.body?.items),
        count: response.body?.items?.length ?? null,
      }).toEqual({ read: label, hasItems: true, count: 12 });
    }

    const shape = (body: any) => ({
      recap: body.recap,
      capability: body.capability,
      items: (body.items as any[]).map((row) => ({
        wbsCode: row.wbsCode,
        name: row.name,
        quantity: row.quantity,
        unit: row.unit,
        unitPrice: row.unitPrice,
        lineTotal: row.lineTotal,
        priceOrigin: row.priceOrigin,
        ahspVersionId: row.ahspVersionId,
      })),
    });
    expect(shape(second.body)).toEqual(shape(first.body));
    expect(shape(second.body).items).toHaveLength(12);
    // The money that survived is the money that was proven, not a blank row
    // set that happens to match another blank row set.
    const survivingPriced = shape(second.body).items.filter(
      (row) => row.priceOrigin === 'SERVER_COST_KERNEL',
    );
    expect(survivingPriced).toHaveLength(
      rows.filter((row) => row.persistStatus === 201).length,
    );
    for (const row of survivingPriced) expect(row.unitPrice).not.toBeNull();
  });

  // ── H. TRACE ──────────────────────────────────────────────────────────────
  it('H: a priced row traces BOQ → occurrence → AHSP → resource resolution → Basic Price evidence', async () => {
    const priced = rows.filter((row) => row.persistStatus === 201);
    for (const row of priced.slice(0, 3)) {
      const proof = await request(app.getHttpServer())
        .get(`/projects/${projectId}/boq/items/${row.boqItemId}/persisted-calculation`)
        .set('Authorization', `Bearer ${viewerToken}`)
        .expect(200);
      expect(proof.body.boqItemId).toBe(row.boqItemId);
      expect(proof.body.provenance.calculationOccurrenceId).toBeTruthy();

      const occurrence = await prisma.projectAhspOccurrence.findUniqueOrThrow({
        where: { id: proof.body.provenance.calculationOccurrenceId },
        include: { resourceResolutions: true },
      });
      expect(occurrence.ahspVersionId).toBe(row.ahspVersionId);
      expect(occurrence.referenceRegionId).toBe(regionId);

      for (const resolution of occurrence.resourceResolutions) {
        expect(resolution.selectedBasicPriceId).not.toBeNull();
        const price = await prisma.basicPrice.findUniqueOrThrow({
          where: { id: resolution.selectedBasicPriceId! },
        });
        // Field-survey provenance, never relabelled as a government price.
        expect(price.sourceOrigin).toBe('FIELD_REPORT');
        expect(price.status).toBe('PUBLISHED');
        expect(price.regionId).toBe(regionId);
        // The snapshot reproduces the price it was taken from, exactly.
        expect(
          new Prisma.Decimal(resolution.sourcePriceValue!).equals(
            new Prisma.Decimal(price.value),
          ),
        ).toBe(true);
        // And back to the source spelling this resolution answered for.
        const sighting = await prisma.resourceSourceIdentity.findFirst({
          where: {
            workspaceId,
            resourceCatalogId: resolution.resourceCatalogId!,
          },
        });
        expect(sighting?.sourceSha256).toBe(golden.sha256.toUpperCase());
      }
    }
  });

  // ── FAIL-CLOSED ON FACT · CONTINUE SAFELY ON WORKFLOW ─────────────────────
  it('the evidence’s own ambiguity is reported, never resolved by SIMPROK', () => {
    // The pack states ONE (name, type) with two canonical units: "Mortar"
    // (M279) is priced per m3 in B4-B8 and per kg in B9-B10. That is a fact
    // about the source, and this fixture neither hides it nor picks a winner.
    expect(ambiguousCatalogNames(section.identities)).toEqual(['mortar||MATERIAL']);
  });

  it('one unprovable resource withholds ONLY its own row — every safe row still carries proven money', async () => {
    const withheld = rows.filter((row) => row.persistStatus !== 201);
    const priced = rows.filter((row) => row.persistStatus === 201);

    // Whatever the split, it must be a split of the SAME 12 rows and every
    // row must be visible.
    expect(withheld.length + priced.length).toBe(12);
    expect(priced.length).toBeGreaterThan(0);

    for (const row of withheld) {
      const stored = await prisma.boqItem.findUniqueOrThrow({
        where: { id: row.boqItemId },
      });
      // Visible, quantified, bound to its AHSP — and honestly unpriced.
      expect(stored.unitPrice).toBeNull();
      expect(stored.lineTotal).toBeNull();
      expect(stored.priceOrigin).not.toBe('SERVER_COST_KERNEL');
      expect(stored.ahspVersionId).toBe(row.ahspVersionId);

      // The reason is inspectable, on the row's own resolutions.
      const occurrence = await prisma.projectAhspOccurrence.findFirstOrThrow({
        where: { projectId, ahspVersionId: row.ahspVersionId },
        include: { resourceResolutions: true },
      });
      const unresolved = occurrence.resourceResolutions.filter(
        (resolution) => resolution.status !== 'RESOLVED',
      );
      expect(unresolved.length).toBeGreaterThan(0);
      expect(unresolved.every((r) => r.reasonCodes.length > 0)).toBe(true);
      expect(unresolved.every((r) => (r.explanation ?? '').length > 0)).toBe(true);
    }

    // The load-bearing claim: a healthy row is not destroyed by a sick one.
    for (const row of priced) {
      const stored = await prisma.boqItem.findUniqueOrThrow({
        where: { id: row.boqItemId },
      });
      expect(stored.priceOrigin).toBe('SERVER_COST_KERNEL');
      expect(stored.unitPrice).not.toBeNull();
    }
  });

  it('a withheld row is never silently dropped from what the browser shows', async () => {
    const draft = await request(app.getHttpServer())
      .get(`/projects/${projectId}/boq/draft`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);
    const shown = new Set((draft.body.items as any[]).map((row) => row.wbsCode));
    for (const row of rows) expect(shown.has(row.wbsCode)).toBe(true);
    expect(shown.size).toBe(12);
  });
});
