import { normalize } from "../model";
import type { Block, ContentDocument } from "../ingestion/content";
import type { EntityLink } from "./contracts";

export interface VocabularyEntry {
  text: string;
  termId: string;
}
export interface UnresolvedLabel {
  blockId: string;
  cellId?: string;
  label: string;
  termIds: string[];
}
export interface LinkResult {
  links: EntityLink[];
  unresolved: UnresolvedLabel[];
}

// "라벨: 값" on one line, tolerating a bullet and bold label markup.
const KEY_VALUE =
  /^[ \t]*(?:[-*+][ \t]+)?(?:\*\*)?(?<label>[^:：\n*|]{1,40}?)(?:\*\*)?[ \t]*[:：][ \t]*(?<value>\S[^\n]*?)[ \t]*$/dgm;

function vocabularyIndex(entries: VocabularyEntry[]) {
  const index = new Map<string, Set<string>>();
  for (const { text, termId } of entries) {
    const key = normalize(text);
    if (key) index.set(key, (index.get(key) ?? new Set()).add(termId));
  }
  return (label: string) => [...(index.get(normalize(label)) ?? [])];
}

// Only structural evidence (a column header or a field label) links a value; free mentions do not.
export function linkStructuredValues(
  document: ContentDocument,
  vocabulary: VocabularyEntry[],
): LinkResult {
  const lookup = vocabularyIndex(vocabulary);
  const links: EntityLink[] = [];
  const unresolved: UnresolvedLabel[] = [];

  const linkTable = (block: Block) => {
    const { header, rows } = block.table!;
    header.forEach((head, column) => {
      const termIds = lookup(head.text);
      if (termIds.length > 1)
        unresolved.push({
          blockId: block.id,
          cellId: head.id,
          label: head.text,
          termIds,
        });
      if (termIds.length !== 1) return;
      for (const row of rows) {
        const cell = row[column];
        if (!cell?.text) continue;
        links.push({
          blockId: block.id,
          cellId: cell.id,
          span: { start: 0, end: cell.text.length },
          value: cell.text,
          termId: termIds[0],
          method: "HEADER",
          resolution: "CONFIRMED",
          evidence: [
            {
              kind: "INPUT",
              blockId: block.id,
              cellId: head.id,
              quote: head.text,
            },
          ],
        });
      }
    });
  };

  const linkKeyValues = (block: Block) => {
    for (const match of block.text.matchAll(KEY_VALUE)) {
      const label = match.groups!.label.trim();
      const termIds = lookup(label);
      if (termIds.length > 1)
        unresolved.push({ blockId: block.id, label, termIds });
      if (termIds.length !== 1) continue;
      const [start, end] = match.indices!.groups!.value;
      links.push({
        blockId: block.id,
        span: { start, end },
        value: block.text.slice(start, end),
        termId: termIds[0],
        method: "KEY_VALUE",
        resolution: "CONFIRMED",
        evidence: [{ kind: "INPUT", blockId: block.id, quote: label }],
      });
    }
  };

  for (const block of document.blocks) {
    if (block.isProtected) continue;
    if (block.kind === "TABLE" && block.table) linkTable(block);
    else if (block.kind !== "HEADING") linkKeyValues(block);
  }
  return { links, unresolved };
}
