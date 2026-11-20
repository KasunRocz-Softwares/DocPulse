export const ANALYTICS_EXPORT_JOB_DEFAULTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 1_000 },
};

type ExportJobData = {
  exportId: string;
  kind: "ANALYTICS_CSV" | "RELEASE_PDF";
  filename: string;
  rows?: Array<{ day: string; projectViews: number; releaseViews: number }>;
  snapshot?: {
    projectName: string;
    version: string;
    title: string;
    summary?: string | null;
    publishedAt: string | Date;
    changes: Array<{ title: string; category: string; description: string }>;
  };
};

type ExportHandlers = {
  processing?(id: string): Promise<void>;
  complete(
    id: string,
    artifact: { contentType: string; content: string },
  ): Promise<void>;
  fail(id: string, code: string): Promise<void>;
};

export function createAnalyticsExportProcessor(handlers: ExportHandlers) {
  return async (job: {
    data: unknown;
    attemptsMade?: number;
    opts?: { attempts?: number };
  }): Promise<void> => {
    const data = job.data as Partial<ExportJobData> | null;
    if (
      !data ||
      typeof data.exportId !== "string" ||
      typeof data.filename !== "string"
    )
      throw new Error("Invalid analytics export job");
    await handlers.processing?.(data.exportId);
    try {
      let content: Buffer;
      let contentType: string;
      if (data.kind === "ANALYTICS_CSV" && Array.isArray(data.rows)) {
        content = Buffer.from(renderCsv(data.rows), "utf8");
        contentType = "text/csv; charset=utf-8";
      } else if (data.kind === "RELEASE_PDF" && isRecord(data.snapshot)) {
        content = renderPdf(data.snapshot as ExportJobData["snapshot"] & {});
        contentType = "application/pdf";
      } else {
        throw Object.assign(new Error("Unsupported export data"), {
          code: "INVALID_EXPORT_DATA",
        });
      }
      await handlers.complete(data.exportId, {
        contentType,
        content: content.toString("base64"),
      });
    } catch (error) {
      const attempts =
        job.opts?.attempts ?? ANALYTICS_EXPORT_JOB_DEFAULTS.attempts;
      if ((job.attemptsMade ?? 0) + 1 >= attempts)
        await handlers.fail(data.exportId, safeErrorCode(error));
      throw new Error("Analytics export processing failed", { cause: error });
    }
  };
}

function renderCsv(
  rows: Array<{ day: string; projectViews: number; releaseViews: number }>,
): string {
  const escape = (value: unknown) => `"${String(value).replace(/"/g, '""')}"`;
  return (
    [
      "day,projectViews,releaseViews",
      ...rows.map((row) =>
        [row.day, row.projectViews, row.releaseViews].map(escape).join(","),
      ),
    ].join("\r\n") + "\r\n"
  );
}

function renderPdf(snapshot: NonNullable<ExportJobData["snapshot"]>): Buffer {
  const lines = [
    snapshot.projectName,
    `Release ${snapshot.version}`,
    snapshot.title,
    `Published ${new Date(snapshot.publishedAt).toISOString().slice(0, 10)}`,
    "",
    ...(snapshot.summary ? wrap(snapshot.summary) : []),
    "",
    "Changes",
    ...snapshot.changes.flatMap((change) => [
      `${change.category}: ${change.title}`,
      ...wrap(change.description, "  "),
    ]),
  ].flatMap((line) => wrap(line));
  const pages: string[][] = [];
  for (let index = 0; index < lines.length || index === 0; index += 48)
    pages.push(lines.slice(index, index + 48));
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const pageRefs: number[] = [];
  for (const page of pages) {
    const pageObject = objects.length + 1;
    const contentObject = pageObject + 1;
    pageRefs.push(pageObject);
    const commands = [
      "BT /F1 10 Tf 50 790 Td 14 TL",
      ...page.map((line) => `(${pdfEscape(line)}) Tj T*`),
      "ET",
    ].join("\n");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(commands, "ascii")} >>\nstream\n${commands}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "ascii");
}

function wrap(value: string, prefix = ""): string[] {
  const words = String(value)
    .replace(/[\r\n\t]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const lines: string[] = [];
  let line = prefix;
  for (const word of words) {
    if (line.length + word.length > 88 && line.trim()) {
      lines.push(line);
      line = prefix;
    }
    line += `${line.trim() ? " " : ""}${word}`;
  }
  if (line.trim()) lines.push(line);
  return lines;
}

function pdfEscape(value: string) {
  const ascii = value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "?");
  return ascii.replace(/[\\()]/g, "\\$&");
}

function safeErrorCode(error: unknown) {
  const code =
    error !== null && typeof error === "object"
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" && /^[A-Z0-9_-]{1,80}$/.test(code)
    ? code
    : "EXPORT_PROCESSING_FAILED";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
