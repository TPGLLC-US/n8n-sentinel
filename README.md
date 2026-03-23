# n8n Sentinel

**Centralized monitoring dashboard for [n8n](https://n8n.io) workflow automation instances.**

Monitor workflows, executions, AI token usage, and instance health — all from a single dashboard. Sentinel uses a push-based architecture: a lightweight Reporter workflow runs inside each n8n instance and sends HMAC-signed telemetry to the Sentinel server.

## Features

- **Multi-instance monitoring** — Track multiple n8n instances from one dashboard
- **Execution tracking** — Error rates, durations, workflow-level stats
- **AI token usage** — Per-model token consumption across all LLM nodes (OpenAI, Anthropic, Gemini, etc.)
- **Heartbeat monitoring** — Alerts when instances go offline
- **AI error diagnosis** — Claude-powered root cause analysis and auto-fix suggestions
- **Email reports** — Scheduled daily/weekly/monthly monitoring summaries via Resend
- **Secure ingestion** — HMAC-SHA256 signed payloads with per-instance authentication tokens
- **Replay protection** — Nonce + timestamp validation on all ingested data

## Stack

- **Server:** Node.js, Express 5, TypeScript, PostgreSQL
- **Client:** React 19, Vite, Tailwind CSS, Recharts
- **Auth:** HMAC-SHA256 for reporter ingestion, JWT for dashboard

## Quick Start

```bash
# Clone the repo
git clone https://github.com/your-org/n8n-sentinel.git
cd n8n-sentinel

# Install all dependencies
npm run install:all

# Copy environment config
cp .env.example .env
# Edit .env with your values (see Environment Variables below)

# Start the database
docker compose up -d db

# Start dev server (server + client)
npm run dev
```

- **Dashboard:** http://localhost:5173
- **API:** http://localhost:3000

## Setup

### 1. Database

```bash
# Using Docker
docker compose up -d db

# Schema is auto-applied via docker-entrypoint-initdb.d
# Or manually: psql -U sentinel -d sentinel -f dbschema.sql
```

### 2. Environment Variables

Copy `.env.example` to `.env` in the project root and fill in the required values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | **Yes** | JWT signing secret, min 32 chars. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `SENTINEL_ADMIN_EMAIL` | **Yes** | Admin login email (seeded on first startup) |
| `SENTINEL_ADMIN_PASSWORD` | **Yes** | Admin password, min 12 chars |
| `DATABASE_URL` | **Yes** | Postgres connection string |
| `CORS_ORIGIN` | Prod | Dashboard origin (e.g. `https://sentinel.example.com`). Defaults to `http://localhost:5173` in dev. |
| `ANTHROPIC_API_KEY` | No | Required for AI error diagnosis |

### 3. Register an n8n Instance

1. Log in to the dashboard with your admin email and password
2. Go to **Instances** → **Register New Instance**
3. Follow the 4-step modal to download and import the Reporter workflow into your n8n instance

### 4. Enable Token Usage Tracking

Token usage tracking requires a **read-only Postgres credential** on your n8n database so the Reporter workflow can extract token counts directly via SQL — without transferring large execution data blobs.

#### Step 1: Create a read-only Postgres user

You need four values from your n8n Postgres setup:

| Variable | Description | Example |
|---|---|---|
| `CONTAINER` | Docker container ID or name for your n8n Postgres | `9ec56066e4f3` |
| `DB_SUPERUSER` | Postgres user with CREATE ROLE privileges | `n8n_user` |
| `DB_NAME` | Your n8n database name | `n8n_db` |
| `RO_PASSWORD` | A strong password for the new read-only user | `eJVJtmTo...` |

**Find your container and database:**

```bash
# List running Postgres containers
docker ps --format '{{.Names}}\t{{.Image}}' | grep postgres

# Check what databases exist (replace CONTAINER and DB_SUPERUSER)
docker exec -it CONTAINER psql -U DB_SUPERUSER -l
```

**Create the user:**

```bash
docker exec -it CONTAINER psql -U DB_SUPERUSER -d DB_NAME -c "
CREATE USER n8n_sentinel_ro WITH PASSWORD 'RO_PASSWORD';
GRANT CONNECT ON DATABASE DB_NAME TO n8n_sentinel_ro;
GRANT USAGE ON SCHEMA public TO n8n_sentinel_ro;
GRANT SELECT ON execution_entity, execution_data TO n8n_sentinel_ro;
"
```

**Example with real values:**

```bash
docker exec -it 9ec56066e4f3 psql -U n8n_user -d n8n_db -c "
CREATE USER n8n_sentinel_ro WITH PASSWORD 'your_secure_password_here';
GRANT CONNECT ON DATABASE n8n_db TO n8n_sentinel_ro;
GRANT USAGE ON SCHEMA public TO n8n_sentinel_ro;
GRANT SELECT ON execution_entity, execution_data TO n8n_sentinel_ro;
"
```

> **Local Postgres (no Docker):**
> ```bash
> psql -U DB_SUPERUSER -d DB_NAME -c "
> CREATE USER n8n_sentinel_ro WITH PASSWORD 'RO_PASSWORD';
> GRANT CONNECT ON DATABASE DB_NAME TO n8n_sentinel_ro;
> GRANT USAGE ON SCHEMA public TO n8n_sentinel_ro;
> GRANT SELECT ON execution_entity, execution_data TO n8n_sentinel_ro;
> "
> ```

#### Step 2: Create the credential in n8n

1. In your n8n instance, go to **Settings → Credentials → Add Credential**
2. Select **Postgres**
3. Name it **`n8n Database`** (must match exactly)
4. Fill in:
   - **Host:** your Postgres host (`localhost`, container name, or `host.docker.internal` if n8n runs in Docker)
   - **Port:** `5432`
   - **Database:** your n8n database name (e.g. `n8n`)
   - **User:** `n8n_sentinel_ro`
   - **Password:** the password you set above
5. Click **Test Connection** to verify, then **Save**

#### Step 3: Assign the credential in the workflow

1. Open the **Sentinel Reporter** workflow in your n8n instance
2. Click the **Get Token Data** node
3. Under **Credential to connect with**, select the **n8n Database** credential you just created
4. Save the workflow

Token usage data will now appear on the dashboard after the next executions sync cycle (every 8 hours, or trigger manually via the webhook).

> **Supported node types:** Token tracking currently works for **Langchain chains and agents** (Basic LLM Chain, AI Agent, Information Extractor, Sentiment Analysis, etc.) which store full response data including token counts. Direct API nodes (Anthropic, OpenAI, Gemini, Ollama) with `simplify: true` (the default) strip token usage before storage — these are pending an n8n schema update to expose token metadata separately.

## Architecture

```
n8n Instance                               Sentinel Server
┌──────────────────────────┐               ┌────────────────────┐
│  Reporter Workflow        │               │                    │
│  ├─ Get Executions (HTTP) │──metadata────▶│  /<token>/ingest   │
│  ├─ Get Token Data (SQL)  │──tokens──────▶│                    │
│  ├─ Get Workflows (HTTP)  │──config──────▶│  Express API       │
│  └─ Sign HMAC + Send      │               │  PostgreSQL        │
└──────────────────────────┘               │  React Dashboard   │
                                           └────────────────────┘
```

Each instance gets a unique ingest URL: `https://your-sentinel.com/<account-token>/<instance-token>/ingest`

## Production Deployment

```bash
# Build everything
npm run build

# Run with Docker
docker compose up -d

# Or run directly
NODE_ENV=production npm start
```

> **Important:** In production, all required environment variables (`SESSION_SECRET`, `SENTINEL_ADMIN_EMAIL`, `SENTINEL_ADMIN_PASSWORD`, `DATABASE_URL`) must be set. The server will refuse to start without them.

## Development

```bash
# Build the reporter workflow (after editing templates/scripts)
node workflow/build.js

# Server only
npm run dev --prefix server

# Client only
npm run dev --prefix client
```

### Workflow Build System

The reporter workflow is compiled from templates:

- **`workflow/workflow.template.json`** — Node definitions and connections
- **`workflow/scripts/*.js`** — Code node scripts (injected via `{{SCRIPT:name}}`)
- **`workflow/sql/*.sql`** — Postgres queries (injected via `{{SQL:name}}`)
- **`workflow/build.js`** — Compiler that produces `client/public/reporter-workflow.json`

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feat/my-feature`)
5. Open a Pull Request

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

This means you can freely use, modify, and distribute this software, but if you run a modified version as a network service, you must make the source code available to users of that service.
