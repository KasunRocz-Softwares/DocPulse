import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ProjectsController } from "./projects.controller";

test("audit CSV endpoint streams a no-store attachment with the expected columns", async () => {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  let ended = false;
  const response = {
    setHeader: (name: string, value: string) => {
      headers[name.toLowerCase()] = value;
    },
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
    end: () => {
      ended = true;
    },
  };
  const controller = new ProjectsController({
    exportAuditEvents: async () =>
      (async function* () {
        yield {
          id: "event-1",
          createdAt: new Date("2026-11-12T10:00:00Z"),
          actor: {
            id: "user-1",
            email: "admin@example.com",
            displayName: "Admin",
          },
          action: "project.created",
          entityType: "project",
          entityId: "project-1",
          metadata: { source: "test" },
        };
      })(),
  } as never);

  await controller.exportAuditEvents(
    { user: { id: "admin-1", isSystemAdmin: false } } as never,
    "project-1",
    response as never,
  );

  assert.equal(headers["cache-control"], "no-store");
  assert.equal(headers["content-type"], "text/csv; charset=utf-8");
  assert.equal(
    headers["content-disposition"],
    'attachment; filename="project-audit.csv"',
  );
  assert.equal(
    chunks.join(""),
    "timestamp,actor,action,entity,metadata\n" +
      '"2026-11-12T10:00:00.000Z","Admin <admin@example.com> (user-1)","project.created","project:project-1","{""source"":""test""}"\n',
  );
  assert.equal(ended, true);
});
