-- Citizen Petition POC - core schema.
--
-- Identity and RBAC, audit, background jobs and AI traceability.
-- The AI Knowledge Configuration and the citizen petition tables live in
-- knowledge-schema.sql.
PRAGMA foreign_keys = ON;

-- ============ IDENTITY & RBAC ============
CREATE TABLE IF NOT EXISTS role (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permission (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permission (
  role_id INTEGER NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permission(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS app_user (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  department_id INTEGER,
  jurisdiction_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_role (
  user_id INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX IF NOT EXISTS ix_user_role_user ON user_role(user_id);

-- ============ AI PROMPTS ============
-- Prompt templates are versioned and stored, so every AI request can record
-- which instructions were in force when it ran.
CREATE TABLE IF NOT EXISTS prompt_template (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  task TEXT NOT NULL,
  version TEXT NOT NULL,
  purpose TEXT,
  system_instructions TEXT NOT NULL,
  output_schema TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (task, version)
);

-- ============ AI TRACEABILITY ============
-- Every AI call is recorded: which provider and model ran, what it produced,
-- how confident it was, and whether its output passed validation.
CREATE TABLE IF NOT EXISTS ai_request (
  id INTEGER PRIMARY KEY,
  request_uid TEXT NOT NULL UNIQUE,
  task TEXT NOT NULL,
  petition_id INTEGER,
  entity_type TEXT,
  entity_id INTEGER,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT,
  input_ref TEXT,
  output_json TEXT,
  output_text TEXT,
  confidence REAL,
  knowledge_sources TEXT,
  validation_status TEXT NOT NULL DEFAULT 'PENDING',
  validation_errors TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  latency_ms INTEGER,
  created_by INTEGER REFERENCES app_user(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_air_task ON ai_request(task);

-- ============ AUDIT ============
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  petition_id INTEGER,
  actor_id INTEGER REFERENCES app_user(id),
  actor_role TEXT,
  old_value TEXT,
  new_value TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_log(created_at);

-- ============ BACKGROUND JOBS ============
CREATE TABLE IF NOT EXISTS job (
  id INTEGER PRIMARY KEY,
  job_type TEXT NOT NULL,
  petition_id INTEGER,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error TEXT,
  result TEXT,
  created_by INTEGER REFERENCES app_user(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_job_status ON job(status);

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
