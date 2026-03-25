# Deployment Assumptions Research

Research conducted 2026-03-25. Sources cited inline.

---

## Assumption 1: `node-pg-migrate` Programmatic API

### Can it be called from JS/TS code?
**Yes.** It exports a `runner` function that accepts an options object mirroring CLI args. You pass `databaseUrl` (or a `dbClient` pg.Client instance), `dir`, `direction: 'up'`, and other options.
- Source: [Programmatic API docs](https://salsita.github.io/node-pg-migrate/api)

### How does it handle already-applied migrations?
**Idempotent by design.** It records each applied migration in a tracking table (default: `pgmigrations`). On subsequent runs, it skips any migration already recorded. It does NOT re-run them.

### Does it create its own tracking table?
**Yes, automatically.** The `migrationsTable` option (default `pgmigrations`) is created if it doesn't exist. You can also set `createMigrationsSchema: true` to auto-create the schema holding that table.

### Can it run raw SQL files?
**Yes.** Files named `TIMESTAMP_name.sql` are supported. The loader strategy supports `'sql'` and `'legacySql'` modes. SQL migrations run the file contents directly. Caveat: no automatic down migration for `.sql` files.
- Source: [Defining Migrations](https://salsita.github.io/node-pg-migrate/migrations/)

---

## Assumption 2: Docker Compose `${VAR:-default}` Syntax

### Does it work in docker-compose.yml across Compose V2?
**Yes, in the compose YAML file itself.** The syntax `${VAR:-default}` is officially documented and supported in all Compose V2 versions. Supported forms: `${VAR:-default}`, `${VAR-default}`, `${VAR:?error}`, `${VAR:+replacement}`, and nested interpolation.
- Source: [Docker Compose Interpolation Reference](https://docs.docker.com/reference/compose-file/interpolation/)

### Known issues with special characters?
**Yes, several:**
- `$` in default values must be escaped as `$$`.
- Double quotes inside double-quoted values can break Compose V2 (worked in V1).
- Rule of thumb for Compose V2: wrap values containing special characters in **single quotes** in `.env` files.
- **Critical regression:** `${VAR:-default}` syntax does NOT work inside `.env` files in Compose V2. It only works in `docker-compose.yml` itself.
- Source: [docker/compose#9303](https://github.com/docker/compose/issues/9303), [docker/compose#8607](https://github.com/docker/compose/issues/8607)

### Cross-platform (Linux, macOS, Windows)?
**Yes.** Docker Compose V2 is a Go-based plugin shipped for Linux, macOS, and Windows via Docker Desktop. The interpolation engine is identical across platforms since it runs inside the Go binary, not the host shell. No platform-specific issues documented for the YAML-level interpolation.

---

## Assumption 3: `node:20-alpine` Health Check Tools

### Does it include `curl` or `wget`?
- **`wget`: YES** -- included by default in Alpine's BusyBox.
- **`curl`: NO** -- not included; must be installed via `apk add curl`.

### Best practice for health checks?
Three options, ranked:

| Approach | Pros | Cons |
|---|---|---|
| `wget --spider -q http://localhost:PORT/health` | Zero install, works out of the box on Alpine | BusyBox wget has limited options |
| `node -e "http.get('http://localhost:PORT/health', ...)"` | No extra binaries, works in distroless too | Slower startup (~40ms Node process spin-up) |
| `curl -f http://localhost:PORT/health` | Most flexible, familiar | Requires `apk add curl`, increases image size |

**Recommendation:** Use `wget` for Alpine images. Use the Node.js approach if targeting distroless/scratch.
- Source: [Docker Healthchecks in Distroless Node.js](https://www.mattknight.io/blog/docker-healthchecks-in-distroless-node-js), [Docker Health Check Best Practices](https://blog.sixeyed.com/docker-healthchecks-why-not-to-use-curl-or-iwr/)

---

## Assumption 4: Auto-Generating Secrets at Container Startup

### How do projects handle this?

| Project | Pattern |
|---|---|
| **n8n** | Expects secrets as env vars. Supports `_FILE` suffix to read from Docker/K8s secrets (e.g., `N8N_ENCRYPTION_KEY_FILE=/run/secrets/enc_key`). No auto-generation. |
| **Immich** | Requires user to set `JWT_SECRET` etc. Supports `CREDENTIALS_DIRECTORY=/run/secrets` for Docker secrets. No auto-generation at startup. |
| **Outline** | Requires `SECRET_KEY` and `UTILS_SECRET` to be pre-set. Docs provide `openssl rand -hex 32` as generation command. No auto-generation. |

### Shell entrypoint vs. Node app?
**The standard pattern is a shell entrypoint script** that:
1. Checks if a secret env var / file exists.
2. If not, generates one (`openssl rand -hex 32` or `node -e "crypto.randomBytes(32).toString('hex')"`) and writes it to a persistent file.
3. Exports it as an env var before `exec`-ing the Node process.

This is preferred over in-app generation because the secret must be **stable across restarts** (especially encryption keys, JWT secrets). Writing to a mounted volume ensures persistence.

### Common entrypoint pattern:
```bash
#!/bin/sh
SECRET_FILE="/data/.secret_key"
if [ ! -f "$SECRET_FILE" ]; then
  node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" > "$SECRET_FILE"
fi
export APP_SECRET=$(cat "$SECRET_FILE")
exec node dist/main.js
```
- Source: [n8n Docker Hub](https://hub.docker.com/r/n8nio/n8n), [Immich Environment Variables](https://docs.immich.app/install/environment-variables/), [entrypoint.sh for docker secret gist](https://gist.github.com/soloman1124/cdcf8e603f3064b2b49d614c6ed45a92)

---

## Assumption 5: Converting `dbschema.sql` to node-pg-migrate Initial Migration

### Can you use a raw SQL file as the first migration?
**Yes.** Name it with a timestamp prefix: `0000000000000_initial-schema.sql` (or use a real timestamp like `1711900000000_initial-schema.sql`). Place it in your migrations directory. node-pg-migrate will execute the SQL contents directly.

### File naming convention
Format: `{TIMESTAMP}_{name}.sql`
- Timestamp = milliseconds since Unix epoch (determines execution order).
- Convention: use `0000000000000` for a "genesis" migration that always runs first.
- Alternatively, use the CLI `node-pg-migrate create` which generates the timestamp automatically.

### Handling existing deployments (tables already exist)
**Use the `--fake` flag.** This marks the migration as applied in the `pgmigrations` table without executing it. Workflow:

1. **New deployments:** Migration runs normally, creates all tables.
2. **Existing deployments:** Run with `fake: true` (programmatic) or `--fake` (CLI) for the initial migration only. This records it as applied without executing the SQL.

Programmatically:
```js
await runner({
  databaseUrl: process.env.DATABASE_URL,
  dir: 'migrations',
  direction: 'up',
  fake: true,        // mark as applied without running
  file: '0000000000000_initial-schema',
  migrationsTable: 'pgmigrations',
});
```

A practical approach: in your entrypoint, check if the target tables already exist. If they do, fake the initial migration; otherwise, run it normally.
- Source: [node-pg-migrate GitHub](https://github.com/salsita/node-pg-migrate), [bitExpert blog on pg-migrate](https://blog.bitexpert.de/blog/migrations-with-node-pg-migrate)
