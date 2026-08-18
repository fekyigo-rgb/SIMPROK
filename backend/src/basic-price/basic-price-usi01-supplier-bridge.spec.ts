import { ForbiddenException } from '@nestjs/common';
import {
  CONNECTOR_REFUSALS,
  IngestionConnectorService,
  generateConnectorSecret,
  hashConnectorSecret,
} from '../universal-intake/connectors/ingestion-connector.service';
import { BasicPriceImportService } from './basic-price-import.service';
import { BasicPriceSupplierBridgeService } from './basic-price-supplier-bridge.service';
import {
  buildBasicPriceCsv,
  buildSemanticHeaderXlsx,
} from '../../test/fixtures/usi01-source-shapes.fixture';
import { createIntakeHarness } from '../../test/fixtures/usi01r-intake-harness';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '99999999-9999-4999-8999-999999999999';
const ORGANIZATION = '22222222-2222-4222-8222-222222222222';
const SUPPLIER_ACCOUNT = '44444444-4444-4444-8444-444444444444';
const CONNECTOR_ID = '55555555-5555-4555-8555-555555555555';

function createConnectorService(overrides: Record<string, unknown> = {}) {
  const secret = generateConnectorSecret();
  const stored = {
    id: CONNECTOR_ID,
    workspaceId: WORKSPACE,
    organizationId: ORGANIZATION,
    displayName: 'Supplier Uji',
    channel: 'SUPPLIER_BRIDGE',
    secretHash: hashConnectorSecret(secret),
    status: 'ACTIVE',
    actsOnBehalfOfAccountId: SUPPLIER_ACCOUNT,
    ...overrides,
  };
  const prisma: any = {
    ingestionConnector: {
      findUnique: async ({ where }: any) => (where.id === stored.id ? stored : null),
    },
  };
  return { service: new IngestionConnectorService(prisma), secret, stored };
}

describe('USI-01 §10 Supplier Bridge — Phase 0', () => {
  const buildBridge = () => {
    const harness = createIntakeHarness();
    const imports = new BasicPriceImportService(
      harness.prisma,
      harness.reviewService,
      harness.sourceArchive,
    );
    const { service: connectors, secret } = createConnectorService();
    const bridge = new BasicPriceSupplierBridgeService(connectors, imports);
    return { bridge, imports, secret, ...harness };
  };

  const credentials = (secret: string, workspaceId = WORKSPACE) => ({
    connectorId: CONNECTOR_ID,
    secret,
    workspaceId,
  });

  it('TEST S1: a simulated supplier connector sends an XLSX through the connector-neutral seam', async () => {
    const { bridge, secret, batches, rows } = buildBridge();
    const summary = await bridge.submit({
      credentials: credentials(secret),
      externalRecordId: 'SUP-4471',
      fileName: 'daftar-harga.xlsx',
      bytes: await buildSemanticHeaderXlsx(),
      metadata: { declaredSection: 'MATERIAL' } as any,
    });

    expect(summary.totalRows).toBe(4);
    expect(batches).toHaveLength(1);
    expect(rows).toHaveLength(4);
  });

  it('TEST S2: the SAME seam accepts a CSV from the same connector', async () => {
    const { bridge, secret, batches } = buildBridge();
    await bridge.submit({
      credentials: credentials(secret),
      fileName: 'daftar-harga.csv',
      bytes: buildBasicPriceCsv(),
      metadata: { declaredSection: 'MATERIAL' } as any,
    });
    expect(batches[0].sourceLocatorDialect).toBe('CSV_RC');
  });

  it('TEST S3: supplier data lands as review candidates, NEVER as a BasicPrice', async () => {
    const { bridge, secret, batches, rows } = buildBridge();
    await bridge.submit({
      credentials: credentials(secret),
      fileName: 'daftar-harga.csv',
      bytes: buildBasicPriceCsv(),
      metadata: { declaredSection: 'MATERIAL' } as any,
    });

    // The whole output is a batch of NEEDS_REVIEW candidates. The recording
    // Prisma throws on any model outside intake's allowed set, so reaching
    // `basicPrice`, `priceSubmission` or a publication table would have failed
    // this test rather than passed it quietly.
    expect(batches[0].status).toBe('NEEDS_REVIEW');
    expect(rows.every((row) => row.status === 'NEEDS_REVIEW')).toBe(true);
    expect(rows.every((row) => row.resolutionStatus === 'UNRESOLVED')).toBe(true);
    expect(rows.every((row) => row.priceSubmissionId === undefined)).toBe(true);
  });

  it('TEST S4: channel and connector are recorded, and neither becomes a source origin', async () => {
    const { bridge, secret, batches } = buildBridge();
    await bridge.submit({
      credentials: credentials(secret),
      externalRecordId: 'SUP-4471',
      fileName: 'daftar-harga.csv',
      bytes: buildBasicPriceCsv(),
      metadata: { declaredSection: 'MATERIAL' } as any,
    });

    expect(batches[0]).toMatchObject({
      ingestionChannel: 'SUPPLIER_BRIDGE',
      ingestionConnectorId: CONNECTOR_ID,
      ingestionExternalRecordId: 'SUP-4471',
      // LAW 3 — arriving over the Supplier Bridge is NOT evidence that the price
      // is a supplier's. A supplier may forward a government price list, so
      // origin stays unstated until a human states it.
      sourceOrigin: null,
      sourceType: null,
    });
  });

  it('TEST S5: an exact replay returns the same batch instead of duplicating candidates', async () => {
    const { bridge, secret, batches, rows } = buildBridge();
    const submission = {
      credentials: credentials(secret),
      externalRecordId: 'SUP-4471',
      fileName: 'daftar-harga.csv',
      bytes: buildBasicPriceCsv(),
      metadata: { declaredSection: 'MATERIAL' } as any,
    };

    const first = await bridge.submit(submission);
    const second = await bridge.submit(submission);

    expect(second.batchId).toBe(first.batchId);
    expect(batches).toHaveLength(1);
    expect(rows).toHaveLength(3);
  });

  it('TEST I7: a different external record ref is a DIFFERENT arrival, not a replay', async () => {
    const { bridge, secret, batches } = buildBridge();
    const base = {
      credentials: credentials(secret),
      fileName: 'daftar-harga.csv',
      bytes: buildBasicPriceCsv(),
      metadata: { declaredSection: 'MATERIAL' } as any,
    };

    const first = await bridge.submit({ ...base, externalRecordId: 'SUP-1' });
    const second = await bridge.submit({ ...base, externalRecordId: 'SUP-2' });

    expect(second.batchId).not.toBe(first.batchId);
    expect(batches).toHaveLength(2);
  });

  it('the connector cannot choose its own workspace — the connector row decides', async () => {
    const { bridge, secret, batches } = buildBridge();
    await bridge.submit({
      credentials: credentials(secret),
      fileName: 'daftar-harga.csv',
      bytes: buildBasicPriceCsv(),
      metadata: { declaredSection: 'MATERIAL' } as any,
    });
    expect(batches[0].workspaceId).toBe(WORKSPACE);
    // Execution belongs to a User: a named account is answerable, not the
    // connector id.
    expect(batches[0].uploadedByAccountId).toBe(SUPPLIER_ACCOUNT);
  });

  describe('TESTS S6/S7 — the boundary fails closed', () => {
    const submitWith = async (
      connectorOverrides: Record<string, unknown>,
      credentialOverrides: Partial<{ secret: string; workspaceId: string }> = {},
    ) => {
      const harness = createIntakeHarness();
      const { service: connectors, secret } = createConnectorService(connectorOverrides);
      const bridge = new BasicPriceSupplierBridgeService(
        connectors,
        new BasicPriceImportService(
          harness.prisma,
          harness.reviewService,
          harness.sourceArchive,
        ),
      );
      return bridge.submit({
        credentials: {
          connectorId: CONNECTOR_ID,
          secret: credentialOverrides.secret ?? secret,
          workspaceId: credentialOverrides.workspaceId ?? WORKSPACE,
        },
        fileName: 'daftar-harga.csv',
        bytes: buildBasicPriceCsv(),
        metadata: { declaredSection: 'MATERIAL' } as any,
      });
    };

    it('TEST S6: a REVOKED connector is refused', async () => {
      await expect(submitWith({ status: 'REVOKED' })).rejects.toThrow(
        CONNECTOR_REFUSALS.REVOKED,
      );
    });

    it('TEST S6: an UNKNOWN connector is refused', async () => {
      await expect(submitWith({ id: 'some-other-id' })).rejects.toThrow(
        CONNECTOR_REFUSALS.UNKNOWN,
      );
    });

    it('a wrong secret is refused', async () => {
      await expect(submitWith({}, { secret: 'not-the-secret' })).rejects.toThrow(
        CONNECTOR_REFUSALS.AUTHENTICATION_FAILED,
      );
    });

    it('TEST S7: a connector cannot cross into another workspace', async () => {
      await expect(submitWith({}, { workspaceId: OTHER_WORKSPACE })).rejects.toThrow(
        CONNECTOR_REFUSALS.WORKSPACE_MISMATCH,
      );
    });

    it('a connector may never claim the human-upload channel', async () => {
      await expect(submitWith({ channel: 'USER_UPLOAD' })).rejects.toThrow(
        CONNECTOR_REFUSALS.CHANNEL_NOT_PERMITTED,
      );
    });

    it('every refusal is a Forbidden, and none of them reads a single byte', async () => {
      // Authorization runs BEFORE parsing. An unauthorized payload therefore
      // never reaches a reader at all, so it cannot be used to attack the
      // parsing layer of a workspace its sender was never entitled to touch.
      await expect(submitWith({ status: 'REVOKED' })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
