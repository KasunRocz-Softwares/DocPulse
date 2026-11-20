export type DocumentAstNode = {
  type: string;
  text?: string;
  content?: DocumentAstNode[];
  [key: string]: unknown;
};

export function documentAstFromText(value: string): DocumentAstNode {
  return { type: "markdown", source: value };
}

function nodeText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const node = value as DocumentAstNode;
  if (typeof node.text === "string") return node.text;
  return Array.isArray(node.content) ? node.content.map(nodeText).join("") : "";
}

export function documentTextFromAst(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as DocumentAstNode;
  if (record.type === "markdown" && typeof record.source === "string")
    return record.source;
  if (!Array.isArray(record.content)) return "";
  return record.content.map(nodeText).join("\n");
}
