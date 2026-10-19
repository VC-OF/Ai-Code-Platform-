'use client';

import { useState } from 'react';

export interface UIComponentItem {
  id: string;
  name: string;
  category: 'Heroes' | 'Navigation' | 'Features' | 'Pricing' | 'Stats' | 'Forms' | 'Feedback';
  description: string;
  fileName: string;
  preview: string;
  code: string;
}

const PALETTE_COMPONENTS: UIComponentItem[] = [
  {
    id: 'hero-gradient',
    name: 'Modern Gradient Hero',
    category: 'Heroes',
    description: 'Impactful hero header with animated badge, headline, and action buttons.',
    fileName: 'HeroSection.tsx',
    preview: '⚡ Build Faster with AI\nNext-Generation Cloud Workspace\n[Start Free Trial] [Read Documentation]',
    code: `export default function HeroSection() {
  return (
    <section className="relative overflow-hidden py-24 sm:py-32 bg-neutral-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.25),rgba(255,255,255,0))]" />
      <div className="relative mx-auto max-w-7xl px-6 lg:px-8 text-center">
        <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold bg-neutral-900 border border-neutral-800 text-neutral-300 mb-8">
          <span className="flex h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          Announcing Version 2.0
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-6xl max-w-4xl mx-auto bg-gradient-to-r from-white via-neutral-200 to-neutral-400 bg-clip-text text-transparent">
          Supercharge your workflow with intelligent autonomous agents
        </h1>
        <p className="mt-6 text-lg leading-8 text-neutral-400 max-w-2xl mx-auto">
          Write, test, and ship complete full-stack web applications effortlessly in your browser.
        </p>
        <div className="mt-10 flex items-center justify-center gap-x-6">
          <button className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 transition-colors">
            Get started free
          </button>
          <button className="text-sm font-semibold leading-6 text-neutral-300 hover:text-white transition-colors">
            View live demo <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: 'feature-grid',
    name: '3-Column Bento Features',
    category: 'Features',
    description: 'Sleek dark card layout highlighting product benefits and features.',
    fileName: 'FeatureGrid.tsx',
    preview: '⚡ Lightning Fast  |  🛡️ Safe Sandbox  |  🔄 Auto Checkpoints',
    code: `export default function FeatureGrid() {
  const features = [
    { title: 'Blazing Fast Execution', desc: 'Instant feedback with local hot reloading and optimized builds.', icon: '⚡' },
    { title: 'Zero Configuration', desc: 'Scaffold and run polyglot projects without manual dev environment setup.', icon: '🚀' },
    { title: 'Air-Gapped Sandboxing', desc: 'Secure path jailing and allowlisted command execution out of the box.', icon: '🛡️' },
    { title: 'Multi-Model Fallbacks', desc: 'Seamlessly switch between top frontier reasoning and coder LLMs.', icon: '🧠' },
    { title: 'Automated Testing', desc: 'Continuous verification and regression tests run before every turn finish.', icon: '🧪' },
    { title: 'One-Click Cloud Deploy', desc: 'Ship your application to Vercel, Netlify, or Cloudflare instantly.', icon: '🌐' },
  ];

  return (
    <section className="py-20 bg-neutral-900 text-neutral-100">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-bold tracking-tight">Everything you need to ship</h2>
          <p className="mt-4 text-neutral-400">Engineered from the ground up for modern developer agility.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className="p-6 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-neutral-700 transition-colors">
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="text-lg font-semibold text-white">{f.title}</h3>
              <p className="mt-2 text-sm text-neutral-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: 'pricing-table',
    name: '3-Tier SaaS Pricing Table',
    category: 'Pricing',
    description: 'Clean pricing tiers with annual/monthly switch and popular badge.',
    fileName: 'PricingTable.tsx',
    preview: 'Starter ($0)  |  Pro ($29/mo - Popular)  |  Enterprise ($99/mo)',
    code: `export default function PricingTable() {
  const tiers = [
    { name: 'Starter', price: '$0', desc: 'For individuals exploring AI code generation', features: ['5 projects', 'Community models', 'Basic preview'] },
    { name: 'Pro', price: '$29', desc: 'For professional software engineers and creators', features: ['Unlimited projects', 'Frontier models (Nemotron/GPT)', 'Docker sandboxing', 'Priority support'], popular: true },
    { name: 'Enterprise', price: '$99', desc: 'For dedicated engineering teams with custom VPCs', features: ['Custom SSO & RBAC', 'Dedicated runners', 'Self-hosted LLMs', 'SLA 99.9%'] },
  ];

  return (
    <section className="py-20 bg-neutral-950 text-white">
      <div className="max-w-6xl mx-auto px-6">
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl font-bold">Predictable, transparent pricing</h2>
          <p className="mt-3 text-neutral-400">Scale as you build. No surprise charges.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {tiers.map((t) => (
            <div key={t.name} className={\`p-8 rounded-2xl border \${t.popular ? 'border-blue-500 bg-neutral-900/80 ring-2 ring-blue-500/20' : 'border-neutral-800 bg-neutral-900/40'} flex flex-col justify-between\`}>
              <div>
                {t.popular && <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/20 text-blue-400 mb-4">Most Popular</span>}
                <h3 className="text-xl font-bold">{t.name}</h3>
                <div className="mt-4 flex items-baseline">
                  <span className="text-4xl font-extrabold tracking-tight">{t.price}</span>
                  <span className="text-neutral-400 ml-2">/ month</span>
                </div>
                <p className="mt-3 text-sm text-neutral-400">{t.desc}</p>
                <ul className="mt-6 space-y-3">
                  {t.features.map((feat) => (
                    <li key={feat} className="text-sm text-neutral-300 flex items-center gap-2">
                      <span className="text-blue-400">✓</span> {feat}
                    </li>
                  ))}
                </ul>
              </div>
              <button className={\`mt-8 w-full py-2.5 rounded-lg text-sm font-semibold transition-colors \${t.popular ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200'}\`}>
                Choose {t.name}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
`,
  },
  {
    id: 'stats-grid',
    name: 'KPI & Metrics Stats Grid',
    category: 'Stats',
    description: 'Dashboard metric cards with trend indicators and growth badges.',
    fileName: 'StatsGrid.tsx',
    preview: '$124.5k Revenue (+14%)  |  12.4k Active (+8%)  |  99.9% Uptime',
    code: `export default function StatsGrid() {
  const stats = [
    { label: 'Total Revenue', value: '$124,592', change: '+14.2%', positive: true },
    { label: 'Active Users', value: '18,490', change: '+8.1%', positive: true },
    { label: 'Conversion Rate', value: '3.42%', change: '-0.3%', positive: false },
    { label: 'System Uptime', value: '99.98%', change: '+0.02%', positive: true },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4">
      {stats.map((s) => (
        <div key={s.label} className="p-5 rounded-xl bg-neutral-900 border border-neutral-800">
          <span className="text-xs font-medium text-neutral-400 uppercase tracking-wider">{s.label}</span>
          <div className="mt-2 text-2xl font-bold text-white">{s.value}</div>
          <div className={\`mt-1 text-xs font-medium \${s.positive ? 'text-emerald-400' : 'text-rose-400'}\`}>
            {s.change} <span className="text-neutral-500 font-normal">vs last month</span>
          </div>
        </div>
      ))}
    </div>
  );
}
`,
  },
  {
    id: 'navbar-glass',
    name: 'Glassmorphism Header Navbar',
    category: 'Navigation',
    description: 'Sticky navigation header with frosted glass effect and responsive links.',
    fileName: 'Navbar.tsx',
    preview: '[Logo]  Features  Docs  Pricing  Blog  |  [Sign In] [Get Started]',
    code: `export default function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full backdrop-blur-md bg-neutral-950/80 border-b border-neutral-800">
      <div className="max-w-7xl mx-auto flex h-16 items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white">⚡</div>
          <span className="font-bold text-white text-lg tracking-tight">OpenCode</span>
        </div>
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-neutral-300">
          <a href="#features" className="hover:text-white transition-colors">Features</a>
          <a href="#solutions" className="hover:text-white transition-colors">Solutions</a>
          <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
          <a href="#docs" className="hover:text-white transition-colors">Documentation</a>
        </nav>
        <div className="flex items-center gap-4">
          <button className="text-sm font-medium text-neutral-300 hover:text-white transition-colors">Sign in</button>
          <button className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 transition-colors">
            Get Started
          </button>
        </div>
      </div>
    </header>
  );
}
`,
  },
  {
    id: 'auth-card',
    name: 'Authentication Card',
    category: 'Forms',
    description: 'Login card with social authentication and clean input validation.',
    fileName: 'AuthCard.tsx',
    preview: 'Sign In  |  [GitHub] [Google]  |  Email & Password  |  [Continue]',
    code: `export default function AuthCard() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4">
      <div className="w-full max-w-md rounded-2xl bg-neutral-900 border border-neutral-800 p-8 shadow-2xl text-white">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold">Welcome back</h2>
          <p className="text-sm text-neutral-400 mt-2">Enter your credentials to access your workspace</p>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">Email address</label>
            <input type="email" placeholder="name@company.com" className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-300 mb-1.5">Password</label>
            <input type="password" placeholder="••••••••" className="w-full rounded-lg bg-neutral-950 border border-neutral-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500" />
          </div>
          <button className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors mt-6">
            Sign in
          </button>
        </div>
      </div>
    </div>
  );
}
`,
  },
];

interface ComponentPaletteModalProps {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onSelectPrompt?: (prompt: string) => void;
}

export default function ComponentPaletteModal({
  projectId,
  isOpen,
  onClose,
  onSelectPrompt,
}: ComponentPaletteModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [search, setSearch] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const categories = ['All', 'Heroes', 'Features', 'Pricing', 'Stats', 'Navigation', 'Forms'];

  const filtered = PALETTE_COMPONENTS.filter((c) => {
    const matchCat = selectedCategory === 'All' || c.category === selectedCategory;
    const matchSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const handleInsert = async (comp: UIComponentItem) => {
    setStatusMsg(`Inserting ${comp.fileName}...`);
    try {
      const targetPath = `src/components/ui/${comp.fileName}`;
      const res = await fetch('/api/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: targetPath,
          content: comp.code,
          projectId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to insert file');
      }

      setStatusMsg(`✓ Saved to ${targetPath}`);
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (err: unknown) {
      setStatusMsg(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleAskAgent = (comp: UIComponentItem) => {
    const prompt = `Please add the ${comp.name} component to our app and mount it on the main page. Here is the component code:\n\n\`\`\`tsx\n${comp.code}\n\`\`\``;
    if (onSelectPrompt) {
      onSelectPrompt(prompt);
      onClose();
    }
  };

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="palette-header">
          <div>
            <h2 className="palette-title">UI Component Palette</h2>
            <p className="palette-desc">Browse pre-built modern UI components to insert or prompt the agent to integrate.</p>
          </div>
          <button onClick={onClose} className="palette-close-btn">&times;</button>
        </div>

        {/* Search & Categories */}
        <div className="palette-controls">
          <input
            type="text"
            placeholder="Search components (e.g. Hero, Pricing, Navbar)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="palette-search"
            autoFocus
          />
          <div className="palette-categories">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`palette-chip ${selectedCategory === cat ? 'palette-chip--active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {statusMsg && <div className="palette-status-banner">{statusMsg}</div>}

        {/* Component Grid */}
        <div className="palette-grid">
          {filtered.map((item) => (
            <div key={item.id} className="palette-card">
              <div className="palette-card-top">
                <span className="palette-badge">{item.category}</span>
                <span className="palette-file">{item.fileName}</span>
              </div>
              <h3 className="palette-card-name">{item.name}</h3>
              <p className="palette-card-desc">{item.description}</p>
              <div className="palette-preview-box">
                <pre>{item.preview}</pre>
              </div>
              <div className="palette-card-actions">
                <button
                  type="button"
                  onClick={() => handleInsert(item)}
                  className="palette-btn palette-btn--insert"
                  title="Save directly into src/components/ui/"
                >
                  Insert File
                </button>
                <button
                  type="button"
                  onClick={() => handleAskAgent(item)}
                  className="palette-btn palette-btn--agent"
                  title="Ask agent to wire it into the page"
                >
                  Ask Agent
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx>{`
        .palette-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(5px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 20px;
        }
        .palette-modal {
          width: 100%;
          max-width: 880px;
          max-height: 85vh;
          background: var(--bg-surface, #141414);
          border: 1px solid var(--border-base, #2a2a2a);
          border-radius: 14px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          overflow: hidden;
        }
        .palette-header {
          padding: 18px 24px;
          border-bottom: 1px solid var(--border-subtle, #222);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .palette-title {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary, #fff);
          margin: 0;
        }
        .palette-desc {
          font-size: 13px;
          color: var(--text-muted, #888);
          margin: 4px 0 0 0;
        }
        .palette-close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted, #888);
          font-size: 24px;
          cursor: pointer;
          line-height: 1;
        }
        .palette-controls {
          padding: 16px 24px;
          border-bottom: 1px solid var(--border-subtle, #222);
          display: flex;
          flex-direction: column;
          gap: 12px;
          background: var(--bg-elevated, #1a1a1a);
        }
        .palette-search {
          width: 100%;
          padding: 8px 14px;
          border-radius: 8px;
          background: var(--bg-surface, #111);
          border: 1px solid var(--border-base, #333);
          color: var(--text-primary, #fff);
          font-size: 13px;
          outline: none;
        }
        .palette-categories {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 2px;
        }
        .palette-chip {
          padding: 4px 12px;
          border-radius: 999px;
          font-size: 12px;
          background: var(--bg-surface, #111);
          border: 1px solid var(--border-base, #333);
          color: var(--text-muted, #888);
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s;
        }
        .palette-chip--active {
          background: var(--accent, #3b82f6);
          color: white;
          border-color: var(--accent, #3b82f6);
        }
        .palette-status-banner {
          padding: 8px 24px;
          background: rgba(59, 130, 246, 0.15);
          color: #93c5fd;
          font-size: 12px;
          font-weight: 500;
        }
        .palette-grid {
          flex: 1;
          overflow-y: auto;
          padding: 20px 24px;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
          gap: 16px;
        }
        .palette-card {
          background: var(--bg-elevated, #181818);
          border: 1px solid var(--border-base, #282828);
          border-radius: 10px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .palette-card-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .palette-badge {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 2px 6px;
          border-radius: 4px;
          background: rgba(255, 255, 255, 0.08);
          color: var(--text-muted, #aaa);
        }
        .palette-file {
          font-family: monospace;
          font-size: 11px;
          color: var(--text-muted, #777);
        }
        .palette-card-name {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary, #fff);
          margin: 0;
        }
        .palette-card-desc {
          font-size: 12px;
          color: var(--text-muted, #999);
          margin: 0;
          line-height: 1.4;
        }
        .palette-preview-box {
          background: var(--bg-surface, #101010);
          border: 1px solid var(--border-subtle, #222);
          border-radius: 6px;
          padding: 8px 10px;
          font-family: monospace;
          font-size: 10.5px;
          color: var(--accent, #60a5fa);
          overflow: hidden;
          white-space: pre-wrap;
          line-height: 1.4;
          height: 60px;
        }
        .palette-card-actions {
          display: flex;
          gap: 8px;
          margin-top: auto;
        }
        .palette-btn {
          flex: 1;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.15s;
          border: 1px solid transparent;
        }
        .palette-btn--insert {
          background: var(--bg-surface, #222);
          border-color: var(--border-base, #333);
          color: var(--text-primary, #fff);
        }
        .palette-btn--insert:hover {
          background: var(--bg-hover, #2c2c2c);
        }
        .palette-btn--agent {
          background: var(--accent, #3b82f6);
          color: white;
        }
        .palette-btn--agent:hover {
          filter: brightness(1.1);
        }
      `}</style>
    </div>
  );
}
