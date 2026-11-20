import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectSubscriptionsPanelView } from "./project-subscriptions-view.ts";

const noop = () => {};

function render(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(ProjectSubscriptionsPanelView, {
      scope: "project",
      releases: [],
      selectedReleaseId: "",
      subscriptions: [],
      loadingReleases: false,
      loadingSubscriptions: false,
      releaseError: "",
      error: "",
      notice: "",
      savingId: "",
      onScopeChange: noop,
      onReleaseChange: noop,
      onRefresh: noop,
      onPreferenceChange: noop,
      ...overrides,
    }),
  );
}

test("subscription panel view exposes project and release scopes", () => {
  const markup = render({
    releases: [{ id: "release-1", version: "2.4.0", title: "April release" }],
  });

  assert.match(markup, /Project-wide/);
  assert.match(markup, /Release-specific/);
  assert.match(markup, /Refresh/);
});

test("release scope view renders release loading, error, and empty states", () => {
  assert.match(
    render({ scope: "release", loadingReleases: true }),
    /Loading project releases/,
  );
  assert.match(
    render({ scope: "release", releaseError: "Could not load releases" }),
    /Could not load releases/,
  );
  assert.match(
    render({ scope: "release", releases: [] }),
    /No releases available/,
  );
});

test("subscription summary shows active, verified, and delivery totals", () => {
  const markup = render({
    subscriptions: [
      {
        id: "one",
        email: "one@example.test",
        locale: "en",
        preferences: { newReleases: true },
        verifiedAt: "2026-11-01T00:00:00.000Z",
        unsubscribedAt: null,
        _count: { deliveries: 3 },
      },
      {
        id: "two",
        email: "two@example.test",
        locale: "en",
        preferences: { securityOnly: true },
        verifiedAt: null,
        unsubscribedAt: "2026-11-02T00:00:00.000Z",
        _count: { deliveries: 2 },
      },
    ],
  });

  assert.match(markup, /Active subscribers/);
  assert.match(markup, /<strong>1<\/strong>/);
  assert.match(markup, /Verified subscribers/);
  assert.match(markup, /Total deliveries/);
  assert.match(markup, /<strong>5<\/strong>/);
});

test("release scope view keeps preference controls and renders subscriber loading and errors", () => {
  assert.match(
    render({
      scope: "release",
      selectedReleaseId: "r1",
      loadingSubscriptions: true,
    }),
    /Loading release subscribers/,
  );
  assert.match(
    render({
      scope: "release",
      selectedReleaseId: "r1",
      error: "Subscriber list failed",
    }),
    /Subscriber list failed/,
  );
  assert.match(
    render({ scope: "release", selectedReleaseId: "r1" }),
    /No subscribers yet/,
  );
});
