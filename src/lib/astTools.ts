import fs from "fs/promises";
import path from "path";
import fg from "fast-glob";
import { z } from "zod";
import { safeResolve } from "./safeResolve";
import type { ScienceToolResult, ScienceTurnContext } from "./scienceTools";

export type AstToolResult = ScienceToolResult;

// ─── Token & Node Types ────────────────────────────────────────────────────────

export type TokenType =
  | "ident"
  | "metavar"
  | "multi_metavar"
  | "string"
  | "number"
  | "punct"
  | "comment"
  | "group";

export interface Token {
  type: TokenType;
  value: string;
  start: number;
  end: number;
  line: number;
  col: number;
  children?: Token[]; // for group: (), {}, []
}

// ─── Tokenizer ─────────────────────────────────────────────────────────────────

export function tokenize(code: string, isPattern = false): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  function advance(n = 1) {
    for (let k = 0; k < n; k++) {
      if (code[i] === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  }

  while (i < code.length) {
    const ch = code[i];

    // Skip whitespace
    if (/\s/.test(ch)) {
      advance();
      continue;
    }

    // Comments: // or /* */ or #
    if (ch === "/" && code[i + 1] === "/") {
      const start = i;
      const startLine = line;
      const startCol = col;
      while (i < code.length && code[i] !== "\n") advance();
      tokens.push({
        type: "comment",
        value: code.slice(start, i),
        start,
        end: i,
        line: startLine,
        col: startCol,
      });
      continue;
    }

    if (ch === "/" && code[i + 1] === "*") {
      const start = i;
      const startLine = line;
      const startCol = col;
      advance(2);
      while (i < code.length && !(code[i] === "*" && code[i + 1] === "/")) {
        advance();
      }
      if (i < code.length) advance(2);
      tokens.push({
        type: "comment",
        value: code.slice(start, i),
        start,
        end: i,
        line: startLine,
        col: startCol,
      });
      continue;
    }

    if (ch === "#" && !isPattern) {
      // Python / Shell comment
      const start = i;
      const startLine = line;
      const startCol = col;
      while (i < code.length && code[i] !== "\n") advance();
      tokens.push({
        type: "comment",
        value: code.slice(start, i),
        start,
        end: i,
        line: startLine,
        col: startCol,
      });
      continue;
    }

    // Metavariables: $$$VAR or $VAR (when in pattern or starting with $)
    if (ch === "$" && isPattern) {
      const start = i;
      const startLine = line;
      const startCol = col;
      if (code.startsWith("$$$", i)) {
        advance(3);
        while (i < code.length && /[a-zA-Z0-9_]/.test(code[i])) advance();
        tokens.push({
          type: "multi_metavar",
          value: code.slice(start, i),
          start,
          end: i,
          line: startLine,
          col: startCol,
        });
        continue;
      } else if (code.startsWith("$$", i)) {
        advance(2);
        while (i < code.length && /[a-zA-Z0-9_]/.test(code[i])) advance();
        tokens.push({
          type: "multi_metavar",
          value: code.slice(start, i),
          start,
          end: i,
          line: startLine,
          col: startCol,
        });
        continue;
      } else {
        advance(1);
        while (i < code.length && /[a-zA-Z0-9_]/.test(code[i])) advance();
        tokens.push({
          type: "metavar",
          value: code.slice(start, i),
          start,
          end: i,
          line: startLine,
          col: startCol,
        });
        continue;
      }
    }

    // Strings: single, double, backtick
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const start = i;
      const startLine = line;
      const startCol = col;
      advance();
      while (i < code.length) {
        if (code[i] === "\\") {
          advance(2);
        } else if (code[i] === quote) {
          advance();
          break;
        } else {
          advance();
        }
      }
      tokens.push({
        type: "string",
        value: code.slice(start, i),
        start,
        end: i,
        line: startLine,
        col: startCol,
      });
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      const start = i;
      const startLine = line;
      const startCol = col;
      while (i < code.length && /[0-9a-fA-FxX_.]/.test(code[i])) advance();
      tokens.push({
        type: "number",
        value: code.slice(start, i),
        start,
        end: i,
        line: startLine,
        col: startCol,
      });
      continue;
    }

    // Identifiers
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = i;
      const startLine = line;
      const startCol = col;
      while (i < code.length && /[a-zA-Z0-9_$]/.test(code[i])) advance();
      tokens.push({
        type: "ident",
        value: code.slice(start, i),
        start,
        end: i,
        line: startLine,
        col: startCol,
      });
      continue;
    }

    // Punctuation & Delimiters
    const start = i;
    const startLine = line;
    const startCol = col;
    // Multi-char operators
    const two = code.slice(i, i + 2);
    const three = code.slice(i, i + 3);
    if (["===", "!==", "...", ">>=", "<<="].includes(three)) {
      advance(3);
      tokens.push({
        type: "punct",
        value: three,
        start,
        end: i,
        line: startLine,
        col: startCol,
      });
      continue;
    }
    if (
      [
        "==",
        "!=",
        "<=",
        ">=",
        "=>",
        "->",
        "::",
        "&&",
        "||",
        "??",
        "+=",
        "-=",
        "*=",
        "/=",
        "++",
        "--",
      ].includes(two)
    ) {
      advance(2);
      tokens.push({
        type: "punct",
        value: two,
        start,
        end: i,
        line: startLine,
        col: startCol,
      });
      continue;
    }

    advance();
    tokens.push({
      type: "punct",
      value: ch,
      start,
      end: i,
      line: startLine,
      col: startCol,
    });
  }

  return tokens;
}

// ─── Grouping (Brackets & Parentheses) ─────────────────────────────────────────

export function buildTokenTree(tokens: Token[]): Token[] {
  const result: Token[] = [];
  const stack: { opener: Token; children: Token[] }[] = [];

  const pairs: Record<string, string> = { "(": ")", "{": "}", "[": "]" };
  const closers: Record<string, string> = { ")": "(", "}": "{", "]": "[" };

  for (const token of tokens) {
    if (token.type === "comment") {
      continue; // Filter out comments for structural AST matching
    }

    if (token.type === "punct" && pairs[token.value]) {
      stack.push({ opener: token, children: [] });
    } else if (token.type === "punct" && closers[token.value]) {
      if (stack.length > 0 && stack[stack.length - 1].opener.value === closers[token.value]) {
        const top = stack.pop()!;
        const groupToken: Token = {
          type: "group",
          value: top.opener.value + token.value,
          start: top.opener.start,
          end: token.end,
          line: top.opener.line,
          col: top.opener.col,
          children: top.children,
        };
        if (stack.length > 0) {
          stack[stack.length - 1].children.push(groupToken);
        } else {
          result.push(groupToken);
        }
      } else {
        // Unmatched closer
        if (stack.length > 0) {
          stack[stack.length - 1].children.push(token);
        } else {
          result.push(token);
        }
      }
    } else {
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(token);
      } else {
        result.push(token);
      }
    }
  }

  // Drain any unclosed openers
  while (stack.length > 0) {
    const item = stack.shift()!;
    result.push(item.opener, ...item.children);
  }

  return result;
}

// ─── AST Pattern Matching Engine ───────────────────────────────────────────────

export interface MatchResult {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  matchedText: string;
  bindings: Record<string, string>;
}

export function matchSequence(
  pattern: Token[],
  target: Token[],
  code: string,
  bindings: Record<string, string> = {}
): { matched: boolean; consumed: number; bindings: Record<string, string> } {
  let pIdx = 0;
  let tIdx = 0;
  const currentBindings = { ...bindings };

  while (pIdx < pattern.length) {
    const pTok = pattern[pIdx];

    if (pTok.type === "multi_metavar") {
      const varName = pTok.value;
      const nextPTok = pattern[pIdx + 1];

      if (!nextPTok) {
        // Matches rest of target sequence
        const capturedTokens = target.slice(tIdx);
        if (capturedTokens.length > 0) {
          const capText = code.slice(
            capturedTokens[0].start,
            capturedTokens[capturedTokens.length - 1].end
          );
          if (currentBindings[varName] !== undefined && currentBindings[varName] !== capText) {
            return { matched: false, consumed: 0, bindings };
          }
          currentBindings[varName] = capText;
        } else {
          currentBindings[varName] = "";
        }
        return { matched: true, consumed: target.length, bindings: currentBindings };
      }

      // Try consuming 0, 1, 2, ... target tokens until nextPTok matches
      for (let count = 0; tIdx + count <= target.length; count++) {
        const subSub = matchSequence(
          pattern.slice(pIdx + 1),
          target.slice(tIdx + count),
          code,
          currentBindings
        );
        if (subSub.matched) {
          const capturedTokens = target.slice(tIdx, tIdx + count);
          const capText =
            capturedTokens.length > 0
              ? code.slice(
                  capturedTokens[0].start,
                  capturedTokens[capturedTokens.length - 1].end
                )
              : "";
          if (currentBindings[varName] !== undefined && currentBindings[varName] !== capText) {
            continue;
          }
          currentBindings[varName] = capText;
          return {
            matched: true,
            consumed: tIdx + count + subSub.consumed,
            bindings: { ...currentBindings, ...subSub.bindings },
          };
        }
      }
      return { matched: false, consumed: 0, bindings };
    }

    if (tIdx >= target.length) {
      return { matched: false, consumed: 0, bindings };
    }

    const tTok = target[tIdx];

    if (pTok.type === "metavar") {
      const varName = pTok.value;
      const capText = code.slice(tTok.start, tTok.end);
      if (varName !== "$_" && currentBindings[varName] !== undefined && currentBindings[varName] !== capText) {
        return { matched: false, consumed: 0, bindings };
      }
      if (varName !== "$_") {
        currentBindings[varName] = capText;
      }
      pIdx++;
      tIdx++;
      continue;
    }

    if (pTok.type === "group" && tTok.type === "group") {
      if (pTok.value !== tTok.value) {
        return { matched: false, consumed: 0, bindings };
      }
      const childMatch = matchSequence(
        pTok.children || [],
        tTok.children || [],
        code,
        currentBindings
      );
      if (!childMatch.matched || childMatch.consumed !== (tTok.children || []).length) {
        return { matched: false, consumed: 0, bindings };
      }
      Object.assign(currentBindings, childMatch.bindings);
      pIdx++;
      tIdx++;
      continue;
    }

    // Literal token match
    if (pTok.value !== tTok.value) {
      return { matched: false, consumed: 0, bindings };
    }

    pIdx++;
    tIdx++;
  }

  return { matched: true, consumed: tIdx, bindings: currentBindings };
}

export function searchInTokens(
  patternTree: Token[],
  targetTree: Token[],
  code: string
): MatchResult[] {
  const matches: MatchResult[] = [];

  function walk(nodeList: Token[]) {
    for (let i = 0; i < nodeList.length; i++) {
      const match = matchSequence(patternTree, nodeList.slice(i), code);
      if (match.matched && match.consumed > 0) {
        const slice = nodeList.slice(i, i + match.consumed);
        const start = slice[0].start;
        const end = slice[slice.length - 1].end;
        const startLine = slice[0].line;
        const endLine = slice[slice.length - 1].line;
        const matchedText = code.slice(start, end);

        matches.push({
          start,
          end,
          startLine,
          endLine,
          matchedText,
          bindings: match.bindings,
        });
      }

      // Also recurse into group children
      if (nodeList[i].type === "group" && nodeList[i].children) {
        walk(nodeList[i].children!);
      }
    }
  }

  walk(targetTree);
  return matches;
}

// ─── Substitute Metavariables in Rewrite Template ──────────────────────────────

export function substituteTemplate(
  template: string,
  bindings: Record<string, string>,
  baseIndent: string
): string {
  let result = template;
  // Sort bindings by key length descending to avoid partial variable name collision ($A vs $AA)
  const keys = Object.keys(bindings).sort((a, b) => b.length - a.length);

  for (const key of keys) {
    const val = bindings[key];
    // Metavariables can be $VAR or $$$VAR
    const re = new RegExp(key.replace(/\$/g, "\\$"), "g");
    result = result.replace(re, () => val);
  }

  // Adjust multi-line indentation to match base indent if needed
  if (baseIndent && result.includes("\n")) {
    const lines = result.split("\n");
    result = lines
      .map((line, idx) => (idx === 0 ? line : baseIndent + line))
      .join("\n");
  }

  return result;
}

// ─── Schemas ───────────────────────────────────────────────────────────────────

const fn = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = []
) => ({
  type: "function" as const,
  function: {
    name,
    description,
    parameters: { type: "object", properties, required },
  },
});

export const AST_TOOL_SCHEMAS = [
  fn(
    "ast_grep_search",
    "Perform structural AST code search across files. Matches syntax structure independent of whitespace, newlines, or formatting. Supports metavariables like $VAR (single node/expression) and $$$ARGS (multi-node/sequence of statements/arguments).",
    {
      pattern: {
        type: "string",
        description:
          "Structural AST code pattern with optional metavariables (e.g. 'console.log($$$ARGS)', 'function $NAME($PARAM) { $$$BODY }', 'useEffect(() => { $$$BODY }, [$$$DEPS])')",
      },
      path: {
        type: "string",
        description:
          "Subdirectory or file path to search within (default: workspace root)",
      },
      glob: {
        type: "string",
        description:
          "File glob filter (e.g. '**/*.{ts,tsx}', 'src/**/*.py', '**/*.go')",
      },
      max_matches: {
        type: "integer",
        description: "Maximum matches to return (default: 50)",
      },
    },
    ["pattern"]
  ),
  fn(
    "ast_grep_replace",
    "Perform structural AST code replacement. Matches code using structural patterns with metavariables ($VAR, $$$ARGS) and rewrites matches using the rewrite template while preserving code structure and indentation.",
    {
      pattern: {
        type: "string",
        description:
          "Structural AST pattern to match (e.g. 'console.error($$$ARGS)')",
      },
      rewrite: {
        type: "string",
        description:
          "Structural template to replace matches with, referencing metavariables (e.g. 'logger.error($$$ARGS)')",
      },
      path: {
        type: "string",
        description:
          "File path or directory to apply replacement across (e.g. 'src/utils.ts' or 'src/')",
      },
      glob: {
        type: "string",
        description: "Optional glob filter when path is a directory (e.g. '**/*.ts')",
      },
      dry_run: {
        type: "boolean",
        description:
          "If true, returns preview diff without modifying files on disk (default: false)",
      },
    },
    ["pattern", "rewrite", "path"]
  ),
];

export const AST_ZOD_SCHEMAS = {
  ast_grep_search: z.object({
    pattern: z.string().min(1).max(2000),
    path: z.string().max(500).optional(),
    glob: z.string().max(200).optional(),
    max_matches: z.number().int().min(1).max(500).optional(),
  }),
  ast_grep_replace: z.object({
    pattern: z.string().min(1).max(2000),
    rewrite: z.string().max(2000),
    path: z.string().min(1).max(500),
    glob: z.string().max(200).optional(),
    dry_run: z.boolean().optional(),
  }),
};

const AST_TOOL_NAMES = new Set(AST_TOOL_SCHEMAS.map((s) => s.function.name));

export function isAstTool(name: string): boolean {
  return AST_TOOL_NAMES.has(name);
}

// ─── File Discovery ────────────────────────────────────────────────────────────

const IGNORED_DIRS = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.next/**",
  "**/.open-code/**",
  "**/dist/**",
  "**/build/**",
  "**/.venv/**",
  "**/target/**",
];

async function findTargetFiles(
  workspace: string,
  relPath?: string,
  globPattern?: string
): Promise<string[]> {
  const targetPath = relPath ? safeResolve(workspace, relPath) : workspace;
  try {
    const stat = await fs.stat(targetPath);
    if (stat.isFile()) {
      return [path.relative(workspace, targetPath)];
    }
  } catch {
    return [];
  }

  const basePattern = globPattern || "**/*";
  const searchRoot = relPath ? path.normalize(relPath).replace(/\\/g, "/") : ".";
  const fullGlob = searchRoot === "." ? basePattern : `${searchRoot}/${basePattern}`;

  return await fg(fullGlob, {
    cwd: workspace,
    dot: false,
    ignore: IGNORED_DIRS,
    onlyFiles: true,
  });
}

// ─── Executor ──────────────────────────────────────────────────────────────────

export async function executeAstTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
  ctx?: ScienceTurnContext
): Promise<AstToolResult> {
  switch (name) {
    case "ast_grep_search": {
      const pattern = String(args.pattern);
      const relPath = args.path ? String(args.path) : undefined;
      const glob = args.glob ? String(args.glob) : undefined;
      const maxMatches = Math.min(500, Math.max(1, Number(args.max_matches ?? 50)));

      const patternTokens = tokenize(pattern, true);
      const patternTree = buildTokenTree(patternTokens);
      if (patternTree.length === 0) {
        return {
          success: false,
          output: "Error: Pattern did not produce any valid AST tokens.",
          summary: "AST search failed: empty pattern",
          error: "Empty AST pattern",
        };
      }

      const files = await findTargetFiles(workspace, relPath, glob);
      if (files.length === 0) {
        return {
          success: true,
          output: `No matching files found to search in ${relPath ?? "."}.`,
          summary: "AST search: 0 files inspected",
        };
      }

      const results: { file: string; match: MatchResult }[] = [];

      for (const file of files) {
        if (results.length >= maxMatches) break;
        const abs = safeResolve(workspace, file);
        try {
          const content = await fs.readFile(abs, "utf-8");
          const targetTokens = tokenize(content, false);
          const targetTree = buildTokenTree(targetTokens);
          const matches = searchInTokens(patternTree, targetTree, content);

          for (const m of matches) {
            results.push({ file, match: m });
            if (results.length >= maxMatches) break;
          }
        } catch {
          // Skip binary or unreadable files
        }
      }

      if (results.length === 0) {
        return {
          success: true,
          output: `No AST matches found for pattern: \`${pattern}\` across ${files.length} file(s).`,
          summary: `AST search: 0 matches in ${files.length} files`,
        };
      }

      const lines = results.map((r, idx) => {
        const bindingStrs = Object.entries(r.match.bindings)
          .map(([k, v]) => `  ${k} => ${v.length > 60 ? v.slice(0, 57) + "..." : v}`)
          .join("\n");
        return (
          `[#${idx + 1}] ${r.file}:${r.match.startLine}-${r.match.endLine}\n` +
          `\`\`\`\n${r.match.matchedText}\n\`\`\`\n` +
          (bindingStrs ? `Bindings:\n${bindingStrs}\n` : "")
        );
      });

      return {
        success: true,
        output:
          `Found ${results.length} AST match(es) for pattern: \`${pattern}\`\n\n` +
          lines.join("\n---\n"),
        summary: `AST search: ${results.length} match(es) in ${new Set(results.map((r) => r.file)).size} files`,
        extra: {
          matchCount: results.length,
          filesChecked: files.length,
        },
      };
    }

    case "ast_grep_replace": {
      const pattern = String(args.pattern);
      const rewrite = String(args.rewrite);
      const targetRel = String(args.path);
      const glob = args.glob ? String(args.glob) : undefined;
      const dryRun = Boolean(args.dry_run);

      const patternTokens = tokenize(pattern, true);
      const patternTree = buildTokenTree(patternTokens);
      if (patternTree.length === 0) {
        return {
          success: false,
          output: "Error: Pattern did not produce any valid AST tokens.",
          summary: "AST replace failed: empty pattern",
          error: "Empty AST pattern",
        };
      }

      const files = await findTargetFiles(workspace, targetRel, glob);
      if (files.length === 0) {
        return {
          success: false,
          output: `Error: No files found matching path '${targetRel}'.`,
          summary: `AST replace failed: path not found`,
          error: `Target path '${targetRel}' not found`,
        };
      }

      let totalReplacements = 0;
      const touchedFiles: string[] = [];
      const diffPreviews: string[] = [];

      for (const file of files) {
        const abs = safeResolve(workspace, file);
        let content: string;
        try {
          content = await fs.readFile(abs, "utf-8");
        } catch {
          continue;
        }

        const targetTokens = tokenize(content, false);
        const targetTree = buildTokenTree(targetTokens);
        const matches = searchInTokens(patternTree, targetTree, content);

        if (matches.length === 0) continue;

        // Sort matches in descending start order so earlier offsets are not invalidated
        matches.sort((a, b) => b.start - a.start);

        let modified = content;
        for (const m of matches) {
          // Determine base indent of matched start line
          const lineStart = content.lastIndexOf("\n", m.start) + 1;
          const linePrefix = content.slice(lineStart, m.start);
          const indentMatch = linePrefix.match(/^(\s*)/);
          const baseIndent = indentMatch ? indentMatch[1] : "";

          const replacementText = substituteTemplate(rewrite, m.bindings, baseIndent);
          modified =
            modified.slice(0, m.start) +
            replacementText +
            modified.slice(m.end);
          totalReplacements++;
        }

        touchedFiles.push(file);
        diffPreviews.push(
          `--- ${file} (${matches.length} replacement(s))\n` +
          `Pattern: ${pattern}\nRewrite: ${rewrite}`
        );

        if (!dryRun) {
          await fs.writeFile(abs, modified, "utf-8");
          if (ctx) {
            ctx.filesEdited.add(file);
          }
        }
      }

      if (totalReplacements === 0) {
        return {
          success: true,
          output: `No AST matches found to replace for pattern: \`${pattern}\` in ${targetRel}.`,
          summary: `AST replace: 0 replacements made`,
        };
      }

      const previewText = diffPreviews.join("\n\n");
      if (dryRun) {
        return {
          success: true,
          output:
            `[DRY RUN] Previewed ${totalReplacements} replacement(s) across ${touchedFiles.length} file(s):\n\n${previewText}`,
          summary: `AST replace [DRY RUN]: ${totalReplacements} match(es) in ${touchedFiles.length} file(s)`,
        };
      }

      return {
        success: true,
        output:
          `Successfully applied ${totalReplacements} AST replacement(s) across ${touchedFiles.length} file(s):\n\n${previewText}`,
        summary: `AST replace: ${totalReplacements} replacement(s) in ${touchedFiles.length} file(s)`,
        changedFile: touchedFiles[0],
        extra: {
          totalReplacements,
          touchedFiles,
        },
      };
    }

    default:
      return {
        success: false,
        output: `Unknown AST tool: ${name}`,
        summary: `Unknown AST tool ${name}`,
        error: `Unknown tool ${name}`,
      };
  }
}
