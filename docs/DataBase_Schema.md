# Database Schema

This document explains the multi-tenant PostgreSQL database schema used by the AI Meeting Agent.

The schema is initialized automatically in `app/database_service.py` on FastAPI application boot. All existing testing tables are dropped on start to ensure clean recreations of the normalized layout.

---

## Tables

### 1. `organizations`
Stores tenant organizations.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated. |
| `name` | VARCHAR(255) NOT NULL | Organization name. |

---

### 2. `users`
Stores user records belonging to an organization.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated. |
| `organization_id` | UUID FK | References `organizations.id` with `ON DELETE CASCADE`. |
| `f_name` | VARCHAR(100) | First name. |
| `l_name` | VARCHAR(100) | Last name. |
| `email` | VARCHAR(255) UNIQUE | Unique login email. |
| `password_hash` | VARCHAR(255) NOT NULL | Cryptographic password hash. |
| `role` | `user_role` ENUM | `admin` or `employee`. |

---

### 3. `teams`
Stores teams/departments created within an organization.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated. |
| `organization_id` | UUID FK | References `organizations.id` with `ON DELETE CASCADE`. |
| `name` | VARCHAR(255) NOT NULL | Team name. |
| `description` | TEXT | Description. |

---

### 4. `team_members`
A join table linking users to teams/departments they belong to.

| Column | Type | Notes |
|---|---|---|
| `team_id` | UUID FK | References `teams.id` with `ON DELETE CASCADE`. |
| `user_id` | UUID FK | References `users.id` with `ON DELETE CASCADE`. |

- **Primary Key**: Composite PK `(team_id, user_id)`

---

### 5. `meetings`
Stores meeting metadata. The raw transcript text has been separated to optimize metadata querying.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated. |
| `organization_id` | UUID FK | References `organizations.id` with `ON DELETE CASCADE`. |
| `uploaded_by` | UUID FK | References `users.id` with `ON DELETE RESTRICT`. |
| `title` | VARCHAR(255) NOT NULL | Meeting title. |
| `meeting_date` | DATE | Date the meeting actually occurred. |
| `file_name` | VARCHAR(255) NOT NULL | Original uploaded filename. |
| `content_hash` | VARCHAR(64) UNIQUE | SHA-256 hash for idempotency prevention. |
| `summary` | TEXT | AI-generated summary of the meeting. |
| `status` | `meeting_status` ENUM | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`. |
| `created_at` | TIMESTAMP | Upload timestamp. |

---

### 6. `meeting_teams`
A join table linking meetings to teams. Enables cross-team idempotency without duplicating the meeting record.

| Column | Type | Notes |
|---|---|---|
| `meeting_id` | UUID FK | References `meetings.id` with `ON DELETE CASCADE`. |
| `team_id` | UUID FK | References `teams.id` with `ON DELETE CASCADE`. |

- **Primary Key**: Composite PK `(meeting_id, team_id)`

---

### 7. `meeting_transcripts`
Stores the raw transcript text of a meeting.

| Column | Type | Notes |
|---|---|---|
| `meeting_id` | UUID PK, FK | References `meetings.id` with `ON DELETE CASCADE`. |
| `raw_transcript` | TEXT NOT NULL | The full transcript content. |
| `is_processed` | BOOLEAN | Defaults to `FALSE`. Turned `TRUE` once LLM extraction finishes. |

---

### 8. `meeting_participants`
Stores speakers identified in the meeting transcript.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated. |
| `meeting_id` | UUID FK | References `meetings.id` with `ON DELETE CASCADE`. |
| `user_id` | UUID FK | References `users.id` with `ON DELETE SET NULL`. Optional mapping. |
| `speaker_name` | VARCHAR(255) NOT NULL | Speaker label/name parsed from transcript. |

---

### 9. `tasks`
Stores actionable tasks or decisions extracted by the LLM.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated. |
| `organization_id` | UUID FK | References `organizations.id` with `ON DELETE CASCADE`. |
| `meeting_id` | UUID FK | References `meetings.id` with `ON DELETE CASCADE`. |
| `description` | TEXT NOT NULL | Description of the task/action item. (Named `description` instead of `task_description` in the normalized schema). |
| `due_date` | DATE | Resolved due date. |
| `due_time` | TIME | Resolved due time. |
| `raw_deadline` | VARCHAR(100) | Natural language deadline phrase. |
| `deadline_type` | VARCHAR(20) | `EXPLICIT`, `INFERRED`, `NONE`. |
| `priority` | VARCHAR(20) | `Low`, `Medium`, `High`, `Critical`. |
| `category` | VARCHAR(30) | `Action Item`, `Decision`, `Follow-up`, `Info`. |
| `status` | VARCHAR(20) | Defaults to `'Open'`. |
| `owner` | VARCHAR(255) | Raw LLM owner name string. |
| `owners_list` | JSONB | Resolved speaker names array. |
| `created_at` | TIMESTAMP | Creation timestamp. |

---

### 10. `task_assignees`
A join table mapping tasks to users.

| Column | Type | Notes |
|---|---|---|
| `task_id` | UUID FK | References `tasks.id` with `ON DELETE CASCADE`. |
| `user_id` | UUID FK | References `users.id` with `ON DELETE CASCADE`. |

- **Primary Key**: Composite PK `(task_id, user_id)`

---

### 11. `risks`
Stores potential risks discussed during the meeting.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | Auto-generated. |
| `organization_id` | UUID FK | References `organizations.id` with `ON DELETE CASCADE`. |
| `meeting_id` | UUID FK | References `meetings.id` with `ON DELETE CASCADE`. |
| `description` | TEXT NOT NULL | Detailed explanation of the risk. |
| `severity` | VARCHAR(20) | `Low`, `Medium`, `High`, `Critical`. |
| `created_at` | TIMESTAMP | Creation timestamp. |

---

## Indexing Structure
High-speed lookup index optimizations are created as B-Tree structures:
- `idx_users_org_id` on `users(organization_id)`
- `idx_teams_org_id` on `teams(organization_id)`
- `idx_meetings_org_id` on `meetings(organization_id)`
- `idx_tasks_org_id` on `tasks(organization_id)`
- `idx_risks_org_id` on `risks(organization_id)`
- `idx_team_members_team_id` on `team_members(team_id)`
- `idx_meeting_teams_team_id` on `meeting_teams(team_id)`
- `idx_meeting_teams_meeting_id` on `meeting_teams(meeting_id)`
- `idx_meeting_participants_meeting_id` on `meeting_participants(meeting_id)`
- `idx_tasks_meeting_id` on `tasks(meeting_id)`
- `idx_risks_meeting_id` on `risks(meeting_id)`
- `idx_meetings_content_hash` on `meetings(content_hash)`
