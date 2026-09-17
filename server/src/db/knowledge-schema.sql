-- ============================================================
-- AI KNOWLEDGE CONFIGURATION
--
-- Structured government knowledge, managed entirely from the
-- configuration UI. No Act, Department, Officer or Authority is
-- hard-coded anywhere in the application: the AI can only ever
-- name an entity that exists as a row here.
--
-- Adding a new Act or Department is a data entry task, not a
-- code change or a redeployment.
-- ============================================================

-- ---------------- Acts, Rules, GOs ----------------
CREATE TABLE IF NOT EXISTS kb_act (
  id INTEGER PRIMARY KEY,
  short_name TEXT NOT NULL,
  full_title TEXT NOT NULL,
  act_type TEXT NOT NULL DEFAULT 'ACT',   -- ACT | RULE | GO | CIRCULAR | POLICY
  act_number TEXT,
  year INTEGER,
  jurisdiction TEXT,                       -- CENTRAL | STATE | DISTRICT
  summary TEXT,
  applies_when TEXT,                       -- plain-language conditions of applicability
  keywords TEXT,                           -- comma-separated retrieval cues
  source_reference TEXT,                   -- where this text was taken from
  is_demo INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES app_user(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_kbact_active ON kb_act(active);

-- ---------------- Sections within an Act ----------------
CREATE TABLE IF NOT EXISTS kb_section (
  id INTEGER PRIMARY KEY,
  act_id INTEGER NOT NULL REFERENCES kb_act(id) ON DELETE CASCADE,
  section_no TEXT NOT NULL,
  heading TEXT,
  text TEXT NOT NULL,
  applies_when TEXT,
  keywords TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_kbsec_act ON kb_section(act_id);

-- ---------------- Departments ----------------
CREATE TABLE IF NOT EXISTS kb_department (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  responsibilities TEXT,                   -- what this department actually handles
  keywords TEXT,
  parent_id INTEGER REFERENCES kb_department(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_kbdept_active ON kb_department(active);

-- ---------------- Officers / Authorities ----------------
CREATE TABLE IF NOT EXISTS kb_authority (
  id INTEGER PRIMARY KEY,
  designation TEXT NOT NULL,
  department_id INTEGER REFERENCES kb_department(id) ON DELETE SET NULL,
  office_name TEXT,
  jurisdiction_level TEXT,                 -- STATE | DISTRICT | TALUK | VILLAGE
  jurisdiction_area TEXT,
  responsibilities TEXT,
  contact_reference TEXT,
  keywords TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_kbauth_dept ON kb_authority(department_id);
CREATE INDEX IF NOT EXISTS ix_kbauth_active ON kb_authority(active);

-- Which Acts a department administers. Lets the AI connect an
-- identified Act to the office that actually deals with it.
CREATE TABLE IF NOT EXISTS kb_department_act (
  department_id INTEGER NOT NULL REFERENCES kb_department(id) ON DELETE CASCADE,
  act_id INTEGER NOT NULL REFERENCES kb_act(id) ON DELETE CASCADE,
  PRIMARY KEY (department_id, act_id)
);

-- ---------------- Petition subject categories ----------------
CREATE TABLE IF NOT EXISTS kb_subject (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  keywords TEXT,
  default_department_id INTEGER REFERENCES kb_department(id) ON DELETE SET NULL,
  default_priority TEXT DEFAULT 'NORMAL',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- CITIZEN PETITION (simplified 2-role flow)
-- ============================================================
CREATE TABLE IF NOT EXISTS cp_petition (
  id INTEGER PRIMARY KEY,
  reference_no TEXT NOT NULL UNIQUE,
  citizen_user_id INTEGER NOT NULL REFERENCES app_user(id),
  citizen_name TEXT NOT NULL,
  citizen_phone TEXT,
  citizen_address TEXT,
  subject TEXT NOT NULL,
  description TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL DEFAULT 'SUBMITTED',  -- SUBMITTED|ANALYSING|ANALYSED|UNDER_REVIEW|ACTIONED|CLOSED
  analysis_status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING|PROCESSING|COMPLETED|FAILED
  officer_notes TEXT,
  officer_verified INTEGER NOT NULL DEFAULT 0,
  verified_by INTEGER REFERENCES app_user(id),
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_cp_status ON cp_petition(status);
CREATE INDEX IF NOT EXISTS ix_cp_citizen ON cp_petition(citizen_user_id);
CREATE INDEX IF NOT EXISTS ix_cp_created ON cp_petition(created_at);

CREATE TABLE IF NOT EXISTS cp_document (
  id INTEGER PRIMARY KEY,
  petition_id INTEGER NOT NULL REFERENCES cp_petition(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER,
  checksum TEXT,
  ocr_status TEXT NOT NULL DEFAULT 'PENDING',
  ocr_engine TEXT,
  ocr_confidence REAL,
  extracted_text TEXT,
  ocr_note TEXT,
  ocr_scripts TEXT,
  -- Officer-corrected OCR text (preferred by AI analyser when present)
  ocr_corrected_text TEXT,
  ocr_corrected_source TEXT,    -- 'OFFICER' | 'AI_ASSIST'
  ocr_corrected_by INTEGER REFERENCES app_user(id),
  ocr_corrected_at TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_cpdoc_petition ON cp_document(petition_id);

-- AI analysis result. Every field is a RECOMMENDATION pending
-- officer verification; nothing here is an official determination.
CREATE TABLE IF NOT EXISTS cp_analysis (
  id INTEGER PRIMARY KEY,
  petition_id INTEGER NOT NULL REFERENCES cp_petition(id) ON DELETE CASCADE,
  ai_request_id INTEGER,
  summary TEXT,
  main_issue TEXT,
  petitioner_request TEXT,
  important_facts TEXT,          -- JSON array
  act_id INTEGER REFERENCES kb_act(id),
  section_id INTEGER REFERENCES kb_section(id),
  act_reason TEXT,
  act_confidence REAL,
  department_id INTEGER REFERENCES kb_department(id),
  department_reason TEXT,
  department_confidence REAL,
  authority_id INTEGER REFERENCES kb_authority(id),
  authority_reason TEXT,
  next_action TEXT,
  priority TEXT,
  priority_reason TEXT,
  overall_confidence REAL,
  missing_information TEXT,      -- JSON array
  requires_verification INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_cpana_petition ON cp_analysis(petition_id);

-- Copilot conversation, retained so an officer can see what was
-- asked and what the AI answered.
CREATE TABLE IF NOT EXISTS cp_copilot_message (
  id INTEGER PRIMARY KEY,
  petition_id INTEGER NOT NULL REFERENCES cp_petition(id) ON DELETE CASCADE,
  role TEXT NOT NULL,            -- USER | ASSISTANT
  content TEXT NOT NULL,
  sources TEXT,                  -- JSON array of knowledge references
  confidence REAL,
  asked_by INTEGER REFERENCES app_user(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_cpcop_petition ON cp_copilot_message(petition_id);

-- Copilot conversation for global e-Gov assistant.
CREATE TABLE IF NOT EXISTS egov_chat_message (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,            -- USER | ASSISTANT
  content TEXT NOT NULL,
  sources TEXT,                  -- JSON array of knowledge references
  confidence REAL,
  asked_by INTEGER REFERENCES app_user(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
