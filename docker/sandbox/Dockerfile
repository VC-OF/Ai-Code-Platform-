# Polyglot sandbox image for agent commands (safeExec docker mode).
# Build: npm run sandbox:build   ->   open-code-sandbox:1
# Toolchains: Node, Python 3 (+ NumPy/SciPy/SymPy/pandas/matplotlib/Jupyter),
# Rust, Go, Java/Maven, gcc/g++/gfortran; Julia and R are opt-in build args.
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
      git build-essential gfortran pkg-config libssl-dev \
      python3 python3-pip python3-venv python-is-python3 pipx \
      openjdk-17-jdk-headless maven \
      sqlite3 curl ca-certificates jq ripgrep make cmake \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

# Scientific Python stack importable by the system python3 (execute_code,
# run_notebook): NumPy/SciPy/SymPy/pandas/matplotlib, units/uncertainties,
# HDF5, graphs, plus Jupyter for notebooks. Projects still create their own
# .venv for their pinned dependencies.
RUN python3 -m pip install --break-system-packages --no-cache-dir \
      numpy scipy sympy matplotlib pandas pint uncertainties h5py networkx tqdm \
      jupyter nbconvert nbformat ipykernel pytest \
 && rm -rf /root/.cache
ENV MPLBACKEND=Agg

# Optional extra runtimes for execute_code / run_command:
#   docker build --build-arg JULIA_VERSION=1.11.3 --build-arg WITH_R=1 -t open-code-sandbox:1 docker/sandbox
ARG JULIA_VERSION=
ARG WITH_R=0
RUN if [ -n "$JULIA_VERSION" ]; then \
      ARCH="$(uname -m)"; case "$ARCH" in x86_64) JARCH=x64;; aarch64) JARCH=aarch64;; *) JARCH="$ARCH";; esac; \
      MAJOR="${JULIA_VERSION%.*}"; \
      curl -sSfL "https://julialang-s3.julialang.org/bin/linux/${JARCH}/${MAJOR}/julia-${JULIA_VERSION}-linux-${ARCH}.tar.gz" | tar -C /opt -xz \
      && ln -s "/opt/julia-${JULIA_VERSION}/bin/julia" /usr/local/bin/julia; \
    fi \
 && if [ "$WITH_R" = "1" ]; then \
      apt-get update && apt-get install -y --no-install-recommends r-base \
      && apt-get clean && rm -rf /var/lib/apt/lists/*; \
    fi

# uv (fast pip/venv) + ruff as global tools. pytest is deliberately NOT a
# pipx tool: an isolated venv could not import the scientific stack above,
# so it is installed into the system python (see the pip layer).
RUN PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install uv \
 && PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install ruff \
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
