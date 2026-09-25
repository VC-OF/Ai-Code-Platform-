# Language Runtime & Sidecars Reference Matrix

## 1. Supported Language Sandboxes

| Language / Framework | Detection File(s) | Default Official Docker Image | Persistent Cache Named Volume | Container Mount Path | Default Workdir |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Rust** | `Cargo.toml` | `rust:1.77-slim` | `opencode-cargo-cache`<br>`opencode-rust-target-cache` | `/root/.cargo`<br>`/workspace/target` | `/workspace` |
| **Go** | `go.mod` | `golang:1.22-alpine` | `opencode-go-cache`<br>`opencode-go-build-cache` | `/go/pkg/mod`<br>`/root/.cache/go-build` | `/workspace` |
| **Python** | `requirements.txt`<br>`pyproject.toml`<br>`Pipfile` | `python:3.11-slim` | `opencode-pip-cache` | `/root/.cache/pip` | `/workspace` |
| **Node.js / Web** | `package.json` | `node:20-slim` | `opencode-npm-cache` | `/root/.npm` | `/workspace` |
| **Generic Shell** | *Fallback* | `node:20-slim` | *None* | `/workspace` | `/workspace` |

---

## 2. Supported Database Sidecars

| Service | Official Image | Default Host Port | Default Container Port | Data Volume | Injected Environment Variables |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **PostgreSQL** | `postgres:16-alpine` | `5432` *(auto-incremented if bound)* | `5432` | `opencode-pgdata-{project_id}` | `DATABASE_URL=postgresql://postgres:postgres@localhost:{port}/devdb`<br>`PGHOST=localhost`<br>`PGPORT={port}`<br>`PGUSER=postgres`<br>`PGDATABASE=devdb` |
| **Redis** | `redis:7-alpine` | `6379` *(auto-incremented if bound)* | `6379` | `opencode-redisdata-{project_id}` | `REDIS_URL=redis://localhost:{port}`<br>`REDIS_HOST=localhost`<br>`REDIS_PORT={port}` |

---

## 3. Recommended Run Flags for Container Execution

When spawning a project run or build command:
```bash
docker run --rm \
  -v "{project_abs_path}:/workspace" \
  -v "{cache_volume}:{container_cache_path}" \
  -w /workspace \
  --network host \
  {image} \
  sh -c "{command}"
```
Using `--network host` (or container network linking) allows the sandbox container to communicate directly with any local sidecar services (`localhost:5432`, `localhost:6379`).
