import datetime
import json
import logging
import uuid
from typing import List, Optional
from urllib.parse import urlparse

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.database_session import engine, async_session_factory, DATABASE_URL
from app.utils.owner_parser import resolve_owners

logger = logging.getLogger(__name__)


# Database initialisation

async def create_database_if_not_exists():
    try:
        url = urlparse(DATABASE_URL)
        db_name = url.path.lstrip("/")

        # Validate db_name format
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
                await conn.execute(text(f'CREATE DATABASE "{db_name}"'))
                logger.info(f"Database '{db_name}' created successfully.")

        await temp_engine.dispose()
    except Exception as e:
        logger.warning(
            "Bypassed database creation check. This is normal on managed database "
            "platforms like Render where the database is pre-created. Error: %s", e
        )


async def init_db():
    await create_database_if_not_exists()

    async with engine.begin() as conn:
        logger.info("Creating new normalized schema...")

        # 1. organizations
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS organizations (
                id   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255)  NOT NULL
            );
        """))

        # 2. users (with role enum)
        await conn.execute(text("""
            DO $$ BEGIN
                CREATE TYPE user_role AS ENUM ('admin', 'employee');
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                f_name          VARCHAR(100),
                l_name          VARCHAR(100),
                email           VARCHAR(255)  UNIQUE NOT NULL,
                password_hash   VARCHAR(255)  NOT NULL,
                role            user_role     NOT NULL
            );
        """))

        # 3. teams
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS teams (
                id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                name            VARCHAR(255)  NOT NULL,
                description     TEXT
            );
        """))

        # 4. team_members (Composite PK)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS team_members (
                team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (team_id, user_id)
            );
        """))

        # 5. meetings (with status enum)
        await conn.execute(text("""
            DO $$ BEGIN
                CREATE TYPE meeting_status AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
            EXCEPTION
                WHEN duplicate_object THEN null;
            END $$;
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS meetings (
                id              UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                uploaded_by     UUID           NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
                title           VARCHAR(255)   NOT NULL,
                meeting_date    DATE           NULL,
                file_name       VARCHAR(255)   NOT NULL,
                content_hash    VARCHAR(64)    UNIQUE NOT NULL,
                summary         TEXT           NULL,
                status          meeting_status NOT NULL DEFAULT 'PENDING',
                created_at      TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
            );
        """))

        # 6. meeting_teams (Composite PK join table)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS meeting_teams (
                meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
                team_id    UUID REFERENCES teams(id) ON DELETE CASCADE,
                PRIMARY KEY (meeting_id, team_id)
            );
        """))

        # 7. meeting_transcripts (Separated transcript table)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS meeting_transcripts (
                meeting_id     UUID     PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
                raw_transcript TEXT     NOT NULL,
                is_processed   BOOLEAN  DEFAULT FALSE
            );
        """))

        # 8. meeting_participants
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS meeting_participants (
                id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
                meeting_id   UUID          NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                user_id      UUID          NULL REFERENCES users(id) ON DELETE SET NULL,
                speaker_name VARCHAR(255)  NOT NULL
            );
        """))

        # 9. tasks (using description, supporting original schema columns too)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS tasks (
                id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                meeting_id      UUID        NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                description     TEXT        NOT NULL,
                due_date        DATE        NULL,
                due_time        TIME        NULL,
                raw_deadline    VARCHAR(100) NULL,
                deadline_type   VARCHAR(20) CHECK (deadline_type IN ('EXPLICIT', 'INFERRED', 'NONE')),
                priority        VARCHAR(20) CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
                category        VARCHAR(30) CHECK (category IN ('Action Item', 'Decision', 'Follow-up', 'Info')),
                status          VARCHAR(20) DEFAULT 'Open',
                owner           VARCHAR(255) DEFAULT 'Unassigned',
                owners_list     JSONB       DEFAULT '[]'::jsonb,
                created_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
            );
        """))

        # 10. task_assignees (Composite PK)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS task_assignees (
                task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (task_id, user_id)
            );
        """))

        # 11. risks (using description)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS risks (
                id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
                meeting_id      UUID        NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
                description     TEXT        NOT NULL,
                severity        VARCHAR(20) CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
                created_at      TIMESTAMP   DEFAULT CURRENT_TIMESTAMP
            );
        """))

        logger.info("Creating B-Tree indexes on required lookups...")
        
        # Index on organization_id
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(organization_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_teams_org_id ON teams(organization_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_meetings_org_id ON meetings(organization_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tasks_org_id ON tasks(organization_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_risks_org_id ON risks(organization_id);"))

        # Index on team_id
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_meeting_teams_team_id ON meeting_teams(team_id);"))

        # Index on meeting_id
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_meeting_teams_meeting_id ON meeting_teams(meeting_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting_id ON meeting_participants(meeting_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_tasks_meeting_id ON tasks(meeting_id);"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_risks_meeting_id ON risks(meeting_id);"))

        # Index on content_hash
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_meetings_content_hash ON meetings(content_hash);"))

        logger.info("Database tables, indexes, and seed records initialised successfully.")


# Idempotency check
async def check_hash_exists(content_hash: str) -> bool:
    async with async_session_factory() as session:
        result = await session.execute(
            text("SELECT 1 FROM meetings WHERE content_hash = :hash LIMIT 1"),
            {"hash": content_hash},
        )
        return result.scalar() is not None


async def get_meeting_id_by_hash(content_hash: str) -> Optional[str]:
    async with async_session_factory() as session:
        result = await session.execute(
            text("SELECT id FROM meetings WHERE content_hash = :hash LIMIT 1"),
            {"hash": content_hash},
        )
        val = result.scalar()
        return str(val) if val else None


async def add_meeting_team_association(meeting_id: str, team_id: str):
    async with async_session_factory() as session:
        async with session.begin():
            await session.execute(
                text("""
                    INSERT INTO meeting_teams (meeting_id, team_id)
                    VALUES (:meeting_id, :team_id)
                    ON CONFLICT DO NOTHING
                """),
                {
                    "meeting_id": meeting_id,
                    "team_id": team_id,
                },
            )


# Save / persist
async def save_meeting(
    title: str,
    file_name: str,
    content_hash: str,
    raw_transcript: str,
    organization_id: str,
    uploaded_by: str,
    meeting_date: Optional[datetime.date] = None,
    team_id: Optional[str] = None,
) -> str:
    async with async_session_factory() as session:
        async with session.begin():
            # 1. Insert meetings row
            result = await session.execute(
                text("""
                    INSERT INTO meetings (organization_id, uploaded_by, title, file_name, content_hash, meeting_date, status)
                    VALUES (:org_id, :uploaded_by, :title, :file_name, :hash, :meeting_date, 'PROCESSING')
                    RETURNING id
                """),
                {
                    "org_id": uuid.UUID(organization_id) if isinstance(organization_id, str) else organization_id,
                    "uploaded_by": uuid.UUID(uploaded_by) if isinstance(uploaded_by, str) else uploaded_by,
                    "title": title,
                    "file_name": file_name,
                    "hash": content_hash,
                    "meeting_date": meeting_date,
                },
            )
            meeting_id = result.scalar()
            
            # 2. Insert transcript row
            await session.execute(
                text("""
                    INSERT INTO meeting_transcripts (meeting_id, raw_transcript, is_processed)
                    VALUES (:meeting_id, :transcript, FALSE)
                """),
                {
                    "meeting_id": meeting_id,
                    "transcript": raw_transcript,
                }
            )

            # 3. Associate with team if provided
            if team_id:
                await session.execute(
                    text("""
                        INSERT INTO meeting_teams (meeting_id, team_id)
                        VALUES (:meeting_id, :team_id)
                        ON CONFLICT DO NOTHING
                    """),
                    {
                        "meeting_id": meeting_id,
                        "team_id": uuid.UUID(team_id) if isinstance(team_id, str) else team_id,
                    }
                )
                
            return str(meeting_id)


async def save_extracted_data(meeting_id: str, extracted_data: dict, organization_id: str):
    """
    Saves tasks and risks in a fully transactional manner.
    Also persists the meeting_summary and sets status = 'COMPLETED' on the parent meeting row.
    If any insert fails, the entire transaction rolls back.
    """
    speakers: List[str] = extracted_data.get("speakers", [])
    summary: str = extracted_data.get("meeting_summary", "")
    today = datetime.date.today()

    async with async_session_factory() as session:
        async with session.begin():
            # ── persist meeting summary & update status ─────────────────────
            await session.execute(
                text("""
                    UPDATE meetings 
                    SET summary = :summary, status = 'COMPLETED' 
                    WHERE id = :id AND organization_id = :org_id
                """),
                {
                    "summary": summary,
                    "id": uuid.UUID(meeting_id) if isinstance(meeting_id, str) else meeting_id,
                    "org_id": uuid.UUID(organization_id) if isinstance(organization_id, str) else organization_id,
                },
            )

            # ── save speakers as participants ──────────────────────────────
            for speaker in speakers:
                await session.execute(
                    text("""
                        INSERT INTO meeting_participants (meeting_id, speaker_name)
                        VALUES (:meeting_id, :speaker)
                    """),
                    {
                        "meeting_id": meeting_id,
                        "speaker": speaker,
                    }
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

                # Parse due_time
                due_time = None
                if raw_time:
                    try:
                        parts = str(raw_time).strip().split(":")
                        due_time = datetime.time(int(parts[0]), int(parts[1]) if len(parts) > 1 else 0)
                    except (ValueError, TypeError, IndexError):
                        logger.warning(f"Could not parse due_time '{raw_time}', will apply defaults.")

                # Apply backend defaults:
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
                            (organization_id, meeting_id, description, owner, owners_list,
                             due_date, due_time, raw_deadline, deadline_type, priority, category)
                        VALUES
                            (:org_id, :meeting_id, :task_desc, :owner, CAST(:owners_list AS JSONB),
                             :due_date, :due_time, :raw_deadline, :deadline_type, :priority, :category)
                    """),
                    {
                        "org_id": organization_id,
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

            # ── risks ──────────────────────────────────────────────────────
            for risk in extracted_data.get("risks", []):
                await session.execute(
                    text("""
                        INSERT INTO risks (organization_id, meeting_id, description, severity)
                        VALUES (:org_id, :meeting_id, :risk_desc, :severity)
                    """),
                    {
                        "org_id": organization_id,
                        "meeting_id": meeting_id,
                        "risk_desc": risk.get("risk_description"),
                        "severity": risk.get("severity", "Medium"),
                    },
                )

            # Update transcript status
            await session.execute(
                text("UPDATE meeting_transcripts SET is_processed = TRUE WHERE meeting_id = :meeting_id"),
                {"meeting_id": meeting_id}
            )


async def delete_meeting(meeting_id: str):
    """Hard-delete a meeting row (cascades to transcripts/tasks/risks)."""
    async with async_session_factory() as session:
        async with session.begin():
            await session.execute(
                text("DELETE FROM meetings WHERE id = :id"),
                {"id": uuid.UUID(meeting_id) if isinstance(meeting_id, str) else meeting_id},
            )


# Queries

async def get_all_meetings(organization_id: str):
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT id, title, file_name, "
                "(created_at AT TIME ZONE 'UTC') AS created_at, "
                "(created_at AT TIME ZONE 'UTC') AS upload_date, "
                "meeting_date, summary, status "
                "FROM meetings WHERE organization_id = :org_id ORDER BY created_at DESC"
            ),
            {"org_id": organization_id}
        )
        rows = []
        for row in result.mappings().all():
            d = dict(row)
            # Ensure datetime fields are serialised as UTC ISO strings for the frontend
            for field in ("created_at", "upload_date"):
                val = d.get(field)
                if val is not None and hasattr(val, "isoformat"):
                    d[field] = (val.astimezone(datetime.timezone.utc).replace(tzinfo=None).isoformat() + "Z"
                                if val.tzinfo is not None else val.isoformat() + "Z")
            rows.append(d)
        return rows


async def get_all_tasks(organization_id: str, meeting_id: str = None):
    query = (
        "SELECT id, meeting_id, description AS task_description, owner, owners_list, "
        "due_date, due_time, raw_deadline, deadline_type, priority, category, status, "
        "(created_at AT TIME ZONE 'UTC') AS created_at "
        "FROM tasks WHERE organization_id = :org_id"
    )
    params = {"org_id": organization_id}
    if meeting_id:
        query += " AND meeting_id = :meeting_id"
        params["meeting_id"] = meeting_id
    query += " ORDER BY created_at DESC"

    async with async_session_factory() as session:
        result = await session.execute(text(query), params)
        rows = []
        for row in result.mappings().all():
            d = dict(row)
            val = d.get("created_at")
            if val is not None and hasattr(val, "isoformat"):
                d["created_at"] = (val.astimezone(datetime.timezone.utc).replace(tzinfo=None).isoformat() + "Z"
                                   if val.tzinfo is not None else val.isoformat() + "Z")
            rows.append(d)
        return rows


async def get_meeting_by_id(meeting_id: str, organization_id: str):
    """Fetch a single meeting row including raw_transcript by joining with transcripts."""
    async with async_session_factory() as session:
        result = await session.execute(
            text(
                "SELECT m.id, m.title, m.file_name, m.content_hash, "
                "(m.created_at AT TIME ZONE 'UTC') AS created_at, "
                "(m.created_at AT TIME ZONE 'UTC') AS upload_date, "
                "m.meeting_date, m.summary, m.status, t.raw_transcript "
                "FROM meetings m "
                "JOIN meeting_transcripts t ON m.id = t.meeting_id "
                "WHERE m.id = :id AND m.organization_id = :org_id"
            ),
            {"id": meeting_id, "org_id": organization_id},
        )
        row = result.mappings().first()
        if not row:
            return None
        d = dict(row)
        for field in ("created_at", "upload_date"):
            val = d.get(field)
            if val is not None and hasattr(val, "isoformat"):
                d[field] = (val.astimezone(datetime.timezone.utc).replace(tzinfo=None).isoformat() + "Z"
                            if val.tzinfo is not None else val.isoformat() + "Z")
        return d


async def get_all_risks(organization_id: str, meeting_id: str = None):
    query = (
        "SELECT id, meeting_id, description AS risk_description, severity, "
        "(created_at AT TIME ZONE 'UTC') AS created_at "
        "FROM risks WHERE organization_id = :org_id"
    )
    params = {"org_id": organization_id}
    if meeting_id:
        query += " AND meeting_id = :meeting_id"
        params["meeting_id"] = meeting_id
    query += " ORDER BY created_at DESC"

    async with async_session_factory() as session:
        result = await session.execute(text(query), params)
        rows = []
        for row in result.mappings().all():
            d = dict(row)
            val = d.get("created_at")
            if val is not None and hasattr(val, "isoformat"):
                d["created_at"] = (val.astimezone(datetime.timezone.utc).replace(tzinfo=None).isoformat() + "Z"
                                   if val.tzinfo is not None else val.isoformat() + "Z")
            rows.append(d)
        return rows


async def update_task_status(task_id: str, status: str):
    async with async_session_factory() as session:
        async with session.begin():
            await session.execute(
                text("UPDATE tasks SET status = :status WHERE id = :id"),
                {"status": status, "id": uuid.UUID(task_id) if isinstance(task_id, str) else task_id},
            )


async def execute_dynamic_query(filters: dict, organization_id: str):
    target_table = filters.get("target_table", "tasks")
    meeting_id   = filters.get("meeting_id")
    owner_name   = filters.get("owner_name")
    priority     = filters.get("priority")
    status_filter = filters.get("status")
    is_open_only = filters.get("is_open_only", False)

    if target_table not in ("tasks", "risks", "meetings"):
        target_table = "tasks"

    query  = f"SELECT * FROM {target_table} WHERE organization_id = :org_id"
    params: dict = {"org_id": organization_id}

    if meeting_id and target_table in ("tasks", "risks"):
        query += " AND meeting_id = :meeting_id"
        params["meeting_id"] = meeting_id

    if owner_name and target_table == "tasks":
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
                if k == "description":
                    if target_table == "tasks":
                        row_dict["task_description"] = str(v) if v is not None else None
                    elif target_table == "risks":
                        row_dict["risk_description"] = str(v) if v is not None else None
                else:
                    row_dict[k] = str(v) if v is not None else None
            rows.append(row_dict)
        return rows