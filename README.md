# Citizen Petition AI — Proof of Concept

AI-assisted processing of citizen petitions, with **two roles**: a Citizen who
submits, and a Government Grievance Officer who reviews with AI assistance.

The AI analyses the petition, identifies the applicable Act, department and
authority, and answers the officer's questions — but it can only ever name
something that exists in the configured knowledge base, and every result is
marked as requiring officer verification.

## Run it

```bash
npm install
npm run seed      # loads the AI Knowledge Configuration and the two logins
npm run dev       # API on :4000, UI on :5173
```

Open **http://localhost:5173**

| Username | Password | Role |
|---|---|---|
| `citizen1` | `Citizen@123` | Citizen |
| `gro` | `Officer@123` | Government Grievance Officer |

## The flow

```
Citizen signs in
  → creates a petition (subject, description, language)
  → uploads the letter (PDF / image / text)
  → submits
        │
        │  real time (server-sent events)
        ▼
Officer dashboard shows it immediately
  → opens the original letter
  → reads the OCR text, with recognition confidence
  → runs the AI analysis
  → asks the Copilot
  → listens in Tamil or English
  → verifies and records the outcome
```

## What the AI produces

| Output | Notes |
|---|---|
| Summary, main issue, petitioner's request | Derived from the petition and the uploaded documents |
| Important facts | Dates, amounts and key statements extracted from the text |
| **Applicable Act / Law** | Selected by row id from the knowledge base. Shows the section, why it may apply, and a confidence figure |
| **Department** | Matched on configured responsibilities; an Act→Department link outranks keyword overlap |
| **Officer / Authority** | The configured authority for that department, with its jurisdiction |
| Recommended next action | Includes the priority and why that priority was assigned |
| Missing information | What the officer should obtain before acting |

Everything is labelled **AI Recommendation — Requires Officer Verification**.

## AI Knowledge Configuration

Everything the AI can name lives in the configuration screen. Acts, sections,
departments, authorities and subjects each support **Add, Edit, Delete, Search
and Activate/Deactivate**.

Loaded as a starting point:

| | Count |
|---|---|
| Acts, Rules and frameworks | 98 |
| Departments | 50 |
| Officers and authorities | 45 |
| Petition subjects | 22 |
| Act → Department links | 126 |

Adding an Act or a department takes effect on the next analysis. **No code
change, no rebuild, no restart.** Deactivating an entry removes it from analysis
just as immediately.

### Verification status — read this before relying on it

Every loaded Act carries **`verification_status = 'UNVERIFIED'`**.

These entries carry the **name, year and subject area** of real Acts. They do
**not** contain verified statutory text, and no section text has been confirmed
against the Gazette. They are a structured starting point for configuration, not
a legal reference.

Before any real use, an administrator must confirm each entry and record its
source. The fields exist and are editable: `source_url`, `gazette_reference`,
`notification_date`, `verification_status`.

The officer UI shows this status, so nobody can mistake an unverified entry for
settled law.

## How the no-hallucination guarantee works

It is structural, not a prompt instruction.

The analyser selects Acts, sections, departments and authorities **by row id**
from the configured knowledge base. There is no code path that can emit a name
an administrator has not entered. When nothing matches, it returns null for that
field and says so:

> *No Act in the configured knowledge base matched this petition. No Act is
> suggested. Requires Officer Verification.*

The Copilot works the same way, and declines what it cannot source:

> *I cannot answer that from this petition or the configured knowledge base.
> Please consult the appropriate official authority.*

The automated test asserts this: it checks that every named Act, department and
authority exists as a row, and that an unanswerable question is refused.

## Real capabilities, and their honest limits

| Capability | Status |
|---|---|
| **OCR** | Real. Tesseract (WASM) for images, pdf.js text layer for PDFs. Runs in the background; the UI polls a real status and shows the recognition confidence. |
| **Real-time dashboard** | Real. Server-sent events; the test opens a stream and waits for the event rather than assuming it fired. |
| **Text-to-speech** | Real, using the browser engine on the officer's device. A Tamil reading needs a Tamil voice installed — the UI says so when one is absent instead of silently failing. |
| **Tamil Copilot summary** | A template rendering of the analysis into Tamil, not machine translation. The citizen's own words are never replaced by a machine rendering. |
| **AI provider** | A deterministic local implementation, **not** a language model. It performs real extraction and matching against real case text. `IAIProvider` is the seam — implement it against a model provider and call `setProvider()`. |
| **Scanned PDFs** | A PDF with no text layer is not rasterised for OCR (that needs a canvas backend). Upload the scan as JPG or PNG, or type the text. |
| **Malware scanning** | Not performed. Uploads get magic-byte validation against the declared type and are marked `SKIPPED`, never `CLEAN`. |

## Testing

```bash
npm test
```

**59 checks, 0 failures.** Drives the real HTTP API against the real database:
both logins, knowledge configuration CRUD, live SSE delivery, upload and OCR,
the full analysis, six Copilot questions plus Tamil, officer verification, and
six access-control checks — including that a citizen cannot run the analysis,
use the Copilot, modify the knowledge base, or read another citizen's petition.

## Architecture

```
web/   React + TypeScript + Vite     white + green UI
server/ Express + TypeScript          API, RBAC, AI gateway
        └── SQLite (WAL)              single file, Postgres-swappable
```

| Area | File |
|---|---|
| Knowledge schema | `server/src/db/knowledge-schema.sql` |
| Knowledge data | `server/src/db/tn-knowledge.ts` |
| Analyser | `server/src/ai/agents/analyzer.ts` |
| Copilot | `server/src/ai/agents/copilot.ts` |
| Knowledge config API | `server/src/modules/knowledgeConfig.ts` |
| Petitions + real time | `server/src/modules/citizenPetitions.ts` |
| OCR | `server/src/core/ocr.ts` |
| Real-time fan-out | `server/src/core/realtime.ts` |
| Text-to-speech | `web/src/lib/tts.ts` |

## Security

- scrypt password hashing, timing-safe comparison, JWT sessions
- Authorisation enforced server-side on every request; the UI never decides it
- A citizen sees only their own petition, and never the AI analysis, the
  officer's notes or the Copilot conversation — these are absent from the
  response payload, not merely hidden
- CSP, rate limiting, CSRF guard, `Cache-Control: no-store`
- Upload type allow-list, 15 MB cap, magic-byte verification
- Append-only audit log

Before production: set `JWT_SECRET`, move uploads to object storage, add a real
AV scanner, migrate to PostgreSQL, and verify every knowledge entry against its
official source.
