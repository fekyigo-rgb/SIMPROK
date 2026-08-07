import {
  PartialReferenceStateError,
  provisionCanonicalReferences,
  type RegionOutcome,
} from './reference-provisioning-sequence';

/**
 * RM-03D0 — partial state law.
 *
 * Region and ResourceCatalog commit in two separate transactions, so a partial
 * outcome is reachable. These tests pin that it is REPORTED, never repaired:
 * no cleanup, no delete, no compensating write, no fake rollback.
 */
describe('RM-03D0 canonical reference sequence', () => {
  const region: RegionOutcome = {
    regionId: 'region-abc',
    regionCreatedDelta: 1,
    regionReusedDelta: 0,
    planSha256: 'REGIONHASH',
  };

  it('runs Region first, then ResourceCatalog', async () => {
    const order: string[] = [];
    await provisionCanonicalReferences({
      applyRegion: async () => {
        order.push('region');
        return region;
      },
      applyResourceCatalog: async () => {
        order.push('catalog');
        return { ok: true };
      },
    });
    expect(order).toEqual(['region', 'catalog']);
  });

  it('returns both outcomes when the whole sequence succeeds', async () => {
    await expect(
      provisionCanonicalReferences({
        applyRegion: async () => region,
        applyResourceCatalog: async () => ({ created: 267 }),
      }),
    ).resolves.toEqual({ region, catalog: { created: 267 } });
  });

  describe('a Region failure is NOT a partial state', () => {
    it('propagates the original error untouched, because nothing was committed', async () => {
      const original = new Error('STOP_REGION_NAME_CONFLICT: ...');
      await expect(
        provisionCanonicalReferences({
          applyRegion: async () => {
            throw original;
          },
          applyResourceCatalog: async () => {
            throw new Error('must never run');
          },
        }),
      ).rejects.toBe(original);
    });

    it('never runs the catalog step when the Region step failed', async () => {
      const catalog = jest.fn();
      await expect(
        provisionCanonicalReferences({
          applyRegion: async () => {
            throw new Error('boom');
          },
          applyResourceCatalog: catalog,
        }),
      ).rejects.toThrow('boom');
      expect(catalog).not.toHaveBeenCalled();
    });
  });

  describe('Region committed then catalog failed → STOP_PARTIAL_REFERENCE_STATE', () => {
    const failing = (catalogError: unknown) =>
      provisionCanonicalReferences({
        applyRegion: async () => region,
        applyResourceCatalog: async () => {
          throw catalogError;
        },
      });

    it('raises the partial-state stop', async () => {
      await expect(failing(new Error('STOP_PLAN_HASH_MISMATCH: stale'))).rejects.toThrow(
        /STOP_PARTIAL_REFERENCE_STATE/,
      );
    });

    it('names the exact Region id and whether it was created or reused', async () => {
      let caught: PartialReferenceStateError | undefined;
      try {
        await failing(new Error('catalog exploded'));
      } catch (error) {
        caught = error as PartialReferenceStateError;
      }
      expect(caught).toBeInstanceOf(PartialReferenceStateError);
      expect(caught!.reasonCode).toBe('STOP_PARTIAL_REFERENCE_STATE');
      expect(caught!.region).toEqual(region);
      expect(caught!.message).toContain('region-abc');
      expect(caught!.message).toContain('created=1');
      expect(caught!.message).toContain('reused=0');
      expect(caught!.message).toContain('REGIONHASH');
    });

    it('carries the ORIGINAL catalog failure, both in the message and as cause', async () => {
      const original = new Error('STOP_MISSING_CONFIRMATION_TOKEN: nope');
      let caught: PartialReferenceStateError | undefined;
      try {
        await failing(original);
      } catch (error) {
        caught = error as PartialReferenceStateError;
      }
      expect(caught!.catalogFailure).toBe(original);
      expect(caught!.cause).toBe(original);
      expect(caught!.message).toContain('STOP_MISSING_CONFIRMATION_TOKEN');
    });

    it('reports a REUSED region honestly, not as a creation', async () => {
      const reused: RegionOutcome = {
        regionId: 'region-existing',
        regionCreatedDelta: 0,
        regionReusedDelta: 1,
        planSha256: 'H',
      };
      let caught: PartialReferenceStateError | undefined;
      try {
        await provisionCanonicalReferences({
          applyRegion: async () => reused,
          applyResourceCatalog: async () => {
            throw new Error('x');
          },
        });
      } catch (error) {
        caught = error as PartialReferenceStateError;
      }
      expect(caught!.message).toContain('created=0');
      expect(caught!.message).toContain('reused=1');
    });

    it('handles a non-Error catalog failure without losing it', async () => {
      let caught: PartialReferenceStateError | undefined;
      try {
        await failing('a bare string failure');
      } catch (error) {
        caught = error as PartialReferenceStateError;
      }
      expect(caught!.catalogFailure).toBe('a bare string failure');
      expect(caught!.message).toContain('a bare string failure');
    });

    it('performs NO cleanup — the sequence has no delete or compensating seam', async () => {
      // The only two things it can call are the two steps it was given. There
      // is nowhere for a silent rollback to live.
      const applyRegion = jest.fn().mockResolvedValue(region);
      const applyResourceCatalog = jest
        .fn()
        .mockRejectedValue(new Error('fail'));
      await expect(
        provisionCanonicalReferences({ applyRegion, applyResourceCatalog }),
      ).rejects.toThrow(/STOP_PARTIAL_REFERENCE_STATE/);
      expect(applyRegion).toHaveBeenCalledTimes(1);
      expect(applyResourceCatalog).toHaveBeenCalledTimes(1);
      expect(
        provisionCanonicalReferences.toString(),
      ).not.toMatch(/delete|rollback|cleanup|compensat/i);
    });

    it('states plainly that the Region was not rolled back', async () => {
      let message = '';
      try {
        await failing(new Error('x'));
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/NOT rolled back, deleted or compensated/);
    });
  });
});
