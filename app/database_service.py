import datetime
import json
import logging
from typing import List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from urllib.parse import urlparse

from app.database_session import engine, async_session_factory, DATABASE_URL
from app.utils.owner_parser import resolve_owners

logger = logging.getLogger(__name__)



# Database initialisation


async def create_database_if_not_exists():
    url = urlparse(DATABASE_URL)
    db_name = url.path.lstrip("/")

    # Use a parameterised existence check to avoid any injection risk on the
    # db_name; CREATE DATABASE cannot be parameterised so we validate manually.
    if not db_name.replace("_", "").replace("-", "").isalnum():
        raise ValueError(f"Unexpected database name format: '{db_name}'")

    base_url = DATABASE_URL.rsplit("/", 1)[0] + "/postgres"
    temp_engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")

    async with temp_engine.connect() as conn:
        result = await conn.execute(
            text("SELECT 1 FROM pg_database WHERE datname = :name"),
            {"name": db_name},
        )
        if not result.scalar():
            logger.info(f"Database '{db_name}' does not exist. Creating it automatically…")
            # db_name is already validated as alphanumeric + _ + -
            await conn.execute(text(f'CREATE DATABASE "{db_name}"'))
            logger.info(f"Database '{db_name}' created successfully.")

    await temp_engine.dispose()


async def init_db():
    await create_database_if_not_exists()

    async with engine.begin() as conn:
        # meetings 
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS meetings (
                id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                title          VARCHAR(255) NOT NULL,
                file_name      VARCHAR(255) NOT NULL,
                content_hash   VARCHAR(64)  UNIQUE NOT NULL,
                upload_date    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
                meeting_date   DATE         NULL,
                summary        TEXT         NULL,
                raw_transcript TEXT
            );
        """))

        # Safe migration: add summary column if it doesn't exist (for existing DBs)
        await conn.execute(text("""
            ALTER TABLE meetings ADD COLUMN IF NOT EXISTS summary TEXT NULL;
        """))

        # tasks 
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tasks (
                id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                meeting_id       UUID        REFERENCES meetings(id) ON DELETE CASCADE,
                task_description TEXT        NOT NULL,
                owner            VARCHAR(255) DEFAULT 'Unassigned',
                owners_list      JSONB       DEFAULT '[]'::jsonb,
                due_date         DATE        NULL,
                due_time         TIME        NULL,
                raw_deadline     VARCHAR(100) NULL,
                deadline_type    VARCHAR(20)  CHECK (deadline_type IN ('EXPLICIT', 'INFERRED', 'NONE')),
                priority         VARCHAR(20)  CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
                category         VARCHAR(30)  CHECK (category IN ('Action Item', 'Decision', 'Follow-up', 'Info')),
                status           VARCHAR(20)  DEFAULT 'Open',
                created_at       TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
            );
        """))

        # risks 
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS risks (
                id               UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
                meeting_id       UUID       REFERENCES meetings(id) ON DELETE CASCADE,
                risk_description TEXT       NOT NULL,
                severity         VARCHAR(20) CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
                created_at       TIMESTAMP  DEFAULT CURRENT_TIMESTAMP
            );
        """))

    logger.info("Database tables initialised successfully.")



# Idempotency check
async def check_hash_exists(content_hash: str) -> bool:
    async with async_session_factory() as session:
        result = await session.execute(
            text("SELECT 1 FROM meetings WHERE content_hash = :hash LIMIT 1"),
            {"hash": content_hash},
        )
        return result.scalar() is not None



# Save / persist
async def save_meeting(
    title: str,
    file_name: str,
    content_hash: str,
    raw_transcript: str,
    meeting_date: Optional[datetime.date] = None,
) -> str:
    async with async_session_factory() as session:
        result = await session.execute(
            text("""
                INSERT INTO meetings (title, file_name, content_hash, raw_transcript, meeting_date)
                VALUES (:title, :file_name, :hash, :transcript, :meeting_date)
                RETURNING id
            """),
            {
                "title": title,
                "file_name": file_name,
                "hash": content_hash,
                "transcript": raw_transcript,
                "meeting_date": meeting_date,
            },
        )
        meeting_id = result.scalar()
        await session.commit()
        return str(meeting_id)


async def save_extracted_data(meeting_id: str, extracted_data: dict):
    """
    Saves tasks and risks in a fully transactional manner.
    Also persists the meeting_summary on the parent meeting row.
    If any insert fails the entire transaction rolls back.
    """
    speakers: List[str] = extracted_data.get("speakers", [])
    summary: str = extracted_data.get("meeting_summary", "")
    today = datetime.date.today()

    async with async_session_factory() as session:
        async with session.begin():
            # ── persist meeting summary ───────────────────────────────────
            if summary:
                await session.execute(
                    text("UPDATE meetings SET summary = :summary WHERE id = :id"),
                    {"summary": summary, "id": meeting_id},
                )

            # ── tasks ──────────────────────────────────────────────────────
            for task in extracted_data.get("tasks", []):
                raw_due  = task.get("due_date")
                raw_time = task.get("due_time")

                # Parse due_date
                due_date = None
                if raw_due:
                    try:
                        due_date = datetime.date.fromisoformat(str(raw_due))
                    except (ValueError, TypeError):
                        logger.warning(f"Could not parse due_date '{raw_due}', defaulting to today.")
                        due_date = today

                # Parse due_time (keep as None if LLM returned nothing)
                due_time = None
                if raw_time:
                    try:
                        parts = str(raw_time).strip().split(":")
                        due_time = datetime.time(int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)
                    except (ValueError, TypeError, IndexError):
                        logger.warning(f"Could not parse due_time '{raw_time}', will apply defaults.")

                # Apply backend defaults (bug #2 and #3 fix):
                # • due_time set but due_date null → default due_date to today
                # • due_date set but due_time null → default due_time to 17:00 (EOD)
                # • both null → leave both null (no artificial deadline)
                if due_time is not None and due_date is None:
                    due_date = today
                elif due_date is not None and due_time is None:
                    due_time = datetime.time(17, 0)

                # Resolve owner string → list of speaker identifiers
                owner_str: str = task.get("owner", "Unassigned")
                owners_list: List[str] = resolve_owners(owner_str, speakers)

                await session.execute(
                    text("""
                        INSERT INTO tasks
                            (meeting_id, task_description, owner, owners_list,
                             due_date, due_time, raw_deadline, deadline_type, priority, category)
                        VALUES
                            (:meeting_id, :task_desc, :owner, CAST(:owners_list AS JSONB),
                             :due_date, :due_time, :raw_deadline, :deadline_type, :priority, :category)
                    """),
                    {
                        "meeting_id": meeting_id,
                        "task_desc": task.get("task_description"),
                        "owner": owner_str,
                        "owners_list": json.dumps(owners_list),
                        "due_date": due_date,
                        "due_time": due_time,
                        "raw_deadline": task.get("raw_deadline"),
                        "deadline_type": task.get("deadline_type", "NONE"),
                        "priority": task.get("priority", "Medium"),
                        "category": task.get("category", "Info"),
                    },
                )

            #  risks 
            for risk in extracted_data.get("risks", []):
                await session.execute(
                    text("""
                        INSERT INTO risks (meeting_id, risk_description, severity)
                        VALUES (:meeting_id, :risk_desc, :severity)
                    """),
                    {
                        "meeting_id": meeting_id,
                        "risk_desc": risk.get("risk_description"),
                        "severity": risk.get("severity", "Medium"),
                    },
                )


async def delete_meeting(meeting_id: str):
    """Hard-delete a meeting row (cascades to tasks/risks).  Used for rollback."""
    async with async_session_factory() as session:
        await session.execute(
            text("DELETE FROM meetings WHERE id = :id"),
            {"id": meeting_id},
        )
        await session.commit()



# Queries


async def get_all_meetings():
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT id, title, file_name, upload_date, meeting_date, summary "
                "FROM meetings ORDER BY upload_date DESC"
            )
        )
        return [dict(row) for row in result.mappings().all()]


async def get_all_tasks(meeting_id: str = None):
    query = (
        "SELECT id, meeting_id, task_description, owner, owners_list, "
        "due_date, due_time, raw_deadline, deadline_type, priority, category, status, created_at "
        "FROM tasks"
    )
    params = {}
    if meeting_id:
        query += " WHERE meeting_id = :meeting_id"
        params["meeting_id"] = meeting_id
    query += " ORDER BY created_at DESC"

    async with async_session_factory() as session:
        result = await session.execute(text(query), params)
        return [dict(row) for row in result.mappings().all()]


async def get_meeting_by_id(meeting_id: str):
    """Fetch a single meeting row including raw_transcript."""
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT id, title, file_name, content_hash, upload_date, "
                "meeting_date, raw_transcript FROM meetings WHERE id = :id"
            ),
            {"id": meeting_id},
        )
        row = result.mappings().first()
        return dict(row) if row else None


async def get_all_risks(meeting_id: str = None):
    query = (
        "SELECT id, meeting_id, risk_description, severity, created_at "
        "FROM risks"
    )
    params = {}
    if meeting_id:
        query += " WHERE meeting_id = :meeting_id"
        params["meeting_id"] = meeting_id
    query += " ORDER BY created_at DESC"

    async with async_session_factory() as session:
        result = await session.execute(text(query), params)
        return [dict(row) for row in result.mappings().all()]


async def update_task_status(task_id: str, status: str):
    async with async_session_factory() as session:
        await session.execute(
            text("UPDATE tasks SET status = :status WHERE id = :id"),
            {"status": status, "id": task_id},
        )
        await session.commit()


async def execute_dynamic_query(filters: dict):
    target_table = filters.get("target_table", "tasks")
    meeting_id   = filters.get("meeting_id")
    owner_name   = filters.get("owner_name")
    priority     = filters.get("priority")
    status_filter = filters.get("status")
    is_open_only = filters.get("is_open_only", False)

    if target_table not in ("tasks", "risks", "meetings"):
        target_table = "tasks"

    query  = f"SELECT * FROM {target_table} WHERE 1=1"
    params: dict = {}

    # meeting_id filter (all tables have meeting_id except meetings itself)
    if meeting_id and target_table in ("tasks", "risks"):
        query += " AND meeting_id = :meeting_id"
        params["meeting_id"] = meeting_id

    if owner_name and target_table == "tasks":
        # Search both the raw owner string and the JSONB owners_list.
        # Use CAST(...) instead of ::text to avoid clashing with SQLAlchemy's :param syntax.
        query += (
            " AND (owner ILIKE :owner_name "
            "OR CAST(owners_list AS TEXT) ILIKE :owner_name)"
        )
        params["owner_name"] = f"%{owner_name}%"

    if priority and target_table in ("tasks", "risks"):
        col = "priority" if target_table == "tasks" else "severity"
        query += f" AND {col} = :priority"
        params["priority"] = priority

    if status_filter and target_table == "tasks":
        query += " AND status = :status"
        params["status"] = status_filter

    if is_open_only and target_table == "tasks":
        query += " AND status = 'Open'"

    async with async_session_factory() as session:
        result = await session.execute(text(query), params)
        rows = []
        for row in result.mappings().all():
            row_dict = {}
            for k, v in dict(row).items():
                row_dict[k] = str(v) if v is not None else None
            rows.append(row_dict)
        return rows