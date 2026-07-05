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
from pydantic import BaseModel, Field
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
)
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
    status: str = Field(..., pattern="^(Open|Closed)$", description="New status: 'Open' or 'Closed'")


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
        result = await process_natural_language_query(request.question, organization_id)
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