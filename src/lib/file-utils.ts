export type FlatNode = { path: string; isDirectory: boolean };

export interface TreeNode {
  name: string;
  fullPath: string;
  isDirectory: boolean;
  children: TreeNode[];
}

/** Build a recursive tree structure from a flat list of paths */
export function buildTree(nodes: FlatNode[]): TreeNode[] {
  const root: TreeNode[] = [];

  // Normalise separators to forward slash
  const normalised = nodes.map((n) => ({
    ...n,
    path: n.path.replace(/\\/g, "/"),
  }));

  for (const node of normalised) {
    const parts = node.path.split("/").filter(Boolean);
    let current = root;

    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      let existing = current.find((c) => c.name === part);
      if (!existing) {
        existing = {
          name: part,
          fullPath: parts.slice(0, i + 1).join("/"),
          isDirectory: isLast ? node.isDirectory : true,
          children: [],
        };
        current.push(existing);
      }
      if (!isLast) current = existing.children;
    });
  }

  // Sort: directories first, then alphabetically
  function sortNodes(arr: TreeNode[]): TreeNode[] {
    return arr
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((n) => ({ ...n, children: sortNodes(n.children) }));
  }

  return sortNodes(root);
}

export function languageFor(filePath: string) {
  if (filePath.endsWith(".tsx") || filePath.endsWith(".ts"))
    return "typescript";
  if (filePath.endsWith(".jsx") || filePath.endsWith(".js") || filePath.endsWith(".mjs") || filePath.endsWith(".cjs"))
    return "javascript";
  if (filePath.endsWith(".json")) return "json";
  if (filePath.endsWith(".css") || filePath.endsWith(".scss") || filePath.endsWith(".less")) return "css";
  if (filePath.endsWith(".md") || filePath.endsWith(".mdx")) return "markdown";
  if (filePath.endsWith(".html") || filePath.endsWith(".htm")) return "html";
  if (filePath.endsWith(".sh") || filePath.endsWith(".bash") || filePath.endsWith(".zsh")) return "shell";
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".sql")) return "sql";
  if (filePath.endsWith(".yml") || filePath.endsWith(".yaml")) return "yaml";
  if (filePath.endsWith(".xml") || filePath.endsWith(".svg")) return "xml";
  if (filePath.endsWith(".rs")) return "rust";
  if (filePath.endsWith(".go")) return "go";
  if (filePath.endsWith(".java")) return "java";
  if (filePath.endsWith(".c") || filePath.endsWith(".h")) return "c";
  if (filePath.endsWith(".cpp") || filePath.endsWith(".hpp") || filePath.endsWith(".cc")) return "cpp";
  if (filePath.endsWith(".cs")) return "csharp";
  if (filePath.endsWith(".rb")) return "ruby";
  if (filePath.endsWith(".php")) return "php";
  if (filePath.endsWith(".toml") || filePath.endsWith(".ini")) return "ini";
  if (filePath.endsWith(".ps1")) return "powershell";
  if (/(^|\/)Dockerfile$/.test(filePath)) return "dockerfile";
  return "plaintext";
}

export function getFileIcon(filePath: string): { icon: string; color: string } {
  const ext = filePath.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "tsx":
    case "ts":
      return { icon: "TS", color: "#3178c6" };
    case "jsx":
    case "js":
    case "mjs":
    case "cjs":
      return { icon: "JS", color: "#f7df1e" };
    case "json":
      return { icon: "{}", color: "#cbcb41" };
    case "css":
    case "scss":
    case "less":
      return { icon: "#", color: "#42a5f5" };
    case "html":
    case "htm":
      return { icon: "<>", color: "#e44d26" };
    case "md":
    case "mdx":
      return { icon: "M↓", color: "#42a5f5" };
    case "svg":
      return { icon: "❖", color: "#ffb74d" };
    case "py":
      return { icon: "🐍", color: "#3572A5" };
    case "sh":
    case "bash":
    case "zsh":
      return { icon: "$_", color: "#89e051" };
    default:
      return { icon: "📄", color: "#9aa3b5" };
  }
}
