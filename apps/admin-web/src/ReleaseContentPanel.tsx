import { FormEvent, useCallback, useEffect, useState } from "react";
import { adminApi } from "./api";
import {
  documentAstFromText,
  documentTextFromAst,
} from "./release-content-model";
import {
  MarkdownDocumentEditor,
  MarkdownDocumentPreview,
} from "./MarkdownDocumentEditor";
import { ReleaseLocalizationEditor } from "./ReleaseLocalizationEditor";

type Document = {
  id: string;
  section: string;
  title: string;
  content: unknown;
  sortOrder: number;
};
type Attachment = {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: string;
  checksumSha256: string;
  scanStatus: "PENDING" | "CLEAN" | "INFECTED" | "FAILED";
  createdAt: string;
  publicAllowed: boolean;
};
type Environment = {
  id: string;
  name: string;
  label?: string | null;
  enabled: boolean;
};
type Deployment = {
  id: string;
  status: string;
  externalId?: string | null;
  deployedAt?: string | null;
  metadata?: unknown;
  environment?: { name: string; label?: string | null };
};

const messageFor = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The request could not be completed.";
const fileSize = (value: string) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
const localDateTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16);
};

export function ReleaseContentPanel({
  projectId,
  releaseId,
}: {
  projectId: string;
  releaseId: string;
}) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [orderedDocuments, setOrderedDocuments] = useState<Document[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [editingId, setEditingId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setError("");
    const requests = await Promise.allSettled([
      adminApi.listDocuments<Document[]>(projectId, releaseId),
      adminApi.listAttachments<Attachment[]>(projectId, releaseId),
      adminApi.listDeployments<Deployment[]>(projectId, releaseId),
      adminApi.listEnvironments<Environment[]>(projectId),
    ]);
    const [
      documentResult,
      attachmentResult,
      deploymentResult,
      environmentResult,
    ] = requests;
    if (documentResult.status === "fulfilled") {
      setDocuments(documentResult.value);
      setOrderedDocuments(documentResult.value);
    }
    if (attachmentResult.status === "fulfilled")
      setAttachments(attachmentResult.value);
    if (deploymentResult.status === "fulfilled")
      setDeployments(deploymentResult.value);
    if (environmentResult.status === "fulfilled")
      setEnvironments(environmentResult.value);
    const labels = [
      "Documents",
      "Attachments",
      "Deployment history",
      "Environments",
    ];
    setError(
      requests
        .flatMap((result, index) =>
          result.status === "rejected"
            ? [`${labels[index]}: ${messageFor(result.reason)}`]
            : [],
        )
        .join(" "),
    );
  }, [projectId, releaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await load();
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function saveDocument(
    event: FormEvent<HTMLFormElement>,
    documentId?: string,
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const values = new FormData(formElement);
    const body = {
      section: String(values.get("section") ?? "").trim(),
      title: String(values.get("title") ?? "").trim(),
      content: documentAstFromText(String(values.get("content") ?? "")),
      ...(documentId ? {} : { sortOrder: documents.length }),
    };
    await run(
      async () => {
        if (documentId)
          await adminApi.updateDocument(projectId, releaseId, documentId, body);
        else await adminApi.createDocument(projectId, releaseId, body);
        setEditingId("");
        formElement.reset();
      },
      documentId ? "Document updated." : "Document created.",
    );
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file") as File | null;
    if (!file || file.size === 0) {
      setError("Choose a file to upload.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("Attachments must be 25 MiB or smaller.");
      return;
    }
    const body = new FormData();
    body.set("file", file, file.name);
    await run(async () => {
      await adminApi.uploadAttachment(projectId, releaseId, body);
      form.reset();
    }, "Private attachment uploaded. Scan it before downloading.");
  }

  async function download(attachment: Attachment) {
    setWorking(true);
    setError("");
    try {
      const result = await adminApi.downloadPrivateAttachment(
        projectId,
        releaseId,
        attachment.id,
      );
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename || attachment.fileName;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`Downloaded private attachment ${attachment.fileName}.`);
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setWorking(false);
    }
  }

  async function togglePublicAccess(attachment: Attachment) {
    const publicAllowed = !attachment.publicAllowed;
    await run(
      () =>
        adminApi.setAttachmentPublic(
          projectId,
          releaseId,
          attachment.id,
          publicAllowed,
        ),
      publicAllowed
        ? "Attachment marked for inclusion in the next approved public snapshot."
        : "Attachment removed from future public snapshots.",
    );
  }

  async function saveDeployment(
    event: FormEvent<HTMLFormElement>,
    deploymentId?: string,
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    let metadata: unknown;
    try {
      metadata = JSON.parse(String(form.get("metadata") ?? "{}"));
    } catch {
      setError("Deployment metadata must be valid JSON.");
      return;
    }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      setError("Deployment metadata must be a JSON object.");
      return;
    }
    const deployedAtValue = String(form.get("deployedAt") ?? "");
    const body = {
      status: String(form.get("status") ?? "").trim(),
      externalId: String(form.get("externalId") ?? "").trim() || null,
      deployedAt: deployedAtValue
        ? new Date(deployedAtValue).toISOString()
        : null,
      metadata,
      ...(!deploymentId
        ? { environmentId: String(form.get("environmentId") ?? "") }
        : {}),
    };
    await run(
      async () => {
        if (deploymentId)
          await adminApi.updateDeployment(
            projectId,
            releaseId,
            deploymentId,
            body,
          );
        else await adminApi.createDeployment(projectId, releaseId, body);
        if (!deploymentId) formElement.reset();
      },
      deploymentId ? "Deployment updated." : "Deployment recorded.",
    );
  }

  function moveDocument(index: number, delta: number) {
    setOrderedDocuments((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      const currentItem = next[index];
      const targetItem = next[target];
      if (!currentItem || !targetItem) return current;
      next[index] = targetItem;
      next[target] = currentItem;
      return next;
    });
  }

  return (
    <>
      <ReleaseLocalizationEditor releaseId={releaseId} />
      <section
        className="section-block release-content-panel"
        aria-labelledby="release-content-heading"
      >
        <div className="section-heading">
          <div>
            <h2 id="release-content-heading">Release content and delivery</h2>
            <p>
              Internal documentation, private files, and environment deployment
              history.
            </p>
          </div>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void load()}
            disabled={working}
          >
            Refresh
          </button>
        </div>
        <div aria-live="polite">
          {error && (
            <p className="error-copy" role="alert">
              {error}
            </p>
          )}
          {notice && <p className="success-copy">{notice}</p>}
        </div>

        <section
          className="admin-subsection"
          aria-labelledby="documents-heading"
        >
          <div className="section-heading">
            <div>
              <h3 id="documents-heading">Release documents</h3>
              <p>
                Write internal sections in paragraphs; saved as the API’s
                document AST.
              </p>
            </div>
          </div>
          {documents.length ? (
            <ol className="order-list">
              {orderedDocuments.map((item, index) => (
                <li className="document-list-row" key={item.id}>
                  <span className="order-index">{index + 1}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.section}</small>
                    <MarkdownDocumentPreview
                      source={documentTextFromAst(item.content)}
                    />
                  </div>
                  <div className="order-buttons">
                    <button
                      className="button button-quiet"
                      type="button"
                      aria-label={`Move ${item.title} up`}
                      disabled={working || index === 0}
                      onClick={() => moveDocument(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="button button-quiet"
                      type="button"
                      aria-label={`Move ${item.title} down`}
                      disabled={
                        working || index === orderedDocuments.length - 1
                      }
                      onClick={() => moveDocument(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      className="button button-quiet"
                      type="button"
                      onClick={() =>
                        setEditingId(editingId === item.id ? "" : item.id)
                      }
                    >
                      Edit
                    </button>
                    <button
                      className="button button-danger"
                      type="button"
                      disabled={working}
                      onClick={() => {
                        if (window.confirm(`Delete document “${item.title}”?`))
                          void run(
                            () =>
                              adminApi.deleteDocument(
                                projectId,
                                releaseId,
                                item.id,
                              ),
                            "Document deleted.",
                          );
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  {editingId === item.id && (
                    <form
                      className="document-editor form-panel compact-form"
                      onSubmit={(event) => void saveDocument(event, item.id)}
                    >
                      <label className="field">
                        <span>Section</span>
                        <input
                          name="section"
                          required
                          maxLength={120}
                          defaultValue={item.section}
                        />
                      </label>
                      <label className="field">
                        <span>Title</span>
                        <input
                          name="title"
                          required
                          maxLength={240}
                          defaultValue={item.title}
                        />
                      </label>
                      <div className="field">
                        <MarkdownDocumentEditor
                          name="content"
                          value={documentTextFromAst(item.content)}
                          rows={10}
                        />
                      </div>
                      <button
                        className="button button-primary"
                        disabled={working}
                      >
                        Save document
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="inline-empty">No internal documents yet.</p>
          )}
          {documents.length > 1 && (
            <div className="form-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={
                  working ||
                  orderedDocuments.map((item) => item.id).join("|") ===
                    documents.map((item) => item.id).join("|")
                }
                onClick={() =>
                  void run(
                    () =>
                      adminApi.reorderDocuments(
                        projectId,
                        releaseId,
                        orderedDocuments.map((item) => item.id),
                      ),
                    "Document order saved.",
                  )
                }
              >
                Save document order
              </button>
            </div>
          )}
          <form
            className="form-panel compact-form"
            onSubmit={(event) => void saveDocument(event)}
          >
            <h4>Add document</h4>
            <div className="form-grid three">
              <label className="field">
                <span>Section</span>
                <input name="section" required maxLength={120} />
              </label>
              <label className="field">
                <span>Title</span>
                <input name="title" required maxLength={240} />
              </label>
              <div className="field">
                <MarkdownDocumentEditor name="content" required rows={8} />
              </div>
            </div>
            <button className="button button-primary" disabled={working}>
              Create document
            </button>
          </form>
        </section>

        <section
          className="admin-subsection"
          aria-labelledby="attachments-heading"
        >
          <div className="section-heading">
            <div>
              <h3 id="attachments-heading">Attachments</h3>
              <p>
                Files up to 25 MiB. Only scan-clean files marked by a project
                administrator or release manager enter the next approved public
                snapshot.
              </p>
            </div>
          </div>
          {attachments.length ? (
            <div
              className="admin-list"
              role="list"
              aria-label="Release attachments"
            >
              {attachments.map((attachment) => (
                <div
                  className="admin-list-row attachment-row"
                  role="listitem"
                  key={attachment.id}
                >
                  <div>
                    <strong>{attachment.fileName}</strong>
                    <small>
                      {attachment.contentType} ·{" "}
                      {fileSize(attachment.sizeBytes)} ·{" "}
                      {attachment.checksumSha256.slice(0, 16)}…
                    </small>
                  </div>
                  <span
                    className={`scan-status scan-${attachment.scanStatus.toLowerCase()}`}
                  >
                    {attachment.scanStatus}
                  </span>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={
                      working ||
                      attachment.scanStatus === "CLEAN" ||
                      attachment.scanStatus === "INFECTED"
                    }
                    onClick={() =>
                      void run(
                        () =>
                          adminApi.scanAttachment(
                            projectId,
                            releaseId,
                            attachment.id,
                          ),
                        "Attachment scan finished.",
                      )
                    }
                  >
                    {attachment.scanStatus === "PENDING"
                      ? "Scan file"
                      : "Retry scan"}
                  </button>
                  <button
                    className="button button-quiet"
                    type="button"
                    disabled={working || attachment.scanStatus !== "CLEAN"}
                    onClick={() => void download(attachment)}
                  >
                    Private download
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    disabled={working || attachment.scanStatus !== "CLEAN"}
                    aria-pressed={attachment.publicAllowed}
                    onClick={() => void togglePublicAccess(attachment)}
                  >
                    {attachment.publicAllowed
                      ? "Remove from next public snapshot"
                      : "Include in next public snapshot"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="inline-empty">No attachments uploaded.</p>
          )}
          <form
            className="form-panel compact-form"
            onSubmit={(event) => void upload(event)}
          >
            <h4>Upload attachment</h4>
            <label className="field">
              <span>File</span>
              <input name="file" type="file" required />
            </label>
            <div className="form-actions">
              <button className="button button-primary" disabled={working}>
                {working ? "Uploading…" : "Upload attachment"}
              </button>
              <small>New files are private and await a malware scan.</small>
            </div>
          </form>
        </section>

        <section
          className="admin-subsection"
          aria-labelledby="deployment-history-heading"
        >
          <div className="section-heading">
            <div>
              <h3 id="deployment-history-heading">Deployment history</h3>
              <p>
                Record or update deployments for enabled project environments.
              </p>
            </div>
          </div>
          {deployments.length ? (
            <div className="deployment-records">
              {deployments.map((deployment) => (
                <form
                  className="form-panel compact-form deployment-record"
                  key={deployment.id}
                  onSubmit={(event) =>
                    void saveDeployment(event, deployment.id)
                  }
                >
                  <div className="form-panel-heading">
                    <h4>
                      {deployment.environment?.label ||
                        deployment.environment?.name ||
                        "Deployment"}
                    </h4>
                    <p>
                      {deployment.deployedAt
                        ? new Date(deployment.deployedAt).toLocaleString()
                        : "No deployment time"}
                    </p>
                  </div>
                  <div className="form-grid three">
                    <label className="field">
                      <span>Status</span>
                      <input
                        name="status"
                        required
                        maxLength={40}
                        defaultValue={deployment.status}
                      />
                    </label>
                    <label className="field">
                      <span>External deployment ID</span>
                      <input
                        name="externalId"
                        maxLength={255}
                        defaultValue={deployment.externalId ?? ""}
                      />
                    </label>
                    <label className="field">
                      <span>Deployed at</span>
                      <input
                        name="deployedAt"
                        type="datetime-local"
                        defaultValue={localDateTime(deployment.deployedAt)}
                      />
                    </label>
                    <label className="field">
                      <span>Metadata JSON</span>
                      <textarea
                        name="metadata"
                        rows={3}
                        defaultValue={JSON.stringify(
                          deployment.metadata ?? {},
                          null,
                          2,
                        )}
                      />
                    </label>
                  </div>
                  <button
                    className="button button-secondary"
                    disabled={working}
                  >
                    Update deployment
                  </button>
                </form>
              ))}
            </div>
          ) : (
            <p className="inline-empty">
              No deployments recorded for this release.
            </p>
          )}
          <form
            className="form-panel compact-form"
            onSubmit={(event) => void saveDeployment(event)}
          >
            <h4>Record deployment</h4>
            <div className="form-grid three">
              <label className="field">
                <span>Environment</span>
                <select name="environmentId" required defaultValue="">
                  <option value="" disabled>
                    Choose an environment
                  </option>
                  {environments
                    .filter((environment) => environment.enabled)
                    .map((environment) => (
                      <option value={environment.id} key={environment.id}>
                        {environment.label || environment.name}
                      </option>
                    ))}
                </select>
              </label>
              <label className="field">
                <span>Status</span>
                <input
                  name="status"
                  required
                  maxLength={40}
                  placeholder="SUCCEEDED"
                />
              </label>
              <label className="field">
                <span>External deployment ID</span>
                <input name="externalId" maxLength={255} />
              </label>
              <label className="field">
                <span>Deployed at</span>
                <input name="deployedAt" type="datetime-local" />
              </label>
              <label className="field">
                <span>Metadata JSON</span>
                <textarea name="metadata" rows={3} defaultValue="{}" />
              </label>
            </div>
            <button
              className="button button-primary"
              disabled={
                working ||
                environments.every((environment) => !environment.enabled)
              }
            >
              Create deployment
            </button>
          </form>
        </section>
      </section>
    </>
  );
}
