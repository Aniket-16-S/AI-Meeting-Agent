"""
app/worker.py
-------------
RabbitMQ consumer that processes uploaded meeting transcripts.

Bug fixed
─────────
The original code opened ONE session for the entire function and then:
  1. Did a bare ``session.execute(users query)``   → SQLAlchemy autobegin fires
  2. Later called ``async with session.begin():``  → "A transaction is already
     begun on this Session." → EVERY meeting save failed silently.

Fix: use separate, scoped sessions for each logical operation:
  - Session A (read-only, no begin):  fetch meeting + transcript + org users
  - Session B (write, session.begin): commit all extracted data atomically

Unknown-user resilience
───────────────────────
The LLM may name speakers who do not exist in the database.
``match_user_by_name`` returns ``None`` for unmatched speakers.
``task_assignees`` rows are only inserted when ``user_id is not None``,
so an unresolved owner never causes a FK violation.  The task itself is
still saved with the raw ``owner`` string for display purposes.
"""

import asyncio
import datetime
import json
import logging
import os
import uuid
from typing import Optional

import pika
from dotenv import load_dotenv
from sqlalchemy import text

from app.database_session import async_session_factory
from app.llm_service import extract_meeting_data
from app.utils.owner_parser import resolve_owners

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("meeting_agent_worker")

load_dotenv(override=True)

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/")


# ── Name-matching helper ──────────────────────────────────────────────────────

def match_user_by_name(name_str: str, users: list) -> Optional[uuid.UUID]:
    """
    Fuzzy-match a speaker/owner label against the organisation's user list.

    Returns the matched user's UUID or ``None`` if no match is found.
    A ``None`` return is handled gracefully — the task is still saved, only
    the ``task_assignees`` FK row is skipped.
    """
    if not name_str:
        return None
    name_clean = name_str.strip().lower()

    # 1. Match first name only
    for u in users:
        f_name = (u.get("f_name") or "").strip().lower()
        if f_name and f_name == name_clean:
            return u["id"]

    # 2. Match full name
    for u in users:
        f_name = (u.get("f_name") or "").strip()
        l_name = (u.get("l_name") or "").strip()
        full_name = f"{f_name} {l_name}".strip().lower()
        if full_name and full_name == name_clean:
            return u["id"]

    return None


# ── Core async processing function ───────────────────────────────────────────

async def process_meeting_async(meeting_id: str) -> bool:
    """
    Full processing pipeline for one meeting:

    1. Read meeting + transcript (Session A — read only, no explicit begin)
    2. Run LLM extraction (no DB session open)
    3. Look up org users for name resolution (Session A reused for read)
    4. Write everything atomically (Session B — fresh session + begin)

    Returns ``True`` to ACK the message (both success and graceful failure).
    Returns ``False`` only on transient errors that should be NACKed/requeued.
    """
    logger.info("Checking status for meeting_id: %s", meeting_id)

    # ── Step 1: Read meeting + transcript (Session A) ─────────────────────────
    # Important: do NOT call session.begin() here — we only read.
    # Using a separate session for reads keeps it from polluting the write
    # session's transaction state.
    organization_id: str
    raw_transcript: str

    async with async_session_factory() as read_session:
        result = await read_session.execute(
            text("""
                SELECT m.organization_id, t.is_processed, t.raw_transcript
                FROM meetings m
                JOIN meeting_transcripts t ON m.id = t.meeting_id
                WHERE m.id = :id
            """),
            {"id": uuid.UUID(meeting_id)},
        )
        row = result.mappings().first()

        if not row:
            logger.warning("Meeting %s not found in database. Dropping message.", meeting_id)
            return True  # ACK — nothing to requeue

        if row["is_processed"]:
            logger.info(
                "Meeting %s already processed. Dropping to prevent duplication.", meeting_id
            )
            return True

        organization_id = str(row["organization_id"])
        raw_transcript = row["raw_transcript"]

        # ── Step 2: Resolve org users for name matching ───────────────────────
        users_result = await read_session.execute(
            text("SELECT id, f_name, l_name FROM users WHERE organization_id = :org_id"),
            {"org_id": row["organization_id"]},
        )
        org_users = [dict(r) for r in users_result.mappings().all()]
        logger.info(
            "Loaded %d users for organisation %s resolution.", len(org_users), organization_id
        )
    # Session A is closed here — no autobegin state to carry forward.

    # ── Step 3: LLM extraction (no DB session open) ───────────────────────────
    logger.info("Running LLM extraction for meeting %s...", meeting_id)
    try:
        extracted_data = await extract_meeting_data(raw_transcript)
    except Exception as exc:
        logger.error("LLM extraction failed for meeting %s: %s", meeting_id, exc)
        async with async_session_factory() as fail_session:
            async with fail_session.begin():
                await fail_session.execute(
                    text("UPDATE meetings SET status = 'FAILED' WHERE id = :id"),
                    {"id": uuid.UUID(meeting_id)},
                )
        return True  # ACK — this message can't be retried usefully

    # ── Step 4: Resolve participant names → user IDs ──────────────────────────
    speakers: list[str] = extracted_data.get("speakers", [])
    resolved_participants: list[tuple[str, Optional[uuid.UUID]]] = [
        (speaker, match_user_by_name(speaker, org_users))
        for speaker in speakers
    ]

    # ── Step 5: Transactional DB write (fresh Session B) ─────────────────────
    # Fresh session = no autobegin contamination from the reads above.
    logger.info("Opening transaction to save extracted data for meeting %s...", meeting_id)
    try:
        async with async_session_factory() as write_session:
            async with write_session.begin():
                meeting_uuid = uuid.UUID(meeting_id)
                org_uuid = uuid.UUID(organization_id)
                today = datetime.date.today()

                # Update meeting: title, summary, COMPLETED
                title = extracted_data.get("meeting_title") or "AI Generated Meeting"
                summary = extracted_data.get("meeting_summary") or ""
                await write_session.execute(
                    text("""
                        UPDATE meetings
                        SET title = :title, summary = :summary, status = 'COMPLETED'
                        WHERE id = :id
                    """),
                    {"title": title, "summary": summary, "id": meeting_uuid},
                )

                # Insert meeting_participants
                # Participants whose name doesn't resolve to a DB user are still
                # recorded with user_id = NULL (the column allows NULLs).
                for speaker_name, user_id in resolved_participants:
                    await write_session.execute(
                        text("""
                            INSERT INTO meeting_participants (meeting_id, user_id, speaker_name)
                            VALUES (:meeting_id, :user_id, :speaker_name)
                            ON CONFLICT DO NOTHING
                        """),
                        {
                            "meeting_id": meeting_uuid,
                            "user_id": user_id,          # None → NULL (allowed by schema)
                            "speaker_name": speaker_name,
                        },
                    )

                # Insert tasks + task_assignees
                for task in extracted_data.get("tasks", []):
                    raw_due = task.get("due_date")
                    raw_time = task.get("due_time")

                    due_date: Optional[datetime.date] = None
                    if raw_due:
                        try:
                            due_date = datetime.date.fromisoformat(str(raw_due))
                        except (ValueError, TypeError):
                            due_date = today

                    due_time: Optional[datetime.time] = None
                    if raw_time:
                        try:
                            parts = str(raw_time).strip().split(":")
                            due_time = datetime.time(
                                int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
                            )
                        except (ValueError, TypeError, IndexError):
                            pass

                    # Apply default due values
                    if due_time is not None and due_date is None:
                        due_date = today
                    elif due_date is not None and due_time is None:
                        due_time = datetime.time(17, 0)

                    owner_str = task.get("owner", "Unassigned")
                    owners_list = resolve_owners(owner_str, speakers)

                    task_result = await write_session.execute(
                        text("""
                            INSERT INTO tasks
                                (organization_id, meeting_id, description, owner, owners_list,
                                 due_date, due_time, raw_deadline, deadline_type, priority, category)
                            VALUES
                                (:org_id, :meeting_id, :task_desc, :owner,
                                 CAST(:owners_list AS JSONB),
                                 :due_date, :due_time, :raw_deadline,
                                 :deadline_type, :priority, :category)
                            RETURNING id
                        """),
                        {
                            "org_id": org_uuid,
                            "meeting_id": meeting_uuid,
                            "task_desc": task.get("task_description"),
                            "owner": owner_str,
                            "owners_list": json.dumps(owners_list),
                            "due_date": due_date,
                            "due_time": due_time,
                            "raw_deadline": task.get("raw_deadline"),
                            "deadline_type": task.get("deadline_type", "NONE"),
                            "priority": task.get("priority", "Medium"),
                            "category": task.get("category", "Info"),
                        },
                    )
                    task_id = task_result.scalar()

                    # Insert assignees — skip if user not found in DB (no FK error)
                    for owner_name in owners_list:
                        resolved_uid = match_user_by_name(owner_name, org_users)
                        if resolved_uid is not None:
                            await write_session.execute(
                                text("""
                                    INSERT INTO task_assignees (task_id, user_id)
                                    VALUES (:task_id, :user_id)
                                    ON CONFLICT DO NOTHING
                                """),
                                {"task_id": task_id, "user_id": resolved_uid},
                            )
                        else:
                            logger.debug(
                                "Owner '%s' not found in DB — task saved without assignee FK.",
                                owner_name,
                            )

                # Insert risks
                for risk in extracted_data.get("risks", []):
                    await write_session.execute(
                        text("""
                            INSERT INTO risks (organization_id, meeting_id, description, severity)
                            VALUES (:org_id, :meeting_id, :risk_desc, :severity)
                        """),
                        {
                            "org_id": org_uuid,
                            "meeting_id": meeting_uuid,
                            "risk_desc": risk.get("risk_description"),
                            "severity": risk.get("severity", "Medium"),
                        },
                    )

                # Mark transcript as processed
                await write_session.execute(
                    text("""
                        UPDATE meeting_transcripts
                        SET is_processed = TRUE
                        WHERE meeting_id = :meeting_id
                    """),
                    {"meeting_id": meeting_uuid},
                )

        logger.info("Successfully processed and committed meeting %s.", meeting_id)
        return True

    except Exception as exc:
        logger.error(
            "Failed to commit database updates for meeting %s: %s",
            meeting_id, exc, exc_info=True,
        )
        # Mark as FAILED so the UI shows the correct status (don't leave it as PROCESSING)
        try:
            async with async_session_factory() as fail_session:
                async with fail_session.begin():
                    await fail_session.execute(
                        text("UPDATE meetings SET status = 'FAILED' WHERE id = :id"),
                        {"id": uuid.UUID(meeting_id)},
                    )
        except Exception as fail_exc:
            logger.error("Could not mark meeting %s as FAILED: %s", meeting_id, fail_exc)
        return True  # ACK — requeuing a broken message would loop forever


# ── RabbitMQ consumer ─────────────────────────────────────────────────────────

def callback(ch, method, properties, body):
    """RabbitMQ message handler: runs the async pipeline synchronously."""
    try:
        payload = json.loads(body)
        meeting_id = payload.get("meeting_id")
        if not meeting_id:
            logger.warning("Received invalid payload with no meeting_id. Dropping.")
            ch.basic_ack(delivery_tag=method.delivery_tag)
            return

        logger.info("Processing message for meeting_id: %s", meeting_id)
        success = asyncio.run(process_meeting_async(meeting_id))

        if success:
            ch.basic_ack(delivery_tag=method.delivery_tag)
            logger.info("Message for meeting_id %s ACKed successfully.", meeting_id)
        else:
            logger.warning("Failed to process meeting %s. Requeueing.", meeting_id)
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

    except Exception as exc:
        logger.error("Error in consumer callback: %s", exc, exc_info=True)
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)


def main():
    logger.info("Connecting to RabbitMQ: %s", RABBITMQ_URL)
    params = pika.URLParameters(RABBITMQ_URL)
    params.connection_attempts = 10
    params.retry_delay = 5
    params.heartbeat = 600

    try:
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        channel.queue_declare(queue="processing_queue", durable=True)
        channel.basic_qos(prefetch_count=1)
        channel.basic_consume(queue="processing_queue", on_message_callback=callback)
        logger.info("RabbitMQ worker started consuming 'processing_queue'...")
        channel.start_consuming()
    except Exception as exc:
        logger.critical("RabbitMQ consumer worker crashed: %s", exc)
        raise


if __name__ == "__main__":
    main()
