import type { Nodes, Root, RootContent, Table } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type {
  Block,
  Cell,
  ContentDocument,
} from "../../domain/ingestion/content";
import type {
  ContentExtractor,
  ExtractionInput,
} from "../../domain/ingestion/ports";
import { LineIndex, blockId, decodeUtf8 } from "./text-source";

type Draft = Omit<Block, "id" | "table"> & {
  table?: { header: Omit<Cell, "id">[]; rows: Omit<Cell, "id">[][] };
};

function range(node: Nodes) {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined)
    throw new Error("Markdown 노드에 위치 정보가 없습니다.");
  return [start, end] as const;
}

// Block text is the literal source slice so later patches can target exact offsets.
class Collector {
  drafts: Draft[] = [];
  constructor(
    private source: string,
    private lines: LineIndex,
  ) {}

  private add(node: Nodes, kind: Block["kind"], extra: Partial<Draft> = {}) {
    const [start, end] = range(node);
    this.drafts.push({
      kind,
      text: this.source.slice(start, end),
      location: this.lines.location(start, end),
      origin: "EXTRACTED",
      isProtected: kind === "CODE" || kind === "HTML",
      ...extra,
    });
  }

  private cell(node: Nodes): Omit<Cell, "id"> {
    const [rawStart, rawEnd] = range(node);
    const raw = this.source.slice(rawStart, rawEnd);
    // Cell positions include the pipe and padding; keep only the content.
    const inner = raw.replace(/^\|/, "").replace(/\|$/, "");
    const lead = raw.indexOf(inner) + (inner.length - inner.trimStart().length);
    const text = inner.trim();
    const start = rawStart + lead;
    return {
      text,
      location: this.lines.location(start, start + text.length),
    };
  }

  private table(node: Table) {
    const [head, ...body] = node.children;
    this.add(node, "TABLE", {
      table: {
        header: head ? head.children.map((c) => this.cell(c)) : [],
        rows: body.map((row) => row.children.map((c) => this.cell(c))),
      },
    });
  }

  visit(node: RootContent, depth = 1): void {
    switch (node.type) {
      case "heading":
        return this.add(node, "HEADING", { depth: node.depth });
      case "paragraph":
        return this.add(node, "PARAGRAPH");
      case "blockquote":
        return this.add(node, "QUOTE");
      case "code":
        return this.add(node, "CODE");
      case "html":
        return this.add(node, "HTML");
      case "table":
        return this.table(node);
      case "list":
        for (const item of node.children) {
          // An item's own text excludes nested lists, which become deeper items.
          const own = item.children.filter((c) => c.type !== "list");
          if (own.length) {
            const start = range(own[0])[0];
            const end = range(own.at(-1)!)[1];
            this.drafts.push({
              kind: "LIST_ITEM",
              text: this.source.slice(start, end),
              location: this.lines.location(start, end),
              origin: "EXTRACTED",
              isProtected: false,
              depth,
            });
          }
          for (const child of item.children)
            if (child.type === "list") this.visit(child, depth + 1);
        }
        return;
      default:
        return;
    }
  }
}

export type BlockDraft = Draft;

export function parseMarkdownDrafts(text: string): BlockDraft[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(text) as Root;
  const collector = new Collector(text, new LineIndex(text));
  for (const node of tree.children) collector.visit(node);
  return collector.drafts;
}

export function assignIds(drafts: BlockDraft[]): Block[] {
  return drafts.map((draft, index) => {
    const id = blockId(index);
    return {
      ...draft,
      id,
      table: draft.table && {
        header: draft.table.header.map((c, i) => ({
          ...c,
          id: `${id}:h${i + 1}`,
        })),
        rows: draft.table.rows.map((row, r) =>
          row.map((c, i) => ({ ...c, id: `${id}:r${r + 1}c${i + 1}` })),
        ),
      },
    };
  });
}

export class MarkdownExtractor implements ContentExtractor {
  name = "markdown-mdast";
  version = "1";
  formats = ["MARKDOWN"] as const;

  async extract(input: ExtractionInput): Promise<ContentDocument> {
    const { text, warnings } = decodeUtf8(input.bytes);
    return {
      schemaVersion: 1,
      itemId: input.itemId,
      sourceSha256: input.sha256,
      format: "MARKDOWN",
      extractor: { name: this.name, version: this.version },
      quality: { status: "COMPLETE", warnings },
      blocks: assignIds(parseMarkdownDrafts(text)),
    };
  }
}
