import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  defaultPublicPageConfig,
  parsePublicPageConfig,
} from "./public-page-config";
import { PublicPageService } from "./public-page.service";

const admin = { id: "admin-1", isSystemAdmin: false };

function fakePrisma(options: {
  role?: string | null;
  settings?: Record<string, unknown>;
}) {
  const state = {
    settings: options.settings ?? {},
    audits: [] as Array<{ action: string }>,
  };
  const brandApi = {
    findUnique: async () => ({ id: "brand-1", settings: state.settings }),
    upsert: async ({
      update,
    }: {
      update: { settings: Record<string, unknown> };
    }) => {
      state.settings = update.settings;
      return { id: "brand-1" };
    },
  };
  const tx = {
    projectBrand: brandApi,
    auditLog: {
      create: async ({ data }: { data: { action: string } }) => {
        state.audits.push(data);
        return {};
      },
    },
  };
  const prisma = {
    ...tx,
    projectMember: {
      findFirst: async () =>
        options.role === null ? null : { role: options.role ?? "ADMIN" },
    },
    project: {
      findUnique: async () => ({ id: "project-1", slug: "aurora" }),
    },
    publicReleaseSnapshot: {
      findFirst: async () => ({
        publication: { release: { projectId: "project-1" } },
      }),
      findMany: async () => [{ projectSlug: "aurora-old" }],
    },
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
  };
  return { prisma, state };
}

test("the API copy of the page config module matches the shared UI module", () => {
  const root = join(__dirname, "..", "..", "..", "..");
  const shared = readFileSync(
    join(root, "packages/ui/src/public-page/config.ts"),
    "utf8",
  );
  const mirror = readFileSync(join(__dirname, "public-page-config.ts"), "utf8");
  assert.equal(mirror, shared);
});

test("config parsing rejects unsafe links, bad colours, and duplicate widgets", () => {
  const { issues } = parsePublicPageConfig({
    theme: { backgroundColor: "red", headingFont: "comic-sans" },
    widgets: [
      { id: "hero", type: "hero" },
      { id: "hero-2", type: "hero" },
      {
        id: "links",
        type: "links",
        links: [{ label: "Docs", url: "javascript:alert(1)" }],
      },
      { id: "x", type: "iframe" },
    ],
  });
  assert.ok(issues.some((issue) => issue.includes("backgroundColor")));
  assert.ok(issues.some((issue) => issue.includes("headingFont")));
  assert.ok(issues.some((issue) => issue.includes("only one Hero")));
  assert.ok(issues.some((issue) => issue.includes("https://")));
  assert.ok(issues.some((issue) => issue.includes("supported widget")));
});

test("config parsing strips control characters and clamps lengths", () => {
  const { config, issues } = parsePublicPageConfig({
    widgets: [
      {
        id: "note",
        type: "customText",
        title: "Hello\u0000 world",
        body: `${"a".repeat(2500)}`,
      },
    ],
  });
  assert.deepEqual(issues, []);
  assert.equal(config.widgets[0]?.title, "Hello world");
  assert.equal(config.widgets[0]?.body.length, 2000);
});

test("saving a draft validates input and keeps other brand settings", async () => {
  const { prisma, state } = fakePrisma({
    settings: { customDomainVerifiedAt: "2026-11-01T00:00:00.000Z" },
  });
  const service = new PublicPageService(prisma as never);
  await assert.rejects(
    service.saveDraft(admin, "project-1", { theme: { textColor: "#12" } }),
    /not valid/,
  );
  const config = defaultPublicPageConfig();
  config.layout.template = "single";
  const result = await service.saveDraft(admin, "project-1", config);
  assert.equal(result.draft.layout.template, "single");
  assert.equal(result.published, null);
  assert.equal(result.hasUnpublishedChanges, true);
  assert.equal(
    state.settings.customDomainVerifiedAt,
    "2026-11-01T00:00:00.000Z",
  );
  assert.deepEqual(
    state.audits.map(({ action }) => action),
    ["project.public_page_draft_saved"],
  );
});

test("publishing copies the draft live and invalidates every project slug", async () => {
  const draft = defaultPublicPageConfig();
  draft.theme.radius = 4;
  const { prisma, state } = fakePrisma({
    settings: { publicPage: { draft } },
  });
  const invalidated: string[] = [];
  const service = new PublicPageService(
    prisma as never,
    {
      invalidateProject: async (slug: string) => {
        invalidated.push(slug);
      },
    } as never,
  );
  const result = await service.publish(admin, "project-1");
  assert.equal(result.published?.theme.radius, 4);
  assert.equal(result.hasUnpublishedChanges, false);
  assert.ok(result.publishedAt);
  assert.deepEqual(invalidated.sort(), ["aurora", "aurora-old"]);
  assert.deepEqual(
    state.audits.map(({ action }) => action),
    ["project.public_page_published"],
  );

  const live = await service.publicConfig("aurora");
  assert.equal(live.customized, true);
  assert.equal(live.config.theme.radius, 4);
});

test("only project administrators can change the page; clients cannot read drafts", async () => {
  const developer = new PublicPageService(
    fakePrisma({ role: "DEVELOPER" }).prisma as never,
  );
  await developer.get(admin, "project-1");
  await assert.rejects(
    developer.saveDraft(admin, "project-1", defaultPublicPageConfig()),
    /administrator/,
  );
  await assert.rejects(developer.publish(admin, "project-1"), /administrator/);
  const client = new PublicPageService(
    fakePrisma({ role: "CLIENT" }).prisma as never,
  );
  await assert.rejects(client.get(admin, "project-1"), /not found/i);
});

test("public delivery falls back to the default layout before anything is published", async () => {
  const service = new PublicPageService(fakePrisma({}).prisma as never);
  const live = await service.publicConfig("aurora");
  assert.equal(live.customized, false);
  assert.deepEqual(live.config, defaultPublicPageConfig());
});
