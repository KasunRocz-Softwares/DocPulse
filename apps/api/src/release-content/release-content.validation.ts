import { BadRequestException } from "@nestjs/common";

const CREDENTIAL_FIELD =
  /(?:^|_)(password|passwd|secret|token|authorization|credential|private_key|api_key|access_key|access_token|refresh_token|client_secret|connection_string)(?:$|_)/;
const SECRET_FORMATS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bsk-[A-Za-z0-9_-]{24,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/i,
];
const MAX_DEPTH = 32;
const MAX_NODES = 20_000;

function validateJsonTree(
  value: unknown,
  label: string,
  depth: number,
  count: { value: number },
): void {
  count.value++;
  if (count.value > MAX_NODES || depth > MAX_DEPTH)
    throw new BadRequestException(
      `${label} exceeds supported structure limits`,
    );
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new BadRequestException(`${label} must contain valid JSON values`);
    return;
  }
  if (typeof value === "string") {
    if (SECRET_FORMATS.some((pattern) => pattern.test(value)))
      throw new BadRequestException(`${label} contains credential-like data`);
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) validateJsonTree(child, label, depth + 1, count);
    return;
  }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new BadRequestException(`${label} must contain valid JSON values`);
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
    if (CREDENTIAL_FIELD.test(normalizedKey))
      throw new BadRequestException(`${label} contains credential-like data`);
    validateJsonTree(child, label, depth + 1, count);
  }
}

export function validateReleaseDocumentAst(
  value: unknown,
): asserts value is Record<string, unknown> {
  validateJsonTree(value, "Document content", 0, { value: 0 });
  if (
    value &&
    !Array.isArray(value) &&
    typeof value === "object" &&
    (value as Record<string, unknown>).type === "markdown"
  ) {
    const markdown = value as Record<string, unknown>;
    if (
      Object.keys(markdown).some((key) => !["type", "source"].includes(key)) ||
      typeof markdown.source !== "string" ||
      markdown.source.length > 500_000
    ) {
      throw new BadRequestException(
        "Document content must be a valid Markdown document",
      );
    }
    return;
  }
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    (value as Record<string, unknown>).type !== "doc" ||
    !Array.isArray((value as Record<string, unknown>).content)
  ) {
    throw new BadRequestException(
      "Document content must be a valid rich document AST",
    );
  }
  const root = value as Record<string, unknown>;
  if (Object.keys(root).some((key) => !["type", "content"].includes(key)))
    throw new BadRequestException("Document root contains unsupported fields");
  const visit = (node: unknown): void => {
    if (
      !node ||
      Array.isArray(node) ||
      typeof node !== "object" ||
      typeof (node as Record<string, unknown>).type !== "string"
    ) {
      throw new BadRequestException(
        "Document content must be a valid rich document AST",
      );
    }
    const record = node as Record<string, unknown>;
    const nodeType = record.type as string;
    const supportedAttributes: Record<string, string[]> = {
      heading: ["level"],
      orderedList: ["start"],
      codeBlock: ["language"],
      image: ["src", "alt", "title"],
    };
    const contentNodes = new Set([
      "doc",
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "listItem",
      "blockquote",
      "codeBlock",
      "table",
      "tableRow",
      "tableHeader",
      "tableCell",
    ]);
    const leafNodes = new Set(["text", "horizontalRule", "hardBreak", "image"]);
    const allowedChildren: Record<string, string[]> = {
      table: ["tableRow"],
      tableRow: ["tableHeader", "tableCell"],
      tableHeader: [
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "blockquote",
        "codeBlock",
        "table",
      ],
      tableCell: [
        "paragraph",
        "heading",
        "bulletList",
        "orderedList",
        "blockquote",
        "codeBlock",
        "table",
      ],
    };
    if (!contentNodes.has(nodeType) && !leafNodes.has(nodeType))
      throw new BadRequestException(
        "Document contains an unsupported node type",
      );
    const allowedKeys = new Set([
      "type",
      ...(contentNodes.has(nodeType) ? ["content"] : []),
      ...(nodeType === "text" ? ["text", "marks"] : []),
      ...(supportedAttributes[nodeType] ? ["attrs"] : []),
    ]);
    if (Object.keys(record).some((key) => !allowedKeys.has(key)))
      throw new BadRequestException(
        "Document node contains unsupported fields",
      );
    if (nodeType === "text" && typeof record.text !== "string")
      throw new BadRequestException("Document text nodes must contain text");
    if (nodeType !== "text" && record.text !== undefined)
      throw new BadRequestException("Only text nodes may contain text");
    if (nodeType === "heading" && record.attrs !== undefined) {
      const attrs = record.attrs as Record<string, unknown>;
      if (
        !Number.isInteger(attrs.level) ||
        Number(attrs.level) < 1 ||
        Number(attrs.level) > 6
      )
        throw new BadRequestException("Document heading level is invalid");
    }
    if (nodeType === "image" && record.attrs !== undefined) {
      const attrs = record.attrs as Record<string, unknown>;
      if (typeof attrs.src !== "string" || !isSafeDocumentUrl(attrs.src))
        throw new BadRequestException("Document image URL is invalid");
    }
    if (record.attrs !== undefined) {
      if (
        !record.attrs ||
        Array.isArray(record.attrs) ||
        typeof record.attrs !== "object"
      )
        throw new BadRequestException("Document attributes must be an object");
      const attrs = record.attrs as Record<string, unknown>;
      const allowed = supportedAttributes[nodeType] ?? [];
      if (Object.keys(attrs).some((key) => !allowed.includes(key)))
        throw new BadRequestException(
          "Document attributes contain unsupported fields",
        );
      if (
        nodeType === "codeBlock" &&
        attrs.language !== undefined &&
        typeof attrs.language !== "string"
      )
        throw new BadRequestException("Document code language is invalid");
      if (
        nodeType === "image" &&
        attrs.alt !== undefined &&
        typeof attrs.alt !== "string"
      )
        throw new BadRequestException("Document image alt text is invalid");
      if (
        nodeType === "image" &&
        attrs.title !== undefined &&
        typeof attrs.title !== "string"
      )
        throw new BadRequestException("Document image title is invalid");
      if (
        nodeType === "orderedList" &&
        attrs.start !== undefined &&
        !Number.isInteger(attrs.start)
      )
        throw new BadRequestException("Document list start is invalid");
    }
    if (record.marks !== undefined) {
      if (nodeType !== "text" || !Array.isArray(record.marks))
        throw new BadRequestException("Only text nodes may contain marks");
      for (const mark of record.marks) {
        if (!mark || Array.isArray(mark) || typeof mark !== "object")
          throw new BadRequestException("Document mark is invalid");
        const markRecord = mark as Record<string, unknown>;
        const markType = markRecord.type;
        if (
          !["bold", "italic", "strike", "code", "underline", "link"].includes(
            String(markType),
          )
        )
          throw new BadRequestException(
            "Document contains an unsupported mark",
          );
        const markAllowed = markType === "link" ? ["type", "attrs"] : ["type"];
        if (Object.keys(markRecord).some((key) => !markAllowed.includes(key)))
          throw new BadRequestException(
            "Document mark contains unsupported fields",
          );
        if (markType === "link") {
          const attrs = markRecord.attrs;
          if (!attrs || Array.isArray(attrs) || typeof attrs !== "object")
            throw new BadRequestException(
              "Document link attributes are invalid",
            );
          const link = attrs as Record<string, unknown>;
          if (
            Object.keys(link).some(
              (key) => !["href", "target", "rel"].includes(key),
            ) ||
            typeof link.href !== "string" ||
            !isSafeDocumentUrl(link.href)
          )
            throw new BadRequestException("Document link URL is invalid");
        }
      }
    }
    if (record.content !== undefined) {
      if (!Array.isArray(record.content))
        throw new BadRequestException(
          "Document content must be a valid rich document AST",
        );
      for (const child of record.content) {
        if (allowedChildren[nodeType]) {
          const childType =
            child && !Array.isArray(child) && typeof child === "object"
              ? (child as Record<string, unknown>).type
              : undefined;
          if (
            typeof childType !== "string" ||
            !allowedChildren[nodeType].includes(childType)
          )
            throw new BadRequestException(
              "Document table structure is invalid",
            );
        }
        visit(child);
      }
    }
    if (contentNodes.has(nodeType) && !Array.isArray(record.content)) {
      throw new BadRequestException(
        "Document content must be a valid rich document AST",
      );
    }
    if (leafNodes.has(nodeType) && record.content !== undefined)
      throw new BadRequestException(
        "Leaf document nodes cannot contain children",
      );
  };
  for (const child of (value as Record<string, unknown>).content as unknown[])
    visit(child);
}

function isSafeDocumentUrl(value: string): boolean {
  if (value.length > 2048 || /[\u0000-\u0020]/.test(value)) return false;
  if (value.startsWith("/") || value.startsWith("#")) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

export function validateDeploymentMetadata(
  value: unknown,
): asserts value is Record<string, unknown> {
  validateJsonTree(value, "Deployment metadata", 0, { value: 0 });
  if (!value || Array.isArray(value) || typeof value !== "object")
    throw new BadRequestException("Deployment metadata must be a JSON object");
}

export function validateReleaseText(value: string, label: string): void {
  if (SECRET_FORMATS.some((pattern) => pattern.test(value)))
    throw new BadRequestException(`${label} contains credential-like data`);
}
