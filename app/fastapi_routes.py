import logging

from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import List

from app.utils.hasher import generate_file_hash
from app.utils.text_parser import extract_text
from app.database_service import (
    check_hash_exists,
    save_meeting,
    save_extracted_data,
    delete_meeting,
    get_all_meetings,
    get_all_tasks,
    get_meeting_by_id,
    get_all_risks,
    update_task_status,
)
from app.llm_service import extract_meeting_data
from app.query_service import process_natural_language_query
from app.schema import QueryRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    results = []

    for file in files:
        content = await file.read()

        #  1. Idempotency hash check 
        content_hash = generate_file_hash(content)
        exists = await check_hash_exists(content_hash)
        if exists:
            results.append({
                "filename": file.filename,
                "status": "skipped",
                "reason": "Already processed",
            })
            continue

        # 2. Parse raw text 
        try:
            raw_text = extract_text(file.filename, content)
        except ValueError as e:
            results.append({"filename": file.filename, "status": "error", "reason": str(e)})
            continue

        # 3. Persist meeting row first
        try:
            meeting_id = await save_meeting(
                title=file.filename,
                file_name=file.filename,
                content_hash=content_hash,
                raw_transcript=raw_text,
            )
        except Exception as e:
            logger.error(f"Failed to save meeting row for '{file.filename}': {e}")
            results.append({
                "filename": file.filename,
                "status": "error",
                "reason": f"Database error: {str(e)}",
            })
            continue

        # 4. LLM extraction (async, non-blocking) 
        try:
            extracted_data = await extract_meeting_data(raw_text)
        except Exception as e:
            # Meeting row exists but extraction failed → roll back the meeting row
            logger.error(
                f"LLM extraction failed for '{file.filename}' "
                f"(meeting_id={meeting_id}). Rolling back meeting row. Error: {e}"
            )
            await delete_meeting(meeting_id)
            results.append({
                "filename": file.filename,
                "status": "error",
                "reason": f"LLM extraction failed: {str(e)}",
            })
            continue

        # 5. Transactional persistence of tasks + risks 
        try:
            await save_extracted_data(meeting_id, extracted_data)
        except Exception as e:
            logger.error(
                f"Failed to save extracted data for meeting_id={meeting_id}. "
                f"Rolling back meeting row. Error: {e}"
            )
            await delete_meeting(meeting_id)
            results.append({
                "filename": file.filename,
                "status": "error",
                "reason": f"Persistence error: {str(e)}",
            })
            continue

        results.append({
            "filename": file.filename,
            "status": "processed",
            "meeting_id": meeting_id,
            "extracted_data": extracted_data,
        })

    return {"results": results}


@router.get("/meetings")
async def get_meetings():
    meetings = await get_all_meetings()
    return {"meetings": meetings}


@router.get("/meetings/{meeting_id}")
async def get_meeting(meeting_id: str):
    meeting = await get_meeting_by_id(meeting_id)
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    return {"meeting": meeting}


@router.get("/tasks")
async def get_tasks(meeting_id: str = None):
    tasks = await get_all_tasks(meeting_id)
    return {"tasks": tasks}


@router.put("/tasks/{task_id}/status")
async def update_task_status_route(task_id: str, payload: dict):
    status = payload.get("status")
    if not status or status not in ("Open", "Closed"):
        raise HTTPException(status_code=400, detail="Invalid status value. Must be 'Open' or 'Closed'")
    try:
        await update_task_status(task_id, status)
        return {"status": "success", "message": f"Task status updated to {status}"}
    except Exception as e:
        logger.error(f"Failed to update task status: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/risks")
async def get_risks(meeting_id: str = None):
    risks = await get_all_risks(meeting_id)
    return {"risks": risks}


@router.post("/query")
async def query_agent(request: QueryRequest):
    try:
        response = await process_natural_language_query(request.question)
        return response
    except Exception as e:
        logger.error(f"Query processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))