# API Endpoints

This document provides a short explanation of the API endpoints available in the AI Meeting Agent.

## `POST /upload`
- **Description**: Uploads one or more meeting transcript files (e.g., .txt, .pdf, .vtt).
- **Process**:
  1. Hashes the file to prevent duplicate processing (idempotency).
  2. Extracts raw text using the appropriate parser based on the file extension.
  3. Saves the meeting metadata and raw transcript to the PostgreSQL database.
  5. **Transactional Persistence (Phase 3)**: Safely saves all extracted tasks and risks directly into the SQL tables using an all-or-nothing transaction.
- **Request Body**: `multipart/form-data` with a list of `files`.
- Response: Returns a JSON object containing a `results` array. Each item in the array includes the filename, processing status, the `meeting_id` from the database, and the `extracted_data` (summary, speakers, tasks, risks) if processing was successful. Each task in `tasks` contains a resolved `due_date` and `due_time` (defaulting to EOD `17:00`).

## GET /meetings
- **Description**: Retrieves a list of all parsed and stored meetings.
- **Process**: Queries the `meetings` table ordered by upload date (most recent first).
- **Response**: Returns a JSON object with a `meetings` array containing meeting metadata (id, title, file_name, upload_date).

## GET /tasks
- **Description**: Retrieves a list of actionable tasks.
- **Query Parameters**:
  - `meeting_id` (optional): Filters tasks by a specific meeting.
- **Response**: Returns a JSON object with a `tasks` array containing the task details, including `due_time` (HH:MM format).

## `POST /query`
- **Description**: Processes a natural language question (Semantic Filter Extraction) to query the database.
- **Process**:
  1. The LLM translates the natural language question into a structured JSON `SearchFilters` schema.
  2. The Python backend safely dynamically builds and executes the parameterized PostgreSQL query.
  3. A second LLM pass translates the raw SQL results into a human-readable answer.
- **Request Body**: JSON payload: `{ "question": "Show me all critical risks and high priority tasks for John" }`
- **Response**: Returns a JSON object containing `filters_applied`, `database_results` (the raw rows), and `answer` (the AI's natural language response).
