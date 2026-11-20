import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ProjectRole } from "../generated/prisma/enums";
import { ProjectsService } from "./projects.service";

test("changing a CLIENT member to an internal role removes their client audience binding", async () => {
  let memberUpdate: unknown;
  const prisma = {
    projectMember: { findFirst: async () => ({ role: ProjectRole.ADMIN }) },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
      work({
        projectMember: {
          findFirst: async () => ({ id: "member-1", role: ProjectRole.CLIENT }),
          update: async ({ data }: { data: unknown }) => {
            memberUpdate = data;
            return {
              id: "member-1",
              user: { email: "client@example.com" },
            };
          },
        },
        projectInvitation: { updateMany: async () => ({ count: 0 }) },
        auditLog: { create: async () => ({}) },
      }),
  };

  await new ProjectsService(prisma as never).updateMemberRole(
    { id: "admin-1", isSystemAdmin: false },
    "project-1",
    "member-1",
    ProjectRole.DEVELOPER,
  );

  assert.deepEqual(memberUpdate, {
    role: ProjectRole.DEVELOPER,
    clientAudienceId: null,
  });
});

test("audit CSV export authorizes admins, records export, and pages through all events", async () => {
  const auditCreates: unknown[] = [];
  const queries: unknown[] = [];
  const firstPage = [
    {
      id: "event-3",
      createdAt: new Date("2026-11-12T12:00:00Z"),
      actor: { id: "user-3", email: "third@example.com", displayName: "Third" },
      action: "release.published",
      entityType: "release",
      entityId: "release-3",
      metadata: { published: true },
    },
    ...Array.from({ length: 498 }, (_, index) => ({
      id: `event-middle-${index}`,
      createdAt: new Date("2026-11-12T11:30:00Z"),
      actor: {
        id: "user-2",
        email: "second@example.com",
        displayName: "Second",
      },
      action: "release.updated",
      entityType: "release",
      entityId: "release-middle",
      metadata: { title: "Updated" },
    })),
    {
      id: "event-2",
      createdAt: new Date("2026-11-12T11:00:00Z"),
      actor: {
        id: "user-2",
        email: "second@example.com",
        displayName: "Second",
      },
      action: "release.updated",
      entityType: "release",
      entityId: "release-2",
      metadata: { title: "Updated" },
    },
  ];
  const secondPage = [
    {
      id: "event-1",
      createdAt: new Date("2026-11-12T10:00:00Z"),
      actor: null,
      action: "project.created",
      entityType: "project",
      entityId: "project-1",
      metadata: null,
    },
  ];
  const prisma = {
    projectMember: { findFirst: async () => ({ role: ProjectRole.ADMIN }) },
    auditLog: {
      create: async ({ data }: { data: unknown }) => {
        auditCreates.push(data);
        return {};
      },
      findMany: async (query: unknown) => {
        queries.push(query);
        return queries.length === 1
          ? firstPage
          : queries.length === 2
            ? secondPage
            : [];
      },
    },
  };

  const service = new ProjectsService(prisma as never);
  const events = await service.exportAuditEvents(
    { id: "admin-1", isSystemAdmin: false },
    "project-1",
  );
  const exported = [];
  for await (const event of events) exported.push(event);

  assert.equal(exported.length, 501);
  assert.equal(exported[0]?.id, "event-3");
  assert.equal(exported[499]?.id, "event-2");
  assert.equal(exported[500]?.id, "event-1");
  assert.deepEqual(auditCreates, [
    {
      actorId: "admin-1",
      projectId: "project-1",
      action: "project.audit_exported",
      entityType: "project_audit",
      entityId: "project-1",
      metadata: { format: "csv" },
    },
  ]);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0], {
    where: { projectId: "project-1" },
    include: {
      actor: { select: { id: true, email: true, displayName: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 500,
  });
  assert.deepEqual(queries[1], {
    where: { projectId: "project-1" },
    include: {
      actor: { select: { id: true, email: true, displayName: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    cursor: { id: "event-2" },
    skip: 1,
    take: 500,
  });
});

test("audit CSV cells quote delimiters and neutralize spreadsheet formulas", async () => {
  const { auditCsvCell } = await import("./projects.service");

  assert.equal(auditCsvCell("=SUM(1,2)"), '"\'=SUM(1,2)"');
  assert.equal(auditCsvCell('  @cmd"x'), `"'  @cmd""x"`);
  assert.equal(auditCsvCell("line 1\nline 2"), '"line 1\nline 2"');
  assert.equal(auditCsvCell(null), '""');
});

test("audit CSV export denies project members without admin access before auditing or reading", async () => {
  let auditWrites = 0;
  let eventReads = 0;
  const prisma = {
    projectMember: { findFirst: async () => ({ role: ProjectRole.DEVELOPER }) },
    auditLog: {
      create: async () => {
        auditWrites += 1;
        return {};
      },
      findMany: async () => {
        eventReads += 1;
        return [];
      },
    },
  };
  const service = new ProjectsService(prisma as never);

  await assert.rejects(
    service.exportAuditEvents(
      { id: "developer-1", isSystemAdmin: false },
      "project-1",
    ),
    /Project administrator access is required/,
  );
  assert.equal(auditWrites, 0);
  assert.equal(eventReads, 0);
});
