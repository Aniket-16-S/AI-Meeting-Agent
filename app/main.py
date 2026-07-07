"""
app/main.py
-----------
FastAPI application entry point.

Lifespan context manager handles:
  - Startup : database initialisation + RabbitMQ pool
  - Shutdown : RabbitMQ pool cleanup + SQLAlchemy engine disposal

Local development note
──────────────────────
The docker-compose.yml sets DATABASE_URL to use the Docker service name
``db`` as the hostname (e.g. postgresql+asyncpg://postgres@db:5432/...).
When running **outside** Docker this hostname doesn't resolve, causing
``socket.gaierror: [Errno 11001] getaddrinfo failed`` at startup.

To run locally without Docker, override DATABASE_URL in .env:
  DATABASE_URL=postgresql+asyncpg://postgres@localhost:5432/meeting_agent
  RABBITMQ_URL=amqp://guest:guest@localhost:5672/
"""

import asyncio
import logging
import warnings
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

try:
    from requests.exceptions import RequestsDependencyWarning
    warnings.filterwarnings("ignore", category=RequestsDependencyWarning)
except ImportError:
    pass

from app.database_service import init_db

logger = logging.getLogger(__name__)
version = "0.0.1"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Database ─────────────────────────────────────────────────────────────
    await init_db()

    # ── RabbitMQ connection pool (blocking pika — run in thread executor) ────
    from app.utils.rabbitmq import rabbitmq_pool
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, rabbitmq_pool.init_pool)
        logger.info("RabbitMQ connection pool initialised.")
    except Exception as exc:
        # Non-fatal: the pool will retry on first publish attempt.
        # This also prevents a hard crash when starting locally without RabbitMQ.
        logger.warning(
            "RabbitMQ pool initialisation failed at startup (will retry on use): %s", exc
        )

    yield

    # ── Cleanup ──────────────────────────────────────────────────────────────
    try:
        await loop.run_in_executor(None, rabbitmq_pool.close_all)
    except Exception:
        pass

    from app.database_session import engine
    await engine.dispose()
    logger.info("Database connection pool disposed.")


app = FastAPI(
    title="AI Meeting Agent",
    description="AI-powered meeting transcript analysis and action-item extraction.",
    version=version,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

from app.fastapi_routes import router as api_router  # noqa: E402

app.include_router(api_router)


@app.get("/health", tags=["Health"], summary="Health Check")
async def health():
    return {"status": "ok", "version": version}
