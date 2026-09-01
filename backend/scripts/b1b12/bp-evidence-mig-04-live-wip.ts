/**
 * BP-EVIDENCE-MIG-04 — one-shot authenticated live proof against WIP 3110→55433.
 * Prints verdicts only. Never prints secrets, tokens, or DSN.
 */
import { readFileSync } from 'node:fs';
import { buildBasicPriceXlsx } from '../../test/fixtures/basic-price-xlsx.fixture';

const API = 'http://127.0.0.1:3110';
const SECRETS = 'C:/Users/asus/SIMPROK-RUNTIME/secrets';
const FOREIGN_WORKSPACE = '10000000-0000-4000-8000-000000000099';

function parseEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

function must(env: Record<string, string>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`missing ${key}`);
  return value;
}

async function json<T>(
  res: Response,
  label: string,
): Promise<{ status: number; body: T }> {
  const text = await res.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    throw new Error(`${label} non-json ${res.status}`);
  }
  return { status: res.status, body };
}

type LoginBody = { access_token?: string };
type Lookup<T> = { items?: T[] };
type PreviewRow = { id: string; sourceRowNumber: number; version: number };
type PreviewBody = { batchId?: string; rows?: PreviewRow[] };
type KeptBody = {
  createdCount?: number;
  prices?: Array<{ basicPriceId: string }>;
};
type MutationBody = {
  basicPriceId?: string;
  value?: string;
  kdnPercent?: string | null;
  unchanged?: boolean;
};
type DetailBody = {
  price?: {
    sourceName?: string | null;
    sourceType?: string;
    sourceOrigin?: string;
    price?: string;
  };
  evidence?: {
    observationBasis?: string;
    importBatchLinked?: boolean;
    originalFileRetained?: boolean;
    kdnSourceSummary?: string | null;
  };
  domesticContent?: { kdnPercent?: string | null };
};

function leakScan(blob: string): string[] {
  const hits: string[] = [];
  if (blob.includes('sourceStorageRef')) hits.push('sourceStorageRef');
  if (blob.includes('sourceImportRowId')) hits.push('sourceImportRowId');
  if (blob.includes('basic-price-intake')) hits.push('basic-price-intake');
  if (/[A-Za-z]:\\SIMPROK\\/u.test(blob)) hits.push('filesystem-path');
  return hits;
}

async function main(): Promise<void> {
  const acceptance = parseEnv(`${SECRETS}/b1b12.basic-price-acceptance.env`);
  const email = must(acceptance, 'BP_ACCEPTANCE_EMAIL');
  const password = must(acceptance, 'BP_ACCEPTANCE_PASSWORD');
  const workspaceId = must(acceptance, 'BP_ACCEPTANCE_WORKSPACE_ID');
  const stamp = Date.now().toString();
  const uniqueMoney = (offset: number): string =>
    `${110000 + (Number(stamp.slice(-5)) % 80000) + offset}.00`;
  const uniqueKdn = `${(40 + (Number(stamp.slice(-3)) % 50)).toFixed(2)}`;

  const login = await json<LoginBody>(
    await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }),
    'login',
  );
  if (login.status !== 201 && login.status !== 200) {
    throw new Error(`LOGIN_FAIL status=${login.status}`);
  }
  const token = login.body.access_token;
  if (!token) throw new Error('LOGIN_FAIL no token');

  const hdr = (ws = workspaceId): Record<string, string> => ({
    Authorization: `Bearer ${token}`,
    'x-workspace-id': ws,
    'content-type': 'application/json',
  });

  const regions = await json<Lookup<{ id: string }>>(
    await fetch(`${API}/basic-price-import-lookups/regions?page=1&limit=5`, {
      headers: hdr(),
    }),
    'regions',
  );
  const regionId = regions.body.items?.[0]?.id;
  if (!regionId) throw new Error('NO_REGION');

  const resources = await json<Lookup<{ id: string; name: string }>>(
    await fetch(
      `${API}/basic-price-import-lookups/resources?type=LABOR&page=1&limit=5`,
      { headers: hdr() },
    ),
    'resources',
  );
  const resourceId = resources.body.items?.[0]?.id;
  if (!resourceId) throw new Error('NO_LABOR_RESOURCE');

  const units = await json<Lookup<{ id: string; code: string }>>(
    await fetch(
      `${API}/basic-price-import-lookups/units?q=PERSON_DAY&page=1&limit=5`,
      { headers: hdr() },
    ),
    'units',
  );
  const unitId =
    units.body.items?.find((row) => row.code === 'PERSON_DAY')?.id ??
    units.body.items?.[0]?.id;
  if (!unitId) throw new Error('NO_UNIT');

  const importAndKeep = async (vendor: string, includeKdnColumn: boolean) => {
    const xlsx = await buildBasicPriceXlsx({ includeKdnColumn });
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(xlsx)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      `${vendor}.xlsx`,
    );
    form.append('selectedSheet', 'HARGA SATUAN UPAH DAN BAHAN');
    form.append('sourceVendorName', vendor);
    form.append('regionId', regionId);
    form.append('effectiveDate', '2026-05-01');
    form.append('sourceOrigin', 'GOVERNMENT');
    form.append('sourceType', 'REGULATION');
    const previewRes = await fetch(`${API}/basic-price-imports/preview`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-workspace-id': workspaceId,
      },
      body: form,
    });
    const preview = await json<PreviewBody>(previewRes, `preview:${vendor}`);
    if (preview.status !== 201) {
      throw new Error(`PREVIEW_FAIL ${vendor} ${preview.status}`);
    }
    const batchId = preview.body.batchId;
    const rows = preview.body.rows ?? [];
    const labor = rows.find((row) => row.sourceRowNumber === 9);
    if (!batchId || !labor) throw new Error(`PREVIEW_ROWS_FAIL ${vendor}`);
    const resolve = await fetch(
      `${API}/basic-price-imports/${batchId}/rows/${labor.id}/resolve`,
      {
        method: 'POST',
        headers: hdr(),
        body: JSON.stringify({
          version: labor.version,
          resourceCatalogId: resourceId,
          unitDefinitionId: unitId,
        }),
      },
    );
    if (resolve.status !== 201) {
      throw new Error(`RESOLVE_FAIL ${vendor} ${resolve.status}`);
    }
    for (const other of rows.filter((row) => row.id !== labor.id)) {
      const rejected = await fetch(
        `${API}/basic-price-imports/${batchId}/rows/${other.id}/reject`,
        {
          method: 'POST',
          headers: hdr(),
          body: JSON.stringify({
            version: other.version,
            reason: 'out of scope for EVID-04 live',
          }),
        },
      );
      if (rejected.status !== 201) {
        throw new Error(`REJECT_FAIL ${vendor} ${rejected.status}`);
      }
    }
    const kept = await json<KeptBody>(
      await fetch(`${API}/basic-price-imports/${batchId}/keep-private`, {
        method: 'POST',
        headers: hdr(),
      }),
      `keep:${vendor}`,
    );
    const predecessorId = kept.body.prices?.[0]?.basicPriceId;
    if (kept.status !== 201 || !predecessorId) {
      throw new Error(`KEEP_FAIL ${vendor} ${kept.status}`);
    }
    return predecessorId;
  };

  const readDetail = async (id: string) => {
    const got = await json<DetailBody>(
      await fetch(`${API}/basic-prices/${id}/detail`, { headers: hdr() }),
      `detail:${id}`,
    );
    if (got.status !== 200) throw new Error(`DETAIL_FAIL ${id} ${got.status}`);
    return got.body;
  };

  const money = (value: string | number | null | undefined): string => {
    if (value === undefined || value === null) throw new Error('NO_MONEY');
    return Number(value).toFixed(2);
  };

  const results: string[] = [];
  const pass = (name: string) => results.push(`${name}=PASS`);
  const fail = (name: string, why: string) => {
    results.push(`${name}=FAIL ${why}`);
    throw new Error(`${name} ${why}`);
  };

  const documentaryVendor = `evid04-doc-${stamp}`;
  const documentaryId = await importAndKeep(documentaryVendor, false);
  const documentary = await readDetail(documentaryId);
  if (documentary.evidence?.observationBasis !== 'SOURCE_DOCUMENT') {
    fail(
      'LIVE-EVID-02',
      `basis=${String(documentary.evidence?.observationBasis)}`,
    );
  }
  if (documentary.price?.sourceName !== documentaryVendor) {
    fail('LIVE-EVID-02', `sourceName=${String(documentary.price?.sourceName)}`);
  }
  const documentaryLeaks = leakScan(JSON.stringify(documentary));
  if (documentaryLeaks.length > 0) {
    fail('LIVE-EVID-02', `leaks=${documentaryLeaks.join(',')}`);
  }
  pass('LIVE-EVID-02');

  const fieldBody = {
    expectedValue: money(documentary.price?.price),
    proposedValue: uniqueMoney(1),
    effectiveDate: '2026-08-28',
    reason: 'survei lapangan Agustus',
    sameSource: true,
  };
  const observed = await json<MutationBody>(
    await fetch(
      `${API}/basic-price-imports/prices/${documentaryId}/observations`,
      {
        method: 'POST',
        headers: hdr(),
        body: JSON.stringify(fieldBody),
      },
    ),
    'observe-same',
  );
  if (
    observed.status !== 201 ||
    !observed.body.basicPriceId ||
    observed.body.unchanged === true
  ) {
    fail(
      'LIVE-EVID-01',
      `status=${observed.status} unchanged=${String(observed.body.unchanged)}`,
    );
  }
  const fieldId = observed.body.basicPriceId as string;
  const fieldDetail = await readDetail(fieldId);
  const stillDoc = await readDetail(documentaryId);
  if (stillDoc.price?.sourceName !== documentaryVendor) {
    fail('LIVE-EVID-01', 'predecessor source overwritten');
  }
  if (fieldDetail.evidence?.observationBasis !== 'FIELD_REPORTED') {
    fail(
      'LIVE-EVID-01',
      `basis=${String(fieldDetail.evidence?.observationBasis)}`,
    );
  }
  if (fieldDetail.evidence?.importBatchLinked === true) {
    fail('LIVE-EVID-01', 'May file presented as August proof');
  }
  if (fieldDetail.price?.sourceType !== 'MARKET_SURVEY') {
    fail('LIVE-EVID-01', `sourceType=${String(fieldDetail.price?.sourceType)}`);
  }
  if (fieldDetail.price?.sourceName !== documentaryVendor) {
    fail(
      'LIVE-EVID-01',
      `same-source name lost=${String(fieldDetail.price?.sourceName)}`,
    );
  }
  pass('LIVE-EVID-01');

  const diffVendor = `evid04-diff-${stamp}`;
  const diffPredId = await importAndKeep(diffVendor, false);
  const diffPred = await readDetail(diffPredId);
  const diffObserved = await json<MutationBody>(
    await fetch(
      `${API}/basic-price-imports/prices/${diffPredId}/observations`,
      {
        method: 'POST',
        headers: hdr(),
        body: JSON.stringify({
          expectedValue: money(diffPred.price?.price),
          proposedValue: uniqueMoney(2),
          effectiveDate: '2026-08-28',
          reason: 'sumber berbeda',
          sameSource: false,
          sourceIdentityName: 'Toko Baru Ambon',
        }),
      },
    ),
    'observe-diff',
  );
  if (
    diffObserved.status !== 201 ||
    !diffObserved.body.basicPriceId ||
    diffObserved.body.unchanged === true
  ) {
    fail(
      'LIVE-EVID-03',
      `status=${diffObserved.status} unchanged=${String(diffObserved.body.unchanged)}`,
    );
  }
  const stillDiffPred = await readDetail(diffPredId);
  const diffDetail = await readDetail(diffObserved.body.basicPriceId);
  if (stillDiffPred.price?.sourceName !== diffVendor) {
    fail('LIVE-EVID-03', 'predecessor source overwritten');
  }
  if (diffDetail.price?.sourceName !== 'Toko Baru Ambon') {
    fail('LIVE-EVID-03', `new source=${String(diffDetail.price?.sourceName)}`);
  }
  if (diffDetail.price?.sourceOrigin !== 'FIELD_REPORT') {
    fail('LIVE-EVID-03', `origin=${String(diffDetail.price?.sourceOrigin)}`);
  }
  pass('LIVE-EVID-03');

  const kdnVendor = `evid04-kdn-${stamp}`;
  const kdnPredId = await importAndKeep(kdnVendor, true);
  const kdnPred = await readDetail(kdnPredId);
  if (kdnPred.price?.sourceName !== kdnVendor) {
    fail('LIVE-EVID-04', `price source=${String(kdnPred.price?.sourceName)}`);
  }
  if (!kdnPred.evidence?.kdnSourceSummary) {
    fail('LIVE-EVID-04', 'imported KDN summary missing');
  }
  if (kdnPred.evidence.kdnSourceSummary === kdnPred.price?.sourceName) {
    fail('LIVE-EVID-04', 'KDN summary collapsed into price source');
  }
  const kdnObserved = await json<MutationBody>(
    await fetch(
      `${API}/basic-price-imports/prices/${kdnPredId}/kdn-observations`,
      {
        method: 'POST',
        headers: hdr(),
        body: JSON.stringify({
          expectedValue: money(kdnPred.price?.price),
          expectedKdnPercent: money(kdnPred.domesticContent?.kdnPercent),
          proposedKdnPercent: uniqueKdn,
          effectiveDate: '2026-08-28',
          reason: 'laporan lapangan KDN',
        }),
      },
    ),
    'kdn-observe',
  );
  if (
    kdnObserved.status !== 201 ||
    !kdnObserved.body.basicPriceId ||
    kdnObserved.body.unchanged === true
  ) {
    fail(
      'LIVE-EVID-04',
      `observe status=${kdnObserved.status} unchanged=${String(kdnObserved.body.unchanged)}`,
    );
  }
  const kdnNew = await readDetail(kdnObserved.body.basicPriceId);
  if (kdnNew.price?.sourceName !== kdnVendor) {
    fail('LIVE-EVID-04', 'price source lost on KDN observation');
  }
  if (kdnNew.evidence?.kdnSourceSummary !== 'Informasi KDN terbaru') {
    fail(
      'LIVE-EVID-04',
      `kdn summary=${String(kdnNew.evidence?.kdnSourceSummary)}`,
    );
  }
  if (/sertifikat/iu.test(String(kdnNew.evidence?.kdnSourceSummary))) {
    fail('LIVE-EVID-04', 'user-reported KDN labelled certificate');
  }
  pass('LIVE-EVID-04');

  const publicBlobs = [
    JSON.stringify(documentary),
    JSON.stringify(fieldDetail),
    JSON.stringify(diffDetail),
    JSON.stringify(kdnNew),
  ];
  for (const blob of publicBlobs) {
    const leaks = leakScan(blob);
    if (leaks.length > 0) {
      fail('LIVE-EVID-05', `leaks=${leaks.join(',')}`);
    }
  }
  pass('LIVE-EVID-05');

  const foreign = await json<unknown>(
    await fetch(`${API}/basic-prices/${fieldId}/detail`, {
      headers: hdr(FOREIGN_WORKSPACE),
    }),
    'foreign-detail',
  );
  if (foreign.status !== 403 && foreign.status !== 404) {
    fail('LIVE-EVID-06', `status=${foreign.status}`);
  }
  pass('LIVE-EVID-06');

  for (const line of results) process.stdout.write(`${line}\n`);
  process.stdout.write('LIVE_WIP_EVID_04=PASS\n');
  process.stdout.write(`WIP_API=${API}\n`);
  process.stdout.write(
    'OWNER_MANUAL_PREVIEW_URL=http://127.0.0.1:5183/basic-price\n',
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`LIVE_WIP_EVID_04=FAIL ${message}\n`);
  process.exitCode = 1;
});
