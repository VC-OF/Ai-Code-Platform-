# ─── Stage 1: Dependencies ────────────────────────────────────────────────────
FROM node:20-alpine AS deps

# Install system dependencies
RUN apk add --no-cache \
    git \
    python3 \
    make \
    g++ \
    libc6-compat

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --frozen-lockfile

# ─── Stage 2: Builder ─────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build environment
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Type check before building
RUN npm run typecheck

# Build Next.js app
RUN npm run build

# ─── Stage 3: Runner ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

# Security: add non-root user
RUN addgroup --system --gid 1001 opencode && \
    adduser  --system --uid 1001 opencode

# Install runtime dependencies only
RUN apk add --no-cache \
    git \
    grep \
    findutils \
    curl

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy built assets
COPY --from=builder /app/public       ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static  ./.next/static

# Create workspace directories owned by app user
RUN mkdir -p \
    workspaces \
    .platform \
    .settings \
    logs && \
    chown -R opencode:opencode \
    workspaces \
    .platform \
    .settings \
    logs \
    /app

# Switch to non-root user
USER opencode

# Configure git for the app user
RUN git config --global user.email "agent@opencode.local" && \
    git config --global user.name  "Open Code Agent"      && \
    git config --global init.defaultBranch main

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
