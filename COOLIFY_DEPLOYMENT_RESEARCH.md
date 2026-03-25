# Coolify Docker Compose Deployment Research

> Researched 2026-03-25 from official Coolify docs (coolify.io/docs). Coolify v4.x (beta).

---

## 1. Docker Compose Support

Coolify **natively supports `docker-compose.y[a]ml`** files. The compose file is the **single source of truth** -- UI settings like env vars and storage must be defined in the compose file itself.

Two deployment modes:
- **Standard Compose**: Coolify adds magic env vars, networking, and proxy config automatically.
- **Raw Compose Deployment**: For advanced users. Coolify runs `docker compose` directly with minimal intervention. You must manually add Traefik labels for routing.

Coolify uses the Docker Compose V2 CLI (`docker compose`, not the legacy `docker-compose`).

---

## 2. Environment Variables

### Defining in Compose
```yaml
services:
  myservice:
    environment:
      - HARD_CODED=dev                    # Not visible in Coolify UI
      - MY_VAR=${MY_VAR_IN_COOLIFY_UI}   # Creates editable variable in UI
```

Variables referenced with `${VAR}` syntax automatically appear in the Coolify UI for editing.

### Magic Environment Variables
Coolify auto-generates values using `SERVICE_<TYPE>_<IDENTIFIER>` syntax:

| Type | What it generates | Example |
|------|-------------------|---------|
| `SERVICE_URL_<ID>` | Full URL for service | `http://app-vgsco4o.example.com` |
| `SERVICE_URL_<ID>_3000` | URL with port routing | `http://app-vgsco4o.example.com:3000` |
| `SERVICE_FQDN_<ID>` | FQDN portion only | `app-vgsco4o.example.com` |
| `SERVICE_PASSWORD_<ID>` | Random password | `G7hkL9mpQ2rT4vXw` |
| `SERVICE_USER_<ID>` | Random username | `a8Kd3fR2mNpQ1xYz` |
| `SERVICE_BASE64_<ID>` | Random base64 string | (32 chars default) |
| `SERVICE_PASSWORD64_<ID>` | 64-char password | (longer password) |

**Important**: Identifiers with underscores (`_`) cannot use ports. Use hyphens instead:
```
SERVICE_URL_APPWRITE_SERVICE_3000   # WRONG
SERVICE_URL_APPWRITE-SERVICE_3000   # CORRECT
```

Generated values persist between deployments and are consistent across all services in the stack.

### Required Variables
```yaml
services:
  app:
    environment:
      - DATABASE_URL=${DATABASE_URL:?Database URL is required}
```
The `:?` syntax marks variables as required -- they show a red border in the UI if empty.

### Build vs Runtime Variables
- **Build variables**: Injected during image build via `--env-file` (stored at `/artifacts/build-time.env`)
- **Runtime variables**: Available in running containers via `.env` file
- Both flags enabled by default; can be toggled independently in UI

### Shared Variables
Coolify supports shared variables scoped at **Team**, **Project**, and **Environment** levels for reuse across resources.

---

## 3. Persistent Storage / Volumes

### Named Volumes (Recommended for PostgreSQL)
```yaml
services:
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

### Bind Mounts with Dynamic Paths
```yaml
services:
  myservice:
    volumes:
      - data-persist:/var/data

volumes:
  data-persist:
    device: /mnt/serverstorage/${SOME_VARIABLE_IN_COOLIFY_UI}
```

### Creating Empty Directories (Coolify Extension)
```yaml
services:
  filebrowser:
    image: filebrowser/filebrowser:latest
    volumes:
      - type: bind
        source: ./srv
        target: /srv
        is_directory: true  # Coolify-specific: creates directory if missing
```

> `is_directory: true` is a Coolify-specific extension not available in standard Docker Compose.

---

## 4. Networking Between Services

### Default Behavior
- Coolify creates **a dedicated network per compose stack**, named with the resource UUID.
- Services within the same stack communicate via service name:
  ```
  backend -> http://db:5432
  backend -> http://redis:6379
  ```
- Standard Docker Compose DNS resolution applies within the stack.

### Cross-Stack Communication
Enable **"Connect to Predefined Network"** on the Service Stack page to allow communication between separate stacks. Caveats:
- Service names get suffixed: `postgres` becomes `postgres-<uuid>`
- You must use `postgres-<uuid>` as the hostname
- Internal Docker DNS may not work as expected

### Private Services
If you don't map ports or assign a domain, the service stays **completely private** within the Docker network. This is ideal for PostgreSQL.

---

## 5. Exposing Services to the Internet (Reverse Proxy)

### Traefik (Default Proxy)
Coolify uses **Traefik** as the default reverse proxy. Two approaches:

**Approach A: Domain Assignment in UI**
After loading the compose file, Coolify lists all services. You assign a domain per service in the UI.
- If app listens on port 80: just enter `https://app.example.com`
- If app listens on port 3000: enter `https://app.example.com:3000` (the `:3000` tells Coolify which container port to route to; external traffic still goes to 80/443)

**Approach B: Traefik Labels (Raw Compose)**
```yaml
services:
  app:
    image: your-app:latest
    labels:
      - traefik.enable=true
      - "traefik.http.routers.my-app.rule=Host(`app.example.com`) && PathPrefix(`/`)"
      - traefik.http.routers.my-app.entryPoints=http
```

### Caddy (Alternative)
Coolify also supports **Caddy** as an alternative proxy. You can select it in server settings.

### Direct Port Mapping (Bypass Proxy)
```yaml
services:
  backend:
    ports:
      - "3000:3000"         # Exposed on all interfaces (CAUTION)
      - "127.0.0.1:5432:5432"  # Localhost only (safer for DB access)
```

> **Warning**: Direct port mapping bypasses the proxy entirely. The service is exposed on the host at that port.

---

## 6. Coolify-Specific Configuration

### Auto-Added Labels
Coolify always adds these labels (if not already set):
```yaml
labels:
  - coolify.managed=true
  - coolify.applicationId=5
  - coolify.type=application
```

### Coolify-Specific Compose Extensions
- `is_directory: true` on bind mount volumes (creates directories)
- `exclude_from_hc: true` on services (excludes from health checks)

### DNS Configuration
- Set an A record pointing your domain to your server's IP
- Wildcard domains (`*.example.com`) can be configured on the Server settings page for auto-generated subdomains

---

## 7. Best Practices & Gotchas

1. **Compose file is the single source of truth.** Don't rely on UI settings for compose deployments -- they won't be applied. Define everything in the YAML.

2. **Don't expose database ports directly.** Keep PostgreSQL private (no `ports` mapping). Access it only via the internal Docker network (`http://db:5432`).

3. **Use magic env vars for passwords.** `SERVICE_PASSWORD_POSTGRES` auto-generates and persists a secure password.

4. **Use `${VAR}` syntax for UI-editable variables.** Hard-coded values in the compose file won't appear in the Coolify UI.

5. **Identifier naming**: Use hyphens, not underscores, in magic env var identifiers when ports are involved.

6. **Predefined Network gotcha**: Enabling cross-stack networking changes service hostnames to `<name>-<uuid>` and may break internal DNS.

7. **Port notation in domains**: When assigning a domain for a service that doesn't listen on port 80, include the container port in the domain field (e.g., `https://app.example.com:3000`).

8. **Raw Compose for full control**: If Coolify's magic interferes with your setup, use "Raw Compose Deployment" mode and manage everything yourself.

9. **Magic env vars require Coolify v4.0.0-beta.411+** for Git-source compose files.

---

## 8. Health Checks

Docker Compose healthchecks work as normal:
```yaml
services:
  app:
    image: your-app:latest
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### Excluding Services from Health Checks
```yaml
services:
  migration:
    image: your-migration:latest
    exclude_from_hc: true   # Coolify-specific: skip this service in health checks
```

> Useful for one-off services like database migrations that exit after running.

---

## 9. SSL/TLS Certificates

- Coolify **automatically provisions and renews Let's Encrypt SSL certificates** for all custom domains.
- When you assign `https://app.example.com` as a domain, Coolify handles the certificate automatically via Traefik.
- No manual certificate configuration needed for standard setups.
- Multiline env vars can store custom TLS certificates if needed (use "Multiline" checkbox in Normal view).

---

## 10. Current Version & Recent Changes

- **Current**: Coolify v4.x (still in beta as of v4.0.0-beta series)
- Magic env vars for Git-source compose: requires **v4.0.0-beta.411+**
- Coolify is open source and actively developed (twitch.tv/heyandras for live streams)
- Supports 280+ one-click services
- Has a CLI tool: github.com/coollabsio/coolify-cli

---

## Example: Node.js Monorepo + PostgreSQL on Coolify

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://${SERVICE_USER_POSTGRES}:${SERVICE_PASSWORD_POSTGRES}@db:5432/${POSTGRES_DB:-myapp}
      - SERVICE_FQDN_APP_3000   # Tells Coolify to generate/route FQDN to port 3000
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=${SERVICE_USER_POSTGRES}
      - POSTGRES_PASSWORD=${SERVICE_PASSWORD_POSTGRES}
      - POSTGRES_DB=${POSTGRES_DB:-myapp}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
```

### Key points about this example:
- `SERVICE_FQDN_APP_3000` tells Coolify to generate a domain and route traffic to container port 3000
- `SERVICE_USER_POSTGRES` and `SERVICE_PASSWORD_POSTGRES` auto-generate consistent credentials
- PostgreSQL has no `ports` mapping -- it's only accessible within the Docker network
- Named volume `pgdata` persists database data across deployments
- Health checks ensure proper startup ordering and monitoring
