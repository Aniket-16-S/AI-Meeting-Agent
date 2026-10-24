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
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

load_dotenv()
RAW_DATABASE_URL = os.getenv("DATABASE_URL")

if not RAW_DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. "
        "Please add it to your .env file, e.g.:\n"
        "  DATABASE_URL=postgresql+asyncpg://postgres@localhost:5432/meeting_agent"
    )


def normalize_database_url(url_str: str) -> str:
    """
    Normalise database URL to work reliably with SQLAlchemy + asyncpg:
    1. Converts driver schemes (postgres:// or postgresql://) to postgresql+asyncpg://
    2. Translates libpq parameters (e.g. sslmode=require) to asyncpg parameter (ssl=require)
    3. Strips query parameters unsupported by asyncpg (e.g. channel_binding, gssencmode)
    """
    if not url_str:
        return url_str

    parsed = urlparse(url_str)
    scheme = parsed.scheme

    if scheme in ("postgres", "postgresql"):
        scheme = "postgresql+asyncpg"
    elif scheme == "postgresql+psycopg2":
        scheme = "postgresql+asyncpg"

    query_params = parse_qs(parsed.query, keep_blank_values=True)
    flat_params = {k: v[0] if len(v) == 1 else v for k, v in query_params.items()}

    # Map libpq sslmode to asyncpg ssl
    if "sslmode" in flat_params:
        sslmode_val = flat_params.pop("sslmode")
        if sslmode_val != "disable":
            flat_params["ssl"] = sslmode_val

    # asyncpg connect() does not accept channel_binding or gssencmode
    unsupported_params = ["channel_binding", "gssencmode"]
    for param in unsupported_params:
        flat_params.pop(param, None)

    # For Neon DB or other cloud providers requiring SSL by default
    if "ssl" not in flat_params and "neon.tech" in (parsed.hostname or ""):
        flat_params["ssl"] = "require"

    new_query = urlencode(flat_params, doseq=True)
    return urlunparse(parsed._replace(scheme=scheme, query=new_query))


DATABASE_URL = normalize_database_url(RAW_DATABASE_URL)

parsed_url = urlparse(DATABASE_URL)
is_pooler = "pooler" in (parsed_url.hostname or "") or "neon.tech" in (parsed_url.hostname or "")

connect_args = {
    "server_settings": {
        "statement_timeout": "60000",  # 60 s per statement max
    },
    "command_timeout": 60,  # asyncpg-level timeout per command (seconds)
}

if is_pooler:
    # Disable asyncpg's statement cache to avoid prepared statement mismatch errors with PgBouncer
    connect_args["statement_cache_size"] = 0
else:
    # On direct PostgreSQL connections (e.g. Docker), OS TCP keepalive settings prevent idle drops
    connect_args["server_settings"].update({
        "tcp_keepalives_idle":     "60",   # seconds idle before first probe
        "tcp_keepalives_interval": "10",   # seconds between probes
        "tcp_keepalives_count":    "5",    # probes before declaring dead
    })


engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    # ── Pool sizing ───────────────────────────────────────────────────────────
    # Smaller pool = fewer idle connections that can go stale in Docker/PgBouncer.
    pool_size=10,
    max_overflow=20,
    pool_timeout=30,           # seconds to wait for a connection from the pool
    # ── Stale-connection prevention ───────────────────────────────────────────
    pool_pre_ping=True,        # ping the DB before using a pooled connection
    pool_recycle=300,          # recycle connections every 5 minutes
    connect_args=connect_args,
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
