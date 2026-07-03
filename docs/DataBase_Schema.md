# Database Schema

This document explains the PostgreSQL database schema used by the AI Meeting Agent.

The schema is initialised automatically in `app/database_service.py` and consists of three main tables to persist meeting data, actionable tasks, and identified risks. The database tables are initialized with all required columns.

---

## Tables

### 1. `meetings`
Stores the core information about an uploaded meeting transcript.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated. |
| `title` | VARCHAR(255) NOT NULL | Currently set to the uploaded filename. |
| `file_name` | VARCHAR(255) NOT NULL | Original filename. |
| `content_hash` | VARCHAR(64) UNIQUE NOT NULL | SHA-256 hash for duplicate-upload prevention. |
| `upload_date` | TIMESTAMP | Server timestamp at time of upload. |
| `meeting_date` | DATE NULL | The date the meeting *actually occurred* (extracted from the transcript or set manually). Useful for calendar integrations. |
| `raw_transcript` | TEXT | Full parsed text of the uploaded file. |

---

### 2. `tasks`
Stores the actionable tasks (Action Items, Decisions, etc.) extracted from the meeting transcript by the LLM.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated. |
| `meeting_id` | UUID FK | References `meetings.id` with `ON DELETE CASCADE`. |
| `task_description` | TEXT NOT NULL | Full description of the task or action item. |
| `owner` | VARCHAR(255) | **Raw LLM string** – e.g. `"Speaker A"`, `"All attendees"`, `"Presenters (Speaker A, Speaker B)"`. Kept for display/audit purposes. |
| `owners_list` | JSONB | **Resolved list of individual speaker identifiers** derived from `owner`. Examples: `["Speaker A"]`, `["Speaker A", "Speaker B"]`, `["Speaker A", "Speaker B", "Speaker C"]` (when "All attendees"). Used for programmatic lookup (email/calendar features). |
| `due_date` | DATE | Resolved ISO 8601 date. Defaults to **today's date** if the LLM cannot determine a specific deadline. Subject to cross-day rollover: if the inferred `due_time` is earlier than the current time and the due date would be today, it is automatically pushed to tomorrow. |
| `due_time` | TIME | Resolved time-of-day (HH:MM). Inferred from natural-language phrases (e.g., `'before lunch'` → `12:00`, `'EOD'` → `17:00`). Defaults to **17:00** (end of day) when no time-of-day context is present. |
| `raw_deadline` | VARCHAR(100) NULL | The exact deadline phrase spoken, e.g. `"next Friday"`, `"after lunch"`. |
| `deadline_type` | VARCHAR(20) | `EXPLICIT` – a concrete date/time was stated. `INFERRED` – a relative/vague timeframe was mentioned. `NONE` – no deadline mentioned. |
| `priority` | VARCHAR(20) | `Low`, `Medium`, `High`, or `Critical`. |
| `category` | VARCHAR(30) | `Action Item`, `Decision`, `Follow-up`, or `Info`. |
| `status` | VARCHAR(20) | Defaults to `Open`. |
| `created_at` | TIMESTAMP | Server timestamp of row creation. |

---

### 3. `risks`
Stores potential risks or issues discussed during the meeting.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated. |
| `meeting_id` | UUID FK | References `meetings.id` with `ON DELETE CASCADE`. |
| `risk_description` | TEXT NOT NULL | Detailed explanation of the identified risk. |
| `severity` | VARCHAR(20) | `Low`, `Medium`, `High`, or `Critical`. |
| `created_at` | TIMESTAMP | Server timestamp of row creation. |

---

## Owner Resolution Logic

The LLM returns owner strings exactly as referenced in the meeting. The backend (`app/utils/owner_parser.py`) then resolves these into the `owners_list` JSONB array:

| LLM `owner` string | Resolved `owners_list` |
|---|---|
| `"Unassigned"` | `[]` |
| `"Speaker A"` | `["Speaker A"]` |
| `"John"` | `["John"]` |
| `"Speaker A, Speaker B"` | `["Speaker A", "Speaker B"]` |
| `"Presenters (Speaker A, Speaker B)"` | `["Speaker A", "Speaker B"]` |
| `"All attendees"` | All speakers identified in the meeting |
| `"Everyone"` | All speakers identified in the meeting |

This design keeps the raw owner string intact for display while providing a clean list for future email/calendar automation.

---

## Semantic Querying

Instead of relying on unstable LLM-to-SQL agents, the AI Meeting Agent safely queries this schema by asking the LLM to output a strictly defined Pydantic JSON schema (`SearchFilters`).

**SearchFilters Schema:**

| Field | Type | Description |
|---|---|---|
| `target_table` | `"tasks"` \| `"risks"` \| `"meetings"` | The primary entity to query. |
| `meeting_id` | Optional string | Filter results to a specific meeting UUID. |
| `owner_name` | Optional string | Partial-match filter against both `owner` and `owners_list`. |
| `priority` | Optional string | Filter by priority (tasks) or severity (risks). |
| `status` | Optional string | Filter by task status. |
| `is_open_only` | Boolean | If true, only returns tasks with `status = 'Open'`. |

The backend maps this JSON directly to parameterised SQL — no dynamic SQL injection risk.

---

## Future-Ready Columns

The following columns are planned for future phases but **not yet in the schema**:

- `tasks.owner_email` — email address for the assigned owner (needed for automated email notifications).
- `meetings.calendar_event_id` — external calendar event ID (needed for Google Calendar / Outlook integration).
