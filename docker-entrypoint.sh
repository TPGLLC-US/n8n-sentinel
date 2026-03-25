#!/bin/sh
set -e

# ─── Validate required environment variables ────────────────────────────
REQUIRED_VARS="SESSION_SECRET ENCRYPTION_KEY SENTINEL_ADMIN_EMAIL SENTINEL_ADMIN_PASSWORD DATABASE_URL"

for var in $REQUIRED_VARS; do
  eval val=\$$var
  if [ -z "$val" ]; then
    echo "FATAL: Required environment variable $var is not set."
    echo "Copy .env.example to .env and configure your environment."
    exit 1
  fi
done

# ─── Wait for PostgreSQL ────────────────────────────────────────────────
echo "[entrypoint] Waiting for PostgreSQL..."
RETRIES=30
until node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "FATAL: Could not connect to PostgreSQL after 30 seconds."
    exit 1
  fi
  echo "[entrypoint] PostgreSQL not ready, retrying... ($RETRIES attempts left)"
  sleep 1
done
echo "[entrypoint] PostgreSQL is ready."

# ─── Run database migrations ────────────────────────────────────────────
node migrate.js

# ─── Start the application ──────────────────────────────────────────────
echo "[entrypoint] Starting n8n Sentinel..."
exec node dist/index.js
