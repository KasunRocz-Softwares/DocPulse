import { lazy, Suspense, useId, useState } from "react";

const MarkdownPreviewRenderer = lazy(() => import("./MarkdownDocumentPreview"));

export function MarkdownDocumentPreview({ source }: { source: string }) {
  return (
    <div className="markdown-preview-content">
      <Suspense fallback={<span>Loading preview…</span>}>
        <MarkdownPreviewRenderer source={source} />
      </Suspense>
    </div>
  );
}

export function MarkdownDocumentEditor({
  name,
  label = "Document content (Markdown)",
  value = "",
  required = false,
  rows = 9,
  placeholder = "Write Markdown. Use # headings, tables, fenced code, links, and ![alt text](https://...) for images.",
}: {
  name: string;
  label?: string;
  value?: string;
  required?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const editorId = useId();
  const helpId = useId();
  const previewId = useId();
  const [source, setSource] = useState(value);
  const [view, setView] = useState<"write" | "preview">("write");

  return (
    <div className="markdown-document-editor">
      <label className="markdown-editor-label" htmlFor={editorId}>
        {label}
      </label>
      <div className="markdown-editor-toolbar">
        <div
          className="markdown-editor-tabs"
          role="group"
          aria-label="Document editor view"
        >
          <button
            className="button button-quiet"
            type="button"
            aria-pressed={view === "write"}
            aria-controls={editorId}
            onClick={() => setView("write")}
          >
            Write
          </button>
          <button
            className="button button-quiet"
            type="button"
            aria-pressed={view === "preview"}
            aria-controls={previewId}
            onClick={() => setView("preview")}
          >
            Preview
          </button>
        </div>
        <span>Markdown with GitHub-style tables and task lists</span>
      </div>
      <textarea
        id={editorId}
        name={name}
        value={source}
        onChange={(event) => setSource(event.currentTarget.value)}
        required={required}
        rows={rows}
        placeholder={placeholder}
        aria-describedby={helpId}
        hidden={view !== "write"}
      />
      <small id={helpId}>
        HTML is displayed as text. Attachments stay private unless separately
        approved for a public release.
      </small>
      <div
        id={previewId}
        className="markdown-preview"
        aria-label="Markdown preview"
        hidden={view !== "preview"}
      >
        {source.trim() ? (
          <MarkdownDocumentPreview source={source} />
        ) : (
          <p className="inline-empty">Nothing to preview yet.</p>
        )}
      </div>
    </div>
  );
}
