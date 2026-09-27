import {
  demoKeyFor,
  isServerSideKeyName,
  keyEnvFor,
  needsKey,
  type AuthKind,
  type CorsSupport,
  type PublicApiWithKey,
} from './catalog';
import type { ResolvedIdea } from './ideas';
import type { ProductRecipe } from './recipes';

/**
 * Turns whatever the user picked on the welcome screen (a product idea, a
 * catalog API or a starter recipe) into the agent prompt plus the keys to
 * store. Key values never enter the prompt; it only names env vars.
 */

export interface BuildApi {
  name: string;
  category: string;
  description?: string;
  docsUrl?: string;
  endpoint?: string;
  sampleEndpoints?: string[];
  authKind: AuthKind;
  authLabel?: string;
  https?: boolean;
  cors?: CorsSupport;
  /** Set for APIs that need a key (apiKey / OAuth). */
  keyEnv?: string;
  keySaved?: boolean;
  keySavedAs?: string;
  demoKey?: string;
}

export interface BuildTarget {
  kind: 'idea' | 'api' | 'starter';
  title: string;
  summary: string;
  category: string;
  features: string[];
  audience?: string;
  apis: BuildApi[];
}

export interface BuildProductKey {
  keyEnv: string;
  value: string;
}

export interface BuildProductSpec {
  title: string;
  /** API name, or a comma-separated list for multi-API builds. */
  api: string;
  category: string;
  description: string;
  endpoint: string;
  /** Legacy single-key fields; `keys` is preferred. */
  apiKey?: string;
  keyEnv?: string;
  /** Each provided key, saved as its own project-scoped setting. */
  keys?: BuildProductKey[];
  apis?: { name: string; docsUrl?: string; authKind: AuthKind; keyEnv?: string }[];
  template: string;
  prompt: string;
}

export const DEFAULT_KEY_ENV = 'VITE_API_KEY';

// Same rule settingsStore.setEnvVar enforces server-side.
export function isValidEnvName(name: string): boolean {
  return /^[A-Z0-9_]+$/i.test(name);
}

function defaultFeatures(apiName: string): string[] {
  return [
    `Live data from ${apiName} with search and filters`,
    'Detail view for each item',
    'Favourites saved locally',
    'Clear loading, empty and error states',
  ];
}

type CatalogApiInput = PublicApiWithKey & { demoKey?: string };

function fromCatalogApi(api: CatalogApiInput): BuildApi {
  const keyed = needsKey(api);
  return {
    name: api.name,
    category: api.category,
    description: api.description || undefined,
    docsUrl: api.url || undefined,
    authKind: api.authKind,
    authLabel: api.authLabel,
    https: api.https,
    cors: api.cors,
    keyEnv: keyed ? api.keyEnv : undefined,
    keySaved: keyed ? api.keySaved : undefined,
    keySavedAs: keyed ? api.keySavedAs : undefined,
    demoKey: keyed ? (api.demoKey ?? demoKeyFor(api.keyEnv)) : undefined,
  };
}

export function targetFromIdea(idea: ResolvedIdea): BuildTarget {
  return {
    kind: 'idea',
    title: idea.title,
    summary: idea.pitch,
    category: idea.categories.join(' · '),
    features: [...idea.features],
    audience: idea.audience,
    apis: idea.apis.map(fromCatalogApi),
  };
}

export function targetFromApi(api: PublicApiWithKey): BuildTarget {
  return {
    kind: 'api',
    title: `${api.name} explorer`,
    summary: api.description
      ? `An app built on ${api.name}: ${api.description.replace(/[.\s]+$/, '')}.`
      : `An app built on ${api.name}.`,
    category: api.category,
    features: defaultFeatures(api.name),
    apis: [fromCatalogApi(api)],
  };
}

export function targetFromRecipe(recipe: ProductRecipe & { keySaved?: boolean; keySavedAs?: string }): BuildTarget {
  const authKind: AuthKind = recipe.auth === 'apiKey' ? 'apiKey' : recipe.auth === 'OAuth' ? 'oauth' : 'none';
  const keyed = authKind !== 'none';
  const keyEnv = keyed ? recipe.keyEnv || keyEnvFor(recipe.api) : undefined;
  return {
    kind: 'starter',
    title: recipe.title,
    summary: recipe.description,
    category: recipe.category,
    features: defaultFeatures(recipe.api),
    apis: [
      {
        name: recipe.api,
        category: recipe.category,
        docsUrl: recipe.docsUrl,
        endpoint: recipe.endpoint,
        sampleEndpoints: recipe.sampleEndpoints,
        authKind,
        authLabel: authKind === 'none' ? 'No' : recipe.auth,
        https: recipe.endpoint.startsWith('https://'),
        keyEnv,
        keySaved: keyed ? Boolean(recipe.keySaved) : undefined,
        keySavedAs: keyed && recipe.keySaved ? recipe.keySavedAs : undefined,
        demoKey: keyed ? (recipe.demoKey ?? demoKeyFor(keyEnv)) : undefined,
      },
    ],
  };
}

/** APIs that get a key input in the modal: one per distinct env var. */
export function keyInputsFor(target: BuildTarget): (BuildApi & { keyEnv: string })[] {
  const seen = new Set<string>();
  const out: (BuildApi & { keyEnv: string })[] = [];
  for (const api of target.apis) {
    if (!needsKey(api) || !api.keyEnv || seen.has(api.keyEnv)) continue;
    seen.add(api.keyEnv);
    out.push({ ...api, keyEnv: api.keyEnv });
  }
  return out;
}

const DEV_PROXY = 'a Vite dev-server proxy (server.proxy in vite.config.ts)';

/**
 * The global setting this API's key must be read from server-side: set when
 * the saved key has no VITE_ prefix and the user gave no project key.
 */
function serverSideKey(api: BuildApi, provided: ReadonlySet<string>): string | null {
  const env = api.keyEnv || DEFAULT_KEY_ENV;
  if (!needsKey(api) || provided.has(env) || !api.keySaved) return null;
  return isServerSideKeyName(api.keySavedAs) ? api.keySavedAs : null;
}

// A non-VITE_ setting may hold anything (even another service's secret), so
// the prompt never offers to re-export it into the client bundle.
function serverKeyLine(name: string, noun: string): string {
  return `The ${noun} is saved in global settings as ${name}, a server-side variable the browser cannot read. Keep it server-side: call the API through ${DEV_PROXY} that reads process.env.${name} and adds it to the proxied requests. Never copy it into a VITE_ variable, a vite.config.ts define or any client code.`;
}

function keyStatus(api: BuildApi, env: string, provided: ReadonlySet<string>): string {
  if (provided.has(env)) return `it is saved in this project's settings as ${env}`;
  if (api.keySaved) return `it is already saved in global settings as ${api.keySavedAs ?? env}`;
  return `it has not been provided yet (the user can add ${env} in Settings)`;
}

/**
 * The variable the browser reads a key from: the key env, unless the key is
 * only saved globally under another spelling of a VITE_ name
 * (VITE_Weatherbit_Api_Key). Env names are case-sensitive, so that spelling is
 * the variable that actually exists.
 */
function clientKeyEnv(api: BuildApi, env: string, provided: ReadonlySet<string>): string {
  if (provided.has(env) || !api.keySaved || !api.keySavedAs || isServerSideKeyName(api.keySavedAs)) return env;
  return api.keySavedAs;
}

function authLine(api: BuildApi, provided: ReadonlySet<string>): string {
  const env = api.keyEnv || DEFAULT_KEY_ENV;
  const serverKey = serverSideKey(api, provided);
  const readEnv = clientKeyEnv(api, env, provided);
  switch (api.authKind) {
    case 'none':
      return 'Auth: none. Call it directly with fetch.';
    case 'other':
      return `Auth: needs ${api.authLabel || 'a special header'} (no secret key); see the docs.`;
    case 'apiKey': {
      const header = api.authLabel && /^x-/i.test(api.authLabel) ? ` Send it in the ${api.authLabel} header.` : '';
      if (serverKey) return `Auth: API key. ${serverKeyLine(serverKey, 'key')}${header}`;
      return `Auth: API key. Read it from import.meta.env.${readEnv}; ${keyStatus(api, env, provided)}.${header}`;
    }
    case 'oauth':
      if (serverKey) {
        return `Auth: OAuth. Follow the provider's OAuth flow from the docs. ${serverKeyLine(serverKey, 'OAuth credential')} Never put a client secret in browser code (use PKCE or a server route).`;
      }
      return `Auth: OAuth. Follow the provider's OAuth flow from the docs and read the client ID from import.meta.env.${readEnv}; ${keyStatus(api, env, provided)}. Never put a client secret in browser code (use PKCE or a server route).`;
  }
}

function transportLine(api: BuildApi): string | null {
  const proxy = DEV_PROXY;
  if (api.https === false) return `Transport: plain HTTP only, which browsers block from HTTPS pages; call it through ${proxy}.`;
  if (api.cors === 'no') return `CORS: not enabled; call it through ${proxy} rather than directly from the browser.`;
  if (api.cors === 'unknown') return `CORS: unknown; if browser requests are blocked, route them through ${proxy}.`;
  if (api.cors === 'yes') return 'CORS: enabled, so the browser can call it directly.';
  return null;
}

export function buildProductPrompt(target: BuildTarget, title: string, providedKeyEnvs: Iterable<string> = []): string {
  const provided = new Set(providedKeyEnvs);
  const multi = target.apis.length > 1;
  const lines: string[] = [
    `Build a complete, polished, fully functional web app called "${title.trim() || target.title}".`,
    '',
    target.summary,
  ];
  if (target.audience) lines.push(`Audience: ${target.audience}.`);

  lines.push('', 'Features:');
  target.features.forEach((feature, i) => lines.push(`${i + 1}. ${feature}`));

  lines.push('', multi ? `APIs to integrate (${target.apis.length}):` : 'API to integrate:');
  target.apis.forEach((api, i) => {
    lines.push(`${i + 1}. ${api.name} (${api.category})${api.description ? `: ${api.description}` : ''}`);
    if (api.docsUrl) lines.push(`   Docs: ${api.docsUrl}`);
    if (api.endpoint && api.endpoint !== api.docsUrl) lines.push(`   Endpoint: ${api.endpoint}`);
    if (api.sampleEndpoints?.length) lines.push(`   Sample requests: ${api.sampleEndpoints.join(' , ')}`);
    lines.push(`   ${authLine(api, provided)}`);
    const transport = transportLine(api);
    if (transport) lines.push(`   ${transport}`);
  });

  const usesKeys = target.apis.some((api) => needsKey(api));
  const usesServerKeys = target.apis.some((api) => serverSideKey(api, provided) !== null);
  const requirements = [
    `Use live data from ${multi ? 'every API above' : target.apis[0]?.name ?? 'the API above'}; no mock data in the finished app.`,
    'Wrap each API in a small typed client module (e.g. src/api/<name>.ts) and show loading, empty and error states, including rate-limit errors.',
    ...(usesKeys
      ? [
          usesServerKeys
            ? 'Read keys only from the variables named above: import.meta.env for VITE_ keys, process.env inside vite.config.ts for server-side keys. Never hard-code, log or commit key values, and never expose a server-side key to the browser; if a key is missing, show a short setup message naming the variable instead of failing.'
            : 'Read keys only from import.meta.env using the variable names above. Never hard-code, log or commit key values; if a key is missing, show a short setup message naming the variable instead of failing.',
        ]
      : []),
    'Responsive, accessible UI that works from 375px phones to desktop, with light and dark themes.',
    'Run run_lint and run_tests before finishing.',
  ];
  lines.push('', 'Requirements:');
  requirements.forEach((req, i) => lines.push(`${i + 1}. ${req}`));
  return lines.join('\n');
}

export function createBuildSpec(
  target: BuildTarget,
  input: { title: string; keyValues?: Readonly<Record<string, string>> }
): BuildProductSpec {
  const title = input.title.trim() || target.title;
  const keys: BuildProductKey[] = [];
  for (const api of keyInputsFor(target)) {
    const value = input.keyValues?.[api.keyEnv]?.trim();
    if (value && isValidEnvName(api.keyEnv)) keys.push({ keyEnv: api.keyEnv, value });
  }
  const primary = target.apis[0];
  return {
    title,
    api: target.apis.map((api) => api.name).join(', '),
    category: target.category,
    description: target.summary,
    endpoint: primary?.endpoint || primary?.docsUrl || '',
    keyEnv: target.apis.length === 1 ? primary?.keyEnv : undefined,
    keys,
    apis: target.apis.map(({ name, docsUrl, authKind, keyEnv }) => ({ name, docsUrl, authKind, keyEnv })),
    template: 'react-vite',
    prompt: buildProductPrompt(target, title, keys.map((k) => k.keyEnv)),
  };
}

/**
 * Every key a spec asks to store, deduplicated by env var: `keys` first, then
 * the legacy single `apiKey` (saved as `keyEnv`, default VITE_API_KEY).
 */
export function collectSpecKeys(spec: Pick<BuildProductSpec, 'apiKey' | 'keyEnv' | 'keys'>): BuildProductKey[] {
  const out = new Map<string, string>();
  const add = (keyEnv: string | undefined, value: string | undefined) => {
    const env = keyEnv?.trim();
    const v = value?.trim();
    if (!env || !v || !isValidEnvName(env) || out.has(env)) return;
    out.set(env, v);
  };
  for (const key of spec.keys ?? []) add(key.keyEnv, key.value);
  add(spec.keyEnv || DEFAULT_KEY_ENV, spec.apiKey);
  return Array.from(out, ([keyEnv, value]) => ({ keyEnv, value }));
}
