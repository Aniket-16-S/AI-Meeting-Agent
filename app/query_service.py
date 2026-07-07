"""
app/query_service.py
--------------------
LangGraph-powered natural language query agent.

Uses Groq (llama-3.3-70b-versatile) with a read-only PostgreSQL tool.

Key design decisions
─────────────────────
- Organization isolation: every query is validated server-side via a
  contextvars token so the LLM cannot bypass tenant boundaries.
- Read-only enforcement: the SQLAlchemy connection is opened with
  ``execution_options(postgresql_readonly=True)`` instead of issuing a
  raw ``SET TRANSACTION READ ONLY`` statement (which fails when called
  inside an already-started transaction block).
- Colon escaping: SQLAlchemy's ``text()`` treats ``:name`` as a named
  bind parameter.  Because the LLM writes raw UUID literals directly in
  the SQL string (e.g. ``WHERE id = '550e…'``), no bind params are used
  and therefore no colon-escaping is required.  The previous
  ``query.replace(":", "\\:")`` was actively mangling UUID literals that
  happen to appear after a colon (rare but possible) and produced
  ``\\;`` at statement termination.
"""

import json
import logging
import contextvars
from datetime import datetime, timezone
from typing import Annotated, TypedDict

import os
from dotenv import load_dotenv

from langchain_groq import ChatGroq
from langchain_core.messages import BaseMessage, AIMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from sqlalchemy import text

from app.database_session import async_session_factory

logger = logging.getLogger(__name__)

# ── Request-scoped tenant context ────────────────────────────────────────────
# Set once per HTTP request before invoking the graph; reset in a `finally`.
_current_org_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "current_org_id", default=None
)


# ── LangGraph state ──────────────────────────────────────────────────────────

class QueryState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


# ── Database tool ────────────────────────────────────────────────────────────

@tool
async def query_database(query: str) -> str:
    """
    Execute a read-only SQL SELECT query against the PostgreSQL database.

    Returns the result rows serialised as a JSON string, or an error message
    prefixed with "Error:" so the LLM knows to explain the failure to the user.

    Rules the LLM MUST follow:
    - Only SELECT statements are allowed.
    - Every query against a data table MUST filter by the correct organization_id.
    - Write plain SQL with single-quoted string literals — do NOT escape colons.
    """
    # ── Safety: only SELECT ──────────────────────────────────────────────────
    stripped = query.strip()
    if not stripped.upper().startswith("SELECT"):
        return "Error: Only read-only SELECT queries are permitted."

    # ── Safety: tenant isolation ─────────────────────────────────────────────
    org_id = _current_org_id.get()
    if org_id:
        lower_query = stripped.lower()
        org_id_lower = org_id.lower()
        if org_id_lower not in lower_query:
            return (
                f"Error: Every query must include a filter on "
                f"organization_id = '{org_id}' to preserve tenant isolation."
            )
        # Allow queries that target the organizations table itself (no org_id column)
        if "organizations" not in lower_query and "organization_id" not in lower_query:
            return (
                f"Error: Queries against data tables must filter by "
                f"organization_id = '{org_id}'."
            )

    try:
        # Open a read-only connection via execution_options — this is the
        # correct SQLAlchemy way; issuing SET TRANSACTION READ ONLY inside an
        # open session.begin() block is a PostgreSQL protocol error.
        async with async_session_factory() as session:
            # Pass execution_options directly to session.execute() as AsyncSession
            # doesn't expose execution_options as a method on the session object itself.
            result = await session.execute(
                text(stripped),
                execution_options={"postgresql_readonly": True}
            )

            if result.returns_rows:
                rows = result.mappings().all()
                serialisable = [
                    {k: (str(v) if v is not None else None) for k, v in dict(row).items()}
                    for row in rows
                ]
                return json.dumps(serialisable, default=str)

            return "Query executed successfully but returned no rows."

    except Exception as exc:
        logger.error("Database query execution failed: %s", exc, exc_info=True)
        return f"Error executing query: {exc}"


# ── System prompt builder ────────────────────────────────────────────────────

def _build_system_prompt(organization_id: str, user_name: str = None) -> str:
    now = datetime.now(tz=timezone.utc).astimezone()
    if user_name:
        first_name = user_name.split()[0] if user_name else ""
        user_context = (
            f"\n\nIMPORTANT CONTEXT: The user asking this query is named '{user_name}'. "
            f"Note that transcripts and task owners often record only their first name '{first_name}'. "
            f"If they ask for 'my tasks' or tasks assigned to them, ALWAYS filter where "
            f"`owner ILIKE '%{user_name}%'` OR `owner ILIKE '%{first_name}%'` OR "
            f"`CAST(owners_list AS TEXT) ILIKE '%{user_name}%'` OR `CAST(owners_list AS TEXT) ILIKE '%{first_name}%'`."
        )
    else:
        user_context = ""
    return (
        "You are an AI meeting assistant with read-only access to a PostgreSQL database. "
        "Your goal is to answer the user's natural language questions by querying the "
        "database using the `query_database` tool, then summarising the results.\n\n"
        f"Today is {now.strftime('%A, %Y-%m-%d')}. "
        f"Current time: {now.strftime('%H:%M %Z')}.\n"
        f"You are strictly authorised to view data for organisation_id = '{organization_id}'. "
        f"EVERY SQL query you write MUST contain a filter: "
        f"``organization_id = '{organization_id}'``."
        f"{user_context}\n\n"
        "DATABASE SCHEMA:\n"
        "1. `organizations` — id (UUID PK), name (VARCHAR)\n"
        "2. `users` — id, organization_id (FK), f_name, l_name, email, role (user_role enum: 'admin'|'employee')\n"
        "3. `teams` — id, organization_id (FK), name, description\n"
        "4. `team_members` — team_id (FK), user_id (FK) [composite PK]\n"
        "5. `meetings` — id, organization_id (FK), uploaded_by (FK→users.id), title, file_name,\n"
        "   content_hash, created_at (TIMESTAMP), meeting_date (DATE), summary (TEXT),\n"
        "   status (meeting_status enum: 'PENDING'|'PROCESSING'|'COMPLETED'|'FAILED')\n"
        "6. `meeting_teams` — meeting_id (FK), team_id (FK) [composite PK]\n"
        "7. `meeting_transcripts` — meeting_id (PK FK), raw_transcript (TEXT), is_processed (BOOLEAN)\n"
        "8. `meeting_participants` — id, meeting_id (FK), user_id (FK nullable), speaker_name (VARCHAR)\n"
        "9. `tasks` — id, organization_id (FK), meeting_id (FK), description (TEXT), owner (VARCHAR),\n"
        "   owners_list (JSONB), due_date (DATE), due_time (TIME), raw_deadline (VARCHAR),\n"
        "   deadline_type ('EXPLICIT'|'INFERRED'|'NONE'), priority ('Low'|'Medium'|'High'|'Critical'),\n"
        "   category ('Action Item'|'Decision'|'Follow-up'|'Info'), status (VARCHAR, default 'Open'),\n"
        "   created_at (TIMESTAMP)\n"
        "10. `task_assignees` — task_id (FK), user_id (FK) [composite PK]\n"
        "11. `risks` — id, organization_id (FK), meeting_id (FK), description (TEXT),\n"
        "    severity ('Low'|'Medium'|'High'|'Critical'), created_at (TIMESTAMP)\n\n"
        "SQL RULES:\n"
        f"- ALWAYS filter by `organization_id = '{organization_id}'` for any data table.\n"
        "- Use only SELECT statements — never INSERT, UPDATE, DELETE, or DDL.\n"
        "- Use ILIKE for case-insensitive text matching.\n"
        "- To search JSONB `owners_list`, use: CAST(owners_list AS TEXT) ILIKE '%name%'\n"
        "- To join tasks with a user by name: "
        "JOIN task_assignees ta ON ta.task_id = tasks.id JOIN users u ON u.id = ta.user_id\n"
        "- Write plain SQL with single-quoted string literals. "
        "Do NOT escape colons or use backslashes in the query string.\n"
        "- If results are empty or contain an error, explain clearly to the user.\n"
        "- Use current date context to resolve relative queries "
        "('tasks due today' → due_date = current date, etc.).\n"
        "- DO NOT include the 'organization_id', 'id', 'content_hash', or 'category' columns in your SELECT queries unless explicitly asked for."
    )


# ── LangGraph nodes ──────────────────────────────────────────────────────────

async def _llm_node(state: QueryState) -> dict:
    """Call the Groq LLM with current message history."""
    logger.debug("LangGraph: llm_node entered.")
    load_dotenv(override=True)
    api_key = os.getenv("groq")
    if not api_key:
        raise ValueError("The 'groq' environment variable (Groq API key) is not set.")

    llm = ChatGroq(
        model="llama-3.3-70b-versatile",
        api_key=api_key,
        temperature=0,
        max_retries=2,
    )
    response = await llm.bind_tools([query_database]).ainvoke(state["messages"])
    logger.debug("LangGraph: llm_node completed.")
    return {"messages": [response]}


async def _tool_node(state: QueryState) -> dict:
    """Execute any tool calls requested by the LLM."""
    logger.debug("LangGraph: tool_node entered.")
    last = state["messages"][-1]
    results: list[ToolMessage] = []

    if isinstance(last, AIMessage) and last.tool_calls:
        for call in last.tool_calls:
            if call["name"] == "query_database":
                sql = call["args"].get("query", "")
                logger.info("Executing SQL: %s", sql)
                output = await query_database.ainvoke(sql)
                results.append(
                    ToolMessage(
                        content=output,
                        tool_call_id=call["id"],
                        name=call["name"],
                    )
                )

    logger.debug("LangGraph: tool_node completed.")
    return {"messages": results}


def _should_call_tools(state: QueryState) -> str:
    last = state["messages"][-1]
    if isinstance(last, AIMessage) and last.tool_calls:
        return "tool_node"
    return END


# ── Build & compile graph (once at import time) ───────────────────────────────

_workflow = StateGraph(QueryState)
_workflow.add_node("llm_node", _llm_node)
_workflow.add_node("tool_node", _tool_node)
_workflow.set_entry_point("llm_node")
_workflow.add_conditional_edges("llm_node", _should_call_tools, {"tool_node": "tool_node", END: END})
_workflow.add_edge("tool_node", "llm_node")

query_graph = _workflow.compile()


# ── Public entry-point ───────────────────────────────────────────────────────

async def process_natural_language_query(question: str, organization_id: str, user_name: str = None) -> dict:
    """
    Process a natural language question using the LangGraph agent.

    Returns a dict with:
        - ``answer``            – human-readable summary from the LLM
        - ``sql_queries``       – list of SQL strings the agent ran
        - ``database_results``  – raw rows returned by the DB (for the UI)
    """
    token = _current_org_id.set(organization_id)
    try:
        system_prompt = _build_system_prompt(organization_id, user_name)
        initial_messages = [
            ("system", system_prompt),
            ("user", question),
        ]

        logger.info("Running query agent for org=%s, question=%r", organization_id, question)
        final_state = await query_graph.ainvoke({"messages": initial_messages})

        # ── Extract structured output from message history ─────────────────
        sql_queries: list[str] = []
        database_results: list = []

        for msg in final_state["messages"]:
            if isinstance(msg, AIMessage) and msg.tool_calls:
                for call in msg.tool_calls:
                    if call["name"] == "query_database":
                        sql_queries.append(call["args"].get("query", ""))
            elif isinstance(msg, ToolMessage):
                try:
                    parsed = json.loads(msg.content)
                    if isinstance(parsed, list):
                        database_results.extend(parsed)
                    else:
                        database_results.append(parsed)
                except (json.JSONDecodeError, TypeError):
                    # Error strings or non-JSON responses go in verbatim
                    database_results.append(msg.content)

        final_answer = final_state["messages"][-1].content

        return {
            "answer": final_answer,
            "filters_applied": {"sql_queries": sql_queries},
            "database_results": database_results,
        }

    finally:
        _current_org_id.reset(token)
