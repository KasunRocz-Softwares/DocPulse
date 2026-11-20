import { expect, test, type Page } from "@playwright/test";
import {
  expectNavigationWithinBudget,
  expectNoHorizontalOverflow,
  recordAxeAudit,
} from "./a11y";

const viewports = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "mobile-320", width: 320, height: 740 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-460", width: 460, height: 900 },
] as const;

const publishedProject = {
  slug: "northstar",
  name: "Northstar",
  releaseCount: 1,
  latestPublishedAt: "2026-11-10T12:00:00.000Z",
  defaultLocale: "en",
  availableLocales: ["en", "fr"],
  latestRelease: {
    projectSlug: "northstar",
    projectName: "Northstar",
    version: "2.4.0",
    title: "Safer releases",
    summary: "A simpler and safer release process.",
    locale: "en",
    defaultLocale: "en",
    availableLocales: ["en", "fr"],
    publishedAt: "2026-11-10T12:00:00.000Z",
  },
};

const publishedRelease = {
  id: "release-public-1",
  projectSlug: "northstar",
  projectName: "Northstar",
  version: "2.4.0",
  title: "Safer releases",
  summary: "A simpler and safer release process.",
  locale: "en",
  defaultLocale: "en",
  availableLocales: ["en", "fr"],
  publishedAt: "2026-11-10T12:00:00.000Z",
  changes: [
    {
      category: "IMPROVEMENT",
      title: "Safer token rotation",
      description: "Rotate API tokens without downtime.",
      sortOrder: 0,
    },
  ],
  attachments: [
    {
      id: "attachment-1",
      fileName: "release-guide.pdf",
      contentType: "application/pdf",
      sizeBytes: "2048",
      checksumSha256: "a".repeat(64),
      downloadUrl: "/attachments/attachment-1/download",
    },
  ],
};

async function installPublishedProjectMock(page: Page) {
  await page.route("http://127.0.0.1:13001/api/v1/public/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith("/analytics/events")) {
      await route.fulfill({ status: 202, body: "{}" });
      return;
    }
    if (url.pathname.endsWith("/projects")) {
      const query = url.searchParams.get("q") ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          page: 1,
          pageSize: 20,
          total: query ? 0 : 1,
          totalPages: query ? 0 : 1,
          query,
          results: query ? [] : [publishedProject],
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/projects/northstar")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(publishedProject),
      });
      return;
    }
    if (url.pathname.endsWith("/projects/northstar/releases/2.4.0")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(publishedRelease),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });
}

async function openProjectPage(
  page: Page,
  viewport: (typeof viewports)[number],
) {
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height,
  });
  await installPublishedProjectMock(page);
  await page.goto("http://127.0.0.1:4174/projects/northstar");
  await expectNavigationWithinBudget(page);
  await expect(
    page.getByRole("heading", { name: "Northstar", exact: true }),
  ).toBeVisible();
  const skipLink = page.getByRole("link", { name: /skip to content/i });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
}

for (const viewport of viewports) {
  test(`public has no shared project directory at ${viewport.name}`, async ({
    page,
  }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    const listRequests: string[] = [];
    await installPublishedProjectMock(page);
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/public/projects"))
        listRequests.push(request.url());
    });
    for (const path of ["/", "/projects", "/projects?q=north"]) {
      await page.goto(`http://127.0.0.1:4174${path}`);
      await expect(
        page.getByRole("heading", { name: "This page isn’t available" }),
      ).toBeVisible();
      await expect(page.getByRole("link", { name: "Northstar" })).toHaveCount(
        0,
      );
      await expect(page.getByText(/all projects/i)).toHaveCount(0);
    }
    expect(listRequests).toEqual([]);
    expect(await page.title()).toBe("Page not found · RDPS");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex",
    );
    await expectNoHorizontalOverflow(page);
    await recordAxeAudit(page, "public-not-found", viewport.name);
  });

  test(`public project page axe audit at ${viewport.name}`, async ({
    page,
  }) => {
    await openProjectPage(page, viewport);
    await expect(page.getByText(/all projects/i)).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await recordAxeAudit(page, "public", viewport.name);
  });
}

test("public visitors can open a published release and its attachment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await installPublishedProjectMock(page);
  await page.goto("http://127.0.0.1:4174/projects/northstar");
  await expect(
    page.getByRole("heading", { name: "Northstar", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Read release notes/ }).click();
  await expect(
    page.getByRole("heading", { name: "Safer releases" }),
  ).toBeVisible();
  await expect(
    page.getByText("Rotate API tokens without downtime."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "release-guide.pdf" }),
  ).toHaveAttribute("href", /attachments\/attachment-1\/download/);
  await expectNoHorizontalOverflow(page);
  await recordAxeAudit(page, "public-release", "mobile-320");
});

test("client release portal pages audience-scoped release history", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route(
    "http://127.0.0.1:13001/api/v1/internal/auth/login",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ accessToken: "browser-test-token" }),
      });
    },
  );
  await page.route(
    "http://127.0.0.1:13001/api/v1/client/projects/northstar/releases**",
    async (route) => {
      const url = new URL(route.request().url());
      requests.push(url.search);
      const pageNumber = Number(url.searchParams.get("page"));
      const version = pageNumber === 2 ? "1.0.0" : "2.0.0";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          audience: { id: "audience-1", name: "Northwind" },
          pagination: {
            page: pageNumber,
            pageSize: 20,
            total: 21,
            totalPages: 2,
          },
          releases: [
            {
              projectSlug: "northstar",
              projectName: "Northstar",
              version,
              title: `Release ${version}`,
              summary: null,
              publishedAt: "2026-11-10T12:00:00.000Z",
              changes: [],
              attachments: [],
            },
          ],
        }),
      });
    },
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:4174/client/northstar");
  await page.getByLabel("Email").fill("client@example.test");
  await page.getByLabel("Password").fill("browser-test-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Northwind", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Release 2.0.0" }),
  ).toBeVisible();
  await expect(page.getByText("Page 1 of 2")).toBeVisible();
  await recordAxeAudit(page, "client-release-portal", "mobile-390");

  await page.getByRole("button", { name: "Next" }).click();
  await expect(
    page.getByRole("heading", { name: "Release 1.0.0" }),
  ).toBeVisible();
  await expect(page.getByText("Page 2 of 2")).toBeVisible();
  expect(requests).toContain("?page=2&pageSize=20");
  await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
});

test("public project pages follow the published page design", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installPublishedProjectMock(page);
  await page.route(
    "http://127.0.0.1:13001/api/v1/public/projects/northstar/page",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          customized: true,
          config: {
            version: 1,
            theme: {
              backgroundColor: "#0f1420",
              surfaceColor: "#171e2e",
              textColor: "#e8edf7",
              mutedColor: "#9aa6bd",
              borderColor: "#283247",
              headingFont: "georgia",
              baseFontSize: 18,
            },
            layout: { template: "single", headerStyle: "centered" },
            widgets: [
              {
                id: "intro",
                type: "customText",
                title: "Status updates",
                body: "We ship every two weeks.",
              },
              { id: "hero", type: "hero", title: "Northstar updates" },
              { id: "latestRelease", type: "latestRelease" },
              { id: "subscribe", type: "subscribe", enabled: false },
              {
                id: "links",
                type: "links",
                links: [
                  { label: "Status page", url: "https://status.example.test" },
                ],
              },
            ],
          },
        }),
      }),
  );
  await page.goto("http://127.0.0.1:4174/projects/northstar");
  await expect(
    page.getByRole("heading", { name: "Northstar updates" }),
  ).toBeVisible();
  const headings = await page.locator(".pp-page :is(h1, h2)").allTextContents();
  // The hero lives in the full-width top region; main widgets follow in list order.
  expect(headings.slice(0, 3)).toEqual([
    "Northstar updates",
    "Status updates",
    "Safer releases",
  ]);
  await expect(
    page.getByRole("heading", { name: "Get release notes by email" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Status page/ })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await expect(page.locator(".site-shell")).toHaveCSS(
    "background-color",
    "rgb(15, 20, 32)",
  );
  await expect(page.locator(".site-shell")).toHaveCSS("font-size", "18px");
  await recordAxeAudit(page, "public-custom-page", "desktop");
  await expectNoHorizontalOverflow(page);
});

test("release pages show the release date and skip descriptions that repeat the title", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await installPublishedProjectMock(page);
  await page.route(
    "http://127.0.0.1:13001/api/v1/public/projects/northstar/releases/2.4.0*",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...publishedRelease,
          releaseDate: "2026-11-04T10:15:00.000Z",
          changes: [
            {
              category: "FEATURE",
              title: "Courier delivery performance report",
              description: "Courier delivery performance report.",
              sortOrder: 0,
            },
            {
              category: "IMPROVEMENT",
              title: "Safer token rotation",
              description: "Rotate API tokens without downtime.",
              sortOrder: 1,
            },
          ],
        }),
      }),
  );
  await page.goto("http://127.0.0.1:4174/projects/northstar/releases/2.4.0");
  await expect(page.locator(".release-detail > time")).toHaveText(
    "Released November 4, 2026",
  );
  await expect(
    page.getByText("Courier delivery performance report", { exact: false }),
  ).toHaveCount(1);
  await expect(
    page.getByText("Rotate API tokens without downtime."),
  ).toBeVisible();
});
