import { describe, it, expect } from "vitest";
import { buildTree, type FlatNode } from "./file-utils";

describe("buildTree", () => {
  it("should build a simple tree from a flat list", () => {
    const nodes: FlatNode[] = [
      { path: "src", isDirectory: true },
      { path: "src/index.ts", isDirectory: false },
      { path: "package.json", isDirectory: false },
    ];

    const tree = buildTree(nodes);

    expect(tree).toHaveLength(2);

    const srcNode = tree.find((n) => n.name === "src");
    expect(srcNode).toBeDefined();
    expect(srcNode?.isDirectory).toBe(true);
    expect(srcNode?.children).toHaveLength(1);
    expect(srcNode?.children[0].name).toBe("index.ts");
    expect(srcNode?.children[0].isDirectory).toBe(false);

    const pkgNode = tree.find((n) => n.name === "package.json");
    expect(pkgNode).toBeDefined();
    expect(pkgNode?.isDirectory).toBe(false);
    expect(pkgNode?.children).toHaveLength(0);
  });
});
