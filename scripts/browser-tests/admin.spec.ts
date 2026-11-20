import { expect, test, type Page } from "@playwright/test";
import {
  expectNavigationWithinBudget,
  expectNoHorizontalOverflow,
  recordAxeAudit,
} from "./a11y";

const adminUrl = process.env.RDPS_BROWSER_ADMIN_URL ?? "http://127.0.0.1:4173";

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile-320", width: 320, height: 740 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-460", width: 460, height: 900 },
] as const;

const project = {
  id: "project-northstar",
  name: "Northstar",
  slug: "northstar",
  description: "Northstar release workspace",
  status: "ACTIVE",
  createdAt: "2026-10-01T12:00:00.000Z",
};

const editorUser = {
  id: "user-1",
  email: "editor@example.test",
  displayName: "Release Editor",
  isSystemAdmin: true,
};

function draftRelease(id = "release-1") {
  return {
    id,
    projectId: project.id,
    project,
    version: "2.4.0",
    title: "Quarterly API",
    type: "MINOR",
    channel: "STABLE",
    status: "DRAFT",
    releaseDate: "2026-11-10T00:00:00.000Z",
    internalSummary: "Internal rollout summary",
    updatedAt: "2026-11-10T12:00:00.000Z",
    changes: [],
    deployments: [],
  };
}

const initialDraftRelease = {
  ...draftRelease("release-existing"),
  version: "2.3.1",
  title: "December maintenance",
  releaseDate: "2026-12-15T00:00:00.000Z",
};

async function installAdminWorkspaceMock(page: Page) {
  const releases: Array<ReturnType<typeof draftRelease>> = [
    initialDraftRelease,
  ];
  const changes = new Map<string, Record<string, unknown>[]>();
  await page.route("http://127.0.0.1:13001/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1", "");
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });

    if (path === "/internal/auth/login" && method === "POST") {
      await json({
        accessToken: "browser-workspace-token",
        user: editorUser,
      });
      return;
    }
    if (path === "/internal/auth/me" && method === "GET") {
      await json(editorUser);
      return;
    }
    if (path === "/internal/projects" && method === "GET") {
      await json([project]);
      return;
    }
    if (path === `/internal/projects/${project.id}` && method === "GET") {
      await json(project);
      return;
    }
    if (path.endsWith("/analytics") && method === "GET") {
      await json({ totals: { projectViews: 0, releaseViews: 0 }, daily: [] });
      return;
    }
    if (path.endsWith("/analytics/exports") && method === "GET") {
      await json([]);
      return;
    }
    if (path.endsWith("/integration-operations") && method === "GET") {
      await json({
        counts: { failed: 2 },
        events: [],
        truncated: false,
        scannedJobs: 0,
      });
      return;
    }
    if (path.endsWith("/integration-suggestions") && method === "GET") {
      await json([]);
      return;
    }
    if (path.endsWith("/github-app") && method === "GET") {
      await json({ configured: false, webhookPath: "", connections: [] });
      return;
    }
    if (path.endsWith("/audit") && method === "GET") {
      await json({ items: [], page: 1, pageSize: 20, total: 0 });
      return;
    }
    if (path.endsWith("/audit/export.csv") && method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "text/csv",
        headers: {
          "content-disposition": 'attachment; filename="project-audit.csv"',
        },
        body: 'action,createdAt\\n"release.published","2026-11-12T10:00:00.000Z"',
      });
      return;
    }
    if (path.endsWith("/subscriptions") && method === "GET") {
      await json([]);
      return;
    }
    if (
      ["/members", "/repositories", "/environments", "/client-audiences"].some(
        (suffix) => path.endsWith(suffix),
      ) &&
      method === "GET"
    ) {
      await json([]);
      return;
    }
    if (
      path === `/internal/projects/${project.id}/releases` &&
      method === "GET"
    ) {
      await json(releases);
      return;
    }
    if (
      path === `/internal/projects/${project.id}/releases` &&
      method === "POST"
    ) {
      const body = request.postDataJSON() as Record<string, unknown>;
      // Mirror the API: a blank date string is invalid (omit it instead).
      if (body.releaseDate === "") {
        await json(
          { message: ["releaseDate must be a valid ISO 8601 date string"] },
          400,
        );
        return;
      }
      const release = {
        ...draftRelease(),
        id: "release-created",
        version: String(body.version),
        title: String(body.title),
        type: String(body.type),
        channel: String(body.channel),
      };
      releases.push(release);
      await json(release, 201);
      return;
    }
    if (
      path === `/internal/projects/${project.id}/releases/compare` &&
      method === "GET"
    ) {
      await json({
        from: { id: "release-existing", version: "2.3.1", title: "Previous" },
        to: { id: "release-created", version: "2.4.0", title: "Current" },
        changes: {
          added: [{ title: "Added change", category: "FEATURE" }],
          removed: [],
          updated: [],
        },
      });
      return;
    }
    if (
      path === `/internal/projects/${project.id}/releases/compare/export` &&
      method === "GET"
    ) {
      const format = url.searchParams.get("format") ?? "csv";
      await route.fulfill({
        status: 200,
        contentType: format === "json" ? "application/json" : "text/csv",
        headers: {
          "content-disposition": `attachment; filename="release-comparison.${format}"`,
        },
        body:
          format === "json"
            ? JSON.stringify({
                changes: { added: [], removed: [], updated: [] },
              })
            : '"From version","To version"\r\n"2.3.1","2.4.0"',
      });
      return;
    }
    const releaseMatch = path.match(/^\/internal\/releases\/([^/]+)$/);
    if (releaseMatch && method === "GET") {
      await json(releases.find((item) => item.id === releaseMatch[1]) ?? {});
      return;
    }
    const changeMatch = path.match(/^\/internal\/releases\/([^/]+)\/changes$/);
    if (changeMatch && method === "POST") {
      const items = changes.get(changeMatch[1]) ?? [];
      const input = request.postDataJSON() as Record<string, unknown>;
      items.push({
        ...input,
        id: "change-1",
        sortOrder: items.length,
        visibility: input.publicDescription ? "PUBLIC" : "INTERNAL",
      });
      changes.set(changeMatch[1], items);
      const release = releases.find((item) => item.id === changeMatch[1]);
      if (release) release.changes = items as typeof release.changes;
      await json({ id: "change-1" }, 201);
      return;
    }
    const bulkChangeMatch = path.match(
      /^\/internal\/releases\/([^/]+)\/changes\/bulk$/,
    );
    if (bulkChangeMatch && method === "PATCH") {
      const body = request.postDataJSON() as {
        changes: Array<Record<string, unknown>>;
      };
      const release = releases.find((item) => item.id === bulkChangeMatch[1]);
      if (release) {
        release.changes = (release.changes ?? []).map((change, sortOrder) => {
          const update = body.changes.find((item) => item.id === change.id);
          return {
            ...change,
            ...update,
            sortOrder,
          } as (typeof release.changes)[number];
        });
        await json(release.changes);
      } else {
        await json([]);
      }
      return;
    }
    await json({});
  });
}

async function openAdmin(page: Page, viewport: (typeof viewports)[number]) {
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await page.route("http://127.0.0.1:13001/api/v1/**", async (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Invalid email or password" }),
    }),
  );
  await page.goto(`${adminUrl}/`);
  await expectNavigationWithinBudget(page);
  await expect(
    page.getByRole("heading", { name: "Sign in to RDPS" }),
  ).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveAttribute("type", "email");
  await expect(page.getByLabel("Password")).toHaveAttribute("type", "password");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Work email")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  await expectNoHorizontalOverflow(page);
}

for (const viewport of viewports) {
  test(`admin sign-in smoke flow at ${viewport.name}`, async ({ page }) => {
    await openAdmin(page, viewport);
    await page.getByLabel("Work email").fill("browser-check@example.test");
    await page.getByLabel("Password").fill("ci-browser-check-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByText("Your session has expired. Sign in again to continue."),
    ).toBeVisible();
  });

  test(`admin full axe audit at ${viewport.name}`, async ({ page }) => {
    await openAdmin(page, viewport);
    await recordAxeAudit(page, "admin", viewport.name);
  });
}

test("admin creates a release and adds a structured change", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installAdminWorkspaceMock(page);
  await page.goto(`${adminUrl}/`);
  await page.getByLabel("Work email").fill("editor@example.test");
  await page.getByLabel("Password").fill("browser-check-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByRole("heading", { name: "Release desk" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Upcoming releases" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Draft releases" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Failed integrations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /December maintenance/ }).first(),
  ).toBeVisible();
  await expect(page.getByText("2 failed events").first()).toBeVisible();
  await recordAxeAudit(page, "admin-dashboard", "desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await recordAxeAudit(page, "admin-dashboard", "mobile-390");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("button", { name: /Northstar/ })
    .first()
    .click();
  await page.getByRole("button", { name: "New release" }).click();
  await page.getByLabel("Version").fill("2.4.0");
  await page.getByLabel("Release title").fill("Quarterly API");
  await page.getByRole("button", { name: "Create release" }).click();
  await expect(
    page.getByRole("heading", { name: "2.4.0 · Quarterly API" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Add change/ }).click();
  await page.getByLabel("Change title").fill("Safer token rotation");
  const releaseUrl = page.url();
  await page.getByRole("link", { name: "Skip to main content" }).focus();
  await page.getByRole("link", { name: "Skip to main content" }).press("Enter");
  await expect(page).toHaveURL(releaseUrl);
  await expect(page.locator("#main")).toBeFocused();
  await page.getByRole("tab", { name: "Notes & review" }).focus();
  await page.getByRole("tab", { name: "Notes & review" }).press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Details & comparison" }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Details & comparison" }).press("Home");
  await expect(page.getByLabel("Change title")).toHaveValue(
    "Safer token rotation",
  );
  await page
    .getByLabel("Internal description")
    .fill("Rotated credentials safely.");
  await page
    .getByLabel("Public description")
    .fill("Rotate API tokens without downtime.");
  await page.getByRole("button", { name: "Add change" }).last().click();
  await expect(page.getByText("Change added.")).toBeVisible();
  await page.getByLabel("Select change Safer token rotation").check();
  await page.getByLabel("Bulk category").selectOption("SECURITY");
  await page.getByLabel("Bulk visibility").selectOption("PUBLIC");
  await page.getByRole("button", { name: "Apply to selected" }).click();
  await expect(page.getByText("Selected changes updated.")).toBeVisible();
  await recordAxeAudit(page, "admin-release", "desktop");
  await page.setViewportSize({ width: 320, height: 740 });
  await expectNoHorizontalOverflow(page);
  await recordAxeAudit(page, "admin-release", "mobile-320");
});

test("admin exports an authorized release comparison as CSV and JSON", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installAdminWorkspaceMock(page);
  await page.goto(`${adminUrl}/`);
  await page.getByLabel("Work email").fill("editor@example.test");
  await page.getByLabel("Password").fill("browser-check-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Release desk" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Northstar/ })
    .first()
    .click();
  await page.getByRole("button", { name: "New release" }).click();
  await page.getByLabel("Version").fill("2.4.0");
  await page.getByLabel("Release title").fill("Quarterly API");
  await page.getByRole("button", { name: "Create release" }).click();
  await page.getByRole("tab", { name: "Details & comparison" }).click();
  await expect(
    page.getByRole("heading", { name: "Release administration" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Comparison result" }),
  ).toBeVisible();

  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await csvDownload).suggestedFilename()).toBe(
    "release-comparison.csv",
  );
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  expect((await jsonDownload).suggestedFilename()).toBe(
    "release-comparison.json",
  );
});

test("admin exports project audit history as CSV", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = createObjectURL(blob);
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      revokeObjectURL(url);
    };
    Object.assign(window, { __auditDownloadUrls: { created, revoked } });
  });
  await installAdminWorkspaceMock(page);
  await page.goto(`${adminUrl}/`);
  await page.getByLabel("Work email").fill("editor@example.test");
  await page.getByLabel("Password").fill("browser-check-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Release desk" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Northstar/ })
    .first()
    .click();
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(
    page.getByRole("heading", { name: "Audit history" }),
  ).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export audit CSV" }).click();
  expect((await download).suggestedFilename()).toBe("project-audit.csv");
  await expect(page.getByText("Project audit CSV exported.")).toBeVisible();
  const urls = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __auditDownloadUrls: { created: string[]; revoked: string[] };
        }
      ).__auditDownloadUrls,
  );
  expect(urls.created).toHaveLength(1);
  expect(urls.revoked).toEqual(urls.created);

  await page.route(
    "http://127.0.0.1:13001/api/v1/internal/projects/project-northstar/audit/export.csv",
    async (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Audit export unavailable" }),
      }),
  );
  await page.getByRole("button", { name: "Export audit CSV" }).click();
  await expect(page.getByText("Audit export unavailable")).toBeVisible();
});

test("project admins design, save, and publish the public page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installAdminWorkspaceMock(page);
  const saved: unknown[] = [];
  let published = 0;
  let state: Record<string, unknown> | null = null;
  await page.route(
    `http://127.0.0.1:13001/api/v1/internal/projects/${project.id}/public-page**`,
    async (route) => {
      const request = route.request();
      const json = (body: unknown) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      if (request.method() === "PUT") {
        const body = request.postDataJSON() as { config: unknown };
        saved.push(body.config);
        state = {
          draft: body.config,
          published: null,
          draftUpdatedAt: "2026-11-18T10:00:00.000Z",
          publishedAt: null,
          hasUnpublishedChanges: true,
        };
        await json(state);
        return;
      }
      if (request.method() === "POST") {
        published += 1;
        state = {
          ...state!,
          published: state!.draft,
          publishedAt: "2026-11-18T10:05:00.000Z",
          hasUnpublishedChanges: false,
        };
        await json(state);
        return;
      }
      await json(
        state ?? {
          draft: undefined,
          published: null,
          draftUpdatedAt: null,
          publishedAt: null,
          hasUnpublishedChanges: false,
        },
      );
    },
  );
  await page.goto(`${adminUrl}/`);
  await page.getByLabel("Work email").fill("editor@example.test");
  await page.getByLabel("Password").fill("browser-check-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page
    .getByRole("button", { name: /Northstar/ })
    .first()
    .click();
  await page.getByRole("tab", { name: "Public page" }).click();
  await expect(
    page.getByRole("heading", { name: "Public page designer" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#\/projects\/project-northstar\/public-page$/);

  const preview = page.getByRole("region", {
    name: "Live preview of the public page",
  });
  // The preview is inert (hidden from assistive tech); query it by text.
  await expect(preview.locator(".pp-hero h1")).toHaveText("Northstar");

  // Clicking a widget in the preview opens it in the widget list.
  const latestBox = await preview
    .locator('[data-widget-id="latestRelease"]')
    .boundingBox();
  await page.mouse.click(
    latestBox!.x + latestBox!.width / 2,
    latestBox!.y + Math.min(40, latestBox!.height / 2),
  );
  await expect(
    page.getByRole("button", { name: /Latest release/, expanded: true }),
  ).toBeVisible();

  // Hide the subscription widget and move "Recent releases" to the top.
  await page.getByLabel("Show Email subscription").uncheck();
  await expect(preview.getByText("Get release notes by email")).toHaveCount(0);
  await page.getByRole("button", { name: "Move Recent releases up" }).click();
  await page.getByRole("button", { name: "Move Recent releases up" }).click();

  await page.getByRole("tab", { name: "Layout" }).click();
  await page.getByText("Single column", { exact: true }).click();
  await page.getByRole("tab", { name: "Style" }).click();
  await page.getByRole("button", { name: "Midnight" }).click();
  await expect(preview.locator(".pp-root")).toHaveCSS(
    "background-color",
    "rgb(15, 20, 32)",
  );
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await recordAxeAudit(page, "admin-public-page-designer", "desktop");

  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved.")).toBeVisible();
  const config = saved.at(-1) as {
    layout: { template: string };
    theme: { backgroundColor: string };
    widgets: Array<{ type: string; enabled: boolean }>;
  };
  expect(config.layout.template).toBe("single");
  expect(config.theme.backgroundColor).toBe("#0f1420");
  expect(config.widgets[0]?.type).toBe("recentReleases");
  expect(
    config.widgets.find((widget) => widget.type === "subscribe")?.enabled,
  ).toBe(false);

  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(/^Published\./)).toBeVisible();
  expect(published).toBe(1);
  await expect(page.getByText(/Live since/)).toBeVisible();
});

test("system admins manage users, password links, and see role permissions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await installAdminWorkspaceMock(page);
  const patches: Array<{ id: string; body: unknown }> = [];
  let linksIssued = 0;
  const people = [
    {
      id: "user-1",
      email: "editor@example.test",
      displayName: "Release Editor",
      status: "ACTIVE",
      isSystemAdmin: true,
      createdAt: "2026-10-01T00:00:00.000Z",
      hasPassword: true,
      signInMethods: ["password"],
      activeSessions: 1,
      lastActiveAt: new Date().toISOString(),
      pendingPasswordLinkExpiresAt: null,
      memberships: [
        {
          id: "m-1",
          role: "ADMIN",
          project: { id: project.id, name: project.name, slug: project.slug },
        },
      ],
    },
    {
      id: "user-2",
      email: "reviewer@example.test",
      displayName: "Demo Reviewer",
      status: "INVITED",
      isSystemAdmin: false,
      createdAt: "2026-11-18T00:00:00.000Z",
      hasPassword: false,
      signInMethods: [],
      activeSessions: 0,
      lastActiveAt: null,
      pendingPasswordLinkExpiresAt: null,
      memberships: [
        {
          id: "m-2",
          role: "REVIEWER",
          project: { id: project.id, name: project.name, slug: project.slug },
        },
      ],
    },
  ];
  await page.route(
    "http://127.0.0.1:13001/api/v1/internal/users**",
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const json = (body: unknown) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      if (url.pathname.endsWith("/password-link")) {
        linksIssued += 1;
        await json({
          token: "one-time-token-value-for-browser-check-0000000",
          expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        });
        return;
      }
      if (request.method() === "PATCH") {
        const id = url.pathname.split("/").pop()!;
        const body = request.postDataJSON() as Record<string, unknown>;
        patches.push({ id, body });
        Object.assign(
          people.find((person) => person.id === id)!,
          body,
        );
        await json(people.find((person) => person.id === id));
        return;
      }
      await json(people);
    },
  );

  await page.goto(`${adminUrl}/`);
  await page.getByLabel("Work email").fill("editor@example.test");
  await page.getByLabel("Password").fill("browser-check-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Users & roles" }).click();
  await expect(
    page.getByRole("heading", { name: "Users & roles" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Demo Reviewer/ }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Invited\s*1/ }).click();
  await expect(
    page.getByRole("button", { name: /Release Editor/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Demo Reviewer/ }).click();
  await expect(
    page.getByRole("heading", { name: "Set up sign-in" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create sign-up link" }).click();
  await expect(page.getByLabel("One-time password link")).toHaveValue(
    /#\/reset-password\?token=one-time-token-value/,
  );
  expect(linksIssued).toBe(1);
  await recordAxeAudit(page, "admin-users", "desktop");

  await page.getByRole("button", { name: "Suspend user…" }).click();
  await page.getByRole("button", { name: "Suspend user", exact: true }).click();
  await expect(page.getByText("User suspended.")).toBeVisible();
  expect(patches.at(-1)).toEqual({
    id: "user-2",
    body: { status: "SUSPENDED" },
  });

  // You cannot remove your own access.
  await page.getByRole("button", { name: /All\s*2/ }).click();
  await page.getByRole("button", { name: /Release Editor/ }).click();
  await expect(page.getByLabel(/System administrator/)).toBeDisabled();

  await page.getByRole("tab", { name: "Role permissions" }).click();
  await expect(
    page.getByRole("heading", { name: "Role permissions" }),
  ).toBeVisible();
  const publishRow = page.getByRole("row", { name: /Publish and unpublish/ });
  await expect(publishRow.getByText("Allowed", { exact: true })).toHaveCount(3);
});

test("a one-time password link sets the password and signs the user in", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installAdminWorkspaceMock(page);
  let completed: unknown = null;
  await page.route(
    "http://127.0.0.1:13001/api/v1/internal/auth/password-reset/complete",
    async (route) => {
      completed = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ accessToken: "reset-token", user: editorUser }),
      });
    },
  );
  await page.goto(
    `${adminUrl}/#/reset-password?token=link-token-value-for-browser-check-000000`,
  );
  await expect(
    page.getByRole("heading", { name: "Set a new password" }),
  ).toBeVisible();
  await expect(page.getByLabel("Work email")).toHaveCount(0);
  await page.locator('input[name="password"]').fill("a-brand-new-password");
  await page.getByLabel("Confirm password").fill("a-different-password");
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByText("The two passwords do not match.")).toBeVisible();
  expect(completed).toBeNull();
  await page.getByLabel("Confirm password").fill("a-brand-new-password");
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Release desk" }),
  ).toBeVisible();
  expect(completed).toEqual({
    token: "link-token-value-for-browser-check-000000",
    password: "a-brand-new-password",
  });
});

test("approved revisions show a Publish button on the review desk", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installAdminWorkspaceMock(page);
  let ready = [
    {
      id: "revision-approved",
      revision: 1,
      releaseId: "release-existing",
      createdAt: "2026-11-18T09:33:37.000Z",
      release: {
        id: "release-existing",
        version: "2.3.1",
        title: "December maintenance",
        projectId: project.id,
        project: { name: project.name, slug: project.slug },
      },
      decisions: [{ id: "d-1", createdAt: "2026-11-18T09:51:53.000Z" }],
    },
  ];
  let publishPath = "";
  await page.route(
    "http://127.0.0.1:13001/api/v1/internal/approval-revisions/ready-to-publish",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(ready),
      }),
  );
  await page.route(
    "http://127.0.0.1:13001/api/v1/internal/releases/*/approval-revisions/*/publish",
    async (route) => {
      publishPath = new URL(route.request().url()).pathname;
      ready = [];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ id: "publication-1" }),
      });
    },
  );
  await page.goto(`${adminUrl}/`);
  await page.getByLabel("Work email").fill("editor@example.test");
  await page.getByLabel("Password").fill("browser-check-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Review desk" }).click();
  await expect(
    page.getByRole("heading", { name: "Ready to publish" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Publish 2.3.1" }).click();
  await expect(page.getByText("Northstar 2.3.1 is live.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /View public page/ }),
  ).toHaveAttribute("href", /\/projects\/northstar\/releases\/2\.3\.1$/);
  expect(publishPath).toBe(
    "/api/v1/internal/releases/release-existing/approval-revisions/revision-approved/publish",
  );
  await expect(page.getByRole("button", { name: "Publish 2.3.1" })).toHaveCount(
    0,
  );
});
