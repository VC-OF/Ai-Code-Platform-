---
name: docker-power-tools
description: Comprehensive skill for autonomous Docker operations, containerized multi-language execution (Python, Rust, Node, Go, C++), database container provisioning (Postgres, Redis), and Dockerfile/Compose generation.
---

# Docker Power Tools & Containerized Execution

This skill empowers the agent to execute code within isolated Docker containers, provision local services, and manage container lifecycles.

## 1. Multi-Language Containerized Execution

The platform integrates Docker directly into the agent execution loop and exposes the `docker_run` tool.

### When to use `docker_run`:
- Running code in non-Node environments (Python, Rust, Go, C++, PHP, Ruby).
- Executing bash scripts requiring full Linux shell syntax (pipes, redirection, process substitution).
- Testing package builds in clean, reproducible environments without host contamination.

### Examples:
- **Node.js environment**: `docker_run` with default image (`node:20-slim`)
- **Python environment**: `docker_run` with `image: "python:3.11-slim"`
- **Lightweight Linux**: `docker_run` with `image: "alpine:3"`

## 2. Docker Health & Container Inspection

- Check status using the `docker_status` tool or the `/docker` slash command.
- Inspect allocated memory, CPU limits, running container counts, and available images.

## 3. Database & Service Provisioning

When building full-stack applications requiring persistence:
- **PostgreSQL**: `docker run -d --name app-postgres -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine`
- **Redis**: `docker run -d --name app-redis -p 6379:6379 redis:alpine`

Always check existing running containers before launching duplicate service names.
