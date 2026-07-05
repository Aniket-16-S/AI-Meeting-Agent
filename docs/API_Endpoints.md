# API Endpoints & Contracts

This document explains the API endpoints available in the AI Meeting Agent and their contracts.

All endpoints require multi-tenant context parameters (`organization_id`, `uploaded_by`, `team_id`) passed as request parameters, reflecting the new normalized database schema structure.

---

## `POST /upload`
Uploads one or more meeting transcript files (e.g. `.txt`, `.pdf`, `.vtt`) and processes them under a tenant organization.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required): The ID of the organization uploading the meeting.
  - `uploaded_by` (UUID string, Required): The user ID of the person uploading the transcript.
  - `team_id` (UUID string, Optional): The team ID to associate this meeting with.
- **Request Body**: `multipart/form-data` with a list of `files`.
- **Process**:
  1. Hashes the file to check global idempotency (returns skipped if the hash is already in the database).
  2. Extracts raw text based on the file type.
  3. Saves the meeting metadata (linking it to `organization_id` and `uploaded_by`) and inserts the transcript into the `meeting_transcripts` table.
  4. Associates the meeting with the `team_id` if provided in `meeting_teams`.
  5. Extracts tasks, risks, and participants from the transcript using LLM structured extraction.
  6. transactionally persists all extracted tasks and risks in the SQL tables, linking them to the meeting and the parent organization.
- **Response**:
  ```json
  {
    "results": [
      {
        "filename": "sprint_review.txt",
        "status": "processed",
        "meeting_id": "8f86cf5b-7b24-4f05-b040-cfc6c4c95a09",
        "extracted_data": {
          "meeting_summary": "Sprint review discussion on database schema and dockerization.",
          "speakers": ["Speaker A", "Speaker B"],
          "tasks": [
            {
              "task_description": "Implement docker-compose script",
              "owner": "Speaker A",
              "owners_list": ["Speaker A"],
              "due_date": "2026-07-05",
              "due_time": "17:00:00",
              "raw_deadline": "tomorrow EOD",
              "deadline_type": "INFERRED",
              "priority": "High",
              "category": "Action Item"
            }
          ],
          "risks": [
            {
              "risk_description": "Connecting to RabbitMQ during database setup might timeout if RabbitMQ container starts late",
              "severity": "Medium"
            }
          ]
        }
      }
    ]
  }
  ```

---

## `GET /meetings`
Retrieves a list of all parsed meetings for an organization.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required): Filters results to only meetings belonging to this organization.
- **Response**:
  ```json
  {
    "meetings": [
      {
        "id": "8f86cf5b-7b24-4f05-b040-cfc6c4c95a09",
        "title": "sprint_review.txt",
        "file_name": "sprint_review.txt",
        "upload_date": "2026-07-04T16:30:00",
        "meeting_date": "2026-07-04",
        "summary": "Sprint review discussion on database schema and dockerization.",
        "status": "COMPLETED"
      }
    ]
  }
  ```

---

## `GET /meetings/{meeting_id}`
Retrieves a single meeting record with its raw transcript text.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required): Verify organization access ownership.
- **Response**:
  ```json
  {
    "meeting": {
      "id": "8f86cf5b-7b24-4f05-b040-cfc6c4c95a09",
      "title": "sprint_review.txt",
      "file_name": "sprint_review.txt",
      "upload_date": "2026-07-04T16:30:00",
      "meeting_date": "2026-07-04",
      "summary": "Sprint review discussion on database schema and dockerization.",
      "status": "COMPLETED",
      "raw_transcript": "Speaker A: Let's build the docker-compose today. Speaker B: Sounds good."
    }
  }
  ```

---

## `GET /tasks`
Retrieves a list of actionable tasks filtered by organization and optionally by meeting.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required): Filter tasks strictly to this organization.
  - `meeting_id` (UUID string, Optional): Filter tasks to a specific meeting.
- **Response**:
  ```json
  {
    "tasks": [
      {
        "id": "c1f7a0dc-3221-49e0-8a7e-4148eb84a3db",
        "meeting_id": "8f86cf5b-7b24-4f05-b040-cfc6c4c95a09",
        "task_description": "Implement docker-compose script",
        "owner": "Speaker A",
        "owners_list": ["Speaker A"],
        "due_date": "2026-07-05",
        "due_time": "17:00:00",
        "raw_deadline": "tomorrow EOD",
        "deadline_type": "INFERRED",
        "priority": "High",
        "category": "Action Item",
        "status": "Open",
        "created_at": "2026-07-04T16:30:05"
      }
    ]
  }
  ```

---

## `PUT /tasks/{task_id}/status`
Updates the status of a specific task.

- **Request Body**:
  ```json
  {
    "status": "Closed"
  }
  ```
- **Response**:
  ```json
  {
    "status": "success",
    "message": "Task status updated to Closed"
  }
  ```

---

## `GET /risks`
Retrieves a list of identified risks filtered by organization and optionally by meeting.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required): Filter risks strictly to this organization.
  - `meeting_id` (UUID string, Optional): Filter risks to a specific meeting.
- **Response**:
  ```json
  {
    "risks": [
      {
        "id": "e67fd4c1-6b2a-436f-87da-a5742fe5c112",
        "meeting_id": "8f86cf5b-7b24-4f05-b040-cfc6c4c95a09",
        "risk_description": "Connecting to RabbitMQ during database setup might timeout if RabbitMQ container starts late",
        "severity": "Medium",
        "created_at": "2026-07-04T16:30:05"
      }
    ]
  }
  ```

---

## `POST /query`
Performs a semantic natural language query against the organization's database records.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required): Restricts the AI Query Agent's lookups strictly to this organization's records (tenancy isolation).
- **Request Body**:
  ```json
  {
    "question": "Are there any critical tasks or risks?"
  }
  ```
- **Response**:
  ```json
  {
    "filters_applied": {
      "sql_queries": [
        "SELECT id, meeting_id, description, priority, status FROM tasks WHERE organization_id = '00000000-0000-0000-0000-000000000000' AND priority = 'Critical'"
      ]
    },
    "database_results": [],
    "answer": "There are currently no critical tasks or risks found in the records for your organization."
  }
  ```
