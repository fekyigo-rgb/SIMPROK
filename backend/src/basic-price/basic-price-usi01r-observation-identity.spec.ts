import {
  IngestionConnectorService,
  generateConnectorSecret,
  hashConnectorSecret,
} from '../universal-intake/connectors/ingestion-connector.service';
import { sourceObservationKeyOf } from '../universal-intake/source-envelope';
import { BasicPriceImportService, compareSourceVersions } from './basic-price-import.service';
import { BasicPriceSupplierBridgeService } from './basic-price-supplier-bridge.service';
import { buildBasicPriceCsv } from '../../test/fixtures/usi01-source-shapes.fixture';
import { testEnvelope } from '../../test/fixtures/source-envelope.fixture';
import {
  HARNESS_ACCOUNT,
  HARNESS_ORGANIZATION,
  HARNESS_WORKSPACE,
  createIntakeHarness,
} from '../../test/fixtures/usi01r-intake-harness';

const CONNECTOR_ID = '55555555-5555-4555-8555-555555555555';
const SUPPLIER_ACCOUNT = '44444444-4444-4444-8444-444444444444';

/**
 * USI-01R GAP C — DELIVERY IS NOT AN OBSERVATION.
 *
 * The failure this suite exists to prevent has two symmetrical halves, and both
 * are silent corruptions of price history:
 *
 *   Treating a RETRY as news invents a price change that never happened.
 *   Treating a genuine NEW PRICE as a duplicate throws away a real one.
 *
 * LAW 2.4 is what separates them: a product identity is not its price, and one
 * stream may carry many observations over time.
 */
/** Shared builders — module scope so every describe in this file may use them. */
const build = () => {
  const harness = createIntakeHarness();
  const imports = new BasicPriceImportService(
    harness.prisma,
    harness.reviewService,
    harness.sourceArchive,
  );
  const secret = generateConnectorSecret();
  const connectorPrisma: any = {
    ingestionConnector: {
      findUnique: async ({ where }: any) =>
        where.id === CONNECTOR_ID
          ? {
              id: CONNECTOR_ID,
              workspaceId: HARNESS_WORKSPACE,
              organizationId: HARNESS_ORGANIZATION,
              displayName: 'Supplier Uji',
              channel: 'SUPPLIER_BRIDGE',
              secretHash: hashConnectorSecret(secret),
              status: 'ACTIVE',
              actsOnBehalfOfAccountId: SUPPLIER_ACCOUNT,
            }
          : null,
    },
  };
  const bridge = new BasicPriceSupplierBridgeService(
    new IngestionConnectorService(connectorPrisma),
    imports,
  );
  const send = (overrides: Record<string, unknown> = {}) =>
    bridge.submit({
      credentials: { connectorId: CONNECTOR_ID, secret, workspaceId: HARNESS_WORKSPACE },
      externalSourceId: 'SUPPLIER-CATALOG-1',
      externalRecordId: 'KERAMIK-X/SIRIMAU',
      externalVersion: '1',
      fileName: 'harga.csv',
      bytes: buildBasicPriceCsv(),
      metadata: { declaredSection: 'MATERIAL' } as any,
      ...(overrides as any),
    });
  return { send, imports, ...harness };
};

/** A second, genuinely different price list from the same supplier stream. */
const laterPriceList = () =>
  Buffer.from(
    [
      'resource_name,source_unit,harga satuan,sumber',
      'Pasir Uji CSV,M3,412000,Survei Uji',
      '"Batu Belah, Uji CSV",M3,351000,Survei Uji',
      'Semen Uji CSV,Zak,70250,Survei Uji',
      '',
    ].join('\r\n'),
    'utf8',
  );

describe('USI-01R delivery vs source observation identity', () => {

  describe('OBS-01 — a retry is a retry', () => {
    it('the same observation re-delivered under a NEW request id is idempotent', async () => {
      const { send, batches, storedBytes } = build();

      const first = await send({ deliveryId: 'req-aaa' });
      const second = await send({ deliveryId: 'req-bbb' });

      // Same fingerprint, same batch. A network hiccup must never look like a
      // supplier changing their price.
      expect(second.batchId).toBe(first.batchId);
      expect(batches).toHaveLength(1);
      expect(storedBytes.size).toBe(1);
    });

    it('the delivery id is retained as evidence even though it is not identity', async () => {
      const { send, batches } = build();
      await send({ deliveryId: 'req-aaa' });
      expect(batches[0].ingestionDeliveryId).toBe('req-aaa');
    });
  });

  describe('OBS-02 — a newer version is a new observation, not a duplicate', () => {
    it('LAW 2.5 — a legitimate later price is accepted, never rejected as known', async () => {
      const { send, batches } = build();

      const v1 = await send({ externalVersion: '1' });
      const v2 = await send({ externalVersion: '2', bytes: laterPriceList() });

      expect(v2.batchId).not.toBe(v1.batchId);
      expect(batches).toHaveLength(2);
      expect(batches.map((b) => b.ingestionExternalVersion).sort()).toEqual(['1', '2']);
      // Same product stream, two observations — exactly LAW 2.4.
      expect(new Set(batches.map((b) => b.ingestionExternalRecordId)).size).toBe(1);
    });

    it('a different record is a different stream, not a version of this one', async () => {
      const { send, batches } = build();
      await send({ externalRecordId: 'KERAMIK-X/SIRIMAU' });
      await send({ externalRecordId: 'KERAMIK-Y/SIRIMAU' });
      expect(batches).toHaveLength(2);
    });
  });

  describe('OBS-03 — one version may not carry two truths', () => {
    it('the same version with different content is a named CONFLICT, not a second batch', async () => {
      const { send, batches } = build();
      await send({ externalVersion: '7' });

      await expect(
        send({ externalVersion: '7', bytes: laterPriceList() }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ message: 'SOURCE_OBSERVATION_CONFLICT' }),
      });

      // Refused, so SIMPROK is not left quietly holding two incompatible prices
      // for one stated version.
      expect(batches).toHaveLength(1);
    });

    it('the refusal names both hashes so a human can see what disagreed', async () => {
      const { send } = build();
      await send({ externalVersion: '7' });
      await expect(
        send({ externalVersion: '7', bytes: laterPriceList() }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          existingSourceSha256: expect.any(String),
          incomingSourceSha256: expect.any(String),
        }),
      });
    });
  });

  describe('OBS-04 — arriving last does not make a version newest', () => {
    it('an out-of-order older version is accepted as evidence but flagged', async () => {
      const { send, batches } = build();

      await send({ externalVersion: '5' });
      const late = await send({ externalVersion: '4', bytes: laterPriceList() });

      // The evidence is real and stays traceable...
      expect(batches).toHaveLength(2);
      // ...but it is explicitly marked as a late arrival, and nothing in intake
      // derives recency from arrival time, so it cannot become "current" merely
      // by being the last to land (LAW 2.7).
      expect(late.lateArrivingSourceVersion).toBe(true);
    });

    it('the in-order case is not flagged', async () => {
      const { send } = build();
      await send({ externalVersion: '4' });
      const next = await send({ externalVersion: '5', bytes: laterPriceList() });
      expect(next.lateArrivingSourceVersion).toBe(false);
    });

    it('recency is a property of the VERSION, never of createdAt', async () => {
      const { send, batches } = build();
      await send({ externalVersion: '5' });
      await send({ externalVersion: '4', bytes: laterPriceList() });

      const byArrival = batches.map((b) => b.ingestionExternalVersion);
      const byVersion = [...byArrival].sort();
      // Arrival order and version order genuinely disagree here — which is the
      // whole point: anything reading "latest" must read the version.
      expect(byArrival).toEqual(['5', '4']);
      expect(byVersion).toEqual(['4', '5']);
    });
  });

  describe('OBS-05 / OBS-06 — a manual upload keeps its own law', () => {
    it('no external identifiers are invented for a human file upload', async () => {
      const { imports, batches } = build();
      const bytes = buildBasicPriceCsv();
      await imports.preview(
        HARNESS_WORKSPACE,
        HARNESS_ACCOUNT,
        { buffer: bytes, size: bytes.length, originalname: 'harga.csv' },
        { declaredSection: 'MATERIAL' } as any,
      );

      expect(batches[0]).toMatchObject({
        ingestionExternalSourceId: null,
        ingestionExternalRecordId: null,
        ingestionExternalVersion: null,
        ingestionDeliveryId: null,
        sourceObservedAt: null,
      });
    });

    it('OBS-06 — the exact same file uploaded twice is one batch', async () => {
      const { imports, batches, storedBytes } = build();
      const bytes = buildBasicPriceCsv();
      const file = { buffer: bytes, size: bytes.length, originalname: 'harga.csv' };
      const metadata = { declaredSection: 'MATERIAL' } as any;

      const first = await imports.preview(HARNESS_WORKSPACE, HARNESS_ACCOUNT, file, metadata);
      const second = await imports.preview(HARNESS_WORKSPACE, HARNESS_ACCOUNT, file, metadata);

      expect(second.batchId).toBe(first.batchId);
      expect(batches).toHaveLength(1);
      expect(storedBytes.size).toBe(1);
    });

    it('a manual upload has no observation key at all, and none is fabricated', () => {
      expect(sourceObservationKeyOf(testEnvelope(buildBasicPriceCsv(), 'a.csv'))).toBeNull();
    });
  });

  describe('the two clocks stay separate', () => {
    it('sourceObservedAt is the SOURCE’s time, never SIMPROK’s arrival time', async () => {
      const { send, batches } = build();
      const observedAt = new Date('2026-08-18T00:00:00.000Z');

      await send({ sourceObservedAt: observedAt });

      // A price observed on the 18th and delivered later is still an 18th fact.
      expect(batches[0].sourceObservedAt).toEqual(observedAt);
      expect(batches[0].sourceObservedAt).not.toEqual(batches[0].createdAt);
    });

    it('an unstated observation time is null, never back-filled from arrival', async () => {
      const { send, batches } = build();
      await send();
      expect(batches[0].sourceObservedAt).toBeNull();
    });
  });

  describe('USI-01R2 §6C — SIMPROK does not rank what it cannot read', () => {
    it('OBS-07: a numeric version orders numerically, segment by segment', () => {
      expect(compareSourceVersions('2', '1')).toBe('NEWER');
      expect(compareSourceVersions('4', '5')).toBe('OLDER');
      expect(compareSourceVersions('7', '7')).toBe('EQUAL');
      // The classic trap: lexically "1.10" sorts before "1.9".
      expect(compareSourceVersions('1.10', '1.9')).toBe('NEWER');
    });

    it('OBS-07: an explicit ISO timestamp orders chronologically', () => {
      expect(compareSourceVersions('2026-08-19T00:00:00Z', '2026-08-18T00:00:00Z')).toBe('NEWER');
      expect(compareSourceVersions('2026-08-17', '2026-08-18')).toBe('OLDER');
    });

    it('OBS-06: an opaque vendor token is ORDER_UNKNOWN, never guessed', () => {
      // Lexical comparison would confidently rank every one of these, and would
      // be wrong often enough to silently resurrect an old price.
      expect(compareSourceVersions('REV-B', 'REV-a')).toBe('ORDER_UNKNOWN');
      expect(compareSourceVersions('v10', 'v9')).toBe('ORDER_UNKNOWN');
      expect(compareSourceVersions('spring-catalog', 'autumn-catalog')).toBe('ORDER_UNKNOWN');
      expect(compareSourceVersions('2026-Q3', '2026-Q2')).toBe('ORDER_UNKNOWN');
    });

    it('OBS-06: an unorderable version never marks anything as late-arriving', async () => {
      const { send } = build();
      await send({ externalVersion: 'REV-B' });
      const next = await send({ externalVersion: 'REV-a', bytes: laterPriceList() });

      // Two real observations, both kept, and NO claim about which is newer.
      expect(next.lateArrivingSourceVersion).toBe(false);
      expect(next.sourceVersionOrder).toBe('ORDER_UNKNOWN');
    });
  });

  describe('USI-01R2 §6A — observation identity may be INCOMPLETE, and says so', () => {
    it('OBS-05: a record with neither version nor observation time is flagged', async () => {
      const { send, batches } = build();
      const result = await send({ externalVersion: null, sourceObservedAt: null });

      // SIMPROK will not invent the missing axis from its own clock, so it states
      // plainly that a future changed price for this record could not be told
      // apart from this one by identity alone.
      expect(result.sourceObservationIdentityComplete).toBe(false);
      expect(batches[0].sourceObservationKey).toBeTruthy();
    });

    it('OBS-04-by-time: an observation time alone can distinguish observations', async () => {
      const { send, batches } = build();
      await send({
        externalVersion: null,
        sourceObservedAt: new Date('2026-08-18T00:00:00.000Z'),
      });
      const later = await send({
        externalVersion: null,
        sourceObservedAt: new Date('2026-08-25T00:00:00.000Z'),
        bytes: laterPriceList(),
      });

      // A source that stamps WHEN it observed a price has given enough identity,
      // even without a formal version number.
      expect(later.sourceObservationIdentityComplete).toBe(true);
      expect(batches).toHaveLength(2);
      expect(new Set(batches.map((b) => b.sourceObservationKey)).size).toBe(2);
    });

    it('a complete identity is reported as complete', async () => {
      const { send } = build();
      const result = await send({ externalVersion: '3' });
      expect(result.sourceObservationIdentityComplete).toBe(true);
    });
  });
});

describe('USI-01R3 §7/§8 — OBS_KEY_COLLISION_RESISTANT', () => {
  const envelopeWith = (fields: Record<string, unknown>) =>
    testEnvelope(buildBasicPriceCsv(), 'harga.csv', {
      ingestionChannel: 'SUPPLIER_BRIDGE',
      connectorId: 'connector-1',
      ...(fields as any),
    });
  const keyOf = (fields: Record<string, unknown>) =>
    sourceObservationKeyOf(envelopeWith(fields));

  it('OBSKEY-01: a delimiter inside an identifier cannot forge another identity', () => {
    // THE EXACT AMBIGUITY A RAW join('|') CREATES. Both of these render
    // "connector-1|ABC|DEF|123|…" under naive concatenation, so two unrelated
    // supplier streams would share one database-unique observation identity —
    // and the second would be reported as a CONFLICT with a stream it has
    // nothing to do with.
    const left = keyOf({ externalSourceId: 'ABC|DEF', externalRecordId: '123', externalVersion: '1' });
    const right = keyOf({ externalSourceId: 'ABC', externalRecordId: 'DEF|123', externalVersion: '1' });

    expect(left).not.toBe(right);
    expect(left).toMatch(/^[0-9A-F]{64}$/);
  });

  it('OBSKEY-01: the same trick across the version boundary also fails', () => {
    const left = keyOf({ externalSourceId: 'S', externalRecordId: 'R|9', externalVersion: '1' });
    const right = keyOf({ externalSourceId: 'S', externalRecordId: 'R', externalVersion: '9|1' });
    expect(left).not.toBe(right);
  });

  it('OBSKEY-05: null and empty string are DIFFERENT identities, not the same one', () => {
    // "the source stated nothing" and "the source stated an empty value" are
    // different facts, and JSON keeps them apart where a join could not.
    const withNull = keyOf({ externalSourceId: null, externalRecordId: 'R', externalVersion: '1' });
    const withEmpty = keyOf({ externalSourceId: '', externalRecordId: 'R', externalVersion: '1' });
    expect(withNull).not.toBe(withEmpty);
  });

  it('OBSKEY-04: Unicode identifiers are stable and distinct', () => {
    const a = keyOf({ externalSourceId: 'Pemasok-Grésik', externalRecordId: 'Keramik-Ø10', externalVersion: '1' });
    const b = keyOf({ externalSourceId: 'Pemasok-Gresik', externalRecordId: 'Keramik-Ø10', externalVersion: '1' });
    expect(a).not.toBe(b);
    // ...and deterministic for the very same input.
    expect(a).toBe(keyOf({ externalSourceId: 'Pemasok-Grésik', externalRecordId: 'Keramik-Ø10', externalVersion: '1' }));
  });

  it('OBSKEY-02: identical semantic input is deterministic and fixed-length', () => {
    const fields = { externalSourceId: 'CAT-1', externalRecordId: 'KERAMIK-X', externalVersion: '3' };
    expect(keyOf(fields)).toBe(keyOf(fields));
    // Fixed length regardless of how large the external strings are — a hostile
    // 4 KB identifier cannot grow the index entry.
    const huge = keyOf({ externalSourceId: 'x'.repeat(4096), externalRecordId: 'y'.repeat(4096), externalVersion: '1' });
    expect(huge).toHaveLength(64);
  });

  it('OBSKEY-03: the delivery id is NOT part of the key', () => {
    const base = { externalSourceId: 'CAT-1', externalRecordId: 'KERAMIK-X', externalVersion: '3' };
    expect(keyOf({ ...base, deliveryId: 'req-aaa' })).toBe(
      keyOf({ ...base, deliveryId: 'req-zzz' }),
    );
  });

  it('the two observation AXES cannot be confused with one another', () => {
    // A version literally equal to a timestamp string must not collide with the
    // same instant supplied as an observation time — they are different claims.
    const asVersion = keyOf({ externalRecordId: 'R', externalVersion: '2026-08-18T00:00:00.000Z' });
    const asTime = keyOf({ externalRecordId: 'R', sourceObservedAt: new Date('2026-08-18T00:00:00.000Z') });
    expect(asVersion).not.toBe(asTime);
  });

  it('a manual upload still has no key at all', () => {
    expect(sourceObservationKeyOf(testEnvelope(buildBasicPriceCsv(), 'a.csv'))).toBeNull();
  });
});

describe('USI-01R3 §9 — OBS_INCOMPLETE_IDENTITY_CHANGED_PAYLOAD_FAILS_CLOSED', () => {
  const incomplete = { externalVersion: null, sourceObservedAt: null };

  it('a changed payload under an incomplete identity is refused, not silently doubled', async () => {
    const { send, batches } = build();

    const first = await send({ ...incomplete });
    expect(first.sourceObservationIdentityComplete).toBe(false);

    // The source named a record and gave SIMPROK no way to say which
    // observation of it this is. A second, contradictory payload under the same
    // name cannot be a newer price (nothing says it is newer) and cannot be a
    // retry (the bytes differ). Creating a second authoritative row would leave
    // two silent truths for one stated identity, so it fails closed.
    await expect(send({ ...incomplete, bytes: laterPriceList() })).rejects.toMatchObject({
      response: expect.objectContaining({ message: 'SOURCE_OBSERVATION_CONFLICT' }),
    });

    // The first observation is untouched — no overwrite, no history destroyed.
    expect(batches).toHaveLength(1);
    expect(batches[0].id).toBe(first.batchId);
  });

  it('the same incomplete identity with an IDENTICAL payload is still idempotent', async () => {
    const { send, batches } = build();
    const first = await send({ ...incomplete, deliveryId: 'req-1' });
    const retry = await send({ ...incomplete, deliveryId: 'req-2' });

    // A retry is a retry even when identity is incomplete.
    expect(retry.batchId).toBe(first.batchId);
    expect(batches).toHaveLength(1);
  });
});
