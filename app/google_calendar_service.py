import os
import uuid
import datetime
import logging
import urllib.parse
import requests
from typing import List, Optional
from dotenv import load_dotenv

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from google.oauth2 import id_token
from google.auth.transport import requests as auth_requests

# Load environment variables
load_dotenv(override=True)

logger = logging.getLogger(__name__)

CLIENT_ID = os.getenv("CLIENT_ID", "")
CLIENT_SECRET = os.getenv("CLIENT_SECRET", "")
REDIRECT_URI = "http://localhost:8000/auth/google/callback"

SCOPES = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid"
]

class GoogleCalendarService:
    @staticmethod
    def get_authorization_url(user_id: str) -> str:
        """
        Generates the Google OAuth authorization URL matching the PoC approach in authorize.py.
        """
        auth_params = {
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "response_type": "code",
            "scope": " ".join(SCOPES),
            "access_type": "offline",
            "prompt": "consent",
            "state": user_id
        }
        return "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(auth_params)

    @staticmethod
    def exchange_code(code: str) -> dict:
        """
        Exchanges the authorization code for tokens using requests, as done in authorize.py.
        """
        token_resp = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": CLIENT_ID,
                "client_secret": CLIENT_SECRET,
                "redirect_uri": REDIRECT_URI,
                "grant_type": "authorization_code"
            }
        )
        token_resp.raise_for_status()
        return token_resp.json()

    @staticmethod
    def get_credentials(refresh_token: str) -> Credentials:
        """
        Constructs and returns a Credentials object with a refresh token.
        """
        return Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=CLIENT_ID,
            client_secret=CLIENT_SECRET,
            scopes=SCOPES
        )

    @staticmethod
    def get_calendar_service(refresh_token: str):
        """
        Returns a built Google Calendar service instance, refreshing credentials if needed.
        """
        creds = GoogleCalendarService.get_credentials(refresh_token)
        try:
            # Refresh if invalid
            if creds.expired or not creds.valid:
                creds.refresh(auth_requests.Request())
        except Exception as exc:
            logger.error("Failed to refresh Google OAuth token: %s", exc)
            raise exc
        return build("calendar", "v3", credentials=creds)

    @staticmethod
    def create_meeting(
        refresh_token: str,
        title: str,
        description: Optional[str],
        start_time: str,  # ISO-8601 string
        end_time: str,    # ISO-8601 string
        timezone: str,
        attendees: List[str]
    ) -> dict:
        """
        Schedules a Google Meet meeting via Google Calendar API.
        """
        service = GoogleCalendarService.get_calendar_service(refresh_token)
        
        event = {
            "summary": title,
            "description": description or "",
            "start": {
                "dateTime": start_time,
                "timeZone": timezone,
            },
            "end": {
                "dateTime": end_time,
                "timeZone": timezone,
            },
            "attendees": [{"email": email} for email in attendees],
            "conferenceData": {
                "createRequest": {
                    "requestId": str(uuid.uuid4()),
                    "conferenceSolutionKey": {
                        "type": "hangoutsMeet"
                    }
                }
            },
        }

        try:
            created_event = service.events().insert(
                calendarId="primary",
                body=event,
                conferenceDataVersion=1,
                sendUpdates="all",
            ).execute()
            return created_event
        except Exception as exc:
            logger.error("Google Calendar insert event failed: %s", exc)
            raise exc

    @staticmethod
    def cancel_meeting(refresh_token: str, calendar_event_id: str):
        """
        Deletes a meeting on Google Calendar.
        """
        service = GoogleCalendarService.get_calendar_service(refresh_token)
        try:
            service.events().delete(
                calendarId="primary",
                eventId=calendar_event_id,
                sendUpdates="all",
            ).execute()
        except Exception as exc:
            logger.error("Google Calendar delete event failed: %s", exc)
            raise exc
