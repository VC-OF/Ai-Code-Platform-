---
name: docker-runtimes-and-sidecars
description: >-
  Detects project programming language runtimes (Rust, Go, Python, Node.js), configures container execution with persistent toolchain cache volumes, and manages on-demand database sidecars (PostgreSQL, Redis) with auto-injected connection strings.
---

# Docker Multi-Language Runtimes & Database Sidecars

## Overview
This skill provides an automated workflow to detect a project's programming language, choose the optimal lightweight official container image (`rust:1.77-slim`, `golang:1.22-alpine`, `python:3.11-slim`, `node:20-slim`), mount persistent toolchain cache volumes to keep incremental builds fast, and launch database sidecars (PostgreSQL, Redis) on-demand with automatic environment variable injection.

## Dependencies
- **`uv`**: Required to run the helper CLI script (`scripts/docker_runtime.py`) safely across platforms.
- **Docker Engine / Desktop**: For containerized compilation, testing, and sidecar hosting. If Docker is offline, the workflow falls back gracefully to host execution.

## Quick Start

### 1. Detect Project Runtime & Image
```bash
uv run scripts/docker_runtime.py detect --project-path /path/to/project --output /tmp/runtime.json
```

### 2. Launch a Database Sidecar
```bash
uv run scripts/docker_runtime.py sidecar --type postgres --action start --project-id my-project --output /tmp/sidecar.json
```

### 3. Check Engine & Containers Status
```bash
uv run scripts/docker_runtime.py status --output /tmp/status.json
```

---

## Utility Scripts

The skill includes a multi-command Python helper at `scripts/docker_runtime.py`:

- **`detect`**:
  - Arguments: `--project-path <path> --output <file>`
  - Scans for `Cargo.toml`, `go.mod`, `requirements.txt`, `package.json`.
  - Returns runtime identifier, recommended official image, cache volumes, and workdir.

- **`sidecar`**:
  - Arguments: `--type <postgres|redis> --action <start|stop|status> --project-id <id> [--port <port>] --output <file>`
  - Manages standalone database sidecars with persistent data volumes.
  - Automatically avoids port collisions and returns connection strings (`DATABASE_URL`, `REDIS_URL`).

- **`status`**:
  - Arguments: `--output <file>`
  - Inspects whether Docker daemon is active and lists running project containers.

---

## Workflow

### 1. Check Docker Daemon Availability
Before executing build, test, or run commands:
1. Run `uv run scripts/docker_runtime.py status --output /tmp/status.json`.
2. Inspect the JSON output:
   - If `dockerAvailable: true`, proceed with container sandbox.
   - If `dockerAvailable: false`, log a warning and proceed with host execution (`run_command`).

### 2. Detect Language & Configure Cache
1. Run `detect` on the workspace directory:
   ```bash
   uv run scripts/docker_runtime.py detect --project-path "<workspace_dir>" --output /tmp/runtime.json
   ```
2. Read `/tmp/runtime.json` to extract `image` and `cacheVolumes`.
3. Construct the container run command with volume mounts:
   - For Rust: `-v opencode-cargo-cache:/root/.cargo`
   - For Go: `-v opencode-go-cache:/go/pkg/mod`
   - For Python: `-v opencode-pip-cache:/root/.cache/pip`
   - For Node: `-v opencode-npm-cache:/root/.npm`

### 3. Provision Database Sidecars On-Demand
When a project requires a database (e.g. testing an SQL schema or caching):
1. Launch the sidecar:
   ```bash
   uv run scripts/docker_runtime.py sidecar --type postgres --action start --project-id "<project_id>" --output /tmp/pg.json
   ```
2. Extract the generated `DATABASE_URL` from `/tmp/pg.json`.
3. Pass `DATABASE_URL` as an environment variable (`-e DATABASE_URL=...`) to subsequent container test and run steps.
4. When finished or when instructed by the user, stop the sidecar with `--action stop`.

---

## Error Handling & Fallback
- **Docker Unavailable**: Do not halt or throw an unrecoverable error. Warn the user that Docker is offline and fall back cleanly to host execution.
- **Port In Use**: The `sidecar` script automatically probes the next available port if default `5432` or `6379` is already bound.
- **Incremental Builds**: Always mount the recommended cache named volumes so that languages like Rust and Go do not re-download crates or recompile entire dependency trees on every turn.
