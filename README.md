# AI Meeting Agent

The AI Meeting Agent is an intelligent, multi-tenant workspace application that automates meeting analysis and coordination. By uploading raw transcripts, the platform extracts summaries, tasks, and potential risks, and allows teams to schedule and synchronize Google Meet video conferences directly with Google Calendar.

---

## Architecture & Design

```mermaid
graph TD
    User([User Browser]) -->|Next.js App| Frontend[Frontend: Next.js / React]
    Frontend -->|HTTP REST| Backend[Backend: FastAPI]
    Backend -->|Transactional Data| DB[(Postgres Database)]
    Backend -->|Processing Job| RabbitMQ[RabbitMQ Broker]
    RabbitMQ -->|Trigger Job| Worker[Background Worker]
    Worker -->|AI Extraction / LLM| LLM[Google Gemini / Groq API]
    Worker -->|Write Analysis Results| DB
    Backend -->|Schedule & Sync| GoogleCal[Google Calendar / Google Meet API]
```

### Key Components

- **Frontend**: A modern Next.js 15 dashboard built using React, Recharts, and custom vanilla CSS styling.
- **Backend API**: A FastAPI service handling multi-tenant administration, auth, file uploads, semantic query processing, and Google Calendar OAuth integration.
- **Background Worker**: A lightweight worker daemon (`app/worker.py`) that processes CPU/network-intensive LLM extraction tasks asynchronously.
- **Message Broker**: RabbitMQ manages processing queues to ensure smooth, decoupled task scheduling and execution.
- **Database**: A multi-tenant PostgreSQL schema supporting cascading deletes, high-performance lookup indexes, and dedicated data models.

For deeper technical information:
- Refer to the [Database Schema Specification](file:///c:/Aniket%20Personal/EkamVistar%20Tasks/AI%20Meeting%20Agent/docs/DataBase_Schema.md) for full descriptions of tables, relationships, and indices.
- Refer to the [API Endpoint Documentation](file:///c:/Aniket%20Personal/EkamVistar%20Tasks/AI%20Meeting%20Agent/docs/API_Endpoints.md) for endpoint signatures, payloads, and integration behaviors.

---

## Setup & Running

### Prerequisites
- [Docker & Docker Compose](https://www.docker.com/)
- [Python 3.11+](https://www.python.org/) (if running locally without Docker)
- [Node.js 18+](https://nodejs.org/) (if running frontend locally without Docker)

### Environment Variables
Configure a `.env` file at the root of the project. A template of required variables is shown below:

```bash
# Database & Broker configuration
DATABASE_URL=postgresql+asyncpg://postgres@localhost:5432/meeting_agent
RABBITMQ_URL=amqp://guest:guest@localhost:5672/

# LLM Providers API Keys
GEMINI_API_KEY=your_gemini_api_key
GROQ_V2=your_groq_api_key

# Google Calendar OAuth Credentials
CLIENT_ID=your_google_oauth_client_id
CLIENT_SECRET=your_google_oauth_client_secret

# Optional Email notification configuration
EMAIL=your_email@gmail.com
EMAIL_PASS=your_app_password
```

---

### Run Method 1: Docker Compose (Recommended)
You can launch the entire stack (Postgres, RabbitMQ, FastAPI Backend, Worker, Next.js Frontend) using a single command:

```bash
docker-compose up --build
```
Once initialized:
- **Frontend App**: `http://localhost:3000`
- **Backend Swagger Docs**: `http://localhost:8000/docs`
- **RabbitMQ Dashboard**: `http://localhost:15672` (Username: `guest` | Password: `guest`)

---

### Run Method 2: Running Standalone (Local Development)

#### 1. Start Postgres and RabbitMQ
You can start just the database and message broker via Docker:
```bash
docker compose up -d db rabbitmq
```

#### 2. Setup & Start Backend API
Create a virtual environment, install requirements, and run the FastAPI server:
```bash
# Install dependencies
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Run backend API
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

#### 3. Run Background Worker
Run the background worker daemon in another terminal window:
```bash
source venv/bin/activate  # On Windows: venv\Scripts\activate
python -m app.worker
```

#### 4. Run Frontend Dashboard
Move to the `frontend` folder, install npm packages, and run the Next.js dev server:
```bash
cd frontend
npm install
npm run dev
```

---

## Other Details

### LLM Processing & Prompting
Action items, due dates, categories, priorities, and potential risks are extracted using structured Pydantic schemas (defined in `app/schema.py`) and processed using Gemini/Groq APIs via LangChain. The LLM resolves relative dates (e.g., "tomorrow EOD") dynamically based on the current date metadata passed in the prompts.

### Google Meet Integration
Users can authenticate their Google accounts using a pop-up OAuth flow. Once connected, Google Meet video conferences can be scheduled, updated, or cancelled through the application, updating both the local database and the user's remote Google Calendar concurrently.
