import { z } from 'zod';

const envSchema = z.object({
  // Required
  NODE_ENV: z.enum(['development', 'test', 'production'])
    .default('development'),
  
  // Optional with defaults
  WORKSPACE_ROOT: z.string()
    .default('./workspaces'),
  PLATFORM_ROOT: z.string()
    .default('./.platform'),
  SETTINGS_ROOT: z.string()
    .default('./.settings'),
  
  // Encryption
  SETTINGS_ENCRYPTION_KEY: z.string()
    .min(32, 'Encryption key must be at least 32 characters')
    .optional(),
  
  // Agent defaults
  DEFAULT_LLM_PROVIDER: z.enum(['ollama', 'openai', 'openrouter'])
    .default('ollama'),
  DEFAULT_MODEL: z.string()
    .default('qwen2.5-coder:32b'),
  DEFAULT_TEMPERATURE: z.coerce.number()
    .min(0).max(2)
    .default(0.2),
  MAX_AGENT_STEPS: z.coerce.number()
    .int().min(1).max(50)
    .default(25),
  AGENT_TIMEOUT_MS: z.coerce.number()
    .int().min(5000)
    .default(300_000),  // 5 minutes
  
  // Preview server
  PREVIEW_PORT_MIN: z.coerce.number().int().default(3100),
  PREVIEW_PORT_MAX: z.coerce.number().int().default(3200),
  
  // Rate limiting
  RATE_LIMIT_REQUESTS: z.coerce.number().int().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(60_000),
});

function parseEnv() {
  const result = envSchema.safeParse(process.env);
  
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  
  return result.data;
}

// Singleton config object
export const config = parseEnv();
export type Config = typeof config;
