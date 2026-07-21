import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import { pool, initSchema, mapTask, publicUser } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { sendPasswordResetEmail, mailConfigured } from './mail.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.warn('WARNING: JWT_SECRET is not set — set it to a long random string in .env.');
if (!process.env.DATABASE_URL) console.warn('WARNING: DATABASE_URL is not set.');
if (!process.env.ENCRYPTION_KEY) console.warn('WARNING: ENCRYPTION_KEY is not set — org Anthropic keys cannot be stored until it is (openssl rand -hex 32).');
if (!mailConfigured()) console.warn('WARNING: SMTP_HOST is not set — email password reset will not work until it is.');

let publicKey;
try {
  const keyPath = process.env.LICENSE_PUBLIC_KEY_PATH || new URL('./keys/public.pem', import.meta.url);
  publicKey = crypto.createPublicKey(fs.readFileSync(keyPath));
} catch (e) {
  console.warn('WARNING: server/keys/public.pem missing — license activation will always fail until it is added.');
}

function verifyLicenseKey(licenseKey) {
  if (!publicKey || !licenseKey || typeof licenseKey !== 'string') return null;
  const [payloadB64, signatureB64] = licenseKey.split('.');
  if (!payloadB64 || !signatureB64) return null;
  try {
    const ok = crypto.verify(null, Buffer.from(payloadB64), publicKey, Buffer.from(signatureB64, 'base64url'));
    if (!ok) return null;
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
  } catch (e) {
    return null;
  }
}

await initSchema();

const app = express();
app.use(helmet());
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  }
}));
app.use(express.json({ limit: '200kb' }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 120 }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true }); // 10 attempts/15min/IP

function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role, orgId: user.org_id }, JWT_SECRET, { expiresIn: '30d' });
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'missing_token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1 AND org_id = $2', [payload.id, payload.orgId]);
    if (!rows[0]) return res.status(401).json({ error: 'invalid_token' });
    req.user = rows[0];
    next();
  } catch (e) {
    res.status(401).json({ error: 'invalid_token' });
  }
}

function requireOwner(req, res, next) {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'owner_only' });
  next();
}

app.get('/health', (req, res) => res.json({ ok: true }));

// Redeem a license key to create a brand-new organization + its owner account.
// Each key works exactly once, server-wide, regardless of which org tries it.
app.post('/api/orgs/activate', async (req, res) => {
  const { licenseKey, orgName, ownerEmail, ownerName, ownerPassword, anthropicApiKey } = req.body || {};
  const claim = verifyLicenseKey(licenseKey);
  if (!claim) return res.status(400).json({ error: 'invalid_license_key' });
  if (!ownerEmail || !ownerPassword || ownerPassword.length < 8) {
    return res.status(400).json({ error: 'owner_email_and_password_required' });
  }
  if (!anthropicApiKey || !anthropicApiKey.trim()) {
    return res.status(400).json({ error: 'anthropic_api_key_required' });
  }
  if (orgName && orgName.length > 100) return res.status(400).json({ error: 'org_name_too_long' });

  const { rows: usedRows } = await pool.query('SELECT license_key FROM redeemed_licenses WHERE license_key = $1', [licenseKey]);
  if (usedRows[0]) return res.status(400).json({ error: 'license_already_used' });

  const cleanEmail = ownerEmail.toLowerCase().trim();
  const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
  if (existing[0]) return res.status(409).json({ error: 'email_already_registered' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orgId = crypto.randomUUID();
    await client.query(
      'INSERT INTO organizations (id, name, anthropic_api_key, licensed_to) VALUES ($1,$2,$3,$4)',
      [orgId, orgName || `${cleanEmail}'s team`, encrypt(anthropicApiKey.trim()), claim.email]
    );
    await client.query('INSERT INTO redeemed_licenses (license_key, org_id) VALUES ($1,$2)', [licenseKey, orgId]);
    const ownerId = crypto.randomUUID();
    const hash = await bcrypt.hash(ownerPassword, 10);
    const recoveryCode = crypto.randomBytes(9).toString('base64url');
    const recoveryHash = await bcrypt.hash(recoveryCode, 10);
    await client.query(
      'INSERT INTO users (id, org_id, email, name, password_hash, role, recovery_code_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [ownerId, orgId, cleanEmail, ownerName || cleanEmail, hash, 'owner', recoveryHash]
    );
    await client.query('COMMIT');

    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [ownerId]);
    res.json({ token: signToken(rows[0]), user: publicUser(rows[0]), recoveryCode });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'activation_failed' });
  } finally {
    client.release();
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase().trim()]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

app.post('/api/auth/password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'password_too_short' });
  if (!(await bcrypt.compare(currentPassword || '', req.user.password_hash))) {
    return res.status(401).json({ error: 'current_password_incorrect' });
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
  res.json({ ok: true });
});

// No email infra yet, so recovery works via a one-time code issued at signup (and
// re-issued here after each use). Anyone who has it can reset that account's password
// without knowing the old one — so it must be treated like a spare key, not a hint.
app.post('/api/auth/recover', async (req, res) => {
  const { email, recoveryCode, newPassword } = req.body || {};
  if (!email || !recoveryCode || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
  const user = rows[0];
  if (!user || !user.recovery_code_hash || !(await bcrypt.compare(recoveryCode, user.recovery_code_hash))) {
    return res.status(401).json({ error: 'invalid_recovery_code' });
  }
  const newHash = await bcrypt.hash(newPassword, 10);
  const newRecoveryCode = crypto.randomBytes(9).toString('base64url');
  const newRecoveryHash = await bcrypt.hash(newRecoveryCode, 10);
  await pool.query('UPDATE users SET password_hash = $1, recovery_code_hash = $2 WHERE id = $3', [newHash, newRecoveryHash, user.id]);
  res.json({ token: signToken(user), user: publicUser(user), recoveryCode: newRecoveryCode });
});

app.post('/api/auth/recovery-code/regenerate', requireAuth, async (req, res) => {
  const recoveryCode = crypto.randomBytes(9).toString('base64url');
  const recoveryHash = await bcrypt.hash(recoveryCode, 10);
  await pool.query('UPDATE users SET recovery_code_hash = $1 WHERE id = $2', [recoveryHash, req.user.id]);
  res.json({ recoveryCode });
});

// Human-typeable code alphabet — no 0/O or 1/I, so it's unambiguous when read off an email.
const RESET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateResetCode(length = 8) {
  let out = '';
  for (let i = 0; i < length; i++) out += RESET_ALPHABET[crypto.randomInt(RESET_ALPHABET.length)];
  return out;
}

const forgotPasswordLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5 }); // 5/hour/IP, separate from the general limiter

app.post('/api/auth/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email_required' });
  if (!mailConfigured()) return res.status(500).json({ error: 'email_not_configured' });

  const cleanEmail = email.toLowerCase().trim();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
  const user = rows[0];
  // Always respond the same way whether or not the account exists — don't let this
  // endpoint be used to discover who has an account.
  if (user) {
    const code = generateResetCode();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    await pool.query(
      'INSERT INTO password_resets (id, user_id, code_hash, expires_at) VALUES ($1,$2,$3,$4)',
      [crypto.randomUUID(), user.id, codeHash, expiresAt]
    );
    try {
      await sendPasswordResetEmail(user.email, code);
    } catch (e) {
      console.error('Failed to send reset email', e); // logged for the operator; client response stays generic either way
    }
  }
  res.json({ ok: true });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!email || !code || !newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'invalid_request' });
  }
  const cleanEmail = email.toLowerCase().trim();
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [cleanEmail]);
  const user = rows[0];
  if (!user) return res.status(400).json({ error: 'invalid_code' });

  const { rows: resets } = await pool.query(
    'SELECT * FROM password_resets WHERE user_id = $1 AND used = FALSE AND expires_at > now() ORDER BY created_at DESC',
    [user.id]
  );
  let matched = null;
  for (const r of resets) {
    if (await bcrypt.compare(code, r.code_hash)) { matched = r; break; }
  }
  if (!matched) return res.status(400).json({ error: 'invalid_code' });

  await pool.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [matched.id]);
  const hash = await bcrypt.hash(newPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
  res.json({ token: signToken(user), user: publicUser(user) });
});

// --- org settings (owner only) ---
app.get('/api/org', requireAuth, requireOwner, async (req, res) => {
  const { rows } = await pool.query('SELECT name, licensed_to, activated_at FROM organizations WHERE id = $1', [req.user.org_id]);
  const org = rows[0];
  if (!org) return res.status(404).json({ error: 'not_found' });
  res.json({ org: { name: org.name, licensedTo: org.licensed_to, activatedAt: org.activated_at } });
});

app.patch('/api/org', requireAuth, requireOwner, async (req, res) => {
  const { name, anthropicApiKey } = req.body || {};
  if (name !== undefined && (!name.trim() || name.length > 100)) return res.status(400).json({ error: 'invalid_name' });
  if (anthropicApiKey !== undefined && !anthropicApiKey.trim()) return res.status(400).json({ error: 'invalid_key' });

  const sets = [];
  const values = [];
  if (name !== undefined) { values.push(name.trim()); sets.push(`name = $${values.length}`); }
  if (anthropicApiKey !== undefined) { values.push(encrypt(anthropicApiKey.trim())); sets.push(`anthropic_api_key = $${values.length}`); }
  if (sets.length === 0) return res.status(400).json({ error: 'nothing_to_update' });

  values.push(req.user.org_id);
  await pool.query(`UPDATE organizations SET ${sets.join(', ')} WHERE id = $${values.length}`, values);
  res.json({ ok: true });
});

// --- team management (owner only, scoped to their own org) ---
app.get('/api/team/members', requireAuth, requireOwner, async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM users WHERE org_id = $1 ORDER BY created_at ASC', [req.user.org_id]);
  res.json({ members: rows.map(publicUser) });
});

app.post('/api/team/members', requireAuth, requireOwner, async (req, res) => {
  const { email, name } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email_required' });
  const cleanEmail = email.toLowerCase().trim();
  const { rows: existing } = await pool.query('SELECT id FROM users WHERE email = $1', [cleanEmail]);
  if (existing[0]) return res.status(409).json({ error: 'already_exists' });

  const tempPassword = crypto.randomBytes(6).toString('base64url');
  const id = crypto.randomUUID();
  const hash = await bcrypt.hash(tempPassword, 10);
  await pool.query(
    'INSERT INTO users (id, org_id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, req.user.org_id, cleanEmail, name || email, hash, 'member']
  );
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  res.json({ member: publicUser(rows[0]), tempPassword });
});

app.post('/api/team/members/:id/reset-password', requireAuth, requireOwner, async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM users WHERE id = $1 AND org_id = $2', [req.params.id, req.user.org_id]);
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  const tempPassword = crypto.randomBytes(6).toString('base64url');
  const hash = await bcrypt.hash(tempPassword, 10);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.params.id]);
  res.json({ tempPassword });
});

app.delete('/api/team/members/:id', requireAuth, requireOwner, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'cannot_remove_self' });
  await pool.query("DELETE FROM tasks WHERE org_id = $1 AND scope = 'personal' AND user_id = $2", [req.user.org_id, req.params.id]);
  await pool.query('DELETE FROM users WHERE id = $1 AND org_id = $2', [req.params.id, req.user.org_id]);
  res.json({ ok: true });
});

// --- tasks: personal (private to creator) + team (shared within the org) ---
app.get('/api/tasks', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM tasks WHERE org_id = $1 AND (scope = 'team' OR user_id = $2) ORDER BY date, start NULLS LAST",
    [req.user.org_id, req.user.id]
  );
  res.json({ tasks: rows.map(mapTask) });
});

app.post('/api/tasks', requireAuth, async (req, res) => {
  const t = req.body || {};
  if (!t.id || !t.title || !t.date) return res.status(400).json({ error: 'invalid_task' });
  if (t.title.length > 200) return res.status(400).json({ error: 'title_too_long' });
  if (t.duration && (t.duration < 1 || t.duration > 1440)) return res.status(400).json({ error: 'invalid_duration' });
  const scope = t.scope === 'team' ? 'team' : 'personal';
  await pool.query(
    `INSERT INTO tasks (id, org_id, title, duration, priority, date, start, done, ai_generated, recurrence_id, scope, user_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)`,
    [t.id, req.user.org_id, t.title, t.duration || 30, t.priority || 'medium', t.date, t.start || null,
      !!t.done, !!t.aiGenerated, t.recurrenceId || null, scope, req.user.id]
  );
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [t.id]);
  res.json({ task: mapTask(rows[0]) });
});

async function loadTaskForEdit(id, user) {
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1 AND org_id = $2', [id, user.org_id]);
  const task = rows[0];
  if (!task) return { error: 404 };
  if (task.scope !== 'team' && task.user_id !== user.id) return { error: 403 };
  return { task };
}

app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
  const { task, error } = await loadTaskForEdit(req.params.id, req.user);
  if (error) return res.status(error).json({ error: error === 404 ? 'not_found' : 'not_yours' });

  const patch = req.body || {};
  if (patch.title !== undefined && patch.title.length > 200) return res.status(400).json({ error: 'title_too_long' });
  const fields = {
    title: patch.title ?? task.title,
    duration: patch.duration ?? task.duration,
    priority: patch.priority ?? task.priority,
    date: patch.date ?? task.date,
    start: patch.start !== undefined ? patch.start : task.start,
    done: patch.done ?? task.done,
    ai_generated: patch.aiGenerated ?? task.ai_generated,
    recurrence_id: patch.recurrenceId ?? task.recurrence_id,
  };
  await pool.query(
    `UPDATE tasks SET title=$1, duration=$2, priority=$3, date=$4, start=$5, done=$6, ai_generated=$7, recurrence_id=$8 WHERE id=$9`,
    [fields.title, fields.duration, fields.priority, fields.date, fields.start, fields.done, fields.ai_generated, fields.recurrence_id, task.id]
  );
  const { rows } = await pool.query('SELECT * FROM tasks WHERE id = $1', [task.id]);
  res.json({ task: mapTask(rows[0]) });
});

app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
  const { task, error } = await loadTaskForEdit(req.params.id, req.user);
  if (error) return res.status(error).json({ error: error === 404 ? 'not_found' : 'not_yours' });
  await pool.query('DELETE FROM tasks WHERE id = $1', [task.id]);
  res.json({ ok: true });
});

app.delete('/api/tasks/series/:recurrenceId', requireAuth, async (req, res) => {
  const { fromDate } = req.query;
  await pool.query(
    `DELETE FROM tasks WHERE org_id = $1 AND recurrence_id = $2 AND ($3::text IS NULL OR date >= $3) AND (scope = 'team' OR user_id = $4)`,
    [req.user.org_id, req.params.recurrenceId, fromDate || null, req.user.id]
  );
  res.json({ ok: true });
});

// --- AI scheduling: uses THIS ORG's own Anthropic key, not a server-wide one. ---
app.post('/api/plan', requireAuth, async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || prompt.length > 8000) {
    return res.status(400).json({ error: 'invalid_prompt' });
  }
  const { rows } = await pool.query('SELECT anthropic_api_key FROM organizations WHERE id = $1', [req.user.org_id]);
  const encryptedKey = rows[0]?.anthropic_api_key;
  if (!encryptedKey) return res.status(500).json({ error: 'org_missing_api_key' });
  let orgKey;
  try {
    orgKey = decrypt(encryptedKey);
  } catch (e) {
    console.error('Failed to decrypt org Anthropic key', e);
    return res.status(500).json({ error: 'key_decrypt_failed' });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': orgKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!upstream.ok) {
      console.error('Anthropic API error', upstream.status, await upstream.text());
      return res.status(502).json({ error: 'upstream_error' });
    }
    res.json(await upstream.json());
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`PlanForge backend listening on ${port}`));
