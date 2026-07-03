import asyncio
import os
import random
import logging
from datetime import datetime, timezone, timedelta
from typing import TypedDict
from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from google.api_core.exceptions import ResourceExhausted, InvalidArgument, ServiceUnavailable
from langgraph.graph import StateGraph, END
from app.schema import MeetingExtractionResult

logger = logging.getLogger(__name__)




FALLBACK_MODELS = [
    # "gemini-2.0-flash",
    # "gemini-2.0-flash-lite",
    # "gemini-2.5-pro",
    # "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3.1-pro",
    "gemini-3-flash",
]

# Rough transcript size guard (characters). Most models support ~1M tokens;
# 500 k chars ≈ 125 k tokens which is safely within that window.
_MAX_TRANSCRIPT_CHARS = 500_000


# Retry / timeout configuration


# onlly to transient errors (quota exhausted, 503 high demand).
_MAX_RETRIES_PER_MODEL = 3

# Maximum seconds the entire extraction (all models + retries)

_TOTAL_TIMEOUT_SECONDS = 300  # 5 minutes

# Base wait (seconds) for the first retry; doubles each subsequent attempt.
_BACKOFF_BASE_SECONDS = 5


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

        # ── EXTRACTION TASKS ─────────────────────────────────────────────────
        f"=== EXTRACT THE FOLLOWING ===\n"
        f"1. A concise meeting summary.\n"
        f"2. All unique speaker names/identifiers present in the transcript.\n"
        f"3. All tasks/decisions/follow-ups — with correct category, verbatim descriptions, "
        f"resolved due_date (never in the past), and due_time (null if not mentioned).\n"
        f"4. All risks and issues discussed.\n\n"

        f"Return null for due_date if no deadline or timeframe is mentioned. "
        f"Return null for due_time if no time-of-day context is mentioned."
    )


async def _invoke_with_backoff(
    model_name: str,
    api_key: str,
    system_prompt: str,
    transcript: str,
) -> dict:
    """
    Attempts LLM extraction for a single model with exponential backoff.
    Raises the last exception if all retries are exhausted.
    Retries only on transient errors (quota / 503 high-demand).
    Immediately re-raises on permanent errors (invalid argument, etc.).
    """
    llm = ChatGoogleGenerativeAI(
        model=model_name,
        api_key=api_key,
        temperature=0,
        # Disable LangChain's own internal retry so our backoff controls everything.
        max_retries=0,
    )
    structured_llm = llm.with_structured_output(MeetingExtractionResult)
    messages = [
        ("system", system_prompt),
        ("user", f"Here is the transcript:\n\n{transcript}"),
    ]

    last_exc: Exception | None = None

    for attempt in range(1, _MAX_RETRIES_PER_MODEL + 1):
        try:
            logger.info(f"[{model_name}] attempt {attempt}/{_MAX_RETRIES_PER_MODEL}")
            result = await structured_llm.ainvoke(messages)
            logger.info(f"[{model_name}] extraction succeeded on attempt {attempt}.")
            return result.model_dump()

        except (ResourceExhausted, ServiceUnavailable) as e:
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

        except InvalidArgument as e:
            # Permanent error for this model — skip immediately, no retries.
            logger.warning(
                f"[{model_name}] permanent error (InvalidArgument): {e}. "
                f"Skipping to next model."
            )
            raise  # caller will catch and move on

        except Exception as e:
            # Unknown / unexpected error — log and skip model.
            logger.error(
                f"[{model_name}] unexpected error on attempt {attempt}: "
                f"{type(e).__name__}: {e}"
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
    """
    Single LangGraph node that delegates to the existing _extract_with_fallbacks
    function (which itself calls _invoke_with_backoff per model).
    No retry/backoff logic lives here — it all stays in _extract_with_fallbacks.
    """
    logger.info("LangGraph: extraction node entered.")
    result = await _extract_with_fallbacks(
        state["system_prompt"],
        state["transcript"],
        state["api_key"],
    )
    logger.info("LangGraph: extraction node completed successfully.")
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
