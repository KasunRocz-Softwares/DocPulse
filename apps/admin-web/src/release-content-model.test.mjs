import assert from "node:assert/strict";
import test from "node:test";
import {
  documentAstFromText,
  documentTextFromAst,
} from "./release-content-model.ts";

test("reads legacy multiline release documentation paragraphs", () => {
  const source = "First paragraph\n\nFinal paragraph";
  const legacyAst = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "First paragraph" }],
      },
      { type: "paragraph", content: [] },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Final paragraph" }],
      },
    ],
  };
  assert.equal(documentTextFromAst(legacyAst), source);
});

test("preserves Markdown headings, tables, code blocks, links, and image references", () => {
  const source = [
    "# Incident response",
    "",
    "| Area | Action |",
    "| --- | --- |",
    "| API | Restart safely |",
    "",
    "```ts",
    "await recover();",
    "```",
    "",
    "[Runbook](https://example.test/runbook)",
    "![Topology](https://example.test/topology.png)",
  ].join("\n");
  const ast = documentAstFromText(source);

  assert.deepEqual(ast, { type: "markdown", source });
  assert.equal(documentTextFromAst(ast), source);
});

test("renders legacy text and malformed values without throwing", () => {
  assert.equal(documentTextFromAst("Legacy content"), "Legacy content");
  assert.equal(
    documentTextFromAst({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    }),
    "Hello",
  );
  assert.equal(documentTextFromAst(null), "");
});
