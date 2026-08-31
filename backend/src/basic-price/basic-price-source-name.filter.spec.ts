import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASIC_PRICE_SOURCE_NAME_FILTER_VERSION,
  basicPriceSourceNameWhere,
} from './basic-price-source-name.filter';
import { deriveExplorerSourceName } from '../common/basic-price-workflow.projection';

/**
 * BP-UX-FINAL-01C GAP-A — THE FILTER AND THE COLUMN MUST AGREE.
 *
 * The Explorer PRINTS a source name derived from two provenance chains and used
 * to FILTER on only one of them. On the Owner's canonical database — where
 * every Basic Price is WORKSPACE_PRIVATE — that meant the Nama sumber box
 * returned nothing for every row, forever, while the SUMBER column beside it
 * displayed those same rows' names.
 */
describe('basicPriceSourceNameWhere', () => {
  const NAME = 'Tim Simprok';

  it('is versioned, so a change to provenance reach is a visible change', () => {
    expect(BASIC_PRICE_SOURCE_NAME_FILTER_VERSION).toBe(
      'BPUXFINAL01C_BASIC_PRICE_SOURCE_NAME_TWO_PATH_V1',
    );
  });

  /* ── A1..A4 both lawful chains, both name columns ──────────────────────── */

  it('A1 — still reaches the CATALOG chain (submission -> importRow -> batch)', () => {
    const where = basicPriceSourceNameWhere(NAME) as {
      OR: Array<Record<string, unknown>>;
    };
    const catalog = where.OR.find((branch) => 'sourceSubmission' in branch);

    expect(catalog).toEqual({
      sourceSubmission: {
        is: {
          importRow: {
            is: {
              batch: {
                is: {
                  OR: [
                    {
                      sourceVendorName: { contains: NAME, mode: 'insensitive' },
                    },
                    {
                      sourceOrganizationName: {
                        contains: NAME,
                        mode: 'insensitive',
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    });
  });

  it('A2 — now also reaches the PRIVATE chain (sourceImportRow -> batch)', () => {
    const where = basicPriceSourceNameWhere(NAME) as {
      OR: Array<Record<string, unknown>>;
    };
    const priv = where.OR.find((branch) => 'sourceImportRow' in branch);

    expect(priv).toEqual({
      sourceImportRow: {
        is: {
          batch: {
            is: {
              OR: [
                { sourceVendorName: { contains: NAME, mode: 'insensitive' } },
                {
                  sourceOrganizationName: {
                    contains: NAME,
                    mode: 'insensitive',
                  },
                },
              ],
            },
          },
        },
      },
    });
  });

  it('A3/A4 — organization name and vendor name are both searchable, case-insensitively', () => {
    const serialised = JSON.stringify(basicPriceSourceNameWhere(NAME));
    expect(serialised.match(/sourceOrganizationName/g)).toHaveLength(2);
    expect(serialised.match(/sourceVendorName/g)).toHaveLength(2);
    expect(serialised.match(/insensitive/g)).toHaveLength(4);
  });

  it('reaches exactly the two chains the PROJECTION reads — no third path invented', () => {
    // `deriveExplorerSourceName` is the function that decides what the SUMBER
    // column says. If the filter ever reached a chain the projection does not
    // read (or missed one it does), the column and the filter would disagree
    // again — which is the whole defect.
    const projection = readFileSync(
      join(__dirname, '..', 'common', 'basic-price-workflow.projection.ts'),
      'utf8',
    );
    const derive = projection
      .split('export function deriveExplorerSourceName')[1]
      .split('export function')[0];

    expect(derive).toContain('sourceSubmission?.importRow?.batch');
    expect(derive).toContain('sourceImportRow?.batch');

    const filter = JSON.stringify(basicPriceSourceNameWhere(NAME));
    expect(filter).toContain('sourceSubmission');
    expect(filter).toContain('sourceImportRow');
  });

  it('the projection still refuses to fabricate a name for a row with no chain', () => {
    // A row that matches no provenance chain simply does not match the filter,
    // and the Explorer keeps saying "Sumber tidak tersedia" for it. Neither
    // side invents a placeholder.
    expect(
      deriveExplorerSourceName({
        sourceSubmission: null,
        sourceImportRow: null,
      } as never),
    ).toBeNull();
  });

  /* ── A5 the composition-safety property that protects tenant isolation ──── */

  it('A5 — the OR is PROVENANCE alternatives only, and can never become the eligibility OR', () => {
    // `buildUsableBasicPriceWhere` owns the top-level `OR` key, and that key IS
    // tenant isolation. This fragment is destined for `AND`, so its own `OR`
    // narrows one row's provenance and can never replace the tenant predicate.
    const where = basicPriceSourceNameWhere(NAME) as {
      OR: Array<Record<string, unknown>>;
    };
    expect(Object.keys(where)).toEqual(['OR']);
    expect(where.OR).toHaveLength(2);

    const serialised = JSON.stringify(where);
    // Nothing about tenancy, publication or asset family may appear here.
    for (const forbidden of [
      'workspaceId',
      'assetScope',
      'status',
      'verificationStatus',
      'organizationId',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('A5 — the service pushes it into AND, never assigns it to OR', () => {
    const service = readFileSync(
      join(__dirname, 'basic-price.service.ts'),
      'utf8',
    );
    const code = service.replace(/\/\*[\s\S]*?\*\//g, '');

    expect(code).toContain(
      '(where.AND as Prisma.BasicPriceWhereInput[]).push(',
    );
    // The single most dangerous line this repair could have written.
    expect(code).not.toContain('where.OR =');
    // And the superseded single-path assignment is gone rather than merely
    // unused — a dead one is an invitation to wire it back in.
    expect(code).not.toContain('where.sourceSubmission =');
  });

  it('narrows only — it contains no NOT and no relation-negation', () => {
    const serialised = JSON.stringify(basicPriceSourceNameWhere(NAME));
    expect(serialised).not.toContain('"NOT"');
    expect(serialised).not.toContain('"none"');
    expect(serialised).not.toContain('"isNot"');
  });
});
