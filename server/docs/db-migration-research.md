# Database Schema Initialization & Migration Research (2025-2026)

## 1. What Popular Open-Source Projects Do

| Project | Stack | Migration Tool | When Migrations Run | Pattern |
|---------|-------|---------------|---------------------|---------|
| **n8n** | TypeORM + Postgres/MySQL/SQLite | TypeORM migrations | Automatically on app startup | Entrypoint |
| **Immich** | TypeORM + Postgres | TypeORM `migrations:generate` | Automatically on server startup; part of the boot process | Entrypoint |
| **Cal.com** | Prisma + Postgres | Prisma Migrate (`prisma migrate deploy`) | Manual command (`yarn db-migrate`) or entrypoint script | Entrypoint / Manual |
| **Outline** | Sequelize + Postgres | Sequelize CLI migrations | `yarn sequelize:migrate` in docker entrypoint before `yarn start` | Entrypoint (chained command) |
| **Langfuse** | Prisma + Postgres | Prisma Migrate | Automatically during container startup; can be disabled via env var | Entrypoint |
| **Supabase** | Raw SQL | SQL files mounted at `/docker-entrypoint-initdb.d` | On first DB creation via Postgres init mechanism | Bind-mount SQL |
| **Appsmith** | Java/Spring + Postgres/Mongo | Flyway (for Postgres path) | On app startup | Entrypoint |

### Key Observation (Consensus)
**The overwhelming majority of self-hosted open-source apps run migrations automatically on application startup as part of the entrypoint.** This is the dominant pattern for single-instance self-hosted deployments. Separate migration containers are rare in this ecosystem.

---

## 2. Current Consensus on Key Questions

### App-level migrations on startup vs. separate migration containers vs. bind-mounting SQL

| Approach | When to Use | Who Uses It |
|----------|-------------|-------------|
| **App entrypoint (dominant)** | Single-instance self-hosted apps, small-to-medium scale | n8n, Immich, Outline, Langfuse, Appsmith |
| **Separate migration service** | Multi-replica production deployments, CI/CD pipelines | Kubernetes-native apps, enterprise setups |
| **Bind-mount SQL files** | Initial seed only (first boot), simple schemas | Supabase (for init), Docker Postgres `initdb.d` pattern |

**Opinion vs. Consensus:**
- **Consensus:** For single-instance Docker Compose self-hosted apps, running migrations in the entrypoint is standard and acceptable.
- **Expert opinion (scaling):** Itamar Turner-Trauring and others argue migrations should be decoupled from startup for production at scale because: (1) parallel migrations from multiple replicas can corrupt the DB, (2) rollbacks become harder when schema and code are tightly coupled, (3) canary deploys become impossible.
- **Practical consensus:** Use advisory locks or DB-level locking if running migrations at startup with potential for multiple replicas. `node-pg-migrate` has built-in advisory lock support.

### Migration Tools Popularity (Node.js/TypeScript, 2025-2026)

| Tool | Philosophy | Best For | Notes |
|------|-----------|----------|-------|
| **Prisma Migrate** | Declarative, schema-first | Full Prisma ORM users | "Gold standard for ease of use" — auto-diffs schema, generates SQL, warns about data loss |
| **Drizzle Kit** | Code-first TypeScript | Drizzle ORM users, SQL-savvy teams | Transparent SQL generation, manual validation needed, lightweight |
| **TypeORM** | Class-based, decorators | Legacy projects, Angular-style teams | Used by n8n and Immich; `synchronize: true` is dangerous in prod |
| **node-pg-migrate** | SQL-first, Postgres-only | Raw `pg` users, no-ORM projects | Lightweight, TypeScript support, advisory locks, atomic transactions |
| **Sequelize CLI** | Traditional ORM migrations | Sequelize users | Used by Outline; mature but aging |
| **Knex** | Query builder + migrations | Projects using Knex for queries | Solid migration framework, multi-DB support |
| **umzug** | Framework-agnostic runner | Custom migration pipelines | Low-level, used as engine inside Sequelize |

**2025-2026 Trend:** Drizzle is rapidly gaining mindshare as the "SQL-first" alternative to Prisma. For projects without an ORM, `node-pg-migrate` remains the go-to dedicated migration tool.

### Entrypoint vs. Separate Docker Compose Service

**For self-hosted single-instance apps (our case):** Entrypoint is standard.

```yaml
# Pattern used by Outline, Langfuse, and many others:
services:
  app:
    command: sh -c "npx node-pg-migrate up && node dist/index.js"
    depends_on:
      db:
        condition: service_healthy
```

**For multi-replica production:** Separate migration service with `service_completed_successfully`:

```yaml
services:
  migrate:
    image: myapp
    command: npx node-pg-migrate up
    depends_on:
      db:
        condition: service_healthy
  app:
    image: myapp
    command: node dist/index.js
    depends_on:
      migrate:
        condition: service_completed_successfully
    deploy:
      replicas: 3
```

---

## 3. Recommendation for Raw `pg` (node-postgres) Without an ORM

### Best Tool: `node-pg-migrate`

**Why:**
- Purpose-built for Postgres (leverages Postgres-specific features like advisory locks, enums, extensions)
- No ORM dependency — works with raw `pg` / `node-postgres`
- TypeScript support out of the box
- Each migration runs in a transaction (atomic — succeeds fully or rolls back)
- Advisory locks prevent concurrent migration issues
- Supports both JS/TS migration functions AND raw `.sql` files
- Active maintenance (Salsita Games)
- ~180K weekly npm downloads

**How it works:**
1. Migrations live in `/migrations` directory as timestamped files
2. Each exports `up()` and optionally `down()` functions
3. A `pgmigrations` table tracks applied migrations
4. `node-pg-migrate up` applies pending migrations
5. `node-pg-migrate down` reverts the last migration

**Example migration file:**
```typescript
// migrations/1711234567890_create-users.ts
import type { MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'varchar(255)', notNull: true, unique: true },
    password_hash: { type: 'varchar(255)', notNull: true },
    role: { type: 'varchar(50)', notNull: true, default: "'viewer'" },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('users');
}
```

**Integration pattern for Docker entrypoint:**
```bash
#!/bin/sh
set -e
# Wait for postgres (handled by depends_on + healthcheck)
# Run migrations
npx node-pg-migrate up --database-url-var DATABASE_URL --migrations-dir ./migrations
# Start the app
exec node dist/index.js
```

**Alternative: Drizzle Kit (if you want schema-as-code without full ORM)**
If you want to define your schema in TypeScript and auto-generate migrations (without using Drizzle's query builder), Drizzle Kit can generate SQL migration files from TS schema definitions. You'd still use raw `pg` for queries. This is a newer pattern gaining traction in 2025-2026.

---

## Summary Matrix

| Factor | Our Situation | Recommendation |
|--------|--------------|----------------|
| ORM usage | None (raw `pg`) | `node-pg-migrate` |
| Deployment | Docker Compose, single instance | Migrations in entrypoint |
| DB | PostgreSQL | Postgres-specific tool (not multi-DB) |
| Scale | Self-hosted, 1 replica | Entrypoint is fine; advisory locks as safety net |
| Schema complexity | Low-medium | Plain migration files, no ORM overhead |

---

## Sources

- [Immich Database Migrations](https://docs.immich.app/developer/database-migrations/)
- [Cal.com Database Migrations](https://cal.com/docs/self-hosting/database-migrations)
- [n8n Docker Docs](https://docs.n8n.io/hosting/installation/docker/)
- [node-pg-migrate GitHub](https://github.com/salsita/node-pg-migrate)
- [Decoupling DB Migrations from Startup](https://pythonspeed.com/articles/schema-migrations-server-startup/)
- [Node.js ORMs in 2025](https://thedataguy.pro/blog/2025/12/nodejs-orm-comparison-2025/)
- [Drizzle vs Prisma 2026](https://makerkit.dev/blog/tutorials/drizzle-vs-prisma)
- [Drizzle vs Prisma (Bytebase)](https://www.bytebase.com/blog/drizzle-vs-prisma/)
- [Docker Pre-seeding Database](https://docs.docker.com/guides/pre-seeding/)
- [Running SQL Migrations Before Docker Compose Services](https://blog.alec.coffee/running-sql-migrations-before-booting-docker-compose-services)
- [Migrations with Node.js and PostgreSQL (MaibornWolff)](https://www.maibornwolff.de/en/know-how/migrations-nodejs-and-postgresql/)
- [Database Migrations with Node.js and PostgreSQL (Synvinkel)](https://synvinkel.org/notes/node-postgres-migrations)
