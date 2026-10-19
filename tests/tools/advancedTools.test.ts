import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { executeTool, createTurnContext } from "@/lib/tools";
import { createWorkspace, TestWorkspace } from "../helpers/workspace";

describe("Advanced Agent Tools", () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await createWorkspace({
      "src/index.ts": `import { log } from './logger';

export function add(a: number, b: number): number {
  console.log("Adding numbers", a, b);
  return a + b;
}

export function multiply(a: number, b: number): number {
  console.log("Multiplying", a, b);
  return a * b;
}
`,
      "src/logger.ts": `export function log(msg: string) {
  console.log("[LOG]", msg);
}
`,
    });
  });

  afterEach(async () => {
    await ws.cleanup().catch(() => {});
  });

  // ─── 1. AST Search & Replace Tools ──────────────────────────────────────────

  describe("ast_grep_search & ast_grep_replace", () => {
    it("finds AST matches with metavariables and extracts bindings", async () => {
      const ctx = createTurnContext();
      const res = await executeTool(
        "ast_grep_search",
        {
          pattern: 'console.log($$$ARGS)',
          path: "src",
        },
        ws.root,
        ctx
      );

      expect(res.success).toBe(true);
      expect(res.output).toContain("console.log");
      expect(res.output).toContain("Adding numbers");
      expect(res.output).toContain("Multiplying");
      expect((res.extra as { matchCount: number }).matchCount).toBe(3);
    });

    it("matches AST patterns independent of formatting and whitespace", async () => {
      await ws.write(
        "src/formatting.ts",
        `
        function compute(
          x: number,
          y: number
        ) {
          return x + y;
        }
        `
      );

      const ctx = createTurnContext();
      const res = await executeTool(
        "ast_grep_search",
        {
          pattern: "function compute($$$PARAMS) { return x + y; }",
          path: "src/formatting.ts",
        },
        ws.root,
        ctx
      );

      expect(res.success).toBe(true);
      expect((res.extra as { matchCount: number }).matchCount).toBe(1);
    });

    it("previews AST replacements in dry-run mode without modifying disk", async () => {
      const ctx = createTurnContext();
      const res = await executeTool(
        "ast_grep_replace",
        {
          pattern: "console.log($$$ARGS)",
          rewrite: "customLogger.info($$$ARGS)",
          path: "src/index.ts",
          dry_run: true,
        },
        ws.root,
        ctx
      );

      expect(res.success).toBe(true);
      expect(res.output).toContain("[DRY RUN]");
      expect(res.output).toContain("customLogger.info($$$ARGS)");

      // Verify file was NOT modified
      const content = await ws.read("src/index.ts");
      expect(content).toContain("console.log");
      expect(content).not.toContain("customLogger.info");
    });

    it("replaces AST nodes and preserves bound metavariables and indentation", async () => {
      const ctx = createTurnContext();
      const res = await executeTool(
        "ast_grep_replace",
        {
          pattern: "console.log($$$ARGS)",
          rewrite: "log($$$ARGS)",
          path: "src/index.ts",
          dry_run: false,
        },
        ws.root,
        ctx
      );

      expect(res.success).toBe(true);
      expect((res.extra as { totalReplacements: number }).totalReplacements).toBe(2);

      const updated = await ws.read("src/index.ts");
      expect(updated).not.toContain('console.log("Adding numbers"');
      expect(updated).toContain('log("Adding numbers", a, b)');
      expect(updated).toContain('log("Multiplying", a, b)');
    });
  });

  // ─── 2. Advanced Git Operations ─────────────────────────────────────────────

  describe("git_advanced tools", () => {
    it("blames lines of a committed file", async () => {
      const ctx = createTurnContext();
      const res = await executeTool(
        "git_blame",
        {
          path: "src/index.ts",
          start_line: 1,
          end_line: 5,
        },
        ws.root,
        ctx
      );

      expect(res.success).toBe(true);
      expect(res.output).toContain("Git Blame for src/index.ts");
      expect(res.output).toContain("Test");
    });

    it("stashes and pops changes safely", async () => {
      // Modify a file
      await ws.write("src/index.ts", "// dirty edit\n");

      const ctx = createTurnContext();
      const pushRes = await executeTool(
        "git_stash_push",
        {
          message: "WIP test stash",
        },
        ws.root,
        ctx
      );
      expect(pushRes.success).toBe(true);

      const listRes = await executeTool("git_stash_list", {}, ws.root, ctx);
      expect(listRes.success).toBe(true);
      expect(listRes.output).toContain("WIP test stash");

      const popRes = await executeTool("git_stash_pop", { index: 0 }, ws.root, ctx);
      expect(popRes.success).toBe(true);

      const restored = await ws.read("src/index.ts");
      expect(restored.trim()).toBe("// dirty edit");
    });

    it("creates, lists, and removes isolated git worktrees", async () => {
      const ctx = createTurnContext();
      const createRes = await executeTool(
        "git_worktree_create",
        {
          name: "scratch-test",
        },
        ws.root,
        ctx
      );
      expect(createRes.success).toBe(true);
      expect(createRes.output).toContain("scratch-test");

      const listRes = await executeTool("git_worktree_list", {}, ws.root, ctx);
      expect(listRes.success).toBe(true);
      expect(listRes.output).toContain("scratch-test");

      const removeRes = await executeTool(
        "git_worktree_remove",
        {
          name: "scratch-test",
          delete_branch: true,
        },
        ws.root,
        ctx
      );
      expect(removeRes.success).toBe(true);
      expect(removeRes.output).toContain("Successfully removed worktree");
    });
  });

  // ─── 3. Database Sidecars ───────────────────────────────────────────────────

  describe("database_sidecar tools", () => {
    it("starts a postgres sidecar and updates .env.local", async () => {
      const ctx = createTurnContext();
      const res = await executeTool(
        "database_sidecar_start",
        {
          type: "postgres",
          name: "test-pg",
          port: 5433,
          db_name: "test_db",
          auto_env: true,
        },
        ws.root,
        ctx
      );

      expect(res.success).toBe(true);
      expect(res.output).toContain("5433");
      expect(res.output).toContain("postgresql://");

      const envContent = await ws.read(".env.local");
      expect(envContent).toContain("DATABASE_URL=\"postgresql://postgres:postgres@localhost:5433/test_db\"");

      const statusRes = await executeTool("database_sidecar_status", {}, ws.root, ctx);
      expect(statusRes.success).toBe(true);
      expect(statusRes.output).toContain("test-pg");

      const stopRes = await executeTool("database_sidecar_stop", { name: "test-pg" }, ws.root, ctx);
      expect(stopRes.success).toBe(true);
    });

    it("starts a redis sidecar with REDIS_URL", async () => {
      const ctx = createTurnContext();
      const res = await executeTool(
        "database_sidecar_start",
        {
          type: "redis",
          port: 6380,
          auto_env: true,
        },
        ws.root,
        ctx
      );

      expect(res.success).toBe(true);
      expect(res.output).toContain("redis://localhost:6380");

      const envContent = await ws.read(".env.local");
      expect(envContent).toContain("REDIS_URL=\"redis://localhost:6380\"");
    });
  });

  // ─── 4. Agent Coordination & Timers ─────────────────────────────────────────

  describe("schedule & agent messaging tools", () => {
    it("schedules, lists, and cancels a timer", async () => {
      const ctx = createTurnContext();
      const schedRes = await executeTool(
        "schedule_timer",
        {
          duration_seconds: 60,
          prompt: "Verify build output",
          timer_condition: "any",
        },
        ws.root,
        ctx
      );

      expect(schedRes.success).toBe(true);
      const timerId = (schedRes.extra as { timerId: string }).timerId;
      expect(timerId).toBeDefined();

      const listRes = await executeTool("list_timers", {}, ws.root, ctx);
      expect(listRes.success).toBe(true);
      expect(listRes.output).toContain(timerId);

      const cancelRes = await executeTool("cancel_timer", { timer_id: timerId }, ws.root, ctx);
      expect(cancelRes.success).toBe(true);
      expect(cancelRes.output).toContain("cancelled");
    });

    it("sends and retrieves inter-agent peer messages", async () => {
      const ctx = createTurnContext();
      const sendRes = await executeTool(
        "agent_send_message",
        {
          recipient: "subagent-worker-1",
          message: "Please run tests on index.ts and report status",
          sender: "main",
        },
        ws.root,
        ctx
      );

      expect(sendRes.success).toBe(true);
      expect(sendRes.output).toContain("subagent-worker-1");

      const readRes = await executeTool(
        "agent_list_messages",
        {
          agent_id: "subagent-worker-1",
          unread_only: true,
        },
        ws.root,
        ctx
      );

      expect(readRes.success).toBe(true);
      expect(readRes.output).toContain("Please run tests on index.ts");
    });
  });

  // ─── 5. Webhook Tunneling ───────────────────────────────────────────────────

  describe("tunnel tools", () => {
    it("opens, checks status, and closes a webhook tunnel", async () => {
      const ctx = createTurnContext();
      const openRes = await executeTool(
        "open_webhook_tunnel",
        {
          port: 3000,
        },
        ws.root,
        ctx
      );

      expect(openRes.success).toBe(true);
      const tunnelId = (openRes.extra as { tunnelId: string }).tunnelId;
      const publicUrl = (openRes.extra as { publicUrl: string }).publicUrl;
      expect(tunnelId).toBeDefined();
      expect(publicUrl).toContain("https://");

      const statusRes = await executeTool("tunnel_status", {}, ws.root, ctx);
      expect(statusRes.success).toBe(true);
      expect(statusRes.output).toContain(tunnelId);

      const closeRes = await executeTool("close_webhook_tunnel", { tunnel_id: tunnelId }, ws.root, ctx);
      expect(closeRes.success).toBe(true);
      expect(closeRes.output).toContain("Closed webhook tunnel");
    });
  });
});
