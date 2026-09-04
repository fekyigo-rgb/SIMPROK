/**
 * Targeted authorization proof for BP-PROVISIONING-02.
 * Reads secrets from BP02_SECRETS_FILE + optional Owner session.
 * Never prints passwords/tokens.
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 0) return '***';
  return (at > 2 ? email.slice(0, 2) + '***' : '***') + email.slice(at);
}

async function login(
  base: string,
  email: string,
  password: string,
): Promise<{ ok: boolean; status: number; token?: string }> {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const status = res.status;
  if (!res.ok) return { ok: false, status };
  const body = (await res.json()) as {
    accessToken?: string;
    access_token?: string;
    token?: string;
  };
  const token = body.accessToken ?? body.access_token ?? body.token;
  return { ok: Boolean(token), status, token };
}

async function capabilities(
  base: string,
  token: string,
  workspaceId: string,
): Promise<{ status: number; permissions: string[] }> {
  const res = await fetch(`${base}/auth/capabilities`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-workspace-id': workspaceId,
    },
  });
  const status = res.status;
  if (!res.ok) return { status, permissions: [] };
  const body = (await res.json()) as {
    permissions?: string[];
    effectivePermissions?: string[];
  };
  const permissions = body.permissions ?? body.effectivePermissions ?? [];
  return { status, permissions: [...permissions].sort() };
}

async function probeDoor(
  base: string,
  token: string,
  workspaceId: string,
  path: string,
): Promise<number> {
  const res = await fetch(`${base}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-workspace-id': workspaceId,
    },
  });
  return res.status;
}

async function main(): Promise<void> {
  const secretsPath = process.env.BP02_SECRETS_FILE;
  const databaseUrl = process.env.DATABASE_URL;
  const base = process.env.BP02_API_BASE ?? 'http://127.0.0.1:3000';
  if (!secretsPath) throw new Error('STOP_MISSING_BP02_SECRETS_FILE');
  if (!databaseUrl) throw new Error('STOP_MISSING_DATABASE_URL');
  const secrets = parseEnvFile(secretsPath);
  const workspaceId = secrets.WORKSPACE_ID;
  const verifierEmail = secrets.VERIFIER_EMAIL;
  const publisherEmail = secrets.PUBLISHER_EMAIL;
  const verifierPassword = secrets.VERIFIER_PASSWORD;
  const publisherPassword = secrets.PUBLISHER_PASSWORD;
  if (!workspaceId || !verifierEmail || !publisherEmail) {
    throw new Error('STOP_SECRETS_INCOMPLETE');
  }

  process.stdout.write(`API_BASE=${base}\n`);
  process.stdout.write(`WORKSPACE=${workspaceId}\n`);
  process.stdout.write(`VERIFIER=${maskEmail(verifierEmail)}\n`);
  process.stdout.write(`PUBLISHER=${maskEmail(publisherEmail)}\n`);
  process.stdout.write(
    `VERIFIER_NE_PUBLISHER_ACCOUNT=${secrets.VERIFIER_ACCOUNT_ID !== secrets.PUBLISHER_ACCOUNT_ID}\n`,
  );

  const vLogin = await login(base, verifierEmail, verifierPassword);
  const pLogin = await login(base, publisherEmail, publisherPassword);
  process.stdout.write(`VERIFIER_LOGIN_STATUS=${vLogin.status} OK=${vLogin.ok}\n`);
  process.stdout.write(`PUBLISHER_LOGIN_STATUS=${pLogin.status} OK=${pLogin.ok}\n`);
  if (!vLogin.ok || !pLogin.ok || !vLogin.token || !pLogin.token) {
    throw new Error('STOP_LOGIN_FAILED');
  }

  const vCap = await capabilities(base, vLogin.token, workspaceId);
  const pCap = await capabilities(base, pLogin.token, workspaceId);
  process.stdout.write(`VERIFIER_CAP_STATUS=${vCap.status}\n`);
  process.stdout.write(
    `VERIFIER_HAS_REVIEW_VIEW=${vCap.permissions.includes('BASIC_PRICE_REVIEW_VIEW')}\n`,
  );
  process.stdout.write(
    `VERIFIER_HAS_VERIFY=${vCap.permissions.includes('BASIC_PRICE_VERIFY')}\n`,
  );
  process.stdout.write(
    `VERIFIER_HAS_PUBLISH=${vCap.permissions.includes('BASIC_PRICE_PUBLISH')}\n`,
  );
  process.stdout.write(`PUBLISHER_CAP_STATUS=${pCap.status}\n`);
  process.stdout.write(
    `PUBLISHER_HAS_PUBLISH=${pCap.permissions.includes('BASIC_PRICE_PUBLISH')}\n`,
  );
  process.stdout.write(
    `PUBLISHER_HAS_VERIFY=${pCap.permissions.includes('BASIC_PRICE_VERIFY')}\n`,
  );
  process.stdout.write(
    `PUBLISHER_HAS_REVIEW_VIEW=${pCap.permissions.includes('BASIC_PRICE_REVIEW_VIEW')}\n`,
  );

  const vReviews = await probeDoor(
    base,
    vLogin.token,
    workspaceId,
    '/basic-price-reviews',
  );
  const vPubs = await probeDoor(
    base,
    vLogin.token,
    workspaceId,
    '/basic-price-publications',
  );
  const pReviews = await probeDoor(
    base,
    pLogin.token,
    workspaceId,
    '/basic-price-reviews',
  );
  const pPubs = await probeDoor(
    base,
    pLogin.token,
    workspaceId,
    '/basic-price-publications',
  );
  process.stdout.write(`VERIFIER_REVIEWS_HTTP=${vReviews}\n`);
  process.stdout.write(`VERIFIER_PUBLICATIONS_HTTP=${vPubs}\n`);
  process.stdout.write(`PUBLISHER_REVIEWS_HTTP=${pReviews}\n`);
  process.stdout.write(`PUBLISHER_PUBLICATIONS_HTTP=${pPubs}\n`);

  // Owner curation unchanged + no auto-publish evidence (DB)
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const owner = await client.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt
       FROM accounts a
       JOIN workspace_memberships wm ON wm."accountId"=a.id
       JOIN membership_roles mr ON mr."workspaceMembershipId"=wm.id AND mr."isActive"=true
       JOIN roles r ON r.id=mr."roleId"
       JOIN role_permissions rp ON rp."roleId"=r.id
       JOIN permissions p ON p.id=rp."permissionId"
       WHERE wm."workspaceId"=$1
         AND lower(a.email)=lower($2)
         AND p.code = ANY($3::text[])`,
      [
        workspaceId,
        secrets.OWNER_EMAIL ?? 'fekyigo@gmail.com',
        [
          'BASIC_PRICE_REVIEW_VIEW',
          'BASIC_PRICE_VERIFY',
          'BASIC_PRICE_PUBLISH',
        ],
      ],
    );
    process.stdout.write(
      `OWNER_CURATION_PERMISSION_ROWS=${owner.rows[0]?.cnt ?? '0'}\n`,
    );

    const director = await client.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt
       FROM roles r
       JOIN role_permissions rp ON rp."roleId"=r.id
       JOIN permissions p ON p.id=rp."permissionId"
       WHERE r."workspaceId"=$1 AND r.code='DIRECTOR'
         AND p.code = ANY($2::text[])`,
      [
        workspaceId,
        [
          'BASIC_PRICE_REVIEW_VIEW',
          'BASIC_PRICE_VERIFY',
          'BASIC_PRICE_PUBLISH',
        ],
      ],
    );
    process.stdout.write(
      `DIRECTOR_CURATION_GRANT_ROWS=${director.rows[0]?.cnt ?? '0'}\n`,
    );

    const published = await client.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM basic_prices
       WHERE "workspaceId"=$1 AND status='PUBLISHED'`,
      [workspaceId],
    );
    // Snapshot only — compare to backup externally if needed; we assert no NEW
    // publish from this mission by checking publication audits after activation stamp.
    const activatedAt = secrets.ACTIVATED_AT;
    const audits = await client.query<{ cnt: string }>(
      `SELECT count(*)::text AS cnt FROM basic_price_publication_audits
       WHERE "createdAt" >= $1::timestamptz`,
      [activatedAt],
    );
    process.stdout.write(`PUBLISHED_BASIC_PRICES=${published.rows[0]?.cnt ?? '?'}\n`);
    process.stdout.write(
      `PUBLICATION_AUDITS_SINCE_ACTIVATION=${audits.rows[0]?.cnt ?? '?'}\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : 'ERR'}\n`);
  process.exit(1);
});
