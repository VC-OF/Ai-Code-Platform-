/**
 * Starter templates written into a new project's workspace so generated
 * apps start from a solid, good-looking baseline instead of an empty folder
 * (the "design-quality gap" vs v0/Lovable).
 *
 * Both runnable templates use Vite so the Preview tab's
 * `npm run dev -- --port N` contract works unchanged.
 */

export interface Template {
  id: string;
  name: string;
  description: string;
  files: Record<string, string>;
}

const BASE_CSS = `:root {
  --bg: #0b0d12;
  --surface: #131722;
  --surface-2: #1a2030;
  --border: rgba(255, 255, 255, 0.08);
  --text: #e8eaf0;
  --text-dim: #9aa3b5;
  --accent: #6c8cff;
  --accent-strong: #4c6fff;
  --radius: 12px;
  --font: ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html { color-scheme: dark; }

body {
  font-family: var(--font);
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3 { line-height: 1.2; letter-spacing: -0.02em; }
h1 { font-size: clamp(2rem, 5vw, 3rem); }
h2 { font-size: clamp(1.4rem, 3vw, 2rem); }
p  { color: var(--text-dim); max-width: 60ch; }

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

.container { max-width: 1080px; margin: 0 auto; padding: 0 24px; }

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 24px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: var(--accent-strong);
  color: white;
  border: none;
  border-radius: 8px;
  padding: 10px 20px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.1s ease;
}
.btn:hover { filter: brightness(1.1); }
.btn:active { transform: scale(0.98); }
.btn--ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text);
}
`;

// ─── Static site (Vite serves plain HTML with HMR) ───────────────────────────
const STATIC_SITE: Template = {
  id: "static-site",
  name: "Static site",
  description: "HTML + CSS + JS with a clean dark design system, served by Vite",
  files: {
    "package.json": JSON.stringify(
      {
        name: "static-site",
        private: true,
        version: "0.1.0",
        scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
        devDependencies: { vite: "^6.0.0" },
      },
      null,
      2
    ),
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>New Site</title>
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="container hero">
      <h1>Hello 👋</h1>
      <p>
        This is your starting point. Describe what to build in the chat and
        the agent will edit these files.
      </p>
      <div class="hero-actions">
        <button class="btn" id="cta">Get started</button>
        <button class="btn btn--ghost">Learn more</button>
      </div>
    </main>
    <script type="module" src="/main.js"></script>
  </body>
</html>
`,
    "styles.css":
      BASE_CSS +
      `
.hero {
  min-height: 80vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16px;
}

.hero-actions { display: flex; gap: 12px; margin-top: 8px; }
`,
    "main.js": `document.getElementById('cta')?.addEventListener('click', () => {
  alert('Ready to build!');
});
`,
  },
};

// ─── React + Vite app ────────────────────────────────────────────────────────
const REACT_VITE: Template = {
  id: "react-vite",
  name: "React app",
  description: "React 18 + Vite with a component-ready dark design system",
  files: {
    "package.json": JSON.stringify(
      {
        name: "react-app",
        private: true,
        version: "0.1.0",
        type: "module",
        scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
        dependencies: { react: "^18.3.0", "react-dom": "^18.3.0" },
        devDependencies: {
          vite: "^6.0.0",
          "@vitejs/plugin-react": "^4.3.0",
        },
      },
      null,
      2
    ),
    "vite.config.js": `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>New App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    "src/main.jsx": `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
    "src/App.jsx": `export default function App() {
  return (
    <main className="container hero">
      <h1>Hello 👋</h1>
      <p>
        This is your starting point. Describe what to build in the chat and
        the agent will edit these components.
      </p>
      <div className="hero-actions">
        <button className="btn" onClick={() => alert('Ready to build!')}>
          Get started
        </button>
        <button className="btn btn--ghost">Learn more</button>
      </div>
    </main>
  );
}
`,
    "src/index.css":
      BASE_CSS +
      `
.hero {
  min-height: 80vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 16px;
}

.hero-actions { display: flex; gap: 12px; margin-top: 8px; }
`,
  },
};

// ─── Next.js 16 + Tailwind App ───────────────────────────────────────────────
const NEXTJS_TAILWIND: Template = {
  id: "nextjs-tailwind",
  name: "Next.js App",
  description: "Next.js 16 App Router with React 19 and Tailwind CSS v4",
  files: {
    "package.json": JSON.stringify(
      {
        name: "nextjs-app",
        version: "0.1.0",
        private: true,
        scripts: {
          dev: "next dev",
          build: "next build",
          start: "next start",
        },
        dependencies: {
          next: "^16.0.0",
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
        devDependencies: {
          "@tailwindcss/postcss": "^4.0.0",
          "@types/node": "^20.0.0",
          "@types/react": "^19.0.0",
          "@types/react-dom": "^19.0.0",
          tailwindcss: "^4.0.0",
          typescript: "^5.0.0",
        },
      },
      null,
      2
    ),
    "next.config.ts": `import type { NextConfig } from 'next';
const nextConfig: NextConfig = {};
export default nextConfig;
`,
    "postcss.config.mjs": `export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
`,
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          target: "ES2017",
          lib: ["dom", "dom.iterable", "esnext"],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: "esnext",
          moduleResolution: "bundler",
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: "preserve",
          incremental: true,
          plugins: [{ name: "next" }],
          paths: { "@/*": ["./*"] },
        },
        include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
        exclude: ["node_modules"],
      },
      null,
      2
    ),
    "app/globals.css": `@import "tailwindcss";

:root {
  --background: #09090b;
  --foreground: #f4f4f5;
}

body {
  color: var(--foreground);
  background: var(--background);
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}
`,
    "app/layout.tsx": `import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Next.js App',
  description: 'Built with Open Code Platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased bg-neutral-950 text-neutral-100">{children}</body>
    </html>
  );
}
`,
    "app/page.tsx": `export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-gradient-to-b from-neutral-900 to-neutral-950">
      <div className="max-w-2xl text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-neutral-800 border border-neutral-700 text-neutral-300">
          Next.js 16 + React 19 + Tailwind v4
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white">
          What are we building today?
        </h1>
        <p className="text-neutral-400 text-lg">
          Your Next.js project is ready. Ask the agent in the chat to create components, API routes, or full features.
        </p>
        <div className="flex justify-center gap-4 pt-4">
          <button className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors cursor-pointer">
            Explore Code
          </button>
          <button className="px-5 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium rounded-lg border border-neutral-700 transition-colors cursor-pointer">
            Read Docs
          </button>
        </div>
      </div>
    </main>
  );
}
`,
  },
};

// ─── FastAPI + React Fullstack ───────────────────────────────────────────────
const FASTAPI_REACT: Template = {
  id: "fastapi-react",
  name: "FastAPI + React",
  description: "Python FastAPI backend with Vite React frontend and proxy setup",
  files: {
    "package.json": JSON.stringify(
      {
        name: "fastapi-react-app",
        private: true,
        version: "0.1.0",
        type: "module",
        scripts: {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
        },
        dependencies: {
          react: "^18.3.0",
          "react-dom": "^18.3.0",
        },
        devDependencies: {
          "@vitejs/plugin-react": "^4.3.0",
          vite: "^6.0.0",
        },
      },
      null,
      2
    ),
    "vite.config.js": `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
`,
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>FastAPI + React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    "src/main.jsx": `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
    "src/App.jsx": `import { useState, useEffect } from 'react';

export default function App() {
  const [status, setStatus] = useState('Connecting to backend...');
  const [items, setItems] = useState([]);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((data) => setStatus(data.status === 'ok' ? 'Connected: FastAPI active' : 'Offline'))
      .catch(() => setStatus('Backend starting or run via python backend/main.py'));

    fetch('/api/items')
      .then((r) => r.json())
      .then((data) => setItems(data))
      .catch(() => {});
  }, []);

  return (
    <main className="container hero">
      <div className="badge">{status}</div>
      <h1>FastAPI + React ⚡</h1>
      <p>Fullstack workspace with Python API backend and fast Vite React frontend.</p>
      <div className="card">
        <h3>Sample Items from Backend</h3>
        {items.length === 0 ? (
          <p className="dim">No items fetched yet.</p>
        ) : (
          <ul>
            {items.map((it) => (
              <li key={it.id}>{it.name} - <span>{it.status}</span></li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
`,
    "src/index.css":
      BASE_CSS +
      `
.hero { min-height: 80vh; display: flex; flex-direction: column; justify-content: center; gap: 16px; }
.badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: rgba(76, 111, 255, 0.15); color: #829eff; font-size: 13px; font-weight: 500; width: fit-content; }
.dim { opacity: 0.6; }
`,
    "backend/main.py": `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="FastAPI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "FastAPI Backend"}

@app.get("/api/items")
def list_items():
    return [
        {"id": 1, "name": "Item Alpha", "status": "active"},
        {"id": 2, "name": "Item Beta", "status": "pending"},
        {"id": 3, "name": "Item Gamma", "status": "completed"}
    ]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
`,
    "backend/requirements.txt": `fastapi>=0.110.0
uvicorn[standard]>=0.28.0
`,
  },
};

// ─── Express Node API ────────────────────────────────────────────────────────
const EXPRESS_API: Template = {
  id: "express-api",
  name: "Express API",
  description: "Node.js REST API with Express, CORS, and JSON routing",
  files: {
    "package.json": JSON.stringify(
      {
        name: "express-api-service",
        version: "1.0.0",
        private: true,
        scripts: {
          dev: "node --watch src/server.js",
          start: "node src/server.js",
        },
        dependencies: {
          cors: "^2.8.5",
          express: "^4.21.0",
        },
      },
      null,
      2
    ),
    "src/server.js": `const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Express REST API',
    endpoints: ['/api/health', '/api/users'],
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.get('/api/users', (req, res) => {
  res.json([
    { id: 1, name: 'Alice Smith', role: 'Engineer' },
    { id: 2, name: 'Bob Jones', role: 'Designer' },
  ]);
});

app.listen(PORT, () => {
  console.log(\`Express API server listening on http://localhost:\${PORT}\`);
});
`,
    "README.md": `# Express API Service
Run \`npm run dev\` to start the server with live file watching.
`,
  },
};

// ─── Analytics & Operations Dashboard Shell ──────────────────────────────────
const DASHBOARD_SHELL: Template = {
  id: "dashboard-shell",
  name: "Dashboard Shell",
  description: "Modern Admin & Analytics Dashboard with metrics, charts and tables",
  files: {
    "package.json": JSON.stringify(
      {
        name: "dashboard-shell",
        private: true,
        version: "0.1.0",
        type: "module",
        scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
        dependencies: { react: "^18.3.0", "react-dom": "^18.3.0" },
        devDependencies: {
          "@vitejs/plugin-react": "^4.3.0",
          vite: "^6.0.0",
        },
      },
      null,
      2
    ),
    "vite.config.js": `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`,
    "index.html": `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Analytics Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
    "src/main.jsx": `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
    "src/App.jsx": `import { useState } from 'react';

const METRICS = [
  { title: 'Total Revenue', value: '$45,231.89', change: '+20.1%', isPositive: true },
  { title: 'Active Subscriptions', value: '+2,350', change: '+180.1%', isPositive: true },
  { title: 'Sales Volume', value: '+12,234', change: '+19%', isPositive: true },
  { title: 'Churn Rate', value: '1.2%', change: '-4.5%', isPositive: false },
];

const RECENT_ORDERS = [
  { id: 'ORD-7291', customer: 'Liam Johnson', product: 'Pro Plan (Annual)', amount: '$299.00', status: 'Completed' },
  { id: 'ORD-7292', customer: 'Olivia Smith', product: 'Enterprise Seat', amount: '$599.00', status: 'Processing' },
  { id: 'ORD-7293', customer: 'Noah Williams', product: 'Starter Tier', amount: '$49.00', status: 'Completed' },
  { id: 'ORD-7294', customer: 'Emma Brown', product: 'Pro Plan (Monthly)', amount: '$29.00', status: 'Completed' },
];

export default function App() {
  const [filter, setFilter] = useState('All');

  return (
    <div className="dash-layout">
      <header className="dash-header">
        <div className="dash-brand">
          <div className="brand-dot" />
          <h2>Operations Cloud</h2>
        </div>
        <div className="dash-user">
          <span>Admin Workspace</span>
        </div>
      </header>

      <main className="dash-content">
        <div className="page-heading">
          <div>
            <h1>Overview</h1>
            <p>Welcome back! Here is a summary of your workspace performance.</p>
          </div>
          <button className="btn" onClick={() => alert('Exporting report...')}>Download Report</button>
        </div>

        {/* Metric Cards */}
        <div className="grid-cards">
          {METRICS.map((m) => (
            <div key={m.title} className="metric-card">
              <span className="metric-title">{m.title}</span>
              <div className="metric-val">{m.value}</div>
              <span className={\`metric-change \${m.isPositive ? 'pos' : 'neg'}\`}>{m.change} from last month</span>
            </div>
          ))}
        </div>

        {/* Data Table */}
        <div className="table-card">
          <div className="table-header">
            <h3>Recent Transactions</h3>
            <div className="pill-group">
              {['All', 'Completed', 'Processing'].map((f) => (
                <button
                  key={f}
                  className={\`pill \${filter === f ? 'pill--active' : ''}\`}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <table className="dash-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {RECENT_ORDERS.filter((o) => filter === 'All' || o.status === filter).map((o) => (
                <tr key={o.id}>
                  <td className="code">{o.id}</td>
                  <td>{o.customer}</td>
                  <td>{o.product}</td>
                  <td>{o.amount}</td>
                  <td>
                    <span className={\`status-badge \${o.status.toLowerCase()}\`}>{o.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
`,
    "src/index.css": `:root {
  --bg: #090a0f;
  --surface: #12141c;
  --surface-hover: #191c27;
  --border: rgba(255, 255, 255, 0.08);
  --text: #f0f2f7;
  --text-muted: #8d95a5;
  --accent: #5e72e4;
  --radius: 10px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: system-ui, sans-serif; }
.dash-layout { min-height: 100vh; display: flex; flex-direction: column; }
.dash-header { height: 60px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 24px; background: var(--surface); }
.dash-brand { display: flex; align-items: center; gap: 10px; }
.brand-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 10px var(--accent); }
.dash-user { font-size: 13px; color: var(--text-muted); }
.dash-content { flex: 1; padding: 32px 24px; max-width: 1200px; margin: 0 auto; width: 100%; display: flex; flex-direction: column; gap: 24px; }
.page-heading { display: flex; justify-content: space-between; align-items: center; }
.page-heading h1 { font-size: 26px; font-weight: 700; }
.page-heading p { color: var(--text-muted); font-size: 14px; margin-top: 4px; }
.btn { background: var(--accent); color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 500; }
.grid-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.metric-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; display: flex; flex-direction: column; gap: 8px; }
.metric-title { font-size: 13px; color: var(--text-muted); }
.metric-val { font-size: 24px; font-weight: 700; }
.metric-change { font-size: 12px; }
.metric-change.pos { color: #4ade80; }
.metric-change.neg { color: #f87171; }
.table-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.table-header { padding: 18px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
.pill-group { display: flex; gap: 6px; }
.pill { background: transparent; border: 1px solid var(--border); color: var(--text-muted); padding: 4px 10px; border-radius: 999px; font-size: 12px; cursor: pointer; }
.pill--active { background: var(--surface-hover); color: var(--text); border-color: rgba(255, 255, 255, 0.2); }
.dash-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
.dash-table th, .dash-table td { padding: 14px 20px; border-bottom: 1px solid var(--border); }
.dash-table th { color: var(--text-muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
.code { font-family: monospace; color: var(--accent); }
.status-badge { padding: 3px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
.status-badge.completed { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
.status-badge.processing { background: rgba(250, 204, 21, 0.15); color: #facc15; }
`,
  },
};

const BLANK: Template = {
  id: "blank",
  name: "Blank",
  description: "Empty workspace — the agent scaffolds everything",
  files: {},
};

export const TEMPLATES: Template[] = [
  BLANK,
  STATIC_SITE,
  REACT_VITE,
  NEXTJS_TAILWIND,
  DASHBOARD_SHELL,
  FASTAPI_REACT,
  EXPRESS_API,
];

export function getTemplate(id?: string): Template {
  if (!id || id === 'blank') return BLANK;
  return TEMPLATES.find((t) => t.id === id) ?? BLANK;
}

