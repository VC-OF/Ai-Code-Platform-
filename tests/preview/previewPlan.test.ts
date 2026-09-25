import { describe, it, expect, afterEach } from "vitest";
import { createWorkspace, type TestWorkspace } from "../helpers/workspace";
import {
  detectRunPlan,
  detectPortFromLog,
  withPort,
  EMPTY_REASON,
  checkComposeConfig,
  pickComposeWebPort,
  isInsideWorkspace,
  pickPythonEntry,
  type NodePlan,
  type ServicePlan,
  type CliPlan,
} from "@/lib/previewPlan";

const pkg = (scripts: Record<string, string>, deps: Record<string, string> = {}, extra = {}) =>
  JSON.stringify({ name: "x", scripts, dependencies: deps, ...extra });

let ws: TestWorkspace | null = null;
async function plan(files: Record<string, string>, opts = {}) {
  ws = await createWorkspace(files);
  return detectRunPlan(ws.root, opts);
}
afterEach(async () => {
  await ws?.cleanup();
  ws = null;
});

describe("detectRunPlan — empty / none", () => {
  it("empty workspace → none", async () => {
    const p = await plan({});
    expect(p).toEqual({ kind: "none", reason: EMPTY_REASON });
  });

  it("only AGENTS.md / text files → none", async () => {
    const p = await plan({ "AGENTS.md": "# rules", "test.txt": "hi" });
    expect(p.kind).toBe("none");
  });

  it("package.json with a dev script but no source → none", async () => {
    const p = await plan({
      "package.json": pkg({ dev: 'concurrently "npm run a" "npm run b"' }),
      "tsconfig.json": "{}",
    });
    expect(p.kind).toBe("none");
  });

  it("Next.js project without any page → none", async () => {
    const p = await plan({
      "package.json": pkg({ dev: "next dev" }, { next: "14" }),
      "app/globals.css": "body{}",
    });
    expect(p.kind).toBe("none");
  });
});

describe("detectRunPlan — node frameworks", () => {
  it("vite → vite with port/strictPort/host", async () => {
    const p = (await plan({
      "package.json": pkg({ dev: "vite" }, { vite: "^6" }),
      "index.html": "<div id=app></div>",
      "src/main.js": "",
    })) as NodePlan;
    expect(p.kind).toBe("node");
    expect(p.framework).toBe("vite");
    expect(withPort(p.web, 4005)).toEqual([
      "--no-install", "vite", "--port", "4005", "--strictPort", "--host", "0.0.0.0",
    ]);
    expect(p.web.cmd).toBe("npx");
    expect(p.installDirs).toEqual([""]);
  });

  it("next dev -p 3000 → strips the hardcoded port", async () => {
    const p = (await plan({
      "package.json": pkg({ dev: "next dev -p 3000 --turbo" }, { next: "14" }),
      "src/app/page.tsx": "export default function P(){return null}",
    })) as NodePlan;
    expect(p.framework).toBe("next");
    const args = withPort(p.web, 4010);
    expect(args).toEqual(["--no-install", "next", "dev", "--turbo", "-p", "4010", "-H", "0.0.0.0"]);
    expect(args).not.toContain("3000");
  });

  it("react-scripts → PORT/HOST env, no port flag", async () => {
    const p = (await plan({
      "package.json": pkg({ start: "react-scripts start" }, { "react-scripts": "5" }),
      "src/index.js": "",
    })) as NodePlan;
    expect(p.framework).toBe("react-scripts");
    expect(p.web.args).toEqual(["--no-install", "react-scripts", "start"]);
    expect(p.web.env.HOST).toBe("0.0.0.0");
    expect(p.web.env.BROWSER).toBe("none");
  });

  it("astro / nuxt get their own flags", async () => {
    const a = (await plan({
      "package.json": pkg({ dev: "astro dev" }, { astro: "4" }),
      "src/pages/index.astro": "",
    })) as NodePlan;
    expect(withPort(a.web, 4001)).toEqual(["--no-install", "astro", "dev", "--port", "4001", "--host", "0.0.0.0"]);
    await ws!.cleanup();
    const n = (await plan({
      "package.json": pkg({ dev: "nuxt dev" }, { nuxt: "3" }),
      "app.vue": "",
    })) as NodePlan;
    expect(n.framework).toBe("nuxt");
  });

  it("unknown script → npm run dev, port read from logs", async () => {
    const p = (await plan({
      "package.json": pkg({ dev: "node server.js" }, { express: "4" }),
      "server.js": "",
    })) as NodePlan;
    expect(p.framework).toBe("unknown");
    expect(p.web.cmd).toBe("npm");
    expect(p.web.args).toEqual(["run", "dev"]);
    expect(p.web.portFromLogs).toBe(true);
  });

  it("falls back to the start script when there is no dev script", async () => {
    const p = (await plan({
      "package.json": pkg({ start: "node index.js" }),
      "index.js": "",
    })) as NodePlan;
    expect(p.web.args).toEqual(["run", "start"]);
  });

  it("prisma dependency (sqlite) → generate + db push dirs", async () => {
    const p = (await plan({
      "package.json": pkg({ dev: "next dev" }, { next: "14", "@prisma/client": "5" }),
      "app/page.tsx": "",
      "prisma/schema.prisma": 'datasource db {\n  provider = "sqlite"\n  url = env("DATABASE_URL")\n}',
    })) as NodePlan;
    expect(p.prismaDirs).toEqual([""]);
    expect(p.prismaSqliteDirs).toEqual([""]);
  });

  it("never passes shell syntax from the script through", async () => {
    const p = (await plan({
      "package.json": pkg({ dev: "vite --mode dev; rm -rf /" }, { vite: "6" }),
      "index.html": "",
    })) as NodePlan;
    // Composite script → handed to npm as-is, not tokenised into our args
    expect(p.web.args).toEqual(["run", "dev"]);
  });
});

describe("detectRunPlan — frontend dir resolution & full-stack", () => {
  it("client/ + server/ with root orchestrator → web=client, api=root server script", async () => {
    const p = (await plan({
      "package.json": pkg(
        { start: 'concurrently "npm run server" "npm run client"', server: "node server/index.js", client: "cd client && npm start" },
        { express: "4", concurrently: "8" }
      ),
      "server/index.js": "",
      "client/package.json": pkg({ start: "react-scripts start" }, { "react-scripts": "5" }),
      "client/src/index.js": "",
    })) as NodePlan;
    expect(p.kind).toBe("node");
    expect(p.web.dir).toBe("client");
    expect(p.api?.dir).toBe("");
    expect(p.api?.args).toEqual(["run", "server"]);
    expect(p.installDirs).toEqual(["", "client"]);
  });

  it("frontend/ + backend/ → both processes", async () => {
    const p = (await plan({
      "frontend/package.json": pkg({ dev: "vite" }, { vite: "6" }),
      "frontend/index.html": "",
      "backend/package.json": pkg({ start: "node server.js", dev: "nodemon server.js" }),
      "backend/server.js": "",
    })) as NodePlan;
    expect(p.web.dir).toBe("frontend");
    expect(p.api).toMatchObject({ dir: "backend", args: ["run", "dev"] });
    expect(p.installDirs).toEqual(["backend", "frontend"]);
  });

  it("monorepo apps/web", async () => {
    const p = (await plan({
      "package.json": pkg({ dev: "concurrently npm:dev:*" }, {}, { workspaces: ["apps/*"] }),
      "apps/web/package.json": pkg({ dev: "vite" }, { vite: "6" }),
      "apps/web/index.html": "",
    })) as NodePlan;
    expect(p.web.dir).toBe("apps/web");
  });

  it("backend only → unsupported with a hint", async () => {
    const p = await plan({
      "package.json": pkg({ dev: "concurrently a b" }, {}, { workspaces: ["apps/*"] }),
      "apps/api/package.json": pkg({ dev: "tsx watch src/server.ts" }),
      "apps/api/src/server.ts": "",
    });
    expect(p.kind).toBe("unsupported");
    if (p.kind === "unsupported") expect(p.hint).toMatch(/npm run dev/);
  });
});

describe("detectRunPlan — static", () => {
  it("root index.html without package.json", async () => {
    const p = await plan({ "index.html": "<h1>hi</h1>", "app.js": "" });
    expect(p).toMatchObject({ kind: "static", entry: "index.html" });
  });

  it("lone non-index html file becomes the entry", async () => {
    const p = await plan({ "dashboard.html": "<h1>hi</h1>", "AGENTS.md": "" });
    expect(p).toMatchObject({ kind: "static", entry: "dashboard.html" });
  });

  it("public/index.html", async () => {
    const p = await plan({ "public/index.html": "" });
    expect(p.kind).toBe("static");
    if (p.kind === "static") expect(p.dir).toMatch(/public$/);
  });

  it("`npx serve .` script → static (no package fetch)", async () => {
    const p = await plan({
      "package.json": pkg({ dev: "npx serve ." }),
      "index.html": "",
    });
    expect(p).toMatchObject({ kind: "static", entry: "index.html" });
  });
});

describe("detectRunPlan — python & other languages", () => {
  it("flask app with python available", async () => {
    const p = await plan(
      { "app.py": "from flask import Flask\napp = Flask(__name__)", "requirements.txt": "flask" },
      { pythonAvailable: true }
    );
    expect(p).toMatchObject({ kind: "python", framework: "flask", entry: "app.py" });
  });

  it("fastapi / django detection", async () => {
    const f = await plan({ "main.py": "from fastapi import FastAPI\napp = FastAPI()" }, { pythonAvailable: true });
    expect(f).toMatchObject({ kind: "python", framework: "fastapi" });
    await ws!.cleanup();
    const d = await plan({ "manage.py": "", "requirements.txt": "django" }, { pythonAvailable: true });
    expect(d).toMatchObject({ kind: "python", framework: "django" });
  });

  it("python web app without python → unsupported", async () => {
    const p = await plan({ "app.py": "import flask" }, { pythonAvailable: false });
    expect(p.kind).toBe("unsupported");
  });

  it("plain python scripts → unsupported", async () => {
    const p = await plan({ "generate.py": "print(1)" }, { pythonAvailable: true });
    expect(p.kind).toBe("unsupported");
  });

  it("rust crate → unsupported with cargo hint", async () => {
    const p = await plan({ "Cargo.toml": "[package]", "src/main.rs": "fn main(){}" });
    expect(p.kind).toBe("unsupported");
    if (p.kind === "unsupported") expect(p.hint).toContain("cargo run");
  });

  it("java backend/ → unsupported", async () => {
    const p = await plan({ "backend/pom.xml": "<project/>", "README.md": "" });
    expect(p.kind).toBe("unsupported");
  });
});

describe("detectPortFromLog", () => {
  it.each([
    ["  ➜  Local:   http://localhost:5173/", 5173],
    ["Server listening on http://127.0.0.1:8080", 8080],
    ["running at http://0.0.0.0:3001", 3001],
    ["Server running on port 5000", 5000],
    ["nothing here", null],
  ])("%s → %s", (line, port) => {
    expect(detectPortFromLog(line)).toBe(port);
  });
});

// ─── Docker-backed plans ─────────────────────────────────────────────────────
const docker = { docker: true, pythonAvailable: true };

describe("detectRunPlan — docker compose", () => {
  it("root docker-compose.yml → compose", async () => {
    const p = await plan({ "docker-compose.yml": "services: {}", "README.md": "" });
    expect(p).toEqual({ kind: "compose", dir: "", file: "docker-compose.yml" });
  });

  it("compose.yaml in a direct child dir → compose", async () => {
    const p = await plan({ "deploy/compose.yaml": "services: {}" });
    expect(p).toEqual({ kind: "compose", dir: "deploy", file: "deploy/compose.yaml" });
  });

  it("non-standard name (docker-compose.db.yml) is not a compose plan", async () => {
    const p = await plan({ "docker-compose.db.yml": "services: {}", "gen.py": "print(1)" }, docker);
    expect(p.kind).toBe("cli");
  });

  it("a runnable frontend wins over a compose file", async () => {
    const p = await plan({
      "docker-compose.yml": "services: {}",
      "package.json": pkg({ dev: "vite" }, { vite: "^6" }),
      "src/main.js": "",
    });
    expect(p.kind).toBe("node");
  });

  it("skipCompose falls through to the next detector", async () => {
    const p = await plan(
      {
        "docker-compose.yml": "services: {}",
        "apps/api/package.json": pkg({ dev: "tsx watch src/server.ts" }),
        "apps/api/src/server.ts": "",
      },
      { ...docker, skipCompose: true }
    );
    expect(p.kind).toBe("node");
  });
});

describe("checkComposeConfig — security", () => {
  const root = "C:\\ws\\proj";
  const cfg = (svc: Record<string, unknown>) => ({ services: { web: { image: "nginx", ...svc } } });

  it("accepts named volumes, in-workspace binds and ports", () => {
    const r = checkComposeConfig(
      cfg({
        volumes: [
          { type: "volume", source: "pgdata", target: "/data" },
          { type: "bind", source: "C:\\ws\\proj\\storage", target: "/app/storage" },
          "./site:/usr/share/nginx/html:ro",
        ],
        ports: [{ target: 80, published: "3000", protocol: "tcp" }, "5432:5432"],
      }),
      root
    );
    expect(r.ok).toBe(true);
    expect(r.ports).toEqual([
      { service: "web", target: 80, published: 3000 },
      { service: "web", target: 5432, published: 5432 },
    ]);
  });

  it.each([
    [{ privileged: true }, /privileged/],
    [{ network_mode: "host" }, /network_mode: host/],
    [{ pid: "host" }, /pid: host/],
    [{ cap_add: ["SYS_ADMIN"] }, /capabilities/],
    [{ devices: ["/dev/kvm:/dev/kvm"] }, /devices/],
    [{ volumes: [{ type: "bind", source: "C:\\Users\\me", target: "/x" }] }, /outside the project/],
    [{ volumes: [{ type: "bind", source: "C:\\ws\\proj\\..\\other", target: "/x" }] }, /outside the project/],
    [{ volumes: ["../../:/host"] }, /outside the project/],
    [{ volumes: ["~/.ssh:/root/.ssh"] }, /outside the project/],
    [{ volumes: ["/var/run/docker.sock:/var/run/docker.sock"] }, /Docker socket/],
    [{ volumes: [{ type: "bind", source: "//./pipe/docker_engine", target: "/x" }] }, /outside the project/],
  ])("refuses %j", (svc, msg) => {
    const r = checkComposeConfig(cfg(svc), root);
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(msg);
  });

  it("refuses an empty stack", () => {
    expect(checkComposeConfig({ services: {} }, root).ok).toBe(false);
  });

  it("isInsideWorkspace handles case, separators and prefixes", () => {
    expect(isInsideWorkspace("c:/WS/proj/data", root)).toBe(true);
    expect(isInsideWorkspace("C:\\ws\\proj2", root)).toBe(false);
    expect(isInsideWorkspace("/srv/app/x", "/srv/app")).toBe(true);
    expect(isInsideWorkspace("/srv/application", "/srv/app")).toBe(false);
  });

  it("pickComposeWebPort prefers web-named services and skips databases", () => {
    expect(
      pickComposeWebPort([
        { service: "postgres", target: 5432, published: 5432 },
        { service: "api", target: 4000, published: 4000 },
        { service: "web", target: 80, published: 5173 },
      ])
    ).toMatchObject({ service: "web" });
    expect(pickComposeWebPort([{ service: "db", target: 5432, published: 5432 }])).toBeNull();
    expect(pickComposeWebPort([{ service: "api", target: 4000, published: 4000 }])).toMatchObject({ service: "api" });
  });
});

describe("detectRunPlan — API-only backends (docker)", () => {
  it("Node backend/ only → api-only node plan", async () => {
    const p = (await plan(
      { "backend/package.json": pkg({ start: "node server.js" }), "backend/server.js": "" },
      docker
    )) as NodePlan;
    expect(p.kind).toBe("node");
    expect(p.apiOnly).toBe(true);
    expect(p.web).toMatchObject({ dir: "backend", cmd: "npm", args: ["run", "start"], portFromLogs: false });
    expect(p.installDirs).toEqual(["backend"]);
  });

  it("Node API inside npm workspaces installs at the root", async () => {
    const p = (await plan(
      {
        "package.json": pkg({ dev: "concurrently a b" }, {}, { workspaces: ["apps/*"] }),
        "apps/api/package.json": pkg({ dev: "tsx watch src/server.ts" }, { "@prisma/client": "5" }),
        "apps/api/src/server.ts": "",
      },
      docker
    )) as NodePlan;
    expect(p.apiOnly).toBe(true);
    expect(p.installDirs).toEqual([""]);
    expect(p.prismaDirs).toEqual(["apps/api"]);
  });

  it("backend without source → none (nothing to run)", async () => {
    const p = await plan({ "backend/package.json": pkg({ start: "node server.js" }) }, docker);
    expect(p.kind).toBe("none");
  });

  it("Spring Boot (mvnw, multi-module) → java service", async () => {
    const p = (await plan(
      {
        ".java-version": "21",
        "backend/mvnw": "#!/bin/sh",
        "backend/pom.xml":
          "<project><parent><artifactId>spring-boot-starter-parent</artifactId></parent><packaging>pom</packaging><modules><module>lib</module><module>app</module></modules></project>",
        "backend/app/src/main/java/App.java": "@SpringBootApplication class App {}",
        "backend/lib/src/main/java/Lib.java": "class Lib {}",
      },
      docker
    )) as ServicePlan;
    expect(p).toMatchObject({
      kind: "service",
      lang: "java",
      dir: "backend",
      tool: "maven",
      wrapper: true,
      module: "app",
      javaVersion: 21,
    });
  });

  it("single-module Spring Boot pom → java service without module", async () => {
    const p = (await plan(
      { "pom.xml": "<project><dependency>spring-boot-starter-web</dependency><java.version>17</java.version></project>" },
      docker
    )) as ServicePlan;
    expect(p).toMatchObject({ kind: "service", lang: "java", dir: "", wrapper: false, javaVersion: 17 });
    expect(p.module).toBeUndefined();
  });

  it("Go net/http server → go service (hard-coded port detected)", async () => {
    const p = (await plan(
      { "go.mod": "module x", "main.go": 'package main\nfunc main(){ http.ListenAndServe(":8080", nil) }' },
      docker
    )) as ServicePlan;
    expect(p).toMatchObject({ kind: "service", lang: "go", fixedPort: 8080 });
  });

  it("Go server reading PORT → no fixed port", async () => {
    const p = (await plan(
      {
        "go.mod": "module x",
        "main.go": 'package main\nfunc main(){ p := os.Getenv("PORT"); http.ListenAndServe(":"+p, nil) }',
      },
      docker
    )) as ServicePlan;
    expect(p.kind).toBe("service");
    expect(p.fixedPort).toBeUndefined();
  });

  it("Flask app in backend/ → python plan in that dir", async () => {
    const p = await plan({ "backend/app.py": "from flask import Flask" }, docker);
    expect(p).toMatchObject({ kind: "python", framework: "flask", dir: "backend" });
  });

  it("host mode keeps the old unsupported answer for API-only Node", async () => {
    const p = await plan({ "backend/package.json": pkg({ start: "node s.js" }), "backend/s.js": "" });
    expect(p.kind).toBe("unsupported");
  });
});

describe("detectRunPlan — CLI programs (docker)", () => {
  it("Rust crate → cli cargo run", async () => {
    const p = (await plan({ "Cargo.toml": "[package]", "src/main.rs": "fn main(){}" }, docker)) as CliPlan;
    expect(p).toMatchObject({ kind: "cli", lang: "rust", command: "cargo run" });
  });

  it("Go program without a server → cli go run", async () => {
    const p = await plan({ "go.mod": "module x", "main.go": "package main\nfunc main(){}" }, docker);
    expect(p).toMatchObject({ kind: "cli", lang: "go", command: "go run ." });
  });

  it("plain Python scripts → cli with the obvious entry", async () => {
    const p = (await plan(
      {
        "b_tool.py": "print(1)",
        "a_lib.py": "x = 1",
        "c.py": 'if __name__ == "__main__":\n  pass',
        "requirements.txt": "",
      },
      docker
    )) as CliPlan;
    expect(p).toMatchObject({ kind: "cli", lang: "python", entry: "c.py", hasRequirements: true, command: "python c.py" });
  });

  it("pickPythonEntry prefers main.py", async () => {
    ws = await createWorkspace({ "main.py": "", "z.py": "" });
    expect(pickPythonEntry(ws.root)).toBe("main.py");
  });
});
