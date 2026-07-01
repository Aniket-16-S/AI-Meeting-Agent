from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
import logging
from urllib.parse import urlparse

from app.database_session import engine, async_session_factory, DATABASE_URL

logger = logging.getLogger(__name__)

async def create_database_if_not_exists():
    url = urlparse(DATABASE_URL)
    db_name = url.path.lstrip('/')
    
    # We must connect to the default 'postgres' database to create a new one
    base_url = DATABASE_URL.rsplit('/', 1)[0] + '/postgres'
    
    # We must use AUTOCOMMIT isolation level to execute CREATE DATABASE
    temp_engine = create_async_engine(base_url, isolation_level="AUTOCOMMIT")
    async with temp_engine.connect() as conn:
        result = await conn.execute(text(f"SELECT 1 FROM pg_database WHERE datname='{db_name}'"))
        if not result.scalar():
            logger.info(f"Database '{db_name}' does not exist. Creating it automatically...")
            await conn.execute(text(f"CREATE DATABASE {db_name}"))
            logger.info(f"Database '{db_name}' created successfully.")
    
    await temp_engine.dispose()

async def init_db():
    await create_database_if_not_exists()
    async with engine.begin() as conn:
        await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS meetings (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            title              VARCHAR(255) NOT NULL,
            file_name          VARCHAR(255) NOT NULL,
            content_hash       VARCHAR(64) UNIQUE NOT NULL,
            upload_date        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            raw_transcript     TEXT
        );
        """))
        await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS tasks (
            id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
            meeting_id        UUID           REFERENCES meetings(id) ON DELETE CASCADE,
            task_description  TEXT           NOT NULL,
            owner             VARCHAR(100)   DEFAULT 'Unassigned',
            due_date          DATE           NULL,
            raw_deadline      VARCHAR(100)   NULL,
            deadline_type     VARCHAR(20)    CHECK (deadline_type IN ('EXPLICIT', 'INFERRED', 'NONE')),
            priority          VARCHAR(20)    CHECK (priority IN ('Low', 'Medium', 'High', 'Critical')),
            category          VARCHAR(30)    CHECK (category IN ('Action Item', 'Decision', 'Follow-up', 'Info')),
            status            VARCHAR(20)    DEFAULT 'Open',
            created_at        TIMESTAMP      DEFAULT CURRENT_TIMESTAMP
        );
        """))
        await conn.execute(text("""
        CREATE TABLE IF NOT EXISTS risks (
            id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
            meeting_id          UUID         REFERENCES meetings(id) ON DELETE CASCADE,
            risk_description    TEXT         NOT NULL,
            severity            VARCHAR(20)  CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
            created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
        );
        """))
    logger.info("Database tables initialized successfully.")

async def check_hash_exists(content_hash: str) -> bool:
    async with async_session_factory() as session:
        result = await session.execute(
            text("SELECT 1 FROM meetings WHERE content_hash = :hash LIMIT 1"),
            {"hash": content_hash}
        )
        return result.scalar() is not None

async def save_meeting(title: str, file_name: str, content_hash: str, raw_transcript: str) -> str:
    async with async_session_factory() as session:
        result = await session.execute(
            text("""
                INSERT INTO meetings (title, file_name, content_hash, raw_transcript)
                VALUES (:title, :file_name, :hash, :transcript)
                RETURNING id
            """),
            {
                "title": title,
                "file_name": file_name,
                "hash": content_hash,
                "transcript": raw_transcript
            }
        )
        meeting_id = result.scalar()
        await session.commit()
        return str(meeting_id)