// create_document: write real .docx / .pdf / .pptx / .xlsx files into the
// workspace from structured content, so research and reports can be handed
// over as documents instead of chat text.
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { safeResolve } from "./safeResolve";
import type { ScienceToolResult } from "./scienceTools";

export type DocumentFormat = "docx" | "pdf" | "pptx" | "xlsx";
type Cell = string | number | boolean | null;

// ─── Schemas ───────────────────────────────────────────────────────────────────

export const DOCUMENT_TOOL_SCHEMAS = [
  {
    type: "function" as const,
    function: {
      name: "create_document",
      description:
        "Create a document file in the workspace: Word (docx), PDF, PowerPoint (pptx) or Excel (xlsx). " +
        "For docx/pdf pass `content` as Markdown (#/##/### headings, - bullets, 1. lists, **bold**, | tables |). " +
        "For pptx pass `slides`; for xlsx pass `sheets`. Returns the file path and a download link to give the user.",
      parameters: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["docx", "pdf", "pptx", "xlsx"] },
          title: { type: "string", description: "Document title (also used for the default file name)" },
          path: { type: "string", description: "Workspace-relative output path; defaults to documents/<title>.<format>" },
          content: { type: "string", description: "docx/pdf: body as Markdown" },
          slides: {
            type: "array",
            description: "pptx: one entry per slide",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                bullets: { type: "array", items: { type: "string" } },
                notes: { type: "string", description: "Speaker notes" },
              },
              required: ["title"],
            },
          },
          sheets: {
            type: "array",
            description: "xlsx: one entry per worksheet; the first row is styled as a header",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                rows: { type: "array", items: { type: "array", items: {} } },
              },
              required: ["name", "rows"],
            },
          },
        },
        required: ["format", "title"],
      },
    },
  },
];

const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const DOCUMENT_ZOD_SCHEMAS = {
  create_document: z
    .object({
      format: z.enum(["docx", "pdf", "pptx", "xlsx"]),
      title: z.string().min(1).max(200),
      path: z.string().max(500).optional(),
      content: z.string().max(500_000).optional(),
      slides: z
        .array(z.object({ title: z.string().max(300), bullets: z.array(z.string().max(1000)).max(30).optional(), notes: z.string().max(5000).optional() }))
        .max(200)
        .optional(),
      sheets: z.array(z.object({ name: z.string().min(1).max(31), rows: z.array(z.array(cell)).max(100_000) })).max(50).optional(),
    })
    .refine((a) => (a.format === "pptx" ? !!a.slides?.length : a.format === "xlsx" ? !!a.sheets?.length : !!a.content?.trim()), {
      message: "docx/pdf need `content`, pptx needs `slides`, xlsx needs `sheets`",
    }),
};

export function isDocumentTool(name: string): boolean {
  return name === "create_document";
}

// ─── Markdown → blocks (shared by docx and pdf) ───────────────────────────────

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "bullet"; text: string; ordered: boolean; index: number }
  | { kind: "table"; rows: string[][] };

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "paragraph", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let m: RegExpMatchArray | null;
    if (!line) {
      flush();
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flush();
      blocks.push({ kind: "heading", level: m[1].length as 1 | 2 | 3, text: m[2] });
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      flush();
      blocks.push({ kind: "bullet", text: m[1], ordered: false, index: 0 });
    } else if ((m = line.match(/^(\d+)[.)]\s+(.*)$/))) {
      flush();
      blocks.push({ kind: "bullet", text: m[2], ordered: true, index: Number(m[1]) });
    } else if (line.startsWith("|")) {
      flush();
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells); // skip |---| separators
      }
      i--;
      if (rows.length) blocks.push({ kind: "table", rows });
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

/** Split "a **b** c" into runs; bold markers are the only inline syntax kept */
export function inlineRuns(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) => (part.startsWith("**") && part.endsWith("**") ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }));
}

// ─── Renderers ─────────────────────────────────────────────────────────────────

async function renderDocx(title: string, blocks: Block[]): Promise<Buffer> {
  const d = await import("docx");
  const runs = (text: string) => inlineRuns(text).map((r) => new d.TextRun({ text: r.text, bold: r.bold }));
  const headingLevel = { 1: d.HeadingLevel.HEADING_1, 2: d.HeadingLevel.HEADING_2, 3: d.HeadingLevel.HEADING_3 } as const;
  const children = [new d.Paragraph({ heading: d.HeadingLevel.TITLE, children: [new d.TextRun(title)] })];
  for (const b of blocks) {
    if (b.kind === "heading") children.push(new d.Paragraph({ heading: headingLevel[b.level], children: runs(b.text) }));
    else if (b.kind === "paragraph") children.push(new d.Paragraph({ children: runs(b.text), spacing: { after: 120 } }));
    else if (b.kind === "bullet") {
      children.push(
        b.ordered
          ? new d.Paragraph({ children: [new d.TextRun(`${b.index}. `), ...runs(b.text)], indent: { left: 360 } })
          : new d.Paragraph({ children: runs(b.text), bullet: { level: 0 } })
      );
    } else {
      const table = new d.Table({
        width: { size: 100, type: d.WidthType.PERCENTAGE },
        rows: b.rows.map(
          (row, r) =>
            new d.TableRow({
              children: row.map(
                (c) => new d.TableCell({ children: [new d.Paragraph({ children: [new d.TextRun({ text: c, bold: r === 0 })] })] })
              ),
            })
        ),
      });
      children.push(table as unknown as InstanceType<typeof d.Paragraph>, new d.Paragraph({}));
    }
  }
  return d.Packer.toBuffer(new d.Document({ title, sections: [{ children }] }));
}

async function renderPdf(title: string, blocks: Block[]): Promise<Buffer> {
  const { default: PDFDocument } = await import("pdfkit");
  const doc = new PDFDocument({ size: "A4", margin: 56, info: { Title: title } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const write = (text: string, size: number, opts: PDFKit.Mixins.TextOptions = {}) => {
    const parts = inlineRuns(text);
    parts.forEach((r, i) => {
      doc.font(r.bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).text(r.text, { ...opts, continued: i < parts.length - 1 });
    });
  };
  doc.font("Helvetica-Bold").fontSize(22).text(title).moveDown(0.8);
  const width = doc.page.width - 112;
  for (const b of blocks) {
    if (b.kind === "heading") {
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(b.level === 1 ? 17 : b.level === 2 ? 14 : 12).text(b.text).moveDown(0.3);
    } else if (b.kind === "paragraph") {
      write(b.text, 11, { align: "left" });
      doc.moveDown(0.5);
    } else if (b.kind === "bullet") {
      write(`${b.ordered ? `${b.index}.` : "•"}  ${b.text}`, 11, { indent: 14 });
      doc.moveDown(0.15);
    } else {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const colW = width / cols;
      for (const [r, row] of b.rows.entries()) {
        const y = doc.y;
        const heights = row.map((c) => doc.font(r === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(10).heightOfString(c, { width: colW - 8 }));
        const h = Math.max(14, ...heights) + 6;
        if (y + h > doc.page.height - 56) doc.addPage();
        const top = doc.y;
        row.forEach((c, ci) => {
          doc.rect(56 + ci * colW, top, colW, h).stroke("#cccccc");
          doc.fillColor("#000").font(r === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(10).text(c, 60 + ci * colW, top + 3, { width: colW - 8 });
        });
        doc.x = 56;
        doc.y = top + h;
      }
      doc.moveDown(0.6);
    }
  }
  doc.end();
  return done;
}

async function renderPptx(title: string, slides: { title: string; bullets?: string[]; notes?: string }[]): Promise<Buffer> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = title;
  const cover = pptx.addSlide();
  cover.addText(title, { x: 0.6, y: 2.6, w: 12, h: 1.4, fontSize: 40, bold: true, color: "1F1E1D" });
  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.addText(s.title, { x: 0.6, y: 0.4, w: 12, h: 1, fontSize: 28, bold: true, color: "1F1E1D" });
    if (s.bullets?.length) {
      slide.addText(
        s.bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.8, y: 1.6, w: 11.6, h: 5.2, fontSize: 18, valign: "top", color: "333333", paraSpaceAfter: 8 }
      );
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}

async function renderXlsx(sheets: { name: string; rows: Cell[][] }[]): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.replace(/[\\/?*[\]:]/g, "_"));
    for (const row of s.rows) ws.addRow(row);
    if (s.rows.length) {
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
      ws.columns.forEach((col, i) => {
        const longest = Math.max(...s.rows.map((r) => String(r[i] ?? "").length));
        col.width = Math.min(60, Math.max(10, longest + 2));
      });
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ─── Executor ──────────────────────────────────────────────────────────────────

function defaultPath(title: string, format: DocumentFormat): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "document";
  return `documents/${slug}.${format}`;
}

export async function executeDocumentTool(
  name: string,
  args: Record<string, unknown>,
  workspace: string,
  projectId: string
): Promise<ScienceToolResult> {
  const parsed = DOCUMENT_ZOD_SCHEMAS.create_document.safeParse(args);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => i.message).join("; ");
    return { success: false, output: `Error: ${message}`, summary: "create_document: invalid arguments", error: message };
  }
  const a = parsed.data;
  let rel = (a.path || defaultPath(a.title, a.format)).replace(/\\/g, "/");
  if (path.extname(rel).toLowerCase() !== `.${a.format}`) rel += `.${a.format}`;

  let file: string;
  try {
    file = safeResolve(workspace, rel);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: `Error: ${message}`, summary: "create_document: path rejected", error: message };
  }

  try {
    const buffer =
      a.format === "docx" ? await renderDocx(a.title, parseMarkdown(a.content!))
      : a.format === "pdf" ? await renderPdf(a.title, parseMarkdown(a.content!))
      : a.format === "pptx" ? await renderPptx(a.title, a.slides!)
      : await renderXlsx(a.sheets!);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buffer);
    const link = `/api/download?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(rel)}`;
    return {
      success: true,
      output: `Created ${rel} (${(buffer.length / 1024).toFixed(1)} KB). Download: ${link}`,
      summary: `Created ${rel}`,
      changedFile: rel,
      extra: { path: rel, downloadUrl: link, bytes: buffer.length },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, output: `Error creating ${a.format}: ${message}`, summary: `create_document failed`, error: message };
  }
}
