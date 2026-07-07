from pydantic import BaseModel, Field
from typing import List, Optional, Literal


class TaskSchema(BaseModel):
    task_description: str = Field(
        description="Detailed description of the action item or task."
    )
    owner: str = Field(
        default="Unassigned",
        description=(
            "The person or group assigned to the task, exactly as referenced in the meeting. "
            "Examples: 'Speaker A', 'John', 'All attendees', 'Presenters (Speaker A, Speaker B)'. "
            "Use 'Unassigned' only if no owner is mentioned at all."
        ),
    )
    due_date: Optional[str] = Field(
        None,
        description=(
            "The resolved due date in ISO 8601 format (YYYY-MM-DD). "
            "You MUST use the current date/time provided in the system prompt to resolve ALL relative "
            "references: 'tomorrow' → current date + 1 day, 'next Friday' → the upcoming Friday, "
            "'end of week' → the coming Sunday, 'after lunch' → same day, 'in two weeks' → +14 days, etc. "
            "CRITICAL: Always compute dates by adding/subtracting from the EXACT date in the system prompt. "
            "Never produce a date that is in the past relative to today's date in the system prompt. "
            "IMPORTANT: if a time-of-day phrase implies a time that has ALREADY PASSED today (e.g., it is "
            "currently evening and the speaker says 'before lunch'), automatically set due_date to TOMORROW "
            "instead of today. "
            "Return null ONLY if absolutely no deadline or timeframe is mentioned."
        ),
    )
    due_time: Optional[str] = Field(
        None,
        description=(
            "The resolved due TIME in HH:MM (24-hour) format, only when a time-of-day context exists. "
            "Standard mappings: "
            "'before lunch'/'by lunch'/'at lunch'/'noon' → '12:00', "
            "'after lunch' → '13:00', "
            "'morning'/'first thing'/'early' → '09:00', "
            "'end of day'/'EOD'/'COB'/'close of business' → '17:00', "
            "'evening'/'tonight' → '21:00', "
            "'midnight' → '00:00', "
            "'by 3pm' → '15:00' (convert any explicit time). "
            "IMPORTANT – cross-day rollover: if the inferred time is earlier than the current time "
            "AND the due_date would be today, push due_date forward by one day instead. "
            "Return null when no time-of-day context is mentioned at all (the backend will apply a "
            "17:00 default only when a due_date is present)."
        ),
    )
    raw_deadline: Optional[str] = Field(
        None,
        description="The exact deadline phrase as spoken in the meeting, e.g., 'by next Friday', 'after lunch'.",
    )
    deadline_type: Literal["EXPLICIT", "INFERRED", "NONE"] = Field(
        description=(
            "EXPLICIT if a concrete date/time was stated. "
            "INFERRED if a relative or vague timeframe was mentioned (e.g., 'soon', 'next week'). "
            "NONE if no deadline was mentioned."
        )
    )
    priority: Literal["Low", "Medium", "High", "Critical"] = Field(
        description="The urgency of the task based on context and language used in the meeting."
    )
    category: Literal["Action Item", "Decision", "Follow-up", "Info"] = Field(
        description=(
            "The type of item extracted from the transcript. Choose strictly by these rules:\n"
            "  'Action Item' — a concrete task or deliverable assigned to a person or team "
            "(someone must DO something). E.g., 'John will send the report by Friday.'\n"
            "  'Decision' — a resolution or agreement reached during the meeting, not requiring "
            "further action. E.g., 'We decided to use PostgreSQL.' or 'Backend changes affecting "
            "contracts must be communicated.' (a policy/constraint, not a task).\n"
            "  'Follow-up' — an item that needs to be revisited, checked on, or discussed again "
            "later. E.g., 'We will revisit this next sprint.'\n"
            "  'Info' — a note or context with no actionable outcome and no clear owner."
        )
    )


class RiskSchema(BaseModel):
    risk_description: str = Field(description="Detailed description of the risk or issue.")
    severity: Literal["Low", "Medium", "High", "Critical"] = Field(
        description="The impact or severity of the risk."
    )


class MeetingExtractionResult(BaseModel):
    meeting_title: str = Field(description="A concise, AI-generated title for the meeting.")
    meeting_summary: str = Field(description="A concise summary of the overall meeting.")
    speakers: List[str] = Field(
        default_factory=list,
        description=(
            "List of all unique speaker names or identifiers found in the transcript. "
            "Use the names/labels exactly as they appear (e.g., 'Speaker A', 'John', 'Sarah'). "
            "This list is used to resolve group owner references like 'All attendees'."
        ),
    )
    tasks: List[TaskSchema] = Field(
        default_factory=list,
        description="List of tasks, action items, and decisions discussed in the meeting.",
    )
    risks: List[RiskSchema] = Field(
        default_factory=list,
        description="List of risks and issues discussed in the meeting.",
    )



# Query / Semantic Filter Schema


class SearchFilters(BaseModel):
    target_table: Literal["tasks", "risks", "meetings"] = Field(
        description="The primary entity the user is asking about."
    )
    meeting_id: Optional[str] = Field(
        None,
        description="UUID of a specific meeting to filter results by, if the user specifies one.",
    )
    owner_name: Optional[str] = Field(
        None,
        description="The name of the owner if filtering tasks by owner.",
    )
    priority: Optional[str] = Field(
        None,
        description="The priority/severity level (e.g., 'High', 'Critical') if specified.",
    )
    status: Optional[str] = Field(
        None,
        description="The status of the task (e.g., 'Open', 'Closed') if specified.",
    )
    is_open_only: bool = Field(
        False,
        description="True if the user only wants open/uncompleted tasks.",
    )


class QueryRequest(BaseModel):
    question: str
    user_name: Optional[str] = Field(None, description="The name of the user asking the query, used to resolve 'my tasks'")
