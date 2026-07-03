
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

import os
from dotenv import load_dotenv

load_dotenv(override=True)
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. "
        "Please add it to your .env file, e.g.:\n"
        '  DATABASE_URL=postgresql+asyncpg://postgres@localhost:5432/meeting_agent'
    )

# Normalise legacy URL schemes to the asyncpg dialect
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://") and not DATABASE_URL.startswith("postgresql+asyncpg://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_size=20,
    max_overflow=40,
    pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(
    engine,
    expire_on_commit=False,
    class_=AsyncSession,
)


async def get_db() -> AsyncSession:
    """Yield one async session per HTTP request, always close it."""
    async with async_session_factory() as session:
        yield session
