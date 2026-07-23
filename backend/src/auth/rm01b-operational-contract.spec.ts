import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), 'utf8');

describe('RM01B dormant operational contract', () => {
  const fingerprint = read('scripts/rm01b/fingerprint-read-only.psql');
  const auditRole = read('scripts/rm01b/audit-role-provision.psql');
  const runner = read('scripts/rm01b/permission-activation.ts');
  const moduleSource = read(
    'src/auth/rm01b-production-permission-activation.ts',
  );

  it('fingerprint is repeatable-read, read-only, and always ends with rollback', () => {
    expect(fingerprint).toContain(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;',
    );
    expect(fingerprint).toContain("current_setting('transaction_read_only')");
    expect(fingerprint.trim().endsWith('ROLLBACK;')).toBe(true);
  });

  it('fingerprint contains no forbidden statement', () => {
    const forbidden = [
      /\bINSERT\b/i,
      /\bUPDATE\b/i,
      /\bDELETE\b/i,
      /\bUPSERT\b/i,
      /\bCREATE\b/i,
      /\bALTER\b/i,
      /\bDROP\b/i,
      /\bTRUNCATE\b/i,
      /\bGRANT\b/i,
      /\bREVOKE\b/i,
      /\bCALL\b/i,
      /\bDO\b/i,
      /COPY\s+.*\s+TO\s+PROGRAM/i,
      /SELECT\s+.*\s+FOR\s+UPDATE/is,
    ];
    for (const expression of forbidden)
      expect(fingerprint).not.toMatch(expression);
  });

  it('fingerprint never requests sensitive columns', () => {
    expect(fingerprint).not.toMatch(/passwordHash|token|secret|documentBytes/i);
    expect(fingerprint).toContain("'OWNER_DECISION_REQUIRED'");
    expect(fingerprint).toContain("'TARGET_IDENTITY_AMBIGUOUS'");
  });

  it('audit role uses the exact bounded column allowlist', () => {
    expect(auditRole).not.toMatch(/SELECT\s+ON\s+ALL\s+TABLES/i);
    expect(auditRole).not.toMatch(/ALTER\s+DEFAULT\s+PRIVILEGES/i);
    expect(auditRole).toContain('NOBYPASSRLS CONNECTION LIMIT 1');
    expect(auditRole).toContain('default_transaction_read_only = on');
    expect(auditRole).toContain('statement_timeout');
    expect(auditRole).toContain('lock_timeout');
    expect(auditRole).toContain('idle_in_transaction_session_timeout');
    const grants = auditRole.match(/GRANT SELECT \([^\n]+/g) ?? [];
    expect(grants).toHaveLength(10);
    expect(grants.join('\n')).not.toMatch(/passwordHash/i);
  });

  it('audit role exits nonzero on every explicit fail-closed branch', () => {
    const failClosedTraps =
      auditRole.match(/^\s*SELECT 1 \/ 0 AS fail_closed;\s*$/gm) ?? [];
    expect(failClosedTraps).toHaveLength(8);
    expect(auditRole).not.toMatch(/^\s*\\quit\b/gm);
    expect(auditRole).toContain('STOP_DATABASE_IDENTITY_MISMATCH');
    expect(auditRole).toContain('STOP_AUDIT_PASSWORD_NOT_SCRAM');
  });

  it('audit role prompts for a new password only through the secure \\password mechanism', () => {
    expect(auditRole).not.toContain('\\prompt -s');
    expect(auditRole).not.toMatch(/\\prompt\b/);
    expect(auditRole).not.toMatch(/\baudit_password\b/);
    expect(auditRole).not.toMatch(/PASSWORD\s+%L/);
    expect(auditRole).toContain('PASSWORD NULL');
    const passwordCalls = auditRole.match(/^\s*\\password\b.*$/gm) ?? [];
    expect(passwordCalls).toHaveLength(1);
    expect(passwordCalls[0].trim()).toBe('\\password :audit_role');
  });

  it('creates the new role NOLOGIN before any password is set, pins SCRAM before \\password, and only normalizes it to LOGIN afterward', () => {
    const createIndex = auditRole.indexOf(
      "CREATE ROLE %I NOLOGIN PASSWORD NULL",
    );
    const setLocalIndex = auditRole.indexOf(
      "SET LOCAL password_encryption = 'scram-sha-256';",
    );
    const passwordIndex = auditRole.indexOf('\\password :audit_role');
    const verifyIndex = auditRole.indexOf('audit_password_is_scram');
    const loginIndex = auditRole.indexOf(
      "ALTER ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1",
    );
    expect(createIndex).toBeGreaterThan(-1);
    expect(setLocalIndex).toBeGreaterThan(createIndex);
    expect(passwordIndex).toBeGreaterThan(setLocalIndex);
    expect(verifyIndex).toBeGreaterThan(passwordIndex);
    expect(loginIndex).toBeGreaterThan(verifyIndex);
  });

  it('pins SCRAM-SHA-256 encryption exactly once and verifies the stored verifier is actually SCRAM', () => {
    const setLocalOccurrences =
      auditRole.match(/^\s*SET LOCAL password_encryption = 'scram-sha-256';\s*$/gm) ?? [];
    expect(setLocalOccurrences).toHaveLength(1);

    expect(auditRole).toMatch(/COALESCE\(\s*rolpassword LIKE 'SCRAM-SHA-256\$%',\s*false\s*\)/);
    expect(auditRole).not.toMatch(/rolpassword IS NOT NULL/);
    expect(auditRole).not.toContain('audit_password_set');
  });

  it('never asks for a new password when the formal role already exists (no automatic rotation)', () => {
    const roleAbsentBranch = auditRole.match(
      /\\if :role_exists\r?\n\\else\r?\n([\s\S]*?)\\endif/,
    )?.[1];
    expect(roleAbsentBranch).toBeDefined();
    expect(roleAbsentBranch).toContain('\\password');
    const outsideAbsentBranch = auditRole.replace(
      /\\if :role_exists\r?\n\\else\r?\n[\s\S]*?\\endif/,
      '',
    );
    expect(outsideAbsentBranch).not.toContain('\\password');
  });

  it('operational assets contain no embedded connection or secret literal', () => {
    const assets = [fingerprint, auditRole, runner, moduleSource].join('\n');
    expect(assets).not.toMatch(/postgres(?:ql)?:\/\//i);
    expect(assets).not.toMatch(/DATABASE_URL\s*=\s*['"][^'"]+/i);
    expect(assets).not.toMatch(/DPAPI|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/i);
  });

  it('permission codes are exactly the two frozen targets', () => {
    const metadataBlock =
      moduleSource.match(
        /RM01B_PERMISSION_METADATA = \[([\s\S]*?)\] as const/,
      )?.[1] ?? '';
    expect(
      [...metadataBlock.matchAll(/code: '([^']+)'/g)]
        .map((match) => match[1])
        .sort(),
    ).toEqual(['RAB_DRAFT_EDIT', 'RAB_VIEW']);
  });

  it('does not invoke the broad seed and preserves the test-only production refusal', () => {
    expect(
      [fingerprint, auditRole, runner, moduleSource].join('\n'),
    ).not.toContain('seed-rbac-permissions');
    const testOnlyPlanner = read(
      'src/auth/rm01-permission-activation-planner.ts',
    );
    expect(testOnlyPlanner).toContain(
      "const FORBIDDEN_PRODUCTION_DATABASE = 'simprok_db'",
    );
    expect(testOnlyPlanner).toContain(
      'This planner never runs against simprok_db',
    );
  });

  it('is not registered in application modules, controllers, or HTTP routes', () => {
    const candidates = [
      read('src/app.module.ts'),
      ...fs
        .readdirSync(path.join(root, 'src/auth'))
        .filter((name) => /\.(module|controller)\.ts$/.test(name))
        .map((name) => read(`src/auth/${name}`)),
    ].join('\n');
    expect(candidates).not.toContain('rm01b-production-permission-activation');
    expect(candidates).not.toContain('permission-activation.ts');
  });
});
