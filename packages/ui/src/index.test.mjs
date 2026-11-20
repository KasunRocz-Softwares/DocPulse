import assert from "node:assert/strict";
import { createRequire } from "node:module";
import Module from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const require = createRequire(
  new URL("../../../apps/admin-web/package.json", import.meta.url),
);
const { transformWithEsbuild } = require("vite");
const react = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const sourcePath = fileURLToPath(new URL("./index.tsx", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const { code } = await transformWithEsbuild(source, sourcePath, {
  loader: "tsx",
  format: "cjs",
  jsx: "automatic",
});
const uiModule = new Module(sourcePath);
uiModule.filename = sourcePath;
uiModule.paths = Module._nodeModulePaths(
  fileURLToPath(new URL("../../../apps/admin-web/", import.meta.url)),
);
uiModule._compile(code, sourcePath);
const {
  Badge,
  Button,
  EmptyState,
  PageHeading,
  Panel,
  StatusBadge,
  TextArea,
  TextField,
} = uiModule.exports;

function markup(element) {
  return renderToStaticMarkup(
    react.createElement(react.Fragment, null, element),
  );
}

test("Button is a named native button with safe default type and visible variant", () => {
  const html = markup(
    react.createElement(Button, { variant: "primary" }, "Save"),
  );
  assert.match(html, /^<button/);
  assert.match(html, /type="button"/);
  assert.match(html, /class="rdps-button rdps-button--primary"/);
  assert.match(html, />Save<\/button>$/);
});

test("Button preserves disabled state, accessible name, and caller attributes", () => {
  const html = markup(
    react.createElement(
      Button,
      { disabled: true, "aria-label": "Save changes", name: "save" },
      "Save",
    ),
  );
  assert.match(html, /disabled=""/);
  assert.match(html, /aria-label="Save changes"/);
  assert.match(html, /name="save"/);
});

test("TextField connects its visible label and error description to the input", () => {
  const html = markup(
    react.createElement(TextField, {
      id: "email",
      label: "Email address",
      type: "email",
      error: "Enter a valid email address",
    }),
  );
  assert.match(html, /<label[^>]*for="email"[^>]*>Email address<\/label>/);
  assert.match(html, /<input[^>]*type="email"[^>]*id="email"/);
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="email-error"/);
  assert.match(html, /id="email-error"[^>]*role="alert"/);
});

test("TextArea keeps its label, hint, and error in the control description", () => {
  const html = markup(
    react.createElement(TextArea, {
      id: "summary",
      label: "Release summary",
      hint: "Shown to customers",
      error: "Summary is required",
      rows: 4,
    }),
  );
  assert.match(html, /for="summary"[^>]*>Release summary<\/label>/);
  assert.match(html, /<textarea[^>]*id="summary"/);
  assert.match(html, /aria-describedby="summary-hint summary-error"/);
  assert.match(html, /Shown to customers/);
  assert.match(html, /role="alert"/);
});

test("Panel and Badge expose semantic content and caller class names", () => {
  const panel = markup(
    react.createElement(
      Panel,
      {
        as: "section",
        className: "release-panel",
        "aria-label": "Release details",
      },
      "Release details",
    ),
  );
  const badge = markup(
    react.createElement(
      Badge,
      { tone: "success", className: "verified" },
      "Published",
    ),
  );
  assert.match(panel, /^<section[^>]*aria-label="Release details"/);
  assert.match(panel, /rdps-panel[^\"]*release-panel/);
  assert.match(panel, />Release details<\/section>$/);
  assert.match(
    badge,
    /^<span[^>]*class="rdps-badge rdps-badge--success verified"/,
  );
  assert.match(badge, />Published<\/span>$/);
});

test("PageHeading renders a labeled heading with optional supporting copy", () => {
  const html = markup(
    react.createElement(PageHeading, {
      title: "Projects",
      description: "Manage your releases",
    }),
  );
  assert.match(html, /<header[^>]*class="rdps-page-heading"/);
  assert.match(html, /<h1[^>]*>Projects<\/h1>/);
  assert.match(html, /<p[^>]*>Manage your releases<\/p>/);
});

test("EmptyState has a heading and polite announcement semantics", () => {
  const html = markup(
    react.createElement(EmptyState, {
      title: "No releases yet",
      description: "Create your first release.",
    }),
  );
  assert.match(html, /role="status"/);
  assert.match(html, /<h2[^>]*>No releases yet<\/h2>/);
  assert.match(html, /Create your first release\./);
});

test("StatusBadge uses readable text and a tone for known workflow statuses", () => {
  const html = markup(react.createElement(StatusBadge, { status: "APPROVED" }));
  assert.match(html, /rdps-badge--success/);
  assert.match(html, /Approved/);
});
