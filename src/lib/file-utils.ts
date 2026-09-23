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
  if (filePath.endsWith(".jsx") || filePath.endsWith(".js"))
    return "javascript";
  if (filePath.endsWith(".json")) return "json";
  if (filePath.endsWith(".css")) return "css";
  if (filePath.endsWith(".md") || filePath.endsWith(".mdx")) return "markdown";
  if (filePath.endsWith(".html")) return "html";
  if (filePath.endsWith(".sh") || filePath.endsWith(".bash")) return "shell";
  return "plaintext";
}
