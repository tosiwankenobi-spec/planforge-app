// Real integration tests: spawns the actual server as a child process against a real
// Postgres database and a real local SMTP relay, then drives it entirely over HTTP —
// the same way a real client would, not by importing internals.
//
// Requires: a reachable Postgres at TEST_DATABASE_URL (defaults to a local `planforge_test`
// database). Run with: node --test test/integration.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { startTestSmtp } from './test-smtp.js';

const PORT = 3199;
const BASE = `http://localhost:${PORT}`;
const DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/planforge_test';
const SMTP_PORT = 2529;

let serverProcess;
let smtp;
let privateKey;

function issueLicense(email) {
  const payload = JSON.stringify({ email, issuedAt: Date.now() });
  const payloadB64 = Buffer.from(payload).toString('base64url');
  const signature = cryptoSign(null, Buffer.from(payloadB64), privateKey).toString('base64url');
  return `${payloadB64}.${signature}`;
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  return { status: res.status, data };
}

async function waitForHealth(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('Server did not become healthy in time');
}

before(async () => {
  // Fresh, isolated keypair for this test run — never touches the real production keys.
  const { publicKey, privateKey: priv } = generateKeyPairSync('ed25519');
  privateKey = priv;
  const tmpDir = mkdtempSync(join(tmpdir(), 'planforge-test-'));
  const publicKeyPath = join(tmpDir, 'public.pem');
  writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));

  // Reset the test database to a known-empty state.
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  await pool.query('DROP TABLE IF EXISTS tasks, users, organizations, redeemed_licenses, password_resets CASCADE');
  await pool.end();

  smtp = await startTestSmtp(SMTP_PORT);

  serverProcess = spawn('node', ['index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_URL,
      JWT_SECRET: 'test-jwt-secret-do-not-use-in-prod',
      ENCRYPTION_KEY: '227d76ff69cd873ea652063fbf4f486781d43853b5d1ceb2dcd8a6cf3fc42a70',
      ALLOWED_ORIGINS: '',
      LICENSE_PUBLIC_KEY_PATH: publicKeyPath,
      SMTP_HOST: 'localhost',
      SMTP_PORT: String(SMTP_PORT),
      SMTP_SECURE: 'false',
      MAIL_FROM: 'PlanForge Test <no-reply@test.local>',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHealth();
});

after(async () => {
  serverProcess?.kill();
  smtp?.server?.close();
});

test('health check responds', async () => {
  const { status, data } = await api('GET', '/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
});

test('org activation rejects an invalid license key', async () => {
  const { status, data } = await api('POST', '/api/orgs/activate', {
    licenseKey: 'not-a-real-key', ownerEmail: 'x@example.com', ownerPassword: 'password123', anthropicApiKey: 'sk-ant-x',
  });
  assert.equal(status, 400);
  assert.equal(data.error, 'invalid_license_key');
});

let orgAToken, orgAOwnerId, orgARecoveryCode;

test('a valid license creates an organization and owner', async () => {
  const license = issueLicense('orgA@example.com');
  const { status, data } = await api('POST', '/api/orgs/activate', {
    licenseKey: license, orgName: 'Org A', ownerEmail: 'owner-a@example.com',
    ownerName: 'Owner A', ownerPassword: 'password123', anthropicApiKey: 'sk-ant-org-a-secret',
  });
  assert.equal(status, 200);
  assert.ok(data.token);
  assert.ok(data.recoveryCode);
  assert.equal(data.user.role, 'owner');
  orgAToken = data.token;
  orgAOwnerId = data.user.id;
  orgARecoveryCode = data.recoveryCode;
  global.__orgALicense = license; // reused by the next test to prove single-use
});

test('reusing the same license key is rejected', async () => {
  const { status, data } = await api('POST', '/api/orgs/activate', {
    licenseKey: global.__orgALicense, orgName: 'Clone', ownerEmail: 'clone@example.com',
    ownerPassword: 'password123', anthropicApiKey: 'sk-ant-x',
  });
  assert.equal(status, 400);
  assert.equal(data.error, 'license_already_used');
});

test('the Anthropic key is never stored as plaintext', async () => {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const { rows } = await pool.query('SELECT anthropic_api_key FROM organizations');
  await pool.end();
  assert.ok(!rows[0].anthropic_api_key.includes('sk-ant-org-a-secret'));
});

let orgBToken;
test('a second license creates a fully separate organization', async () => {
  const license = issueLicense('orgB@example.com');
  const { status, data } = await api('POST', '/api/orgs/activate', {
    licenseKey: license, orgName: 'Org B', ownerEmail: 'owner-b@example.com',
    ownerPassword: 'password123', anthropicApiKey: 'sk-ant-org-b-secret',
  });
  assert.equal(status, 200);
  orgBToken = data.token;
});

test('login works with correct credentials, fails with wrong ones', async () => {
  const good = await api('POST', '/api/auth/login', { email: 'owner-a@example.com', password: 'password123' });
  assert.equal(good.status, 200);
  const bad = await api('POST', '/api/auth/login', { email: 'owner-a@example.com', password: 'wrongpassword' });
  assert.equal(bad.status, 401);
});

test('org A and org B tasks are fully isolated', async () => {
  const a = await api('POST', '/api/tasks', { id: 'a1', title: 'Acme standup', duration: 15, priority: 'medium', date: '2026-08-01', start: '09:00', scope: 'team' }, orgAToken);
  assert.equal(a.status, 200);
  const b = await api('POST', '/api/tasks', { id: 'b1', title: 'Beta standup', duration: 15, priority: 'medium', date: '2026-08-01', start: '09:00', scope: 'team' }, orgBToken);
  assert.equal(b.status, 200);

  const aTasks = await api('GET', '/api/tasks', null, orgAToken);
  assert.equal(aTasks.data.tasks.length, 1);
  assert.equal(aTasks.data.tasks[0].id, 'a1');

  const bTasks = await api('GET', '/api/tasks', null, orgBToken);
  assert.equal(bTasks.data.tasks.length, 1);
  assert.equal(bTasks.data.tasks[0].id, 'b1');

  // Org B trying to touch org A's task by ID must 404, not leak its existence.
  const cross = await api('PATCH', '/api/tasks/a1', { done: true }, orgBToken);
  assert.equal(cross.status, 404);
});

test('task title over 200 characters is rejected', async () => {
  const { status, data } = await api('POST', '/api/tasks', {
    id: 'toolong', title: 'x'.repeat(201), duration: 30, priority: 'low', date: '2026-08-01', scope: 'personal',
  }, orgAToken);
  assert.equal(status, 400);
  assert.equal(data.error, 'title_too_long');
});

test('a member sees team tasks and their own personal tasks, not the owner\'s personal ones', async () => {
  await api('POST', '/api/tasks', { id: 'a-personal', title: 'Owner personal', duration: 30, priority: 'low', date: '2026-08-01', scope: 'personal' }, orgAToken);

  const add = await api('POST', '/api/team/members', { email: 'member-a@example.com', name: 'Member A' }, orgAToken);
  assert.equal(add.status, 200);
  const tempPassword = add.data.tempPassword;

  const login = await api('POST', '/api/auth/login', { email: 'member-a@example.com', password: tempPassword });
  assert.equal(login.status, 200);
  const memberToken = login.data.token;

  const memberTasks = await api('GET', '/api/tasks', null, memberToken);
  const ids = memberTasks.data.tasks.map(t => t.id);
  assert.ok(ids.includes('a1'));           // team task: visible
  assert.ok(!ids.includes('a-personal'));  // owner's personal task: not visible

  // Member cannot reach owner-only routes.
  const forbidden = await api('GET', '/api/team/members', null, memberToken);
  assert.equal(forbidden.status, 403);

  global.__memberAId = add.data.member.id;
});

test('owner can reset a member\'s password without deleting their tasks', async () => {
  const before = await api('GET', '/api/tasks', null, orgAToken);
  const countBefore = before.data.tasks.length;

  const reset = await api('POST', `/api/team/members/${global.__memberAId}/reset-password`, null, orgAToken);
  assert.equal(reset.status, 200);
  assert.ok(reset.data.tempPassword);

  const relogin = await api('POST', '/api/auth/login', { email: 'member-a@example.com', password: reset.data.tempPassword });
  assert.equal(relogin.status, 200);

  const after = await api('GET', '/api/tasks', null, orgAToken);
  assert.equal(after.data.tasks.length, countBefore); // nothing was deleted
});

test('offline recovery code resets a password and rotates itself', async () => {
  const wrong = await api('POST', '/api/auth/recover', { email: 'owner-a@example.com', recoveryCode: 'WRONG-CODE', newPassword: 'irrelevant123' });
  assert.equal(wrong.status, 401);

  const ok = await api('POST', '/api/auth/recover', { email: 'owner-a@example.com', recoveryCode: orgARecoveryCode, newPassword: 'recoveredpass123' });
  assert.equal(ok.status, 200);
  const newCode = ok.data.recoveryCode;
  assert.notEqual(newCode, orgARecoveryCode);

  const loginNew = await api('POST', '/api/auth/login', { email: 'owner-a@example.com', password: 'recoveredpass123' });
  assert.equal(loginNew.status, 200);

  // The old code must no longer work.
  const reuseOld = await api('POST', '/api/auth/recover', { email: 'owner-a@example.com', recoveryCode: orgARecoveryCode, newPassword: 'anotherpass456' });
  assert.equal(reuseOld.status, 401);

  orgAToken = loginNew.data.token; // subsequent tests use the current password's session
});

test('email-based reset delivers a real code and the code is single-use', async () => {
  smtp.inbox.length = 0;
  const request = await api('POST', '/api/auth/forgot-password', { email: 'owner-a@example.com' });
  assert.equal(request.status, 200);

  await new Promise(r => setTimeout(r, 300));
  assert.equal(smtp.inbox.length, 1);
  const match = smtp.inbox[0].text.match(/code is: ([A-Z0-9]+)/);
  assert.ok(match, 'reset code should appear in the actual email body');
  const code = match[1];

  const wrongCode = await api('POST', '/api/auth/reset-password', { email: 'owner-a@example.com', code: 'WRONGCOD', newPassword: 'emailresetpw1' });
  assert.equal(wrongCode.status, 400);

  const redeem = await api('POST', '/api/auth/reset-password', { email: 'owner-a@example.com', code, newPassword: 'emailresetpw1' });
  assert.equal(redeem.status, 200);

  const reuse = await api('POST', '/api/auth/reset-password', { email: 'owner-a@example.com', code, newPassword: 'anotherpw2' });
  assert.equal(reuse.status, 400);

  const login = await api('POST', '/api/auth/login', { email: 'owner-a@example.com', password: 'emailresetpw1' });
  assert.equal(login.status, 200);
  orgAToken = login.data.token;
});

test('org settings: owner can view org info and rotate the Anthropic key', async () => {
  const view = await api('GET', '/api/org', null, orgAToken);
  assert.equal(view.status, 200);
  assert.equal(view.data.org.name, 'Org A');

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const { rows: before } = await pool.query('SELECT anthropic_api_key FROM organizations WHERE name = $1', ['Org A']);

  const rotate = await api('PATCH', '/api/org', { anthropicApiKey: 'sk-ant-rotated-key' }, orgAToken);
  assert.equal(rotate.status, 200);

  const { rows: after } = await pool.query('SELECT anthropic_api_key FROM organizations WHERE name = $1', ['Org A']);
  await pool.end();
  assert.notEqual(before[0].anthropic_api_key, after[0].anthropic_api_key);
});

test('org settings route requires auth at all', async () => {
  const noAuth = await api('PATCH', '/api/org', { name: 'Hacked' }, undefined);
  assert.equal(noAuth.status, 401);
});
