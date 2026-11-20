import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const axeTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

export async function recordAxeAudit(
  page: Page,
  surface: string,
  viewport: string,
) {
  const results = await new AxeBuilder({ page }).withTags(axeTags).analyze();
  const rawResults = JSON.stringify(
    { surface, viewport, tags: axeTags, violations: results.violations },
    null,
    2,
  );
  const summary = results.violations.flatMap((violation) =>
    violation.nodes.map(
      (node) =>
        `${violation.id} (${violation.impact ?? "impact unavailable"}): ${node.target.join(" ")} — ${node.failureSummary ?? violation.help}`,
    ),
  );

  await test.info().attach(`axe-${surface}-${viewport}.json`, {
    body: rawResults,
    contentType: "application/json",
  });
  test.info().annotations.push({
    type: "axe-raw-audit",
    description:
      summary.length === 0
        ? "No violations reported for the configured WCAG tags."
        : summary.join("\n"),
  });
  if (summary.length > 0)
    console.warn(
      `[axe raw audit: ${surface}/${viewport}]\n${summary.join("\n")}`,
    );
  expect(
    results.violations,
    `Full axe WCAG audit reported violations for ${surface}/${viewport}`,
  ).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(100);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    overflowElements: Array.from(document.body.querySelectorAll("*"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className:
            typeof element.className === "string" ? element.className : "",
          right: Math.round(rect.right),
          text: element.textContent?.trim().slice(0, 80) ?? "",
        };
      })
      .filter(
        (element) => element.right > document.documentElement.clientWidth + 1,
      )
      .slice(0, 8),
  }));
  test.info().annotations.push({
    type: "layout-width",
    description: `viewport=${dimensions.viewport}px, document=${dimensions.document}px`,
  });
  if (dimensions.document > dimensions.viewport) {
    throw new Error(
      `Horizontal overflow: document width ${dimensions.document}px exceeds viewport width ${dimensions.viewport}px; overflowing elements: ${JSON.stringify(dimensions.overflowElements)}`,
    );
  }
}

export async function expectNavigationWithinBudget(page: Page) {
  const duration = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    return navigation
      ? navigation.domContentLoadedEventEnd - navigation.fetchStart
      : 0;
  });
  test.info().annotations.push({
    type: "load-budget",
    description: `DOMContentLoaded ${Math.round(duration)}ms / 5000ms budget`,
  });
  if (duration > 5000)
    throw new Error(
      `DOMContentLoaded exceeded 5000ms: ${Math.round(duration)}ms`,
    );
}
