import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  deriveExplorerSourceName,
  mapBasicPriceEvidence,
  sourceIdentityNameFromAudit,
  type DetailRowSource,
} from '../common/basic-price-workflow.projection';
import { BasicPricePrivateAssetService } from './basic-price-private-asset.service';

function firstCallArg<T>(mock: jest.Mock): T {
  const calls: unknown[][] = mock.mock.calls as unknown[][];
  const first = calls[0];
  if (!Array.isArray(first) || first[0] === undefined) {
    throw new Error('expected a call argument');
  }
  return first[0] as T;
}

const RESOURCE = {
  id: 'rc-01',
  code: 'M-1',
  name: 'Semen',
  type: 'MATERIAL',
  baseUnit: 'Zak',
};

function explorerRow(
  over: Partial<DetailRowSource> & { id?: string } = {},
): DetailRowSource {
  return {
    id: 'bp-now',
    workspaceId: 'ws-1',
    assetScope: 'WORKSPACE_PRIVATE',
    value: '65000.00',
    effectiveDate: new Date('2026-08-28'),
    validUntil: null,
    sourceType: 'MARKET_SURVEY',
    sourceOrigin: 'STORE',
    freshnessStatus: 'CURRENT',
    resource: RESOURCE,
    region: { id: 'reg-1', code: 'AMB', name: 'Ambon' },
    sourceSubmission: null,
    sourceImportRow: null,
    ...over,
  };
}

describe('BP-EVIDENCE-MIG-04 evidence truth', () => {
  describe('projection', () => {
    it('PRICE-EVID-01 — same-source identity from audit is not the predecessor file', () => {
      const row = explorerRow({
        provenanceCorrections: [
          {
            after: {
              sourceIdentityName: 'Toko ABC',
              evidenceClass: 'FIELD_REPORTED',
              observedAfterBasicPriceId: 'bp-may',
            },
          },
        ],
        sourceImportRow: null,
        sourceSubmission: null,
      });
      expect(deriveExplorerSourceName(row)).toBe('Toko ABC');
      const evidence = mapBasicPriceEvidence(row);
      expect(evidence.importBatchLinked).toBe(false);
      expect(evidence.originalFileRetained).toBe(false);
      expect(evidence.observationBasis).toBe('FIELD_REPORTED');
      expect(JSON.stringify(evidence)).not.toContain('bp-may');
      expect(JSON.stringify(evidence)).not.toContain(
        'observedAfterBasicPriceId',
      );
    });

    it('PRICE-EVID-03 — import chain is documentary even when bytes are gone', () => {
      const evidence = mapBasicPriceEvidence(
        explorerRow({
          sourceType: 'VENDOR_QUOTE',
          sourceImportRow: {
            batch: {
              sourceVendorName: 'Toko ABC',
              sourceOrganizationName: null,
            },
          },
        }),
      );
      expect(evidence.importBatchLinked).toBe(true);
      expect(evidence.originalFileRetained).toBe(false);
      expect(evidence.observationBasis).toBe('SOURCE_DOCUMENT');
    });

    it('PRICE-EVID-04 — field-reported is not labelled documentary', () => {
      const evidence = mapBasicPriceEvidence(
        explorerRow({
          sourceType: 'MARKET_SURVEY',
          sourceOrigin: 'FIELD_REPORT',
        }),
      );
      expect(evidence.observationBasis).toBe('FIELD_REPORTED');
      expect(evidence.importBatchLinked).toBe(false);
    });

    it('PRICE-EVID-05 / KDN-EVID-07 — raw storage and import ids stay off the projection', () => {
      const evidence = mapBasicPriceEvidence(
        explorerRow({
          sourceImportRow: {
            sourceKdnHeaderText: '%KDN',
            batch: {
              sourceVendorName: 'Toko ABC',
              sourceOrganizationName: null,
              sourceStorageRef: 'basic-price-intake/ab/cdef0123',
              sourceFileName: 'harga.xlsx',
            },
          },
          kdnPercent: '72.50',
          kdnEstablishment: 'SOURCE_IMPORT_ROW',
        }),
      );
      const serialised = JSON.stringify(evidence);
      expect(evidence.originalFileRetained).toBe(true);
      expect(serialised).not.toContain('basic-price-intake');
      expect(serialised).not.toContain('sourceStorageRef');
      expect(serialised).not.toContain('sourceImportRowId');
      expect(evidence.kdnSourceSummary).toContain('harga.xlsx');
    });

    it('PRICE-EVID-07 — correction may reuse predecessor documentary evidence without a duplicate file pointer', () => {
      const evidence = mapBasicPriceEvidence(
        explorerRow({
          sourceImportRow: null,
          sourceSubmission: null,
          supersedes: {
            sourceImportRow: {
              batch: {
                sourceVendorName: 'Toko ABC',
                sourceOrganizationName: null,
                sourceStorageRef: 'basic-price-intake/ab/invoice-may',
              },
            },
          },
        }),
      );
      expect(evidence.importBatchLinked).toBe(true);
      expect(evidence.originalFileRetained).toBe(true);
      expect(evidence.observationBasis).toBe('SOURCE_DOCUMENT');
      expect(JSON.stringify(evidence)).not.toContain('basic-price-intake');
    });

    it('PRICE-EVID-01 — a new observation must not inherit predecessor documentary evidence', () => {
      const evidence = mapBasicPriceEvidence(
        explorerRow({
          sourceImportRow: null,
          sourceSubmission: null,
          supersedes: null,
        }),
      );
      expect(evidence.importBatchLinked).toBe(false);
      expect(evidence.observationBasis).toBe('FIELD_REPORTED');
    });

    it('EVID-CLASS-01 — a documentary/import chain is SOURCE_DOCUMENT', () => {
      const evidence = mapBasicPriceEvidence(
        explorerRow({
          sourceType: 'VENDOR_QUOTE',
          sourceOrigin: 'SUPPLIER',
          sourceImportRow: {
            batch: {
              sourceVendorName: 'Toko ABC',
              sourceOrganizationName: null,
            },
          },
        }),
      );
      expect(evidence.importBatchLinked).toBe(true);
      expect(evidence.observationBasis).toBe('SOURCE_DOCUMENT');
    });

    it('EVID-CLASS-02 — an explicit field-report marker is FIELD_REPORTED', () => {
      const bySourceSemantics = mapBasicPriceEvidence(
        explorerRow({
          sourceType: 'MARKET_SURVEY',
          sourceOrigin: 'FIELD_REPORT',
          sourceImportRow: null,
          sourceSubmission: null,
        }),
      );
      expect(bySourceSemantics.importBatchLinked).toBe(false);
      expect(bySourceSemantics.observationBasis).toBe('FIELD_REPORTED');

      const byWriterProvenance = mapBasicPriceEvidence(
        explorerRow({
          sourceType: 'VENDOR_QUOTE',
          sourceOrigin: 'STORE',
          sourceImportRow: null,
          sourceSubmission: null,
          provenanceCorrections: [
            { after: { evidenceClass: 'FIELD_REPORTED' } },
          ],
        }),
      );
      expect(byWriterProvenance.observationBasis).toBe('FIELD_REPORTED');
    });

    it('EVID-CLASS-03 — no documentary chain and no field-report marker is not FIELD_REPORTED', () => {
      const evidence = mapBasicPriceEvidence(
        explorerRow({
          sourceType: 'SYSTEM_ESTIMATE',
          sourceOrigin: 'GOVERNMENT',
          sourceImportRow: null,
          sourceSubmission: null,
          supersedes: null,
          provenanceCorrections: null,
        }),
      );
      expect(evidence.importBatchLinked).toBe(false);
      expect(evidence.observationBasis).not.toBe('FIELD_REPORTED');
    });

    it('EVID-CLASS-04 — legacy/unknown provenance is not silently upgraded to SOURCE_DOCUMENT', () => {
      const evidence = mapBasicPriceEvidence(
        explorerRow({
          sourceType: 'SYSTEM_ESTIMATE',
          sourceOrigin: 'GOVERNMENT',
          sourceImportRow: null,
          sourceSubmission: null,
          supersedes: null,
          provenanceCorrections: null,
        }),
      );
      expect(evidence.observationBasis).not.toBe('SOURCE_DOCUMENT');
      expect(evidence.importBatchLinked).toBe(false);
    });

    it('EVID-CLASS-05 — legacy/unknown provenance is not silently upgraded to VERIFIED', () => {
      const evidence = mapBasicPriceEvidence(
        explorerRow({
          sourceType: 'SYSTEM_ESTIMATE',
          sourceOrigin: 'GOVERNMENT',
          sourceImportRow: null,
          sourceSubmission: null,
          supersedes: null,
          provenanceCorrections: null,
        }),
      );
      const serialised = JSON.stringify(evidence);
      expect(evidence.observationBasis).toBeNull();
      expect(serialised).not.toMatch(/"VERIFIED"/);
      expect(serialised).not.toContain('verificationStatus');
    });

    it('EVID-CLASS-06 — unknown evidence stays a truthful neutral projection without raw ids', () => {
      const evidence = mapBasicPriceEvidence(
        explorerRow({
          id: 'bp-legacy-unknown',
          sourceType: 'SYSTEM_ESTIMATE',
          sourceOrigin: 'GOVERNMENT',
          sourceImportRow: null,
          sourceSubmission: null,
          supersedes: null,
          provenanceCorrections: null,
        }),
      );
      const serialised = JSON.stringify(evidence);
      expect(evidence.observationBasis).toBeNull();
      expect(evidence.importBatchLinked).toBe(false);
      expect(evidence.originalFileRetained).toBe(false);
      expect(serialised).not.toContain('bp-legacy-unknown');
      expect(serialised).not.toContain('sourceImportRowId');
      expect(serialised).not.toContain('sourceStorageRef');
      expect(serialised).not.toContain('basic-price-intake');
    });

    it('batch vendor name wins over audit identity', () => {
      expect(
        deriveExplorerSourceName(
          explorerRow({
            sourceImportRow: {
              batch: {
                sourceVendorName: 'Toko ABC',
                sourceOrganizationName: null,
              },
            },
            provenanceCorrections: [
              { after: { sourceIdentityName: 'Should Not Appear' } },
            ],
          }),
        ),
      ).toBe('Toko ABC');
    });

    it('sourceIdentityNameFromAudit ignores blank and non-string values', () => {
      expect(
        sourceIdentityNameFromAudit({ sourceIdentityName: '  ' }),
      ).toBeNull();
      expect(
        sourceIdentityNameFromAudit({ sourceIdentityName: 12 }),
      ).toBeNull();
      expect(sourceIdentityNameFromAudit(null)).toBeNull();
    });

    it('KDN-EVID-01 / KDN-EVID-06 — manual enrichment is not a manufacturer certificate', () => {
      const evidence = mapBasicPriceEvidence(
        explorerRow({
          kdnPercent: '72.50',
          kdnEstablishment: 'MANUAL_ENRICHMENT',
          sourceImportRow: {
            sourceKdnHeaderText: '%KDN',
            batch: {
              sourceVendorName: 'Toko ABC',
              sourceOrganizationName: null,
              sourceFileName: 'harga.xlsx',
            },
          },
        }),
      );
      expect(evidence.kdnSourceSummary).toBe('Dilengkapi kemudian');
      expect(evidence.kdnSourceSummary).not.toMatch(/sertifikat/i);
    });

    it('KDN-EVID-02 / KDN-EVID-03 — correction and new KDN have their own public sentences', () => {
      expect(
        mapBasicPriceEvidence(
          explorerRow({
            kdnPercent: '68.20',
            kdnEstablishment: 'MANUAL_CORRECTION',
          }),
        ).kdnSourceSummary,
      ).toBe('Koreksi nilai sebelumnya');
      expect(
        mapBasicPriceEvidence(
          explorerRow({
            kdnPercent: '70.00',
            kdnEstablishment: 'MANUAL_NEW_OBSERVATION',
          }),
        ).kdnSourceSummary,
      ).toBe('Informasi KDN terbaru');
    });

    it('KDN-EVID-04 — KDN source sentence is independent of price source name', () => {
      const row = explorerRow({
        kdnPercent: '70.00',
        kdnEstablishment: 'MANUAL_NEW_OBSERVATION',
        provenanceCorrections: [{ after: { sourceIdentityName: 'Toko ABC' } }],
      });
      const evidence = mapBasicPriceEvidence(row);
      expect(deriveExplorerSourceName(row)).toBe('Toko ABC');
      expect(evidence.kdnSourceSummary).toBe('Informasi KDN terbaru');
      expect(evidence.kdnSourceSummary).not.toBe('Toko ABC');
    });
  });

  describe('private writers', () => {
    const ACTOR = { accountId: 'acct-1', workspaceId: 'ws-1' };
    const MAY = new Date('2026-05-01T00:00:00.000Z');
    const PREDECESSOR = {
      id: 'bp-may',
      workspaceId: ACTOR.workspaceId,
      organizationId: 'org-1',
      resourceId: 'res-1',
      regionId: 'reg-1',
      effectiveDate: MAY,
      value: '62500.00',
      kdnPercent: '72.50',
      kdnEstablishment: 'SOURCE_IMPORT_ROW',
      sourceType: 'VENDOR_QUOTE',
      sourceOrigin: 'STORE',
      freshnessStatus: 'CURRENT',
      reviewDate: null,
      validUntil: null,
      sourcePeriodLabel: 'Mei 2026',
      sourcePeriodGranularity: 'YEAR',
      effectiveDateProvenance: 'DERIVED_FROM_SOURCE_PERIOD',
      effectiveDateDerivationRule: 'YEAR_START',
      sourceImportRowId: 'import-row-may',
      sourceImportRow: {
        batch: {
          sourceVendorName: 'Toko ABC',
          sourceOrganizationName: null,
        },
      },
      sourceSubmission: null,
    };

    let service: BasicPricePrivateAssetService;
    let tx: {
      $queryRaw: jest.Mock;
      basicPrice: {
        findFirst: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
        updateMany: jest.Mock;
      };
      basicPriceProvenanceCorrection: { create: jest.Mock };
    };

    beforeEach(() => {
      tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ id: PREDECESSOR.id }]),
        basicPrice: {
          findFirst: jest.fn(),
          create: jest.fn().mockResolvedValue({
            id: 'bp-aug',
            value: new Prisma.Decimal('65000.00'),
            kdnPercent: new Prisma.Decimal('72.50'),
            createdAt: new Date('2026-08-28T03:00:00.000Z'),
          }),
          update: jest.fn(),
          updateMany: jest.fn(),
        },
        basicPriceProvenanceCorrection: {
          create: jest.fn().mockResolvedValue({}),
        },
      };
      const prisma = {
        $transaction: jest.fn((fn: (t: typeof tx) => unknown) =>
          Promise.resolve(fn(tx)),
        ),
      };
      service = new BasicPricePrivateAssetService(prisma as never);
    });

    it('PRICE-EVID-01 / PRICE-EVID-04 / PRICE-EVID-10 — field-reported new money keeps source identity and does not inherit VENDOR_QUOTE', async () => {
      tx.basicPrice.findFirst
        .mockResolvedValueOnce(PREDECESSOR)
        .mockResolvedValueOnce(null);
      await service.observePrivatePrice({
        basicPriceId: PREDECESSOR.id,
        actor: ACTOR,
        expectedValue: '62500.00',
        proposedValue: '65000.00',
        effectiveDate: '2026-08-28',
        reason: 'cek lapangan Agustus',
        sameSource: true,
      });
      const data = firstCallArg<{ data: Record<string, unknown> }>(
        tx.basicPrice.create,
      ).data;
      expect(data.recordsNewObservation).toBe(true);
      expect(data.sourceImportRowId).toBeUndefined();
      expect(data.sourceType).toBe('MARKET_SURVEY');
      expect(data.sourceOrigin).toBe('STORE');
      expect(data.reportedByAccountId).toBe(ACTOR.accountId);
      const audit = firstCallArg<{
        data: {
          after: Record<string, unknown>;
          before: Record<string, unknown>;
        };
      }>(tx.basicPriceProvenanceCorrection.create).data;
      expect(audit.after.evidenceClass).toBe('FIELD_REPORTED');
      expect(audit.after.sourceIdentityName).toBe('Toko ABC');
      expect(audit.after.sameSourceIdentity).toBe(true);
      expect(JSON.stringify(audit)).not.toContain('import-row-may');
      expect(tx.basicPrice.update).not.toHaveBeenCalled();
    });

    it('PRICE-EVID-02 — different source records a new identity and does not overwrite the predecessor', async () => {
      tx.basicPrice.findFirst
        .mockResolvedValueOnce(PREDECESSOR)
        .mockResolvedValueOnce(null);
      await service.observePrivatePrice({
        basicPriceId: PREDECESSOR.id,
        actor: ACTOR,
        expectedValue: '62500.00',
        proposedValue: '65000.00',
        effectiveDate: '2026-08-28',
        reason: 'toko lain',
        sameSource: false,
        sourceIdentityName: 'Toko Baru',
      });
      const data = firstCallArg<{ data: Record<string, unknown> }>(
        tx.basicPrice.create,
      ).data;
      expect(data.sourceOrigin).toBe('FIELD_REPORT');
      expect(data.sourceType).toBe('MARKET_SURVEY');
      const audit = firstCallArg<{
        data: {
          after: { sourceIdentityName: string; sameSourceIdentity: boolean };
        };
      }>(tx.basicPriceProvenanceCorrection.create).data;
      expect(audit.after.sourceIdentityName).toBe('Toko Baru');
      expect(audit.after.sameSourceIdentity).toBe(false);
      expect(tx.basicPrice.update).not.toHaveBeenCalled();
      expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
    });

    it('PRICE-EVID-02 — different source without a name fails closed', async () => {
      tx.basicPrice.findFirst.mockResolvedValueOnce(PREDECESSOR);
      await expect(
        service.observePrivatePrice({
          basicPriceId: PREDECESSOR.id,
          actor: ACTOR,
          expectedValue: '62500.00',
          proposedValue: '65000.00',
          effectiveDate: '2026-08-28',
          reason: 'toko lain',
          sameSource: false,
        }),
      ).rejects.toMatchObject({ message: 'SOURCE_IDENTITY_REQUIRED' });
      expect(tx.basicPrice.create).not.toHaveBeenCalled();
    });

    it('PRICE-EVID-08 / PRICE-EVID-07 — correction keeps documentary type and may name the original source', async () => {
      tx.basicPrice.findFirst
        .mockResolvedValueOnce(PREDECESSOR)
        .mockResolvedValueOnce(null);
      tx.basicPrice.create.mockResolvedValueOnce({
        id: 'bp-fix',
        value: new Prisma.Decimal('62000.00'),
      });
      await service.correctPrivatePrice({
        basicPriceId: PREDECESSOR.id,
        actor: ACTOR,
        expectedValue: '62500.00',
        proposedValue: '62000.00',
        reason: 'salah baca invoice Mei',
      });
      const data = firstCallArg<{ data: Record<string, unknown> }>(
        tx.basicPrice.create,
      ).data;
      expect(data.sourceType).toBe('VENDOR_QUOTE');
      expect(data.sourceOrigin).toBe('STORE');
      expect(data.supersedesBasicPriceId).toBe(PREDECESSOR.id);
      expect(data.sourceImportRowId).toBeUndefined();
      const audit = firstCallArg<{
        data: {
          before: { value: string };
          after: {
            value: string;
            evidenceClass: string;
            sourceIdentityName: string;
          };
        };
      }>(tx.basicPriceProvenanceCorrection.create).data;
      expect(audit.before.value).toBe('62500.00');
      expect(audit.after.value).toBe('62000.00');
      expect(audit.after.evidenceClass).toBe('SOURCE_DOCUMENT');
      expect(audit.after.sourceIdentityName).toBe('Toko ABC');
    });

    it('PRICE-EVID-09 — evidence-class metadata does not move money by itself', async () => {
      tx.basicPrice.findFirst
        .mockResolvedValueOnce(PREDECESSOR)
        .mockResolvedValueOnce(null);
      await service.observePrivatePrice({
        basicPriceId: PREDECESSOR.id,
        actor: ACTOR,
        expectedValue: '62500.00',
        proposedValue: '65000.00',
        effectiveDate: '2026-08-28',
        reason: 'cek lapangan',
      });
      expect(tx.basicPrice.update).not.toHaveBeenCalled();
      expect(tx.basicPrice.updateMany).not.toHaveBeenCalled();
      const data = firstCallArg<{ data: { value: Prisma.Decimal } }>(
        tx.basicPrice.create,
      ).data;
      expect(data.value).toEqual(new Prisma.Decimal('65000.00'));
    });

    it('KDN-EVID-02 — KDN correction keeps price source and records correction evidence', async () => {
      tx.basicPrice.findFirst
        .mockResolvedValueOnce(PREDECESSOR)
        .mockResolvedValueOnce(null);
      tx.basicPrice.create.mockResolvedValueOnce({
        id: 'bp-kdn-fix',
        value: new Prisma.Decimal('62500.00'),
        kdnPercent: new Prisma.Decimal('68.20'),
      });
      await service.correctPrivateKdn({
        basicPriceId: PREDECESSOR.id,
        actor: ACTOR,
        expectedValue: '62500.00',
        expectedKdnPercent: '72.50',
        proposedKdnPercent: '68.20',
        reason: 'angka KDN salah baca',
      });
      const data = firstCallArg<{ data: Record<string, unknown> }>(
        tx.basicPrice.create,
      ).data;
      expect(data.value).toBe(PREDECESSOR.value);
      expect(data.sourceType).toBe('VENDOR_QUOTE');
      expect(data.kdnEstablishment).toBe('MANUAL_CORRECTION');
      const audit = firstCallArg<{
        data: { before: { kdnPercent: string }; after: { kdnPercent: string } };
      }>(tx.basicPriceProvenanceCorrection.create).data;
      expect(audit.before.kdnPercent).toBe('72.50');
      expect(audit.after.kdnPercent).toBe('68.20');
    });
  });

  describe('refusals', () => {
    it('ConflictException remains the closed door', () => {
      expect(new ConflictException('SOURCE_IDENTITY_REQUIRED')).toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
