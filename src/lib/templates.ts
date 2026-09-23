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

const BLANK: Template = {
  id: "blank",
  name: "Blank",
  description: "Empty workspace — the agent scaffolds everything",
  files: {},
};

export const TEMPLATES: Template[] = [BLANK, STATIC_SITE, REACT_VITE];

export function getTemplate(id?: string): Template {
  return TEMPLATES.find((t) => t.id === id) ?? BLANK;
}
