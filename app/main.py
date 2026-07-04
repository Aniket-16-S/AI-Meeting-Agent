"""
app/main.py
-----------
FastAPI application entry point.

Lifespan context manager handles:
  - Startup : nothing extra needed (engine is module-level)
  - Shutdown: disposes the async connection pool gracefully
"""


from contextlib import asynccontextmanager
import warnings

from app.database_service import init_db

try :
    from requests.exceptions import RequestsDependencyWarning
    warnings.filterwarnings("ignore", category=RequestsDependencyWarning)
except ImportError:
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

version = "0.0.1"


@asynccontextmanager
async def lifespan(app:FastAPI) :
    
    await init_db()

    yield

    # nothing later to do


app = FastAPI(
    title="AI Meeting Agent",
    description=(
        "AI powered meeting agent"
    ),
    version = version ,
    lifespan= lifespan, 
    docs_url="/docs",

    redoc_url="/redoc"
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)



from app.fastapi_routes import router as api_router

routers = [api_router]

for route in routers :
    app.include_router(route)


@app.get("/health", tags=["Health"], summary="Health Check")
async def health() :
    return {"status":"ok", "version":version}
