# Polyglot sandbox image for agent commands (safeExec docker mode).
# Build: npm run sandbox:build   ->   open-code-sandbox:1
#
# Runtime contract (see src/lib/safeExec.ts):
#   - workspace bind-mounted at /workspace, HOME=/workspace, runs as root
#   - toolchains therefore live OUTSIDE $HOME (/usr/local/...)
#   - a named volume is mounted at /cache for cargo registry, go mod/build,
#     pip and maven caches (paths set via the ENV below)
FROM node:20-bookworm

# Empty = resolve the current stable Go release from go.dev at build time
ARG GO_VERSION=

ENV DEBIAN_FRONTEND=noninteractive \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/cache/cargo \
    GOROOT=/usr/local/go \
    GOPATH=/cache/go \
    GOMODCACHE=/cache/go/pkg/mod \
    GOCACHE=/cache/go-build \
    PIP_CACHE_DIR=/cache/pip \
    UV_CACHE_DIR=/cache/uv \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    MAVEN_OPTS=-Dmaven.repo.local=/cache/m2 \
    JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 \
    PATH=/usr/local/cargo/bin:/usr/local/go/bin:/cache/go/bin:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git build-essential pkg-config libssl-dev \
      python3 python3-pip python3-venv python-is-python3 pipx \
      openjdk-17-jdk-headless maven \
      sqlite3 curl ca-certificates jq ripgrep make cmake \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# uv (fast pip/venv) + ruff + pytest as global tools
RUN PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install uv \
 && PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install ruff \
 && PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install pytest \
 && rm -rf /root/.cache

# Rust (minimal profile + clippy/rustfmt). Binaries go to /usr/local/cargo/bin;
# CARGO_HOME at runtime points at the cache volume for the registry.
RUN curl -sSf https://sh.rustup.rs | CARGO_HOME=/usr/local/cargo sh -s -- -y \
      --profile minimal --default-toolchain stable --component clippy,rustfmt --no-modify-path \
 && chmod -R a+rX /usr/local/rustup /usr/local/cargo \
 && rm -rf /usr/local/rustup/tmp/* /usr/local/rustup/downloads/*

# Go (official tarball)
RUN ARCH="$(dpkg --print-architecture)" \
 && V="${GO_VERSION:-$(curl -sSf 'https://go.dev/VERSION?m=text' | head -n1 | sed 's/^go//')}" \
 && curl -sSfL "https://go.dev/dl/go${V}.linux-${ARCH}.tar.gz" | tar -C /usr/local -xz

RUN mkdir -p /cache && chmod 777 /cache
WORKDIR /workspace
