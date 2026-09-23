// Known external sites/apps the secure exam browser should detect & log.
// Browser security limits us: we cannot truly read other tabs or apps,
// but if a candidate pastes a URL, performs a search, or types into an
// outside-chat window that we are told about, we can log it. These lists
// also power heuristic detection in the security monitor component.

export type SiteCategory =
  "search" | "ai" | "translation" | "video" | "dictionary" | "social" | "other";

interface SitePattern {
  name: string;
  category: SiteCategory;
  match: (url: string) => boolean;
}

export const KNOWN_SITES: SitePattern[] = [
  {
    name: "Google",
    category: "search",
    match: (u) => /(^|\.)google\./i.test(u),
  },
  {
    name: "Bing",
    category: "search",
    match: (u) => /(^|\.)bing\.com/i.test(u),
  },
  {
    name: "DuckDuckGo",
    category: "search",
    match: (u) => /duckduckgo\.com/i.test(u),
  },
  {
    name: "Yahoo Search",
    category: "search",
    match: (u) => /search\.yahoo\.com/i.test(u),
  },
  { name: "Yandex", category: "search", match: (u) => /yandex\./i.test(u) },

  {
    name: "ChatGPT",
    category: "ai",
    match: (u) => /(^|\.)chatgpt\.com|chat\.openai\.com|openai\.com/i.test(u),
  },
  {
    name: "Gemini",
    category: "ai",
    match: (u) => /gemini\.google\.com|bard\.google\.com/i.test(u),
  },
  {
    name: "Claude",
    category: "ai",
    match: (u) => /claude\.ai|anthropic\.com/i.test(u),
  },
  {
    name: "DeepSeek",
    category: "ai",
    match: (u) => /deepseek\.com|chat\.deepseek\.com/i.test(u),
  },
  {
    name: "Copilot",
    category: "ai",
    match: (u) => /copilot\.microsoft\.com/i.test(u),
  },
  {
    name: "Perplexity",
    category: "ai",
    match: (u) => /perplexity\.ai/i.test(u),
  },

  {
    name: "Google Translate",
    category: "translation",
    match: (u) => /translate\.google\./i.test(u),
  },
  {
    name: "DeepL",
    category: "translation",
    match: (u) => /deepl\.com/i.test(u),
  },
  {
    name: "Jisho",
    category: "dictionary",
    match: (u) => /jisho\.org/i.test(u),
  },
  {
    name: "Tangorin",
    category: "dictionary",
    match: (u) => /tangorin\.com/i.test(u),
  },
  {
    name: "Goo辞書",
    category: "dictionary",
    match: (u) => /dictionary\.goo\.ne\.jp/i.test(u),
  },
  {
    name: "Weblio",
    category: "dictionary",
    match: (u) => /weblio\.jp/i.test(u),
  },

  {
    name: "YouTube",
    category: "video",
    match: (u) => /(^|\.)youtube\.com|youtu\.be/i.test(u),
  },
  { name: "Netflix", category: "video", match: (u) => /netflix\.com/i.test(u) },
  { name: "Twitch", category: "video", match: (u) => /twitch\.tv/i.test(u) },

  {
    name: "X (Twitter)",
    category: "social",
    match: (u) => /(^|\.)x\.com|twitter\.com/i.test(u),
  },
  {
    name: "Facebook",
    category: "social",
    match: (u) => /facebook\.com/i.test(u),
  },
  {
    name: "Instagram",
    category: "social",
    match: (u) => /instagram\.com/i.test(u),
  },
  { name: "Reddit", category: "social", match: (u) => /reddit\.com/i.test(u) },
  {
    name: "Discord",
    category: "social",
    match: (u) => /discord\.com|discord\.gg/i.test(u),
  },
  {
    name: "WhatsApp Web",
    category: "social",
    match: (u) => /web\.whatsapp\.com/i.test(u),
  },
];

export function detectSite(
  url: string
): { name: string; category: SiteCategory } | null {
  if (!url) return null;
  for (const p of KNOWN_SITES) {
    if (p.match(url)) return { name: p.name, category: p.category };
  }
  return null;
}

export const BLOCKED_KEY_COMBOS: { keys: string; label: string }[] = [
  { keys: "Ctrl+C", label: "Copy" },
  { keys: "Ctrl+V", label: "Paste" },
  { keys: "Ctrl+X", label: "Cut" },
  { keys: "Ctrl+A", label: "Select all" },
  { keys: "Ctrl+P", label: "Print" },
  { keys: "Ctrl+S", label: "Save" },
  { keys: "Ctrl+U", label: "View source" },
  { keys: "Ctrl+Shift+I", label: "DevTools" },
  { keys: "Ctrl+Shift+J", label: "DevTools console" },
  { keys: "Ctrl+Shift+C", label: "Inspect element" },
  { keys: "F12", label: "DevTools" },
  { keys: "F11", label: "Toggle fullscreen" },
  { keys: "Meta+C", label: "Copy" },
  { keys: "Meta+V", label: "Paste" },
  { keys: "Meta+X", label: "Cut" },
  { keys: "Meta+A", label: "Select all" },
  { keys: "Meta+S", label: "Save" },
  { keys: "PrintScreen", label: "Screenshot" },
];

export const MONITORED_APPS: { name: string; key: string }[] = [
  { name: "Microsoft Word", key: "word" },
  { name: "Notepad", key: "notepad" },
  { name: "Calculator", key: "calc" },
  { name: "PDF Reader (Adobe)", key: "pdf" },
  { name: "Google Docs", key: "gdocs" },
  { name: "OneNote", key: "onenote" },
  { name: "Slack", key: "slack" },
  { name: "Discord", key: "discord" },
  { name: "Telegram", key: "telegram" },
  { name: "Screen Capture Tool", key: "screenrec" },
  { name: "DevTools / Inspect", key: "devtools" },
];
