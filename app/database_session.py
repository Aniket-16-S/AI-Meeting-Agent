"""
app/database_session.py
-----------------------
SQLAlchemy async engine + session factory.

Connection resilience
─────────────────────
Docker's internal bridge network can silently drop idle TCP connections,
causing asyncpg to raise:
  ``Stream connection lost: ConnectionResetError(104, 'Connection reset by peer')``

Mitigations applied here:
1. ``pool_pre_ping=True`` — test each connection before handing it out.
2. ``pool_recycle=300``  — forcibly recycle connections every 5 minutes so
   stale TCP sessions are never reused.
3. ``connect_args`` with TCP-level keepalive settings passed via asyncpg's
   ``server_settings`` — this makes PostgreSQL send periodic keepalive probes
   at the OS level, keeping the Docker NAT table entry alive.
4. Reduced ``pool_size`` + ``max_overflow`` — fewer idle connections means
   fewer opportunities for a connection to go stale.
"""

import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

load_dotenv(override=True)
DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. "
        "Please add it to your .env file, e.g.:\n"
        "  DATABASE_URL=postgresql+asyncpg://postgres@localhost:5432/meeting_agent"
    )

# Normalise legacy URL schemes to the asyncpg dialect
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql+asyncpg://", 1)
elif DATABASE_URL.startswith("postgresql://") and not DATABASE_URL.startswith("postgresql+asyncpg://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)


engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    # ── Pool sizing ───────────────────────────────────────────────────────────
    # Smaller pool = fewer idle connections that can go stale in Docker.
    pool_size=10,
    max_overflow=20,
    pool_timeout=30,           # seconds to wait for a connection from the pool
    # ── Stale-connection prevention ───────────────────────────────────────────
    pool_pre_ping=True,        # ping the DB before using a pooled connection
    pool_recycle=300,          # recycle connections every 5 minutes
    # ── asyncpg TCP keepalive ─────────────────────────────────────────────────
    # These are passed as PostgreSQL SET parameters at connection time.
    # They instruct the OS TCP stack to send keepalive probes, preventing
    # Docker's NAT from silently dropping idle connections.
    connect_args={
        "server_settings": {
            "tcp_keepalives_idle":     "60",   # seconds idle before first probe
            "tcp_keepalives_interval": "10",   # seconds between probes
            "tcp_keepalives_count":    "5",    # probes before declaring dead
            "statement_timeout":       "60000", # 60 s per statement max
        },
        "command_timeout": 60,  # asyncpg-level timeout per command (seconds)
    },
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
