from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import List

from app.utils.hasher import generate_file_hash
from app.utils.text_parser import extract_text
from app.database_service import check_hash_exists, save_meeting

router = APIRouter()

@router.post("/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    results = []
    for file in files:
        content = await file.read()
        
        # Generate Hash
        content_hash = generate_file_hash(content)
        
        # Check idempotency
        exists = await check_hash_exists(content_hash)
        if exists:
            results.append({"filename": file.filename, "status": "skipped", "reason": "Already processed"})
            continue
            
        # Parse text
        try:
            raw_text = extract_text(file.filename, content)
        except ValueError as e:
            results.append({"filename": file.filename, "status": "error", "reason": str(e)})
            continue
            
        # Save to database
        try:
            meeting_id = await save_meeting(
                title=file.filename, 
                file_name=file.filename, 
                content_hash=content_hash, 
                raw_transcript=raw_text
            )
            results.append({"filename": file.filename, "status": "processed", "meeting_id": meeting_id})
        except Exception as e:
            results.append({"filename": file.filename, "status": "error", "reason": f"DB Error: {str(e)}"})
            
    return {"results": results}