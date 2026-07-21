import pg from 'pg';
const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      anthropic_api_key TEXT NOT NULL,
      licensed_to TEXT NOT NULL,
      activated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- One row per redeemed license key, so the same signed key can't spin up a
    -- second organization. Server-wide, not per-org, since redemption happens
    -- before an org exists yet.
    CREATE TABLE IF NOT EXISTS redeemed_licenses (
      license_key TEXT PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      redeemed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Email is unique server-wide (not per-org) to keep login simple: no org
    -- picker needed, one email always means one specific account.
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      recovery_code_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      duration INT NOT NULL,
      priority TEXT NOT NULL,
      date TEXT NOT NULL,
      start TEXT,
      done BOOLEAN NOT NULL DEFAULT FALSE,
      ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
      recurrence_id TEXT,
      scope TEXT NOT NULL,
      user_id UUID NOT NULL,
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_org_date ON tasks(org_id, date);
    CREATE INDEX IF NOT EXISTS idx_tasks_org_scope_user ON tasks(org_id, scope, user_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_recurrence ON tasks(recurrence_id);
    CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

    ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_code_hash TEXT;

    -- Short-lived, single-use codes emailed to a user for self-service password reset.
    CREATE TABLE IF NOT EXISTS password_resets (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, used, expires_at);
  `);
}

export function mapTask(row) {
  return {
    id: row.id, title: row.title, duration: row.duration, priority: row.priority,
    date: row.date, start: row.start, done: row.done, aiGenerated: row.ai_generated,
    recurrenceId: row.recurrence_id, scope: row.scope, userId: row.user_id, createdBy: row.created_by,
  };
}

export function publicUser(row) {
  return { id: row.id, email: row.email, name: row.name, role: row.role, orgId: row.org_id };
}
