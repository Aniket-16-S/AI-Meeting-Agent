"""
app/fastapi_routes.py
---------------------
All HTTP API endpoints for the AI Meeting Agent.

Fixes applied
─────────────
- ``update_task_status_route``: replaced ``payload: dict`` (which FastAPI
  cannot deserialise from a JSON body) with a proper Pydantic BaseModel.
  The old signature caused a 422 Unprocessable Entity on every "Mark
  Complete" click.
- Upload route: added retry logic for transient database connection errors
  (ConnectionResetError 104 from asyncpg inside Docker). The first-time
  upload now retries the save_meeting() call up to 3 times with exponential
  back-off before returning an error to the client.
- Idempotency: if a hash-matched meeting is still in PROCESSING/PENDING it
  is re-queued to RabbitMQ (handles cases where the original publish failed).
- All write sessions use ``async with session.begin()`` for atomicity.
"""

import asyncio
import logging
import uuid
from typing import List, Optional

import bcrypt
from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import RedirectResponse, HTMLResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.database_session import async_session_factory
from app.database_service import (
    add_meeting_team_association,
    delete_meeting,
    get_all_meetings,
    get_all_risks,
    get_all_tasks,
    get_meeting_by_id,
    get_meeting_id_by_hash,
    save_meeting,
    update_task_status,
    get_user_google_status,
    get_user_google_refresh_token,
    update_user_google_connection,
    save_google_meeting,
    get_google_meeting_by_id,
    update_google_meeting_status,
    get_active_google_meetings,
)
from app.google_calendar_service import GoogleCalendarService, CLIENT_ID as GOOGLE_CLIENT_ID
from google.oauth2 import id_token
from google.auth.transport import requests as auth_requests
import os
import zoneinfo
import re
import datetime
from app.llm_service import extract_meeting_data
from app.query_service import process_natural_language_query
from app.schema import QueryRequest
from app.utils.hasher import generate_file_hash
from app.utils.rabbitmq import publish_to_processing_queue
from app.utils.text_parser import extract_text

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Transient DB error types that are safe to retry ──────────────────────────
# asyncpg raises plain ConnectionResetError / OSError when the underlying
# TCP connection is dropped by Docker's NAT.  SQLAlchemy wraps these in
# OperationalError.  We retry these automatically so a first-time upload
# doesn't fail just because of a momentary connection hiccup.
_TRANSIENT_DB_ERRORS = (ConnectionResetError, OSError, OperationalError)


async def _save_meeting_with_retry(
    *,
    title: str,
    file_name: str,
    content_hash: str,
    raw_transcript: str,
    organization_id: str,
    uploaded_by: str,
    team_id: str | None,
    max_retries: int = 3,
    base_delay: float = 0.5,
) -> str:
    """
    Call ``save_meeting()`` with automatic retries on transient connection errors.

    Retries up to *max_retries* times with exponential back-off:
      attempt 1 → immediate
      attempt 2 → 0.5 s delay
      attempt 3 → 1.0 s delay
    After all retries are exhausted the last exception is re-raised.
    """
    last_exc: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            return await save_meeting(
                title=title,
                file_name=file_name,
                content_hash=content_hash,
                raw_transcript=raw_transcript,
                organization_id=organization_id,
                uploaded_by=uploaded_by,
                team_id=team_id,
            )
        except _TRANSIENT_DB_ERRORS as exc:
            last_exc = exc
            if attempt < max_retries:
                delay = base_delay * (attempt)  # 0.5s, 1.0s
                logger.warning(
                    "save_meeting transient error (attempt %d/%d), retrying in %.1fs: %s",
                    attempt, max_retries, delay, exc,
                )
                await asyncio.sleep(delay)
            else:
                logger.error(
                    "save_meeting failed after %d attempts: %s", max_retries, exc, exc_info=True
                )
    raise last_exc  # type: ignore[misc]


# ── File upload ───────────────────────────────────────────────────────────────

@router.post("/upload", summary="Upload meeting transcript files")
async def upload_files(
    response: Response,
    files: List[UploadFile] = File(...),
    organization_id: str = Query(...),
    uploaded_by: str = Query(...),
    team_id: Optional[str] = Query(None),
):
    results = []
    has_new = False

    for file in files:
        content = await file.read()
        content_hash = generate_file_hash(content)

        # Idempotency check — re-use existing meeting if transcript is a duplicate
        existing_id = await get_meeting_id_by_hash(content_hash)
        if existing_id:
            if team_id:
                try:
                    await add_meeting_team_association(existing_id, team_id)
                except Exception as exc:
                    logger.error("Failed to add team association: %s", exc)

            # Check if this meeting is still stuck in PROCESSING/PENDING
            # (e.g. original RabbitMQ publish failed due to a connection reset).
            # If so, re-queue it so the worker can pick it up.
            try:
                existing_meeting = await get_meeting_by_id(existing_id, organization_id)
                stuck_statuses = ("PROCESSING", "PENDING")
                if existing_meeting and existing_meeting.get("status") in stuck_statuses:
                    logger.info(
                        "Meeting %s found with status '%s' — re-queuing for processing.",
                        existing_id, existing_meeting["status"]
                    )
                    await publish_to_processing_queue(existing_id)
                    has_new = True
                    results.append({"filename": file.filename, "status": "accepted", "meeting_id": existing_id})
                    continue
            except Exception as exc:
                logger.warning("Could not check status of existing meeting %s: %s", existing_id, exc)

            results.append({"filename": file.filename, "status": "linked", "meeting_id": existing_id})
            continue

        # Parse raw text from the uploaded file
        try:
            raw_text = extract_text(file.filename, content)
        except ValueError as exc:
            results.append({"filename": file.filename, "status": "error", "reason": str(exc)})
            continue

        # Step 1: Persist meeting + transcript (with automatic retry on transient errors)
        try:
            meeting_id = await _save_meeting_with_retry(
                title=file.filename,
                file_name=file.filename,
                content_hash=content_hash,
                raw_transcript=raw_text,
                organization_id=organization_id,
                uploaded_by=uploaded_by,
                team_id=team_id,
            )
        except Exception as exc:
            logger.error("Failed to save meeting '%s' after retries: %s", file.filename, exc, exc_info=True)
            results.append({
                "filename": file.filename,
                "status": "error",
                "reason": f"Database error: {exc}",
            })
            continue

        # Step 2: Publish to queue (separate try so DB save is not rolled back on queue failure)
        try:
            await publish_to_processing_queue(meeting_id)
        except Exception as exc:
            logger.error(
                "Meeting '%s' saved (id=%s) but failed to publish to queue: %s — "
                "it will remain in PROCESSING until re-uploaded.",
                file.filename, meeting_id, exc, exc_info=True,
            )

        has_new = True
        results.append({"filename": file.filename, "status": "accepted", "meeting_id": meeting_id})

    response.status_code = status.HTTP_202_ACCEPTED if has_new else status.HTTP_200_OK
    return {"results": results}


# ── Meetings ──────────────────────────────────────────────────────────────────

@router.get("/meetings", summary="List all meetings for an organisation")
async def get_meetings(organization_id: str = Query(...)):
    meetings = await get_all_meetings(organization_id)
    return {"meetings": meetings}


@router.get("/meetings/{meeting_id}", summary="Get a single meeting by ID")
async def get_meeting(meeting_id: str, organization_id: str = Query(...)):
    meeting = await get_meeting_by_id(meeting_id, organization_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {"meeting": meeting}


@router.get("/meetings/{meeting_id}/status", summary="Get a meeting's processing status")
async def get_meeting_status(meeting_id: str, organization_id: str = Query(...)):
    meeting = await get_meeting_by_id(meeting_id, organization_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {"status": meeting.get("status", "PENDING")}


# ── Tasks ─────────────────────────────────────────────────────────────────────

@router.get("/tasks", summary="List tasks for an organisation (optionally filtered by meeting)")
async def get_tasks(
    organization_id: str = Query(...),
    meeting_id: Optional[str] = Query(None),
):
    tasks = await get_all_tasks(organization_id, meeting_id)
    return {"tasks": tasks}


class UpdateTaskStatusRequest(BaseModel):
    """Request body for the task-status PATCH endpoint."""
    status: str = Field(..., pattern="^(Open|Closed|In Progress)$", description="New status: 'Open', 'In Progress', or 'Closed'")


@router.put("/tasks/{task_id}/status", summary="Update a task's Open/Closed status")
async def update_task_status_route(task_id: str, payload: UpdateTaskStatusRequest):
    """
    Toggle a task between Open and Closed.

    Previously this accepted ``payload: dict`` which FastAPI cannot parse from
    a JSON body, causing a 422 on every call.  Now uses a typed Pydantic model.
    """
    try:
        await update_task_status(task_id, payload.status)
        return {"status": "success", "message": f"Task status updated to '{payload.status}'"}
    except Exception as exc:
        logger.error("Failed to update task %s: %s", task_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Risks ─────────────────────────────────────────────────────────────────────

@router.get("/risks", summary="List risks for an organisation (optionally filtered by meeting)")
async def get_risks(
    organization_id: str = Query(...),
    meeting_id: Optional[str] = Query(None),
):
    risks = await get_all_risks(organization_id, meeting_id)
    return {"risks": risks}


# ── Query agent ───────────────────────────────────────────────────────────────

@router.post("/query", summary="Ask a natural-language question about meeting data")
async def query_agent(request: QueryRequest, organization_id: str = Query(...)):
    try:
        result = await process_natural_language_query(request.question, organization_id, request.user_name)
        return result
    except Exception as exc:
        logger.error("Query agent failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


# ── Auth & Organisation Management ───────────────────────────────────────────

class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    org_name: str
    admin_name: str
    admin_email: str
    admin_password: str
    department_name: str


class CreateDepartmentRequest(BaseModel):
    name: str


class CreateUserRequest(BaseModel):
    name: str
    email: str
    password: str
    role: str
    department_id: str


class UpdateUserDepartmentRequest(BaseModel):
    department_id: str


class LinkMeetingRequest(BaseModel):
    meeting_id: str


# ── Helper: build a user dict from a DB row ───────────────────────────────────

async def _resolve_user_dept(session, user_id) -> str | None:
    """Return the team_id (as str) for a user, or None."""
    res = await session.execute(
        text("SELECT team_id FROM team_members WHERE user_id = :uid LIMIT 1"),
        {"uid": user_id},
    )
    val = res.scalar()
    return str(val) if val else None


def _user_dict(u, dept_id: str | None) -> dict:
    return {
        "id": str(u["id"]),
        "name": f"{u['f_name']} {u['l_name']}".strip(),
        "email": u["email"],
        "password": u["password"],
        "role": u["role"],
        "organizationId": str(u["organization_id"]),
        "departmentId": dept_id,
    }


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/auth/login", summary="Authenticate a user and return session data")
async def login_route(payload: LoginRequest):
    async with async_session_factory() as session:
        # 1. Fetch user by email
        res = await session.execute(
            text(
                "SELECT id, f_name, l_name, email, password_hash, role, organization_id "
                "FROM users WHERE email = :email"
            ),
            {"email": payload.email},
        )
        user = res.mappings().first()
        if not user:
            raise HTTPException(status_code=400, detail="Invalid email or password")

        # 2. Verify password (bcrypt with plaintext fallback for dev seeds)
        try:
            valid = bcrypt.checkpw(
                payload.password.encode("utf-8"),
                user["password_hash"].encode("utf-8"),
            )
        except ValueError:
            # Legacy plaintext password stored during early development
            valid = user["password_hash"] == payload.password

        if not valid:
            raise HTTPException(status_code=400, detail="Invalid email or password")

        org_id = user["organization_id"]
        user_id = user["id"]

        # 3. Organisation name
        res_org = await session.execute(
            text("SELECT name FROM organizations WHERE id = :id"),
            {"id": org_id},
        )
        org_row = res_org.mappings().first()
        org_name = org_row["name"] if org_row else "Unknown Organisation"

        # 4. Logged-in user's active department (first team membership)
        dept_id = await _resolve_user_dept(session, user_id)
        dept_row = None
        if dept_id:
            res_dept = await session.execute(
                text("SELECT id, name, organization_id FROM teams WHERE id = :id"),
                {"id": uuid.UUID(dept_id)},
            )
            dept_row = res_dept.mappings().first()

        # 5. All departments in the organisation
        res_depts = await session.execute(
            text("SELECT id, name, organization_id FROM teams WHERE organization_id = :oid"),
            {"oid": org_id},
        )
        depts_list = [
            {"id": str(r["id"]), "name": r["name"], "organizationId": str(r["organization_id"])}
            for r in res_depts.mappings().all()
        ]

        # 6. All users in the organisation (with their departments)
        res_users = await session.execute(
            text(
                "SELECT id, f_name, l_name, email, password_hash AS password, "
                "role, organization_id FROM users WHERE organization_id = :oid"
            ),
            {"oid": org_id},
        )
        users_raw = res_users.mappings().all()
        users_list = []
        for u in users_raw:
            u_dept = await _resolve_user_dept(session, u["id"])
            users_list.append(_user_dict(u, u_dept))

        return {
            "user": {
                "id": str(user_id),
                "name": f"{user['f_name']} {user['l_name']}".strip(),
                "email": user["email"],
                "role": user["role"],
                "organizationId": str(org_id),
                "departmentId": dept_id,
            },
            "organization": {"id": str(org_id), "name": org_name},
            "department": {
                "id": str(dept_row["id"]),
                "name": dept_row["name"],
                "organizationId": str(dept_row["organization_id"]),
            } if dept_row else None,
            "users": users_list,
            "departments": depts_list,
        }


# ── Register organisation ─────────────────────────────────────────────────────

@router.post("/auth/register", status_code=201, summary="Register a new organisation with an admin user")
async def register_route(payload: RegisterRequest):
    async with async_session_factory() as session:
        async with session.begin():
            # Guard: unique email
            res = await session.execute(
                text("SELECT 1 FROM users WHERE email = :email LIMIT 1"),
                {"email": payload.admin_email},
            )
            if res.scalar():
                raise HTTPException(status_code=400, detail="Email is already registered")

            org_id = uuid.uuid4()
            dept_id = uuid.uuid4()
            admin_id = uuid.uuid4()

            # Insert organisation
            await session.execute(
                text("INSERT INTO organizations (id, name) VALUES (:id, :name)"),
                {"id": org_id, "name": payload.org_name},
            )

            # Insert initial department (team)
            await session.execute(
                text(
                    "INSERT INTO teams (id, organization_id, name, description) "
                    "VALUES (:id, :oid, :name, :desc)"
                ),
                {
                    "id": dept_id,
                    "oid": org_id,
                    "name": payload.department_name,
                    "desc": f"{payload.department_name} department",
                },
            )

            # Split name
            name_parts = payload.admin_name.strip().split(None, 1)
            f_name = name_parts[0] if name_parts else ""
            l_name = name_parts[1] if len(name_parts) > 1 else ""

            hashed_pw = bcrypt.hashpw(
                payload.admin_password.encode("utf-8"), bcrypt.gensalt()
            ).decode("utf-8")

            # Insert admin user
            await session.execute(
                text(
                    "INSERT INTO users (id, organization_id, f_name, l_name, email, password_hash, role) "
                    "VALUES (:id, :oid, :f, :l, :email, :pw, 'admin'::user_role)"
                ),
                {
                    "id": admin_id,
                    "oid": org_id,
                    "f": f_name,
                    "l": l_name,
                    "email": payload.admin_email,
                    "pw": hashed_pw,
                },
            )

            # Link admin → department
            await session.execute(
                text("INSERT INTO team_members (team_id, user_id) VALUES (:tid, :uid)"),
                {"tid": dept_id, "uid": admin_id},
            )

        # Re-fetch for correct response format (outside the begin() block)
        res_depts = await session.execute(
            text("SELECT id, name, organization_id FROM teams WHERE organization_id = :oid"),
            {"oid": org_id},
        )
        depts_list = [
            {"id": str(r["id"]), "name": r["name"], "organizationId": str(r["organization_id"])}
            for r in res_depts.mappings().all()
        ]

        res_users = await session.execute(
            text(
                "SELECT id, f_name, l_name, email, password_hash AS password, "
                "role, organization_id FROM users WHERE organization_id = :oid"
            ),
            {"oid": org_id},
        )
        users_raw = res_users.mappings().all()
        users_list = []
        for u in users_raw:
            u_dept = await _resolve_user_dept(session, u["id"])
            users_list.append(_user_dict(u, u_dept))

        return {
            "user": {
                "id": str(admin_id),
                "name": payload.admin_name,
                "email": payload.admin_email,
                "role": "admin",
                "organizationId": str(org_id),
                "departmentId": str(dept_id),
            },
            "organization": {"id": str(org_id), "name": payload.org_name},
            "department": {
                "id": str(dept_id),
                "name": payload.department_name,
                "organizationId": str(org_id),
            },
            "users": users_list,
            "departments": depts_list,
        }


# ── Departments ───────────────────────────────────────────────────────────────

@router.post("/departments", summary="Create a new department (team) in an organisation")
async def create_department_route(
    payload: CreateDepartmentRequest,
    organization_id: str = Query(...),
):
    async with async_session_factory() as session:
        async with session.begin():
            dept_id = uuid.uuid4()
            await session.execute(
                text(
                    "INSERT INTO teams (id, organization_id, name, description) "
                    "VALUES (:id, :oid, :name, '')"
                ),
                {"id": dept_id, "oid": uuid.UUID(organization_id), "name": payload.name},
            )
    return {"id": str(dept_id), "name": payload.name, "organizationId": organization_id}


@router.post("/departments/{dept_id}/meetings", summary="Link a meeting to a department")
async def link_meeting_to_department_route(dept_id: str, payload: LinkMeetingRequest):
    async with async_session_factory() as session:
        async with session.begin():
            await session.execute(
                text(
                    "INSERT INTO meeting_teams (meeting_id, team_id) "
                    "VALUES (:mid, :tid) ON CONFLICT DO NOTHING"
                ),
                {"mid": uuid.UUID(payload.meeting_id), "tid": uuid.UUID(dept_id)},
            )
    return {"status": "success"}


@router.get("/departments/{dept_id}/meetings", summary="List meeting IDs linked to a department")
async def get_department_meetings_route(dept_id: str):
    async with async_session_factory() as session:
        res = await session.execute(
            text("SELECT meeting_id FROM meeting_teams WHERE team_id = :tid"),
            {"tid": uuid.UUID(dept_id)},
        )
        meeting_ids = [str(row[0]) for row in res.all()]
    return {"meeting_ids": meeting_ids}


# ── Users ─────────────────────────────────────────────────────────────────────

@router.post("/users", summary="Create a new user in an organisation")
async def create_user_route(
    payload: CreateUserRequest,
    organization_id: str = Query(...),
):
    async with async_session_factory() as session:
        async with session.begin():
            # Guard: unique email
            res = await session.execute(
                text("SELECT 1 FROM users WHERE email = :email LIMIT 1"),
                {"email": payload.email},
            )
            if res.scalar():
                raise HTTPException(status_code=400, detail="A user with this email already exists")

            user_id = uuid.uuid4()
            name_parts = payload.name.strip().split(None, 1)
            f_name = name_parts[0] if name_parts else ""
            l_name = name_parts[1] if len(name_parts) > 1 else ""
            db_role = "admin" if payload.role == "admin" else "employee"

            hashed_pw = bcrypt.hashpw(
                payload.password.encode("utf-8"), bcrypt.gensalt()
            ).decode("utf-8")

            await session.execute(
                text(
                    "INSERT INTO users (id, organization_id, f_name, l_name, email, password_hash, role) "
                    "VALUES (:id, :oid, :f, :l, :email, :pw, CAST(:role AS user_role))"
                ),
                {
                    "id": user_id,
                    "oid": uuid.UUID(organization_id),
                    "f": f_name,
                    "l": l_name,
                    "email": payload.email,
                    "pw": hashed_pw,
                    "role": db_role,
                },
            )
            await session.execute(
                text("INSERT INTO team_members (team_id, user_id) VALUES (:tid, :uid)"),
                {"tid": uuid.UUID(payload.department_id), "uid": user_id},
            )

    return {
        "id": str(user_id),
        "name": payload.name,
        "email": payload.email,
        "password": payload.password,          # return raw pw so UI can cache it
        "role": db_role,
        "organizationId": organization_id,
        "departmentId": payload.department_id,
    }


@router.put("/users/{user_id}/department", summary="Move a user to a different department")
async def update_user_department_route(user_id: str, payload: UpdateUserDepartmentRequest):
    async with async_session_factory() as session:
        async with session.begin():
            await session.execute(
                text("DELETE FROM team_members WHERE user_id = :uid"),
                {"uid": uuid.UUID(user_id)},
            )
            await session.execute(
                text("INSERT INTO team_members (team_id, user_id) VALUES (:tid, :uid)"),
                {"tid": uuid.UUID(payload.department_id), "uid": uuid.UUID(user_id)},
            )
    return {"status": "success"}


class DeleteRequest(BaseModel):
    admin_email: str
    password: str


@router.delete("/users/{user_id}", summary="Delete an employee user")
async def delete_user_route(user_id: str, payload: DeleteRequest):
    admin_email = payload.admin_email
    password = payload.password

    async with async_session_factory() as session:
        # 1. Fetch admin user
        res_admin = await session.execute(
            text(
                "SELECT id, password_hash, role, organization_id "
                "FROM users WHERE email = :email"
            ),
            {"email": admin_email},
        )
        admin = res_admin.mappings().first()
        if not admin or admin["role"] != "admin":
            raise HTTPException(status_code=403, detail="Unauthorized: Only admins can delete users")

        # Verify password
        try:
            valid = bcrypt.checkpw(
                password.encode("utf-8"),
                admin["password_hash"].encode("utf-8"),
            )
        except ValueError:
            valid = admin["password_hash"] == password

        if not valid:
            raise HTTPException(status_code=400, detail="Invalid admin password")

        # 2. Check target user
        user_uuid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        res_user = await session.execute(
            text("SELECT organization_id FROM users WHERE id = :id"),
            {"id": user_uuid},
        )
        target_user = res_user.mappings().first()
        if not target_user:
            raise HTTPException(status_code=404, detail="User not found")
        if target_user["organization_id"] != admin["organization_id"]:
            raise HTTPException(status_code=403, detail="Unauthorized to delete users in other organizations")

        # 3. Handle ON DELETE RESTRICT on meetings (re-assign uploaded meetings to admin)
        await session.execute(
            text("UPDATE meetings SET uploaded_by = :admin_id WHERE uploaded_by = :user_id"),
            {"admin_id": admin["id"], "user_id": user_uuid},
        )
        # Delete user
        await session.execute(
            text("DELETE FROM users WHERE id = :id"),
            {"id": user_uuid},
        )
        await session.commit()

    return {"status": "success"}


@router.delete("/departments/{dept_id}", summary="Delete a department")
async def delete_department_route(dept_id: str, payload: DeleteRequest):
    admin_email = payload.admin_email
    password = payload.password

    async with async_session_factory() as session:
        # 1. Fetch admin user
        res_admin = await session.execute(
            text(
                "SELECT password_hash, role, organization_id "
                "FROM users WHERE email = :email"
            ),
            {"email": admin_email},
        )
        admin = res_admin.mappings().first()
        if not admin or admin["role"] != "admin":
            raise HTTPException(status_code=403, detail="Unauthorized: Only admins can delete departments")

        # Verify password
        try:
            valid = bcrypt.checkpw(
                password.encode("utf-8"),
                admin["password_hash"].encode("utf-8"),
            )
        except ValueError:
            valid = admin["password_hash"] == password

        if not valid:
            raise HTTPException(status_code=400, detail="Invalid admin password")

        # 2. Check target department (team)
        dept_uuid = uuid.UUID(dept_id) if isinstance(dept_id, str) else dept_id
        res_dept = await session.execute(
            text("SELECT organization_id FROM teams WHERE id = :id"),
            {"id": dept_uuid},
        )
        target_dept = res_dept.mappings().first()
        if not target_dept:
            raise HTTPException(status_code=404, detail="Department not found")
        if target_dept["organization_id"] != admin["organization_id"]:
            raise HTTPException(status_code=403, detail="Unauthorized to delete departments in other organizations")

        # 3. Delete department
        await session.execute(
            text("DELETE FROM teams WHERE id = :id"),
            {"id": dept_uuid},
        )
        await session.commit()

    return {"status": "success"}


# ── Google Meet Integration Endpoints ─────────────────────────────────────────

class CreateGoogleMeetingRequest(BaseModel):
    title: str = Field(..., description="Meeting title")
    description: Optional[str] = Field(None, description="Meeting description")
    start: str = Field(..., description="ISO 8601 start time")
    end: str = Field(..., description="ISO 8601 end time")
    timezone: str = Field(..., description="IANA timezone name")
    attendees: List[str] = Field(..., description="List of attendee email addresses")

    @model_validator(mode="after")
    def validate_inputs(self):
        try:
            zoneinfo.ZoneInfo(self.timezone)
        except Exception:
            raise ValueError("Invalid timezone database identifier")

        try:
            start_dt = datetime.datetime.fromisoformat(self.start)
        except Exception:
            raise ValueError("Invalid start date/time format. Use ISO 8601")
        try:
            end_dt = datetime.datetime.fromisoformat(self.end)
        except Exception:
            raise ValueError("Invalid end date/time format. Use ISO 8601")

        if end_dt <= start_dt:
            raise ValueError("End date/time must be strictly after start date/time")

        if not self.attendees:
            raise ValueError("At least one attendee is required")

        email_regex = r"^[^@]+@[^@]+\.[^@]+$"
        cleaned_emails = []
        for email in self.attendees:
            email = email.strip()
            if not email:
                continue
            if not re.match(email_regex, email):
                raise ValueError(f"Invalid email address: {email}")
            cleaned_emails.append(email)

        unique_emails = list(dict.fromkeys(cleaned_emails))
        if len(unique_emails) < 1:
            raise ValueError("At least one valid unique attendee is required")

        self.attendees = unique_emails
        return self


@router.get("/auth/google/login", summary="Start Google OAuth Connect flow")
async def google_login(user_id: str = Query(...)):
    status_dict = await get_user_google_status(user_id)
    if status_dict.get("connected"):
        return RedirectResponse("http://localhost:3000/")

    auth_url = GoogleCalendarService.get_authorization_url(user_id)
    return RedirectResponse(auth_url)


@router.get("/auth/google/callback", summary="Receive Google OAuth authorization code")
async def google_callback(code: str = Query(...), state: str = Query(...)):
    try:
        tokens = GoogleCalendarService.exchange_code(code)
        refresh_token = tokens.get("refresh_token")
        id_token_jwt = tokens.get("id_token")

        id_info = id_token.verify_oauth2_token(
            id_token_jwt,
            auth_requests.Request(),
            GOOGLE_CLIENT_ID
        )
        google_email = id_info.get("email")

        # Save the tokens
        await update_user_google_connection(
            user_id=state,
            refresh_token=refresh_token,
            email=google_email
        )

        html_content = """
        <!DOCTYPE html>
        <html>
        <head>
            <title>Google Connection Successful</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                    background-color: #0f0f13;
                    color: #f3f4f6;
                    text-align: center;
                }
                .card {
                    background: #181823;
                    border: 1px solid #2a2b3d;
                    padding: 40px;
                    border-radius: 16px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                }
                h1 { color: #22c55e; margin-bottom: 8px; }
                p { color: #9ca3af; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="card">
                <h1>Connection Successful!</h1>
                <p>Google Calendar has been successfully connected.</p>
                <p>This window will close automatically.</p>
            </div>
            <script>
                try {
                    if (window.opener) {
                        window.opener.postMessage("google-connected", "*");
                    }
                } catch (e) {
                    console.error("Failed to post message", e);
                }
                setTimeout(function() {
                    window.close();
                }, 1500);
            </script>
        </body>
        </html>
        """
        return HTMLResponse(content=html_content)
    except Exception as exc:
        logger.error("Google OAuth callback failed: %s", exc)
        raise HTTPException(status_code=400, detail=f"OAuth callback failed: {exc}")


@router.get("/google/status", summary="Check connection status with Google")
async def google_status(user_id: str = Query(...)):
    status_dict = await get_user_google_status(user_id)
    return status_dict


@router.post("/meetings/google", summary="Schedule a Google Meet meeting")
async def create_google_meeting_route(
    payload: CreateGoogleMeetingRequest,
    user_id: str = Query(...),
    organization_id: str = Query(...)
):
    refresh_token = await get_user_google_refresh_token(user_id)
    if not refresh_token:
        raise HTTPException(
            status_code=400,
            detail="Google account not connected. Please complete Google OAuth authorization."
        )

    try:
        # Schedule via Calendar Service
        created = GoogleCalendarService.create_meeting(
            refresh_token=refresh_token,
            title=payload.title,
            description=payload.description,
            start_time=payload.start,
            end_time=payload.end,
            timezone=payload.timezone,
            attendees=payload.attendees
        )

        event_id = created.get("id")
        meet_link = created.get("hangoutLink")

        if not meet_link:
            entry_points = created.get("conferenceData", {}).get("entryPoints", [])
            for ep in entry_points:
                if ep.get("entryPointType") == "video" or "meet.google.com" in ep.get("uri", ""):
                    meet_link = ep.get("uri")
                    break

        if not meet_link:
            meet_link = created.get("htmlLink", "")

        # Parse times for db insert
        start_time_dt = datetime.datetime.fromisoformat(payload.start)
        end_time_dt = datetime.datetime.fromisoformat(payload.end)

        # Store locally
        meeting_id = await save_google_meeting(
            organization_id=organization_id,
            created_by_user_id=user_id,
            title=payload.title,
            description=payload.description,
            google_calendar_event_id=event_id,
            google_meet_link=meet_link,
            start_time=start_time_dt,
            end_time=end_time_dt,
            timezone=payload.timezone,
            attendees=payload.attendees
        )

        return {
            "success": True,
            "meeting": {
                "id": meeting_id,
                "title": payload.title,
                "description": payload.description,
                "meet_link": meet_link,
                "start": payload.start,
                "end": payload.end,
                "timezone": payload.timezone,
                "attendees": payload.attendees
            }
        }
    except Exception as exc:
        logger.error("Failed to create Google Meet meeting: %s", exc)
        raise HTTPException(status_code=500, detail=f"Google API Error: {exc}")


@router.delete("/meetings/google/{meeting_id}", summary="Cancel a Google Meet meeting")
async def cancel_google_meeting_route(meeting_id: str):
    meeting = await get_google_meeting_by_id(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    creator_user_id = meeting["created_by_user_id"]
    refresh_token = await get_user_google_refresh_token(creator_user_id)
    if not refresh_token:
        raise HTTPException(
            status_code=400,
            detail="Creator user's Google Calendar is not connected. Unable to cancel Google event."
        )

    try:
        # Delete from Google Calendar
        GoogleCalendarService.cancel_meeting(
            refresh_token=refresh_token,
            calendar_event_id=meeting["google_calendar_event_id"]
        )

        # Update local db status to cancelled
        await update_google_meeting_status(meeting_id, "cancelled")

        return {"success": True, "message": "Meeting successfully cancelled"}
    except Exception as exc:
        logger.error("Failed to cancel Google Meet meeting: %s", exc)
        await update_google_meeting_status(meeting_id, "cancelled")
        return {"success": True, "message": f"Meeting status set to cancelled locally. Google sync error: {exc}"}


@router.get("/meetings/google/latest", summary="Get all active upcoming scheduled Google Meet meetings")
async def get_latest_google_meetings_route(
    organization_id: str = Query(...),
    user_id: str = Query(...)
):
    meetings = await get_active_google_meetings(organization_id, user_id)
    return {"meetings": meetings}