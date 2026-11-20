import { deepEqual, equal, rejects, throws } from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ClamAvAttachmentScanner,
  createAttachmentScanner,
  EicarDevelopmentScanner,
} from "./release-content.adapters";
import { ReleaseContentService } from "./release-content.service";
import { validateReleaseDocumentAst } from "./release-content.validation";

const actor = { id: "user-1", isSystemAdmin: false };
const release = {
  id: "release-1",
  projectId: "project-1",
  status: "PUBLISHED",
};

function harness(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    projectMember: { findUnique: async () => ({ role: "DEVELOPER" }) },
    release: { findFirst: async () => release },
    releaseDocument: {
      findMany: async () => [],
      findFirst: async () => null,
      create: async ({ data }: any) => ({ id: "doc-1", ...data }),
      update: async ({ data }: any) => ({ id: "doc-1", ...data }),
      delete: async () => ({ id: "doc-1" }),
      updateMany: async () => ({ count: 1 }),
    },
    releaseAttachment: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async ({ data }: any) => ({ id: "attachment-1", ...data }),
      update: async ({ data }: any) => ({ id: "attachment-1", ...data }),
    },
    projectEnvironment: { findFirst: async () => ({ id: "env-1" }) },
    releaseDeployment: {
      findMany: async () => [],
      findFirst: async () => null,
      create: async ({ data }: any) => ({ id: "deployment-1", ...data }),
      update: async ({ data }: any) => ({ id: "deployment-1", ...data }),
    },
    auditLog: { create: async ({ data }: any) => data },
    ...overrides,
  };
  if (!prisma.$transaction)
    prisma.$transaction = async (operation: any) => operation(prisma);
  const storage = {
    put: async () => ({ storageKey: "key", checksumSha256: "a".repeat(64) }),
    get: async () => Buffer.from("file"),
    delete: async () => undefined,
  };
  const scanner = { scan: async () => "CLEAN" as const };
  return new ReleaseContentService(
    prisma as any,
    storage as any,
    scanner as any,
  );
}

test("document reorder requires every document exactly once and in the release", async () => {
  const service = harness({
    releaseDocument: {
      findMany: async () => [{ id: "doc-1" }, { id: "doc-2" }],
      updateMany: async () => ({ count: 1 }),
    },
  });

  await rejects(
    service.reorderDocuments(actor, "project-1", "release-1", [
      "doc-1",
      "doc-1",
    ]),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test("deployment creation rejects an environment from another project", async () => {
  const service = harness({
    projectEnvironment: { findFirst: async () => null },
  });

  await rejects(
    service.createDeployment(actor, "project-1", "release-1", {
      environmentId: "foreign-env",
      status: "SUCCEEDED",
    }),
    (error: unknown) => error instanceof NotFoundException,
  );
});

test("public attachment access rejects pending or non-public attachments", async () => {
  const service = harness({
    releaseAttachment: {
      findFirst: async () => ({
        id: "attachment-1",
        releaseId: "release-1",
        storageKey: "key",
        scanStatus: "PENDING",
        publicAllowed: true,
        release,
      }),
    },
  });

  await rejects(
    service.getPublicAttachment("attachment-1"),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test("public attachment access stays disabled even for clean approved published attachment rows", async () => {
  const bytes = Buffer.from("file");
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const service = harness({
    releaseAttachment: {
      findFirst: async () => ({
        id: "attachment-1",
        releaseId: "release-1",
        storageKey: "key",
        fileName: "manual.pdf",
        contentType: "application/pdf",
        sizeBytes: 4n,
        checksumSha256,
        scanStatus: "CLEAN",
        publicAllowed: true,
        release,
      }),
    },
  });

  await rejects(
    service.getPublicAttachment("attachment-1"),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test("client members cannot read internal documents, attachment metadata or downloads, or deployment history", async () => {
  const bytes = Buffer.from("file");
  const service = harness({
    projectMember: { findUnique: async () => ({ role: "CLIENT" }) },
    releaseDocument: {
      findMany: async () => [{ id: "doc-1" }],
      findFirst: async () => ({ id: "doc-1", releaseId: "release-1" }),
    },
    releaseAttachment: {
      findMany: async () => [{ id: "attachment-1" }],
      findFirst: async () => ({
        id: "attachment-1",
        releaseId: "release-1",
        storageKey: "key",
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    },
    releaseDeployment: { findMany: async () => [{ id: "deployment-1" }] },
  });

  await rejects(
    service.listDocuments({ ...actor }, "project-1", "release-1"),
    (error: unknown) => error instanceof ForbiddenException,
  );
  await rejects(
    service.getDocument({ ...actor }, "project-1", "doc-1"),
    (error: unknown) => error instanceof ForbiddenException,
  );
  await rejects(
    service.listAttachments({ ...actor }, "project-1", "release-1"),
    (error: unknown) => error instanceof ForbiddenException,
  );
  await rejects(
    service.getPrivateAttachment({ ...actor }, "project-1", "attachment-1"),
    (error: unknown) => error instanceof ForbiddenException,
  );
  await rejects(
    service.listDeployments({ ...actor }, "project-1", "release-1"),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test("generic write roles cannot grant public attachment access", async () => {
  const service = harness({
    releaseAttachment: {
      findFirst: async () => ({
        id: "attachment-1",
        releaseId: "release-1",
        scanStatus: "CLEAN",
        publicAllowed: false,
      }),
    },
  });

  await rejects(
    service.setAttachmentPublic(actor, "project-1", "attachment-1", true),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test("project administrators can enable only clean attachments for future public snapshots", async () => {
  let update: unknown;
  const service = harness({
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    releaseAttachment: {
      findFirst: async () => ({
        id: "attachment-1",
        releaseId: "release-1",
        fileName: "guide.pdf",
        contentType: "application/pdf",
        sizeBytes: 25n,
        checksumSha256: "a".repeat(64),
        scanStatus: "CLEAN",
        publicAllowed: false,
        release,
      }),
      update: async ({ data }: any) => {
        update = data;
        return { id: "attachment-1", publicAllowed: true, scanStatus: "CLEAN" };
      },
    },
  });

  await service.setAttachmentPublic(actor, "project-1", "attachment-1", true);

  deepEqual(update, { publicAllowed: true });
});

test("project administrators cannot enable public access before a clean malware scan", async () => {
  const service = harness({
    projectMember: { findUnique: async () => ({ role: "ADMIN" }) },
    releaseAttachment: {
      findFirst: async () => ({
        id: "attachment-1",
        releaseId: "release-1",
        scanStatus: "PENDING",
        publicAllowed: false,
        release,
      }),
    },
  });

  await rejects(
    service.setAttachmentPublic(actor, "project-1", "attachment-1", true),
    (error: unknown) => error instanceof ForbiddenException,
  );
});

test("document access is project scoped before returning its content", async () => {
  const service = harness({
    release: { findFirst: async () => null },
  });

  await rejects(
    service.createDocument(actor, "project-1", "foreign-release", {
      section: "details",
      title: "Notes",
      content: { type: "doc", content: [] },
    }),
    (error: unknown) => error instanceof NotFoundException,
  );
});

test("uploaded attachments are stored pending and are never public by default", async () => {
  let created: any;
  const service = harness({
    releaseAttachment: {
      create: async ({ data }: any) =>
        (created = { id: "attachment-1", ...data }),
    },
  });

  const attachment = await service.uploadAttachment(
    actor,
    "project-1",
    "release-1",
    {
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, ...Buffer.alloc(12)]),
      originalname: "artifact.zip",
      mimetype: "application/zip",
      size: 16,
    },
  );

  equal(attachment.scanStatus, "PENDING");
  equal(attachment.publicAllowed, false);
  equal(attachment.sizeBytes, "16");
  equal(created.releaseId, "release-1");
});

test("attachment MIME and content are validated before storage is touched", async () => {
  let storageWrites = 0;
  const prisma: any = {
    projectMember: { findUnique: async () => ({ role: "DEVELOPER" }) },
    release: { findFirst: async () => release },
  };
  const storage = {
    put: async () => {
      storageWrites++;
      return { storageKey: "key", checksumSha256: "a".repeat(64) };
    },
    get: async () => Buffer.alloc(0),
    delete: async () => undefined,
  };
  const service = new ReleaseContentService(prisma, storage, {
    scan: async () => "CLEAN",
  });

  await rejects(
    service.uploadAttachment(actor, "project-1", "release-1", {
      buffer: Buffer.from("<script>alert(1)</script>"),
      originalname: "payload.html",
      mimetype: "text/plain",
      size: 25,
    }),
    (error: unknown) => error instanceof BadRequestException,
  );
  await rejects(
    service.uploadAttachment(actor, "project-1", "release-1", {
      buffer: Buffer.from("not a PDF"),
      originalname: "manual.pdf",
      mimetype: "application/pdf",
      size: 9,
    }),
    (error: unknown) => error instanceof BadRequestException,
  );
  equal(storageWrites, 0);
});

test("development scanner detects the standard EICAR test signature", async () => {
  const scanner = new EicarDevelopmentScanner();
  const clean = await scanner.scan(Buffer.from("ordinary release artifact"));
  const infected = await scanner.scan(
    Buffer.from(
      "prefix X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H* suffix",
    ),
  );

  equal(clean, "CLEAN");
  equal(infected, "INFECTED");
});

test("development and test environments select the EICAR scanner", () => {
  equal(
    createAttachmentScanner("development") instanceof EicarDevelopmentScanner,
    true,
  );
  equal(
    createAttachmentScanner("test") instanceof EicarDevelopmentScanner,
    true,
  );
});

test("production, unset, and unknown environments select ClamAV", () => {
  for (const environment of ["production", undefined, "staging", ""]) {
    equal(
      createAttachmentScanner(environment) instanceof ClamAvAttachmentScanner,
      true,
      "non-development environment must not select the EICAR scanner",
    );
  }
});

test("unavailable ClamAV marks an attachment failed and returns a sanitized error", async () => {
  const bytes = Buffer.from("file");
  let updated: any;
  const scanner = new ClamAvAttachmentScanner({
    host: "127.0.0.1",
    port: 1,
    timeoutMs: 50,
  });
  const service = harness({
    releaseAttachment: {
      findFirst: async () => ({
        id: "attachment-1",
        releaseId: "release-1",
        storageKey: "key",
        checksumSha256: createHash("sha256").update(bytes).digest("hex"),
        scanStatus: "PENDING",
        publicAllowed: false,
      }),
      update: async ({ data }: any) => (updated = data),
    },
  });
  (service as any).scanner = scanner;

  await rejects(
    service.scanAttachment(actor, "project-1", "attachment-1"),
    (error: unknown) =>
      error instanceof ServiceUnavailableException &&
      !error.message.includes("127.0.0.1"),
  );
  deepEqual(updated, { scanStatus: "FAILED", publicAllowed: false });
});

test("document mutation and audit roll back together when audit insertion fails", async () => {
  let committedDocuments = 0;
  const prismaOverrides = {
    $transaction: async (callback: any) => {
      let transactionDocuments = 0;
      const tx = {
        releaseDocument: {
          create: async () => {
            transactionDocuments++;
            return { id: "doc-atomic" };
          },
        },
        auditLog: {
          create: async () => {
            throw new Error("audit unavailable");
          },
        },
      };
      const result = await callback(tx);
      committedDocuments += transactionDocuments;
      return result;
    },
  };
  const service = harness(prismaOverrides);

  await rejects(
    service.createDocument(actor, "project-1", "release-1", {
      section: "guide",
      title: "Install",
      content: { type: "doc", content: [] },
    }),
  );
  equal(committedDocuments, 0);
});

test("release document AST rejects credential keys and known secret formats without echoing values", async () => {
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
  const service = harness();

  await rejects(
    service.createDocument(actor, "project-1", "release-1", {
      section: "guide",
      title: "Install",
      content: {
        type: "doc",
        content: [
          { type: "text", attrs: { apiKey: "ordinary-looking-value" } },
        ],
      },
    }),
    (error: unknown) =>
      error instanceof BadRequestException &&
      !error.message.includes("ordinary-looking-value"),
  );
  await rejects(
    service.createDocument(actor, "project-1", "release-1", {
      section: "guide",
      title: "Install",
      content: {
        type: "doc",
        content: [{ type: "text", attrs: { refresh_token: secret } }],
      },
    }),
    (error: unknown) =>
      error instanceof BadRequestException && !error.message.includes(secret),
  );
  await rejects(
    service.createDocument(actor, "project-1", "release-1", {
      section: "guide",
      title: "Install",
      content: {
        type: "doc",
        content: [{ type: "text", text: "-----BEGIN PRIVATE KEY-----" }],
      },
    }),
    (error: unknown) => error instanceof BadRequestException,
  );
});

test("deployment metadata recursively rejects credential URLs and JWTs", async () => {
  const service = harness();
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature-value";

  await rejects(
    service.createDeployment(actor, "project-1", "release-1", {
      environmentId: "env-1",
      status: "SUCCEEDED",
      metadata: {
        pipeline: {
          dashboard: "https://operator:private-pass@example.test/build",
        },
      },
    }),
    (error: unknown) =>
      error instanceof BadRequestException &&
      !error.message.includes("private-pass"),
  );
  await rejects(
    service.createDeployment(actor, "project-1", "release-1", {
      environmentId: "env-1",
      status: "SUCCEEDED",
      metadata: { pipeline: { status: jwt } },
    }),
    (error: unknown) =>
      error instanceof BadRequestException && !error.message.includes(jwt),
  );
});

test("safe rich document AST and deployment metadata remain accepted", async () => {
  let savedDocument: any;
  let savedDeployment: any;
  const service = harness({
    releaseDocument: {
      create: async ({ data }: any) => (savedDocument = data),
    },
    releaseDeployment: {
      create: async ({ data }: any) => (savedDeployment = data),
    },
  });

  await service.createDocument(actor, "project-1", "release-1", {
    section: "guide",
    title: "Install",
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Run the installer." }],
        },
      ],
    },
  });
  await service.createDeployment(actor, "project-1", "release-1", {
    environmentId: "env-1",
    status: "SUCCEEDED",
    metadata: {
      pipeline: { build: 42, url: "https://ci.example.test/build/42" },
    },
  });

  equal(savedDocument.section, "guide");
  equal(savedDeployment.environmentId, "env-1");
});

test("release documents accept Markdown and reject unknown rich-text nodes and attributes", () => {
  validateReleaseDocumentAst({ type: "markdown", source: "# Safe\n\nText" });
  validateReleaseDocumentAst({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Safe" }],
      },
    ],
  });
  validateReleaseDocumentAst({
    type: "doc",
    content: [
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableHeader",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Platform" }],
                  },
                ],
              },
              {
                type: "tableHeader",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Status" }],
                  },
                ],
              },
            ],
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Web" }],
                  },
                ],
              },
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "Available" }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  throws(
    () =>
      validateReleaseDocumentAst({
        type: "doc",
        content: [{ type: "runCommand", attrs: { command: "rm -rf /" } }],
      }),
    BadRequestException,
  );
  throws(
    () =>
      validateReleaseDocumentAst({
        type: "doc",
        content: [
          { type: "table", content: [{ type: "paragraph", content: [] }] },
        ],
      }),
    BadRequestException,
  );
  throws(
    () =>
      validateReleaseDocumentAst({
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { className: "unexpected" },
            content: [],
          },
        ],
      }),
    BadRequestException,
  );
  throws(
    () =>
      validateReleaseDocumentAst({
        type: "doc",
        content: [
          {
            type: "text",
            text: "unsafe",
            marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
          },
        ],
      }),
    BadRequestException,
  );
});

test("every release-content mutation writes a safe actor/project/entity audit row in its transaction", async () => {
  const auditRows: any[] = [];
  const bytes = Buffer.from("file");
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
  const service = harness({
    auditLog: { create: async ({ data }: any) => (auditRows.push(data), data) },
    releaseDocument: {
      findMany: async () => [{ id: "doc-1" }, { id: "doc-2" }],
      findFirst: async () => ({ id: "doc-1", releaseId: "release-1" }),
      create: async ({ data }: any) => ({ id: "doc-new", ...data }),
      update: async ({ data }: any) => ({ id: "doc-1", ...data }),
      delete: async () => ({ id: "doc-1" }),
      updateMany: async () => ({ count: 1 }),
    },
    releaseAttachment: {
      findFirst: async () => ({
        id: "attachment-1",
        releaseId: "release-1",
        storageKey: "key",
        checksumSha256,
        scanStatus: "PENDING",
        fileName: "file.txt",
        contentType: "text/plain",
        sizeBytes: 4n,
      }),
      create: async ({ data }: any) => ({ id: "attachment-created", ...data }),
      update: async ({ data }: any) => ({ id: "attachment-1", ...data }),
    },
    releaseDeployment: {
      findFirst: async () => ({ id: "deployment-1", releaseId: "release-1" }),
      create: async ({ data }: any) => ({ id: "deployment-created", ...data }),
      update: async ({ data }: any) => ({ id: "deployment-1", ...data }),
    },
  });
  const document = {
    section: "guide",
    title: "Install",
    content: {
      type: "doc",
      content: [{ type: "text", text: "Safe instructions" }],
    },
  };
  await service.createDocument(actor, "project-1", "release-1", document);
  await service.updateDocument(actor, "project-1", "doc-1", {
    title: "Updated",
  });
  await service.deleteDocument(actor, "project-1", "doc-1");
  await service.reorderDocuments(actor, "project-1", "release-1", [
    "doc-1",
    "doc-2",
  ]);
  await service.uploadAttachment(actor, "project-1", "release-1", {
    buffer: bytes,
    originalname: "file.txt",
    mimetype: "text/plain",
    size: 4,
  });
  await service.scanAttachment(actor, "project-1", "attachment-1");
  await service.getPrivateAttachment(actor, "project-1", "attachment-1");
  await service.createDeployment(actor, "project-1", "release-1", {
    environmentId: "env-1",
    status: "SUCCEEDED",
    metadata: { build: 1 },
  });
  await service.updateDeployment(actor, "project-1", "deployment-1", {
    status: "FAILED",
  });

  equal(auditRows.length, 10);
  for (const row of auditRows) {
    equal(row.actorId, actor.id);
    equal(row.projectId, "project-1");
    equal(typeof row.entityId, "string");
    equal(typeof row.action, "string");
    equal(typeof row.entityType, "string");
  }
  equal(JSON.stringify(auditRows).includes("Safe instructions"), false);
  equal(JSON.stringify(auditRows).includes("file.txt"), false);
});

test("attachment upload removes stored bytes when the audit transaction fails", async () => {
  let committedAttachments = 0;
  let cleanedStorage = false;
  const prisma: any = {
    projectMember: { findUnique: async () => ({ role: "DEVELOPER" }) },
    release: { findFirst: async () => release },
    $transaction: async (callback: any) => {
      let transactionAttachments = 0;
      const tx = {
        releaseAttachment: {
          create: async () => {
            transactionAttachments++;
            return {
              id: "attachment-atomic",
              contentType: "application/zip",
              sizeBytes: 4n,
            };
          },
        },
        auditLog: {
          create: async () => {
            throw new Error("audit unavailable");
          },
        },
      };
      const result = await callback(tx);
      committedAttachments += transactionAttachments;
      return result;
    },
  };
  const storage = {
    put: async () => ({ storageKey: "key", checksumSha256: "a".repeat(64) }),
    get: async () => Buffer.from("file"),
    delete: async () => {
      cleanedStorage = true;
    },
  };
  const service = new ReleaseContentService(prisma, storage, {
    scan: async () => "CLEAN",
  });

  await rejects(
    service.uploadAttachment(actor, "project-1", "release-1", {
      buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      originalname: "file.zip",
      mimetype: "application/zip",
      size: 4,
    }),
  );
  equal(committedAttachments, 0);
  equal(cleanedStorage, true);
});
