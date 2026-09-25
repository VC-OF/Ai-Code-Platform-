import { z } from 'zod';

const toolSchemas = {
  read_file: z.object({
    path: z.string().min(1).max(500),
  }),
  
  create_file: z.object({
    path: z.string().min(1).max(500),
    content: z.string().max(500_000), // 500KB limit
  }),
  
  append_file: z.object({
    path: z.string().min(1).max(500),
    content: z.string().min(1).max(500_000),
  }),

  edit_file: z.object({
    path: z.string().min(1).max(500),
    oldText: z.string().min(1).max(50_000),
    newText: z.string().max(50_000),
  }),
  
  replace_lines: z.object({
    path: z.string().min(1).max(500),
    start_line: z.number().int().min(1),
    end_line: z.number().int().min(1),
    new_content: z.string().max(50_000),
  }).refine(d => d.start_line <= d.end_line, {
    message: 'start_line must be <= end_line',
  }),
  
  delete_file: z.object({
    path: z.string().min(1).max(500),
  }),
  
  list_files: z.object({
    path: z.string().max(500).optional().default('.'),
  }).optional().default({ path: '.' }),

  glob_files: z.object({
    pattern: z.string().min(1).max(200),
  }),
  
  grep_files: z.object({
    pattern: z.string().min(1).max(500),
    path: z.string().max(500).optional(),
    glob: z.string().max(200).optional(),
    case_sensitive: z.boolean().optional().default(false),
  }),
  
  run_command: z.object({
    command: z.string().min(1).max(1000),
  }),

  web_search: z.object({
    query: z.string().min(1).max(300),
  }),

  fetch_url: z.object({
    url: z.string().url().max(2000),
  }),

  read_preview_logs: z.object({
    lines: z.number().int().min(1).max(500).optional(),
  }),

  fetch_preview: z.object({
    path: z.string().max(500).optional(),
    raw: z.boolean().optional(),
  }),

  check_preview: z.object({
    path: z.string().max(500).optional(),
    screenshot_path: z.string().max(500)
      .regex(/\.png$/i, 'screenshot_path must end in .png')
      .optional(),
  }),

  ask_user: z.object({
    question: z.string().min(1).max(1000),
    options: z.array(z.string().min(1).max(120)).max(4).optional(),
  }),

  deploy_app: z.object({}),

  update_plan: z.object({
    tasks: z
      .array(
        z.object({
          id: z.string().min(1).max(20),
          title: z.string().min(1).max(200),
          status: z.enum(['pending', 'in_progress', 'completed']),
        })
      )
      .min(1)
      .max(20),
  }),

  generate_image: z.object({
    prompt: z.string().min(1).max(2000),
    path: z.string().min(1).max(500)
      .regex(/\.(png|jpe?g|webp)$/i, 'path must end in .png, .jpg, or .webp'),
    width: z.number().int().min(64).max(2048).optional(),
    height: z.number().int().min(64).max(2048).optional(),
    seed: z.number().int().optional(),
  }),

  create_artifact: z.object({
    title: z.string().min(1).max(200),
    content: z.string().min(1),
    type: z.enum(['markdown', 'plan', 'diagram', 'diff', 'report', 'code']).optional(),
    description: z.string().max(500).optional(),
  }),
  
  run_lint: z.object({}).optional(),
  run_tests: z.object({
    pattern: z.string().max(200).optional(),
  }).optional(),
  
  docker_run: z.object({
    command: z.string().min(1).max(2000),
    image: z.string().max(200).optional(),
    network: z.enum(['none', 'bridge']).optional(),
  }),
  docker_status: z.object({}).optional(),
};

export type ToolName = keyof typeof toolSchemas;

export function validateToolArgs(
  toolName: string,
  args: unknown
): { success: true; data: unknown } | { success: false; error: string } {
  // MCP tools carry their own JSON Schemas — the server validates; we only
  // require an object payload
  if (toolName.startsWith('mcp_')) {
    if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
      return { success: true, data: args };
    }
    return { success: false, error: 'MCP tool arguments must be an object' };
  }

  const schema = toolSchemas[toolName as ToolName];

  if (!schema) {
    return { success: false, error: `Unknown tool: ${toolName}` };
  }
  
  const result = schema.safeParse(args);
  
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return { success: false, error: `Validation failed: ${issues}` };
  }
  
  return { success: true, data: result.data };
}

export function validateTool(
  toolName: string,
  args: unknown
): { ok: boolean; error?: string } {
  const result = validateToolArgs(toolName, args);
  if (result.success) {
    return { ok: true };
  }
  return { ok: false, error: result.error };
}
