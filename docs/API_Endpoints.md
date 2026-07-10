# API Endpoints & Contracts

This document explains the API endpoints available in the AI Meeting Agent and their contracts.

All endpoints require multi-tenant context parameters (`organization_id`, `uploaded_by`, `team_id`) passed as query parameters or payload properties, reflecting the normalized database schema structure.

---

## 1. Meeting Upload & Management

### `POST /upload`
Uploads one or more meeting transcript files (e.g. `.txt`, `.pdf`, `.vtt`) and processes them under a tenant organization.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required): The ID of the organization uploading the meeting.
  - `uploaded_by` (UUID string, Required): The user ID of the person uploading the transcript.
  - `team_id` (UUID string, Optional): The team ID to associate this meeting with.
- **Request Body**: `multipart/form-data` with a list of `files`.
- **Response**:
  ```json
  {
    "results": [
      {
        "filename": "sprint_review.txt",
        "status": "accepted",
        "meeting_id": "8f86cf5b-7b24-4f05-b040-cfc6c4c95a09"
      }
    ]
  }
  ```

---

### `GET /meetings`
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

### `GET /meetings/{meeting_id}`
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

### `GET /meetings/{meeting_id}/status`
Retrieves the processing status of a specific meeting.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required)
- **Response**:
  ```json
  {
    "status": "COMPLETED" // Or PENDING, PROCESSING, FAILED
  }
  ```

---

### `DELETE /meetings/{meeting_id}`
Permanently deletes a meeting and all its related tasks, risks, and transcripts.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required)
- **Response**:
  ```json
  {
    "success": true,
    "message": "Meeting and all related data permanently deleted"
  }
  ```

---

## 2. Tasks & Risks Management

### `GET /tasks`
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
        "description": "Implement docker-compose script",
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

### `PUT /tasks/{task_id}/status`
Updates the status of a specific task.

- **Request Body**:
  ```json
  {
    "status": "Closed" // Accepted: 'Open', 'In Progress', 'Closed'
  }
  ```
- **Response**:
  ```json
  {
    "status": "success",
    "message": "Task status updated to 'Closed'"
  }
  ```

---

### `DELETE /tasks/bulk`
Permanently deletes multiple completed/unneeded tasks in bulk.

- **Request Body**:
  ```json
  {
    "task_ids": ["c1f7a0dc-3221-49e0-8a7e-4148eb84a3db"]
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "deleted_count": 1,
    "message": "1 task(s) permanently deleted"
  }
  ```

---

### `GET /risks`
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
        "description": "Connecting to RabbitMQ during database setup might timeout if RabbitMQ container starts late",
        "severity": "Medium",
        "created_at": "2026-07-04T16:30:05"
      }
    ]
  }
  ```

---

## 3. Natural Language Query Agent

### `POST /query`
Performs a semantic natural language query against the organization's database records using LLM processing.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required): Restricts the AI Query Agent's lookups strictly to this organization's records.
- **Request Body**:
  ```json
  {
    "question": "Are there any critical tasks or risks?",
    "user_name": "Speaker A" // Optional, resolves 'my tasks' references
  }
  ```
- **Response**:
  ```json
  {
    "filters_applied": {
      "target_table": "tasks",
      "priority": "Critical",
      "status": null,
      "is_open_only": false
    },
    "database_results": [],
    "answer": "There are currently no critical tasks or risks found in the records for your organization."
  }
  ```

---

## 4. Auth & Organization Management

### `POST /auth/login`
Authenticates a user and returns their organization, active department, and peer listings.

- **Request Body**:
  ```json
  {
    "email": "admin@ekamvistar.com",
    "password": "securepassword"
  }
  ```
- **Response**:
  ```json
  {
    "user": {
      "id": "2d1b7d59-3fb9-444a-a979-3c97ea0ea9c7",
      "name": "Jane Doe",
      "email": "admin@ekamvistar.com",
      "role": "admin",
      "organizationId": "50cfa820-21a4-4a0f-ba10-09e4ee84a6c2",
      "departmentId": "48b0a9cd-324b-4c4f-9a11-0987efc92134"
    },
    "organization": {
      "id": "50cfa820-21a4-4a0f-ba10-09e4ee84a6c2",
      "name": "EkamVistar"
    },
    "department": {
      "id": "48b0a9cd-324b-4c4f-9a11-0987efc92134",
      "name": "Engineering",
      "organizationId": "50cfa820-21a4-4a0f-ba10-09e4ee84a6c2"
    },
    "users": [ ... ],
    "departments": [ ... ]
  }
  ```

---

### `POST /auth/register`
Registers a new tenant organization with an initial admin user and department.

- **Request Body**:
  ```json
  {
    "org_name": "EkamVistar",
    "admin_name": "Jane Doe",
    "admin_email": "admin@ekamvistar.com",
    "admin_password": "securepassword",
    "department_name": "Engineering"
  }
  ```
- **Response**: Similar structure to `POST /auth/login`.

---

### `POST /departments`
Creates a new department/team in an organization.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required)
- **Request Body**:
  ```json
  {
    "name": "Product Development"
  }
  ```
- **Response**:
  ```json
  {
    "id": "48b0a9cd-324b-4c4f-9a11-0987efc92134",
    "name": "Product Development",
    "organizationId": "50cfa820-21a4-4a0f-ba10-09e4ee84a6c2"
  }
  ```

---

### `POST /departments/{dept_id}/meetings`
Links a meeting record to a department.

- **Request Body**:
  ```json
  {
    "meeting_id": "8f86cf5b-7b24-4f05-b040-cfc6c4c95a09"
  }
  ```
- **Response**:
  ```json
  {
    "status": "success"
  }
  ```

---

### `GET /departments/{dept_id}/meetings`
Lists all meeting IDs associated with a department.

- **Response**:
  ```json
  {
    "meeting_ids": ["8f86cf5b-7b24-4f05-b040-cfc6c4c95a09"]
  }
  ```

---

### `POST /users`
Creates a new employee/admin user within an organization.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required)
- **Request Body**:
  ```json
  {
    "name": "John Smith",
    "email": "john@ekamvistar.com",
    "password": "userpassword",
    "role": "employee",
    "department_id": "48b0a9cd-324b-4c4f-9a11-0987efc92134"
  }
  ```
- **Response**:
  ```json
  {
    "id": "a90f8231-1b2c-4d3e-9087-c102a98f12cb",
    "name": "John Smith",
    "email": "john@ekamvistar.com",
    "password": "userpassword",
    "role": "employee",
    "organizationId": "50cfa820-21a4-4a0f-ba10-09e4ee84a6c2",
    "departmentId": "48b0a9cd-324b-4c4f-9a11-0987efc92134"
  }
  ```

---

### `PUT /users/{user_id}/department`
Moves a user to a different department.

- **Request Body**:
  ```json
  {
    "department_id": "87fa23cd-41e9-40da-b883-9bfa0812e987"
  }
  ```
- **Response**:
  ```json
  {
    "status": "success"
  }
  ```

---

### `DELETE /users/{user_id}`
Deletes an employee user (reassigns their uploaded meetings to the admin).

- **Request Body**:
  ```json
  {
    "admin_email": "admin@ekamvistar.com",
    "password": "adminpassword"
  }
  ```
- **Response**:
  ```json
  {
    "status": "success"
  }
  ```

---

### `DELETE /departments/{dept_id}`
Deletes a department.

- **Request Body**:
  ```json
  {
    "admin_email": "admin@ekamvistar.com",
    "password": "adminpassword"
  }
  ```
- **Response**:
  ```json
  {
    "status": "success"
  }
  ```

---

## 5. Google Calendar & Google Meet Integration

### `GET /auth/google/login`
Starts the Google OAuth 2.0 flow for calendar integration by returning a redirect response to Google's consent screen.

- **Request Query Parameters**:
  - `user_id` (UUID string, Required): The user authorizing the integration.
- **Response**: Redirect to Google Authorization URL.

---

### `GET /auth/google/callback`
Receives the OAuth authorization code from Google, exchanges it for access/refresh tokens, and updates the user's Google connection.

- **Request Query Parameters**:
  - `code` (string, Required): Auth code.
  - `state` (string, Required): Maps back to the `user_id`.
- **Response**: HTML success card that auto-closes the popup.

---

### `GET /google/status`
Checks the current connection status of the user with Google Calendar.

- **Request Query Parameters**:
  - `user_id` (UUID string, Required)
- **Response**:
  ```json
  {
    "connected": true,
    "email": "user@gmail.com"
  }
  ```

---

### `POST /meetings/google`
Schedules a Google Meet video conference, creates the event in Google Calendar, and saves the record locally.

- **Request Query Parameters**:
  - `user_id` (UUID string, Required)
  - `organization_id` (UUID string, Required)
- **Request Body**:
  ```json
  {
    "title": "Sync on Architecture Docs",
    "description": "Align on database and API specifications",
    "start": "2026-07-15T14:00:00",
    "end": "2026-07-15T15:00:00",
    "timezone": "America/New_York",
    "attendees": ["team@ekamvistar.com"]
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "meeting": {
      "id": "e58fb23c-910a-4bf3-a00d-9fb4e08219c8",
      "title": "Sync on Architecture Docs",
      "description": "Align on database and API specifications",
      "meet_link": "https://meet.google.com/abc-defg-hij",
      "start": "2026-07-15T14:00:00",
      "end": "2026-07-15T15:00:00",
      "timezone": "America/New_York",
      "attendees": ["team@ekamvistar.com"]
    }
  }
  ```

---

### `DELETE /meetings/google/{meeting_id}`
Cancels a Google Meet meeting, removing it from Google Calendar and marking it as `cancelled` locally.

- **Response**:
  ```json
  {
    "success": true,
    "message": "Meeting successfully cancelled"
  }
  ```

---

### `GET /meetings/google/latest`
Retrieves all active, upcoming scheduled Google Meet meetings for a user.

- **Request Query Parameters**:
  - `organization_id` (UUID string, Required)
  - `user_id` (UUID string, Required)
- **Response**:
  ```json
  {
    "meetings": [
      {
        "id": "e58fb23c-910a-4bf3-a00d-9fb4e08219c8",
        "meeting_title": "Sync on Architecture Docs",
        "google_meet_link": "https://meet.google.com/abc-defg-hij",
        "meeting_start_time": "2026-07-15T14:00:00Z",
        "meeting_end_time": "2026-07-15T15:00:00Z",
        "timezone": "America/New_York",
        "status": "scheduled",
        "attendees": ["team@ekamvistar.com"]
      }
    ]
  }
  ```

---

## 6. System Utility

### `GET /health`
Returns system status.

- **Response**:
  ```json
  {
    "status": "ok",
    "version": "0.0.1"
  }
  ```
