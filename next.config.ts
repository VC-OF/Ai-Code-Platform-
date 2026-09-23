import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  // Turbopack's file watcher otherwise walks .platform/ (SQLite WAL files,
  // locked exclusively on Windows by better-sqlite3 while open) and
  // workspaces/ (agent-managed project files that change outside any
  // build-relevant way) — both are pure runtime data, never build inputs.
  turbopack: {
    root: __dirname,
  },
  outputFileTracingExcludes: {
    "*": [".platform/**", "workspaces/**"],
  },
};

export default nextConfig;
