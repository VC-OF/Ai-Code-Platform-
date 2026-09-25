#!/usr/bin/env python3
"""
CLI Helper for Docker Multi-Language Runtimes and Database Sidecars.
Provides runtime detection, persistent cache volume configuration, and sidecar lifecycle management.
"""

import argparse
import json
import os
import socket
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


def run_cmd(args: List[str], timeout: int = 15) -> Dict[str, Any]:
    """Run a shell/docker command safely and return output."""
    try:
        proc = subprocess.run(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout,
            shell=False,
        )
        return {
            "success": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout": proc.stdout.strip(),
            "stderr": proc.stderr.strip(),
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "returncode": -1, "stdout": "", "stderr": f"Command timed out after {timeout}s"}
    except Exception as e:
        return {"success": False, "returncode": -1, "stdout": "", "stderr": str(e)}


def check_port_open(port: int, host: str = "127.0.0.1") -> bool:
    """Check if a local TCP port is already in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, port)) == 0


def find_available_port(start_port: int, max_attempts: int = 20) -> int:
    """Find the next available port starting from start_port."""
    for p in range(start_port, start_port + max_attempts):
        if not check_port_open(p):
            return p
    return start_port


def cmd_status(args: argparse.Namespace) -> Dict[str, Any]:
    """Inspect Docker daemon and active containers."""
    ping = run_cmd(["docker", "info", "--format", "{{json .}}"])
    if not ping["success"]:
        return {
            "success": False,
            "dockerAvailable": False,
            "error": ping["stderr"] or "Docker daemon is not running or unreachable",
            "fallback": "host",
        }

    ps = run_cmd(["docker", "ps", "--format", "{{json .}}"])
    running_containers = []
    if ps["success"] and ps["stdout"]:
        for line in ps["stdout"].splitlines():
            try:
                running_containers.append(json.loads(line))
            except Exception:
                pass

    return {
        "success": True,
        "dockerAvailable": True,
        "containersRunning": len(running_containers),
        "containers": running_containers,
    }


def cmd_detect(args: argparse.Namespace) -> Dict[str, Any]:
    """Detect project language runtime and return optimal image and cache volumes."""
    project_path = Path(args.project_path).resolve()
    if not project_path.exists():
        return {
            "success": False,
            "error": f"Project path does not exist: {project_path}",
        }

    # Inspection rules
    has_cargo = (project_path / "Cargo.toml").exists()
    has_go = (project_path / "go.mod").exists()
    has_python = (
        (project_path / "requirements.txt").exists()
        or (project_path / "pyproject.toml").exists()
        or (project_path / "Pipfile").exists()
    )
    has_node = (
        (project_path / "package.json").exists()
        or (project_path / "node_modules").exists()
    )

    if has_cargo:
        return {
            "success": True,
            "runtime": "rust",
            "image": "rust:1.77-slim",
            "displayName": "Rust (Cargo)",
            "cacheVolumes": [
                {"name": "opencode-cargo-cache", "mount": "/root/.cargo"},
                {"name": "opencode-rust-target-cache", "mount": "/workspace/target"},
            ],
            "workdir": "/workspace",
            "sampleCommand": "cargo build",
        }
    elif has_go:
        return {
            "success": True,
            "runtime": "go",
            "image": "golang:1.22-alpine",
            "displayName": "Go",
            "cacheVolumes": [
                {"name": "opencode-go-cache", "mount": "/go/pkg/mod"},
                {"name": "opencode-go-build-cache", "mount": "/root/.cache/go-build"},
            ],
            "workdir": "/workspace",
            "sampleCommand": "go build ./...",
        }
    elif has_python:
        return {
            "success": True,
            "runtime": "python",
            "image": "python:3.11-slim",
            "displayName": "Python",
            "cacheVolumes": [
                {"name": "opencode-pip-cache", "mount": "/root/.cache/pip"},
            ],
            "workdir": "/workspace",
            "sampleCommand": "python3 -m unittest discover",
        }
    elif has_node:
        return {
            "success": True,
            "runtime": "node",
            "image": "node:20-slim",
            "displayName": "Node.js",
            "cacheVolumes": [
                {"name": "opencode-npm-cache", "mount": "/root/.npm"},
            ],
            "workdir": "/workspace",
            "sampleCommand": "npm test",
        }
    else:
        return {
            "success": True,
            "runtime": "generic",
            "image": "node:20-slim",
            "displayName": "Generic Sandbox",
            "cacheVolumes": [],
            "workdir": "/workspace",
            "sampleCommand": "ls -la",
        }


def cmd_sidecar(args: argparse.Namespace) -> Dict[str, Any]:
    """Start, stop, or check status of a database sidecar container."""
    sidecar_type = args.type.lower()
    action = args.action.lower()
    project_id = args.project_id or "default"
    container_name = f"opencode-{project_id}-{sidecar_type}"

    if action == "status":
        res = run_cmd(["docker", "inspect", container_name, "--format", "{{.State.Status}}"])
        is_running = res["success"] and res["stdout"] == "running"
        return {
            "success": True,
            "containerName": container_name,
            "type": sidecar_type,
            "status": res["stdout"] if res["success"] else "not_found",
            "running": is_running,
        }

    elif action == "stop":
        res = run_cmd(["docker", "rm", "-f", container_name])
        return {
            "success": res["success"],
            "containerName": container_name,
            "action": "stopped",
            "error": res["stderr"] if not res["success"] else None,
        }

    elif action == "start":
        # Check if already running
        check = run_cmd(["docker", "inspect", container_name, "--format", "{{.State.Status}}"])
        if check["success"] and check["stdout"] == "running":
            # Extract bound port
            port_inspect = run_cmd([
                "docker", "port", container_name,
                "5432/tcp" if sidecar_type == "postgres" else "6379/tcp",
            ])
            port = 5432 if sidecar_type == "postgres" else 6379
            if port_inspect["success"] and port_inspect["stdout"]:
                try:
                    port = int(port_inspect["stdout"].split(":")[-1])
                except Exception:
                    pass
            env_map = (
                {"DATABASE_URL": f"postgresql://postgres:postgres@localhost:{port}/devdb"}
                if sidecar_type == "postgres"
                else {"REDIS_URL": f"redis://localhost:{port}"}
            )
            return {
                "success": True,
                "containerName": container_name,
                "type": sidecar_type,
                "status": "already_running",
                "port": port,
                "env": env_map,
            }

        # Remove stale container if stopped
        run_cmd(["docker", "rm", "-f", container_name])

        if sidecar_type == "postgres":
            target_port = args.port or find_available_port(5432)
            cmd = [
                "docker", "run", "-d",
                "--name", container_name,
                "-p", f"{target_port}:5432",
                "-e", "POSTGRES_USER=postgres",
                "-e", "POSTGRES_PASSWORD=postgres",
                "-e", "POSTGRES_DB=devdb",
                "-v", f"opencode-pgdata-{project_id}:/var/lib/postgresql/data",
                "postgres:16-alpine",
            ]
            launch = run_cmd(cmd)
            if not launch["success"]:
                return {"success": False, "error": launch["stderr"]}
            return {
                "success": True,
                "containerName": container_name,
                "type": "postgres",
                "status": "running",
                "port": target_port,
                "env": {
                    "DATABASE_URL": f"postgresql://postgres:postgres@localhost:{target_port}/devdb",
                    "PGHOST": "localhost",
                    "PGPORT": str(target_port),
                    "PGUSER": "postgres",
                    "PGPASSWORD": "postgres",
                    "PGDATABASE": "devdb",
                },
            }

        elif sidecar_type == "redis":
            target_port = args.port or find_available_port(6379)
            cmd = [
                "docker", "run", "-d",
                "--name", container_name,
                "-p", f"{target_port}:6379",
                "-v", f"opencode-redisdata-{project_id}:/data",
                "redis:7-alpine",
            ]
            launch = run_cmd(cmd)
            if not launch["success"]:
                return {"success": False, "error": launch["stderr"]}
            return {
                "success": True,
                "containerName": container_name,
                "type": "redis",
                "status": "running",
                "port": target_port,
                "env": {
                    "REDIS_URL": f"redis://localhost:{target_port}",
                    "REDIS_HOST": "localhost",
                    "REDIS_PORT": str(target_port),
                },
            }
        else:
            return {"success": False, "error": f"Unsupported sidecar type: {sidecar_type}"}

    return {"success": False, "error": f"Unknown action: {action}"}


def main():
    parser = argparse.ArgumentParser(
        description="Docker Multi-Language Runtime and Sidecar CLI helper"
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcommand: status
    parser_status = subparsers.add_parser("status", help="Check Docker daemon and active containers")
    parser_status.add_argument("--output", required=True, help="Path to write JSON output")

    # Subcommand: detect
    parser_detect = subparsers.add_parser("detect", help="Detect project language runtime & images")
    parser_detect.add_argument("--project-path", required=True, help="Absolute path to project directory")
    parser_detect.add_argument("--output", required=True, help="Path to write JSON output")

    # Subcommand: sidecar
    parser_sidecar = subparsers.add_parser("sidecar", help="Manage PostgreSQL and Redis sidecars")
    parser_sidecar.add_argument("--type", choices=["postgres", "redis"], required=True, help="Sidecar type")
    parser_sidecar.add_argument("--action", choices=["start", "stop", "status"], required=True, help="Action to execute")
    parser_sidecar.add_argument("--project-id", required=True, help="Project unique identifier")
    parser_sidecar.add_argument("--port", type=int, help="Optional port override")
    parser_sidecar.add_argument("--output", required=True, help="Path to write JSON output")

    args = parser.parse_args()

    if args.command == "status":
        result = cmd_status(args)
    elif args.command == "detect":
        result = cmd_detect(args)
    elif args.command == "sidecar":
        result = cmd_sidecar(args)
    else:
        result = {"success": False, "error": f"Unknown command: {args.command}"}

    # Write output to file (Rule 4)
    out_path = Path(args.output).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    if result.get("success"):
        print(f"Success! Result written to: {out_path}")
        sys.exit(0)
    else:
        print(f"Error: {result.get('error', 'Command failed')}. Details written to: {out_path}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
