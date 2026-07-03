import os
import logging
import json
from datetime import datetime, timezone
from typing import Annotated, TypedDict

from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.messages import BaseMessage, AIMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from sqlalchemy import text

from app.database_session import async_session_factory

logger = logging.getLogger(__name__)

# State definition
class QueryState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]


@tool
async def query_database(query: str) -> str:
    """
    Executes a SQL SELECT query against the PostgreSQL database and returns the results as a JSON string.
    Use this to fetch records from meetings, tasks, or risks tables.
    Always write read-only SELECT queries. Do not perform any write/delete operations.
    """
    cleaned_query = query.strip().lower()
    if not cleaned_query.startswith("select"):
        return "Error: Only read-only SELECT queries are allowed."
    
    try:
        async with async_session_factory() as session:
            result = await session.execute(text(query))
            if result.returns_rows:
                rows = result.mappings().all()
                serializable_rows = []
                for row in rows:
                    row_dict = {}
                    for k, v in dict(row).items():
                        row_dict[k] = str(v) if v is not None else None
                    serializable_rows.append(row_dict)
                return json.dumps(serializable_rows)
            else:
                return "Query executed successfully, but returned no rows."
    except Exception as e:
        logger.error(f"Database query execution failed: {e}")
        return f"Error executing query: {str(e)}"


def _build_query_system_prompt() -> str:
    now = datetime.now(tz=timezone.utc).astimezone()   # local system time
    day_name = now.strftime("%A")
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%H:%M")
    tz_name = now.strftime("%Z")

    return (
        "You are an AI meeting assistant with read-only access to a PostgreSQL database. "
        "Your goal is to answer the user's natural language questions by querying the database using the provided query_database tool, and summarizing the results.\n\n"
        f"Today is {day_name}, {date_str}. The current time is {time_str} {tz_name}. "
        "Use this current date/time context to resolve relative date queries (e.g., 'tasks due today' -> due_date = today's date, 'meetings from last week', etc.) in your SQL queries.\n\n"
        "DATABASE SCHEMA:\n"
        "1. Table `meetings`:\n"
        "   - `id` (UUID, PRIMARY KEY)\n"
        "   - `title` (VARCHAR(255)) - The meeting title (typically the uploaded filename)\n"
        "   - `file_name` (VARCHAR(255)) - Original filename\n"
        "   - `content_hash` (VARCHAR(64)) - Hash of the transcript to prevent duplicates\n"
        "   - `upload_date` (TIMESTAMP) - Timestamp when the meeting was uploaded\n"
        "   - `meeting_date` (DATE, NULL) - The actual date the meeting occurred\n"
        "   - `raw_transcript` (TEXT) - The full text of the meeting transcript\n\n"
        "2. Table `tasks`:\n"
        "   - `id` (UUID, PRIMARY KEY)\n"
        "   - `meeting_id` (UUID, FOREIGN KEY to `meetings.id`)\n"
        "   - `task_description` (TEXT) - Description of the action item/task\n"
        "   - `owner` (VARCHAR(255)) - Raw owner name string (e.g., 'Speaker A', 'John')\n"
        "   - `owners_list` (JSONB) - Resolved list of individual speaker identifiers, e.g. [\"John\", \"Sarah\"]\n"
        "   - `due_date` (DATE) - The resolved due date for the task\n"
        "   - `raw_deadline` (VARCHAR(100), NULL) - Raw deadline phrase spoken\n"
        "   - `deadline_type` (VARCHAR(20)) - 'EXPLICIT', 'INFERRED', or 'NONE'\n"
        "   - `priority` (VARCHAR(20)) - 'Low', 'Medium', 'High', or 'Critical'\n"
        "   - `category` (VARCHAR(30)) - 'Action Item', 'Decision', 'Follow-up', or 'Info'\n"
        "   - `status` (VARCHAR(20)) - Defaults to 'Open'\n"
        "   - `created_at` (TIMESTAMP)\n\n"
        "3. Table `risks`:\n"
        "   - `id` (UUID, PRIMARY KEY)\n"
        "   - `meeting_id` (UUID, FOREIGN KEY to `meetings.id`)\n"
        "   - `risk_description` (TEXT) - Description of the risk or issue\n"
        "   - `severity` (VARCHAR(20)) - 'Low', 'Medium', 'High', or 'Critical'\n"
        "   - `created_at` (TIMESTAMP)\n\n"
        "SQL QUERY RULES:\n"
        "- ALWAYS use read-only SELECT queries. Do not try to modify, insert, delete, or drop tables.\n"
        "- HINT ABOUT JOIN OPERATIONS: To connect tasks or risks with their parent meeting details (like meeting title or meeting date), perform a JOIN on the `meeting_id` column (e.g., `tasks.meeting_id = meetings.id` or `risks.meeting_id = meetings.id`).\n"
        "- Case-insensitive partial string matching: Use `ILIKE` for text matching where appropriate (e.g. `owner ILIKE '%john%'` or `CAST(owners_list AS TEXT) ILIKE '%john%'`).\n"
        "- JSONB Querying: Since `owners_list` is a JSONB array, you can search it using containment operators or cast it to text (e.g. `CAST(owners_list AS TEXT) ILIKE '%john%'`).\n"
        "- If the results returned from `query_database` are empty or contain an error, explain this clearly to the user.\n"
        "- Always formulate an accurate, helpful response summarizing the database query results to answer the user's question."
    )


async def llm_node(state: QueryState) -> dict:
    """Calls the Groq LLM with the list of messages in state."""
    logger.info("LangGraph: llm_node entered.")
    load_dotenv(override=True)
    groq_api_key = os.getenv("groq")
    if not groq_api_key:
        raise ValueError("The 'groq' environment variable containing the Groq API key is not set.")
    
    llm = ChatGroq(
        model="llama-3.3-70b-versatile",
        api_key=groq_api_key,
        temperature=0,
    )
    llm_with_tools = llm.bind_tools([query_database])
    response = await llm_with_tools.ainvoke(state["messages"])
    logger.info("LangGraph: llm_node execution completed.")
    return {"messages": [response]}


async def query_database_node(state: QueryState) -> dict:
    """Executes the query_database tool calls requested by the LLM."""
    logger.info("LangGraph: query_database_node entered.")
    messages = state["messages"]
    last_message = messages[-1]
    tool_messages = []
    
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        for tool_call in last_message.tool_calls:
            if tool_call["name"] == "query_database":
                query_arg = tool_call["args"].get("query")
                logger.info(f"Executing query_database tool with query: {query_arg}")
                result = await query_database.ainvoke(query_arg)
                tool_message = ToolMessage(
                    content=result,
                    tool_call_id=tool_call["id"],
                    name=tool_call["name"]
                )
                tool_messages.append(tool_message)
                
    logger.info("LangGraph: query_database_node execution completed.")
    return {"messages": tool_messages}


def route_tools(state: QueryState):
    """Router function to determine if tools should be called or if we should stop."""
    messages = state["messages"]
    last_message = messages[-1]
    if isinstance(last_message, AIMessage) and last_message.tool_calls:
        return "query_database_node"
    return END


# Build and compile graph
workflow = StateGraph(QueryState)
workflow.add_node("llm_node", llm_node)
workflow.add_node("query_database_node", query_database_node)

workflow.set_entry_point("llm_node")
workflow.add_conditional_edges(
    "llm_node",
    route_tools,
    {
        "query_database_node": "query_database_node",
        END: END
    }
)
workflow.add_edge("query_database_node", "llm_node")

query_graph = workflow.compile()


async def process_natural_language_query(question: str) -> dict:
    """
    Takes a natural language question, passes it through the LangGraph-based agent
    which calls Groq to decide if a query is needed. The Groq agent will use the
    query_database tool to extract results, and then formulate a natural language
    response.
    """
    system_prompt = _build_query_system_prompt()
    messages = [
        ("system", system_prompt),
        ("user", question),
    ]
    
    logger.info(f"Running LangGraph agent for question: {question}")
    state = await query_graph.ainvoke({"messages": messages})
    
    sql_queries = []
    database_results = []
    
    for msg in state["messages"]:
        if isinstance(msg, AIMessage) and msg.tool_calls:
            for tool_call in msg.tool_calls:
                if tool_call["name"] == "query_database":
                    sql_queries.append(tool_call["args"].get("query"))
        elif isinstance(msg, ToolMessage):
            try:
                data_list = json.loads(msg.content)
                if isinstance(data_list, list):
                    database_results.extend(data_list)
                else:
                    database_results.append(data_list)
            except Exception:
                # If database output wasn't valid JSON (e.g., error string)
                database_results.append(msg.content)
                
    final_answer = state["messages"][-1].content
    
    return {
        "filters_applied": {"sql_queries": sql_queries},
        "database_results": database_results,
        "answer": final_answer,
    }
