import asyncio
import os
import random
import logging
import json
import re
from datetime import datetime, timezone, timedelta
from typing import TypedDict, Optional
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_groq import ChatGroq
from google.api_core.exceptions import ResourceExhausted, InvalidArgument, ServiceUnavailable
from langgraph.graph import StateGraph, END
from app.schema import MeetingExtractionResult, TaskSchema, RiskSchema

logger = logging.getLogger(__name__)


FALLBACK_MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro",
    "gemini-3-flash",
]

GROQ_FALLBACK_MODELS = [
    "openai/gpt-oss-20b",
    "openai/gpt-oss-120b",
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "groq/compound-mini",
]

GEMINI_FALLBACK_MODELS = [
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
]

# Rough transcript size guard (characters). Most models support ~1M tokens;
# 500 k chars ≈ 125 k tokens which is safely within that window.
_MAX_TRANSCRIPT_CHARS = 500_000


# Retry / timeout configuration
_MAX_RETRIES_PER_MODEL = 3

# Maximum seconds the entire extraction (all models + retries)
_TOTAL_TIMEOUT_SECONDS = 300  # 5 minutes

# Base wait (seconds) for the first retry; doubles each subsequent attempt.
_BACKOFF_BASE_SECONDS = 5


# ── Robust Transient Error Detection ─────────────────────────────────────────

def is_transient_error(e: Exception) -> bool:
    """
    Check if an exception is a transient error (e.g. 503 high demand or 429 quota/rate limit).
    Handles standard Google API exception classes and general wrapped/unwrapped
    exceptions containing status codes or message patterns indicating transient state.
    """
    err_str = str(e).lower()
    class_name = type(e).__name__.lower()

    # Match class names
    if "resourceexhausted" in class_name or "serviceunavailable" in class_name or "servererror" in class_name:
        return True

    # Match string patterns
    transient_patterns = [
        "503", "429", "unavailable", "resource_exhausted", "resource exhausted",
        "service unavailable", "rate limit", "high demand", "temp", "try again",
        "quota"
    ]
    if any(pat in err_str for pat in transient_patterns):
        return True

    return False


# ── Graceful Degradation / Truncated JSON Parsers ────────────────────────────

def _extract_json_objects(text: str) -> list[dict]:
    """
    Scans a text block and extracts all top-level balanced JSON objects.
    Extremely robust against trailing truncated content.
    """
    objs = []
    stack = []
    start_idx = -1
    for i, char in enumerate(text):
        if char == '{':
            if not stack:
                start_idx = i
            stack.append('{')
        elif char == '}':
            if stack:
                stack.pop()
                if not stack:
                    candidate = text[start_idx:i+1]
                    try:
                        objs.append(json.loads(candidate))
                    except json.JSONDecodeError:
                        pass
    return objs


def parse_truncated_json(raw_text: str) -> dict:
    """
    Extract as much valid content as possible from a truncated/malformed JSON string.
    """
    result = {
        "meeting_title": "AI Generated Meeting",
        "meeting_summary": "",
        "speakers": [],
        "tasks": [],
        "risks": []
    }

    # Extract simple fields via regex
    title_match = re.search(r'"meeting_title"\s*:\s*"([^"]+)"', raw_text)
    if title_match:
        result["meeting_title"] = title_match.group(1)

    summary_match = re.search(r'"meeting_summary"\s*:\s*"([^"]+)"', raw_text)
    if summary_match:
        result["meeting_summary"] = summary_match.group(1)

    # Extract speakers array
    speakers_match = re.search(r'"speakers"\s*:\s*\[([^\]]*)\]', raw_text)
    if speakers_match:
        speakers_str = speakers_match.group(1)
        result["speakers"] = [
            s.strip().strip('"').strip("'")
            for s in speakers_str.split(",")
            if s.strip()
        ]

    # Locate array sections to isolate tasks vs risks scanner space
    tasks_idx = raw_text.find('"tasks"')
    risks_idx = raw_text.find('"risks"')

    if tasks_idx != -1:
        tasks_end = risks_idx if risks_idx > tasks_idx else len(raw_text)
        tasks_text = raw_text[tasks_idx:tasks_end]
        raw_tasks = _extract_json_objects(tasks_text)
        for t in raw_tasks:
            try:
                sanitized = sanitize_task_dict(t)
                validated = TaskSchema(**sanitized)
                result["tasks"].append(validated.model_dump())
            except Exception as e:
                logger.warning("Dropped malformed task during partial parsing: %s | Error: %s", t, e)

    if risks_idx != -1:
        risks_end = len(raw_text)
        risks_text = raw_text[risks_idx:risks_end]
        raw_risks = _extract_json_objects(risks_text)
        for r in raw_risks:
            try:
                sanitized = sanitize_risk_dict(r)
                validated = RiskSchema(**sanitized)
                result["risks"].append(validated.model_dump())
            except Exception as e:
                logger.warning("Dropped malformed risk during partial parsing: %s | Error: %s", r, e)

    return result


def sanitize_task_dict(t: dict) -> dict:
    """
    Sanitize and normalize task dictionary fields (casing, spelling, format)
    before Pydantic validation to prevent strict Literal checks from dropping valid tasks.
    """
    cleaned = dict(t)

    # 1. Normalize Category -> Literal["Action Item", "Decision", "Follow-up", "Info"]
    cat = str(cleaned.get("category", "")).strip().lower().replace("_", " ").replace("-", " ")
    if "action" in cat:
        cleaned["category"] = "Action Item"
    elif "decision" in cat:
        cleaned["category"] = "Decision"
    elif "follow" in cat:
        cleaned["category"] = "Follow-up"
    elif "info" in cat:
        cleaned["category"] = "Info"
    else:
        cleaned["category"] = "Info"  # default fallback

    # 2. Normalize Priority -> Literal["Low", "Medium", "High", "Critical"]
    prio = str(cleaned.get("priority", "")).strip().lower()
    if "low" in prio:
        cleaned["priority"] = "Low"
    elif "high" in prio:
        cleaned["priority"] = "High"
    elif "critical" in prio:
        cleaned["priority"] = "Critical"
    else:
        cleaned["priority"] = "Medium"  # default fallback

    # 3. Normalize Deadline Type -> Literal["EXPLICIT", "INFERRED", "NONE"]
    dl = str(cleaned.get("deadline_type", "")).strip().upper()
    if dl in ("EXPLICIT", "INFERRED", "NONE"):
        cleaned["deadline_type"] = dl
    elif "explicit" in dl.lower():
        cleaned["deadline_type"] = "EXPLICIT"
    elif "inferred" in dl.lower():
        cleaned["deadline_type"] = "INFERRED"
    else:
        cleaned["deadline_type"] = "NONE"

    # 4. Handle empty string values for optional fields
    for field in ("due_date", "due_time", "raw_deadline"):
        if cleaned.get(field) == "":
            cleaned[field] = None

    return cleaned


def sanitize_risk_dict(r: dict) -> dict:
    """
    Sanitize and normalize risk dictionary fields before Pydantic validation.
    """
    cleaned = dict(r)

    # 1. Normalize Severity -> Literal["Low", "Medium", "High", "Critical"]
    sev = str(cleaned.get("severity", "")).strip().lower()
    if "low" in sev:
        cleaned["severity"] = "Low"
    elif "high" in sev:
        cleaned["severity"] = "High"
    elif "critical" in sev:
        cleaned["severity"] = "Critical"
    else:
        cleaned["severity"] = "Medium"  # default fallback

    return cleaned


def validate_extracted_dict(data: dict) -> dict:
    """
    Validates dictionary elements individually to ensure Pydantic compliance,
    dropping only invalid items instead of crashing the whole graph node.
    """
    validated_tasks = []
    for t in data.get("tasks", []):
        try:
            sanitized = sanitize_task_dict(t)
            validated_tasks.append(TaskSchema(**sanitized).model_dump())
        except Exception as exc:
            logger.warning("Dropped malformed task from valid JSON: %s | Error: %s", t, exc)

    validated_risks = []
    for r in data.get("risks", []):
        try:
            sanitized = sanitize_risk_dict(r)
            validated_risks.append(RiskSchema(**sanitized).model_dump())
        except Exception as exc:
            logger.warning("Dropped malformed risk from valid JSON: %s | Error: %s", r, exc)

    return {
        "meeting_title": data.get("meeting_title") or "AI Generated Meeting",
        "meeting_summary": data.get("meeting_summary") or "",
        "speakers": data.get("speakers") or [],
        "tasks": validated_tasks,
        "risks": validated_risks,
    }


def safe_parse_and_validate(raw_text) -> dict:
    """
    Safely parses JSON and validates it. Falls back to truncated parsing on failure.
    Handles string input as well as lists of content blocks returned by the model.
    """
    if isinstance(raw_text, list):
        content_str = ""
        for block in raw_text:
            if isinstance(block, dict) and "text" in block:
                content_str += block["text"]
            elif isinstance(block, str):
                content_str += block
        raw_text = content_str
    elif not isinstance(raw_text, str):
        raw_text = str(raw_text)

    text_clean = raw_text.strip()
    if text_clean.startswith("```"):
        lines = text_clean.splitlines()
        if len(lines) > 2:
            text_clean = "\n".join(lines[1:-1]).strip()

    try:
        data = json.loads(text_clean)
        if not isinstance(data, dict):
            raise ValueError("JSON output is not a dictionary.")
    except Exception as exc:
        logger.warning(
            "Initial JSON parsing failed. Running truncated JSON fallback parser: %s", exc
        )
        data = parse_truncated_json(text_clean)

    return validate_extracted_dict(data)


# ── System prompt builder ────────────────────────────────────────────────────

def _build_system_prompt() -> str:
    """
    Returns the system prompt with the current date/time injected so the LLM
    can resolve all relative deadline references (e.g., 'tomorrow', 'next Friday').
    """
    now      = datetime.now(tz=timezone.utc).astimezone()   # local system time
    day_name = now.strftime("%A")                            # e.g. "Tuesday"
    date_str = now.strftime("%Y-%m-%d")                     # e.g. "2026-07-01"
    time_str = now.strftime("%H:%M")                        # e.g. "08:17"
    tz_name  = now.strftime("%Z")                           # e.g. "IST"

    # Compute tomorrow's date in Python so the prompt contains the real value,
    # not a formula the LLM might misread.
    tomorrow_str = (datetime.now(tz=timezone.utc).astimezone() + timedelta(days=1)).strftime("%Y-%m-%d")

    return (
        f"You are an AI meeting assistant. "
        f"Today is {day_name}, {date_str}. The current time is {time_str} {tz_name}.\n\n"

        # ── DATE RESOLUTION ──────────────────────────────────────────────────
        f"=== DUE DATE RESOLUTION ===\n"
        f"Resolve ALL relative date references to concrete YYYY-MM-DD values.\n"
        f"CRITICAL ARITHMETIC RULE: Always add/subtract from the EXACT date '{date_str}' "
        f"shown above. NEVER output a date that is BEFORE {date_str}. "
        f"A due date in the past is always wrong.\n"
        f"  'today'              -> {date_str}\n"
        f"  'tomorrow'           -> {tomorrow_str}  (this is already computed for you)\n"
        f"  'next [Weekday]'     -> the nearest [Weekday] that is STRICTLY AFTER {date_str}\n"
        f"  'end of week'        -> the coming Friday on or after {date_str}\n"
        f"  'in two weeks'       -> 14 days from {date_str}\n"
        f"  No date context      -> leave due_date null; do NOT invent a date.\n\n"

        # ── TIME RESOLUTION ──────────────────────────────────────────────────
        f"=== DUE TIME RESOLUTION ===\n"
        f"Only populate due_time when the speaker mentions a time-of-day. "
        f"Leave it null if no time context is present at all.\n"
        f"  'morning' / 'first thing' / 'early'                         -> 09:00\n"
        f"  'before lunch' / 'by lunch' / 'at lunch' / 'noon' / 'midday' -> 12:00\n"
        f"  'after lunch'                                                -> 13:00\n"
        f"  'afternoon'                                                  -> 15:00\n"
        f"  'end of day' / 'EOD' / 'COB' / 'close of business'          -> 17:00\n"
        f"  'evening' / 'tonight'                                        -> 21:00\n"
        f"  'midnight'                                                   -> 00:00\n"
        f"  Any explicit clock time (e.g. 'by 3pm', 'at 10am')          -> convert to HH:MM 24-hour.\n\n"

        # ── CROSS-DAY ROLLOVER ───────────────────────────────────────────────
        f"=== CROSS-DAY ROLLOVER RULE ===\n"
        f"If the inferred due_time is EARLIER than the current time ({time_str}) "
        f"AND the due_date would otherwise be TODAY ({date_str}), "
        f"push due_date to TOMORROW ({tomorrow_str}) instead.\n"
        f"Example: it is 20:00, speaker says 'finish this before lunch' "
        f"-> due_time=12:00, due_date={tomorrow_str}.\n\n"

        # ── VERBATIM EXTRACTION ──────────────────────────────────────────────
        f"=== VERBATIM EXTRACTION RULE ===\n"
        f"Extract task descriptions ONLY from what was explicitly said or clearly implied. "
        f"Do NOT embellish, reframe, or invent deliverables. "
        f"If a speaker says 'create a backlog item', the task is 'Create a backlog item' — "
        f"NOT 'Prepare a proposal for X'. Stay faithful to the transcript wording.\n\n"

        # ── DEDUPLICATION ────────────────────────────────────────────────────
        f"=== DEDUPLICATION RULE ===\n"
        f"Before finalising the task list, check for duplicates. "
        f"Two tasks are duplicates if they describe the same underlying action, "
        f"even if worded differently (e.g. 'Investigate fallback rules' and "
        f"'Investigate why fallback frequency increased' are the SAME task). "
        f"Keep only the most specific/complete version and discard the rest.\n\n"

        # ── CATEGORY DISCIPLINE ──────────────────────────────────────────────
        f"=== CATEGORY DISCIPLINE ===\n"
        f"Use the correct category — do NOT default everything to 'Action Item':\n"
        f"  'Action Item' -> someone is explicitly assigned to DO something concrete.\n"
        f"  'Decision'    -> a policy, rule, or agreement was reached (no personal task involved). "
        f"E.g. 'Backend changes must be communicated to contracts' is a Decision, not an Action Item.\n"
        f"  'Follow-up'   -> something to revisit or monitor later.\n"
        f"  'Info'        -> a note or observation with no owner or outcome.\n\n"

        # ── NO REPETITION / INFINITE LOOPS ───────────────────────────────────
        f"=== NO REPETITION / INFINITE GENERATION LOOPS ===\n"
        f"Do NOT get stuck in generation loops. Output each unique task, speaker, "
        f"or risk EXACTLY once. Do NOT output the same item multiple times. "
        f"Keep the list of tasks concise, literal, and completely free of repetitions "
        f"or hallucinated duplicates.\n\n"

        # ── EXTRACTION TASKS ─────────────────────────────────────────────────
        f"=== EXTRACT THE FOLLOWING ===\n"
        f"1. A concise meeting summary.\n"
        f"2. All unique speaker names/identifiers present in the transcript.\n"
        f"3. All tasks/decisions/follow-ups — with correct category, verbatim descriptions, "
        f"resolved due_date (never in the past), and due_time (null if not mentioned).\n"
        f"4. All risks and issues discussed.\n\n"

        f"Return null for due_date if no deadline or timeframe is mentioned. "
        f"Return null for due_time if no time-of-day context is mentioned.\n\n"
        f"=== Completeness ===\n"
        f"Always process the entire transcript before generating output. "
        f"Do not stop at topic changes, breaks, or phrases like 'Let\\'s continue' or 'Next issue.' "
        f"Before finalizing, perform one verification pass to ensure all action items, decisions, "
        f"owners, priorities, and due dates from the full transcript have been captured."
    )


# ── Core LLM invocation ──────────────────────────────────────────────────────

async def _invoke_with_backoff(
    model_name: str,
    api_key: str,
    system_prompt: str,
    transcript: str,
) -> dict:
    """
    Attempts LLM extraction for a single model with exponential backoff.
    Raises the last exception if all retries are exhausted.
    Retries only on transient errors (quota / 503 high-demand / 429).
    Immediately re-raises on permanent errors (invalid argument, etc.).
    """
    llm = ChatGoogleGenerativeAI(
        model=model_name,
        api_key=api_key,
        temperature=0,
        max_output_tokens=8192,
        # Disable LangChain's own internal retry so our backoff controls everything.
        max_retries=0,
        response_mime_type="application/json",
        response_schema=MeetingExtractionResult.model_json_schema(),
    )
    messages = [
        ("system", system_prompt),
        ("user", f"Here is the transcript:\n\n{transcript}"),
    ]

    last_exc: Exception | None = None

    for attempt in range(1, _MAX_RETRIES_PER_MODEL + 1):
        try:
            logger.info(f"[{model_name}] attempt {attempt}/{_MAX_RETRIES_PER_MODEL}")
            response = await llm.ainvoke(messages)
            
            # Safe parse and validate (supports recovery if truncated)
            result = safe_parse_and_validate(response.content)
            
            # Simple guard: if the output has absolutely no useful fields, treat it as a failure
            if not result.get("meeting_summary") and not result.get("tasks") and not result.get("risks"):
                raise ValueError("LLM returned empty or completely malformed JSON structure.")

            logger.info(f"[{model_name}] extraction succeeded on attempt {attempt}.")
            return result

        except Exception as e:
            if is_transient_error(e):
                last_exc = e
                # Only retry on transient errors.
                if attempt < _MAX_RETRIES_PER_MODEL:
                    # Exponential backoff with ±20 % jitter to avoid thundering-herd.
                    wait = _BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
                    jitter = wait * 0.2 * (2 * random.random() - 1)  # ±20 %
                    sleep_for = round(wait + jitter, 2)
                    logger.warning(
                        f"[{model_name}] transient error on attempt {attempt} "
                        f"({type(e).__name__}). "
                        f"Retrying in {sleep_for}s... | {e}"
                    )
                    await asyncio.sleep(sleep_for)
                else:
                    logger.warning(
                        f"[{model_name}] exhausted {_MAX_RETRIES_PER_MODEL} retries "
                        f"({type(e).__name__}). Moving to next model."
                    )
            else:
                # Permanent error or parsing error — skip model.
                logger.error(
                    f"[{model_name}] non-transient error on attempt {attempt}: "
                    f"{type(e).__name__}: {e}. Skipping model."
                )
                raise  # caller will catch and move on

    raise last_exc  # type: ignore[misc]


async def _extract_with_fallbacks(system_prompt: str, transcript: str, api_key: str) -> dict:
    """
    Iterates through FALLBACK_MODELS, calling _invoke_with_backoff for each.
    Returns the first successful result or raises if all models fail.
    """
    last_exception: Exception | None = None

    for model_name in FALLBACK_MODELS:
        try:
            return await _invoke_with_backoff(model_name, api_key, system_prompt, transcript)
        except Exception as e:
            last_exception = e
            logger.warning(f"Model '{model_name}' failed entirely. Trying next fallback...")
            continue

    logger.error("All fallback models failed. No more options.")
    if last_exception:
        raise last_exception
    raise RuntimeError("Failed to extract data using any Gemini model.")


# ── Groq Invocation and Fallback logic ───────────────────────────────────────

async def _invoke_groq_with_backoff(
    model_name: str,
    api_key: str,
    system_prompt: str,
    transcript: str,
) -> dict:
    """
    Attempts Groq LLM extraction for a single model with exponential backoff.
    Raises the last exception if all retries are exhausted.
    Retries only on transient errors (quota / 503 high-demand / 429).
    Immediately re-raises on permanent errors (invalid argument, etc.).
    """
    llm = ChatGroq(
        model=model_name,
        api_key=api_key,
        temperature=0,
        max_retries=0,
        model_kwargs={"response_format": {"type": "json_object"}},
    )
    schema_str = json.dumps(MeetingExtractionResult.model_json_schema(), indent=2)
    messages = [
        ("system", system_prompt + f"\n\nYou MUST return the response as a JSON object matching this JSON Schema:\n{schema_str}"),
        ("user", f"Here is the transcript:\n\n{transcript}"),
    ]

    last_exc: Exception | None = None

    for attempt in range(1, _MAX_RETRIES_PER_MODEL + 1):
        try:
            logger.info(f"[{model_name}] attempt {attempt}/{_MAX_RETRIES_PER_MODEL}")
            response = await llm.ainvoke(messages)
            
            # Safe parse and validate (supports recovery if truncated)
            result = safe_parse_and_validate(response.content)
            
            if not result.get("meeting_summary") and not result.get("tasks") and not result.get("risks"):
                raise ValueError("LLM returned empty or completely malformed JSON structure.")

            logger.info(f"[{model_name}] extraction succeeded on attempt {attempt}.")
            return result

        except Exception as e:
            if is_transient_error(e):
                last_exc = e
                if attempt < _MAX_RETRIES_PER_MODEL:
                    wait = _BACKOFF_BASE_SECONDS * (2 ** (attempt - 1))
                    jitter = wait * 0.2 * (2 * random.random() - 1)
                    sleep_for = round(wait + jitter, 2)
                    logger.warning(
                        f"[{model_name}] transient error on attempt {attempt} "
                        f"({type(e).__name__}). "
                        f"Retrying in {sleep_for}s... | {e}"
                    )
                    await asyncio.sleep(sleep_for)
                else:
                    logger.warning(
                        f"[{model_name}] exhausted {_MAX_RETRIES_PER_MODEL} retries "
                        f"({type(e).__name__}). Moving to next model."
                    )
            else:
                logger.error(
                    f"[{model_name}] non-transient error on attempt {attempt}: "
                    f"{type(e).__name__}: {e}. Skipping model."
                )
                raise

    raise last_exc


async def _extract_with_groq_and_gemini_fallbacks(
    system_prompt: str,
    transcript: str,
    gemini_api_key: str,
) -> dict:
    """
    Iterates through GROQ_FALLBACK_MODELS using GROQ_V2 API key.
    If all Groq models fail, falls back to GEMINI_FALLBACK_MODELS using gemini_api_key.
    Returns the first successful result or raises if all fail.
    """
    groq_api_key = os.getenv("GROQ_V2")
    if groq_api_key:
        groq_api_key = groq_api_key.strip()

    last_exception: Exception | None = None

    if groq_api_key:
        for model_name in GROQ_FALLBACK_MODELS:
            try:
                logger.info(f"Trying Groq model: {model_name}")
                return await _invoke_groq_with_backoff(
                    model_name,
                    groq_api_key,
                    system_prompt,
                    transcript,
                )
            except Exception as e:
                last_exception = e
                logger.warning(f"Groq model '{model_name}' failed. Trying next model... Error: {e}")
                continue
    else:
        logger.warning("GROQ_V2 key not found in environment, skipping Groq models.")

    logger.warning("All Groq models failed or skipped. Falling back to Gemini models...")

    for model_name in GEMINI_FALLBACK_MODELS:
        try:
            logger.info(f"Trying Gemini fallback model: {model_name}")
            return await _invoke_with_backoff(
                model_name,
                gemini_api_key,
                system_prompt,
                transcript,
            )
        except Exception as e:
            last_exception = e
            logger.warning(f"Gemini model '{model_name}' failed. Trying next model... Error: {e}")
            continue

    logger.error("All fallback models (Groq and Gemini) failed. No more options.")
    if last_exception:
        raise last_exception
    raise RuntimeError("Failed to extract data using any Groq or Gemini model.")


# ---------------------------------------------------------------------------
# LangGraph integration
# ---------------------------------------------------------------------------

class ExtractionState(TypedDict):
    """State passed through the LangGraph extraction graph."""
    system_prompt: str
    transcript: str
    api_key: str
    result: dict


async def _extraction_node(state: ExtractionState) -> ExtractionState:
    # """
    # Single LangGraph node that delegates to the existing _extract_with_fallbacks
    # function (which itself calls _invoke_with_backoff per model).
    # No retry/backoff logic lives here — it all stays in _extract_with_fallbacks.
    # """
    # logger.info("LangGraph: extraction node entered.")
    # result = await _extract_with_fallbacks(
    #     state["system_prompt"],
    #     state["transcript"],
    #     state["api_key"],
    # )
    # logger.info("LangGraph: extraction node completed successfully.")
    # return {"result": result}

    logger.info("LangGraph: Groq/Gemini fallback extraction node entered.")
    result = await _extract_with_groq_and_gemini_fallbacks(
        state["system_prompt"],
        state["transcript"],
        state["api_key"],
    )
    logger.info("LangGraph: Groq/Gemini fallback extraction node completed successfully.")
    return {"result": result}


# Build and compile the graph once at module load time.
_graph_builder = StateGraph(ExtractionState)
_graph_builder.add_node("extract", _extraction_node)
_graph_builder.set_entry_point("extract")
_graph_builder.add_edge("extract", END)
extraction_graph = _graph_builder.compile()


async def extract_meeting_data(transcript: str) -> dict:
    """
    Public entry-point. Extracts structured data from a meeting transcript
    using Gemini models with full retry/backoff and a hard total timeout.

    Raises:
        asyncio.TimeoutError  – if the whole process exceeds _TOTAL_TIMEOUT_SECONDS.
        RuntimeError          – if all models fail with non-transient errors.
    """
    # Load .env on every call so hot-reloaded keys are picked up.
    load_dotenv(override=True)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY is not set in the environment variables.")

    if len(transcript) > _MAX_TRANSCRIPT_CHARS:
        logger.warning(
            f"Transcript is very large ({len(transcript):,} chars). "
            f"Consider chunking to avoid hitting context limits."
        )

    system_prompt = _build_system_prompt()

    try:
        output = await asyncio.wait_for(
            extraction_graph.ainvoke({
                "system_prompt": system_prompt,
                "transcript": transcript,
                "api_key": api_key,
                "result": {},
            }),
            timeout=_TOTAL_TIMEOUT_SECONDS,
        )
        return output["result"]
    except asyncio.TimeoutError:
        logger.error(
            f"LLM extraction timed out after {_TOTAL_TIMEOUT_SECONDS}s "
            f"(all models were tried with backoff)."
        )
        raise RuntimeError(
            f"LLM extraction timed out after {_TOTAL_TIMEOUT_SECONDS // 60} minutes. "
            f"The Gemini API may be experiencing high demand. Please try again later."
        )
