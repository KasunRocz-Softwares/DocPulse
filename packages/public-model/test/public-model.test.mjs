import assert from "node:assert/strict";
import test from "node:test";

import { publicProjectSchema, publicReleaseSchema } from "../dist/index.js";

test("public release DTO accepts an explicitly projected publication", () => {
  const release = {
    projectSlug: "rdps",
    projectName: "RDPS",
    version: "1.2.0",
    title: "Release",
    summary: "A public summary",
    primaryColor: "#2457c5",
    accentColor: null,
    logoUrl: null,
    locale: "en",
    defaultLocale: "en",
    publishedAt: "2026-11-10T00:00:00.000Z",
    changes: [
      {
        category: "FEATURE",
        title: "Public",
        description: "Visible",
        sortOrder: 0,
      },
    ],
    attachments: [],
  };
  assert.equal(publicReleaseSchema.safeParse(release).success, true);
});

test("public DTOs support complete BCP 47 tags and published locale options", async () => {
  const { publicProjectSchema } = await import("../dist/index.js");
  const locale = "zh-Hant-TW-u-nu-hanidec";
  const release = {
    projectSlug: "rdps",
    projectName: "RDPS",
    version: "1.2.0",
    title: "Release",
    summary: null,
    primaryColor: "#2457c5",
    accentColor: null,
    logoUrl: null,
    locale,
    defaultLocale: locale,
    availableLocales: ["en", locale],
    publishedAt: "2026-11-10T00:00:00.000Z",
    changes: [],
    attachments: [],
  };
  assert.equal(publicReleaseSchema.safeParse(release).success, true);
  assert.equal(
    publicProjectSchema.safeParse({
      slug: "rdps",
      name: "RDPS",
      releaseCount: 1,
      latestPublishedAt: "2026-11-10T00:00:00.000Z",
      primaryColor: "#2457c5",
      accentColor: null,
      logoUrl: null,
      defaultLocale: locale,
      latestRelease: {
        version: "1.2.0",
        title: "Release",
        summary: null,
        locale,
        availableLocales: ["en", locale],
        publishedAt: "2026-11-10T00:00:00.000Z",
      },
    }).success,
    true,
  );
});

test("public DTOs reject internal identities, documents, approvals and credentials", () => {
  const release = {
    projectSlug: "rdps",
    projectName: "RDPS",
    version: "1.2.0",
    title: "Release",
    summary: "Public",
    primaryColor: "#2457c5",
    accentColor: null,
    logoUrl: null,
    locale: "en",
    defaultLocale: "en",
    publishedAt: "2026-11-10T00:00:00.000Z",
    changes: [
      { category: "FIX", title: "Fix", description: "Public", sortOrder: 0 },
    ],
    attachments: [],
  };
  for (const field of [
    "authorId",
    "internalNotes",
    "approvalRevisionId",
    "accessToken",
    "internalDocuments",
    "publicationId",
  ]) {
    assert.equal(
      publicReleaseSchema.safeParse({ ...release, [field]: "private" }).success,
      false,
      field,
    );
  }
  assert.equal(
    publicReleaseSchema.safeParse({
      ...release,
      changes: [{ ...release.changes[0], internalDescription: "private" }],
    }).success,
    false,
  );

  const project = {
    slug: "rdps",
    name: "RDPS",
    releaseCount: 1,
    latestPublishedAt: "2026-11-10T00:00:00.000Z",
    primaryColor: "#2457c5",
    accentColor: null,
    logoUrl: null,
    defaultLocale: "en",
    latestRelease: {
      version: "1.2.0",
      title: "Release",
      summary: null,
      locale: "en",
      publishedAt: "2026-11-10T00:00:00.000Z",
    },
  };
  assert.equal(
    publicProjectSchema.safeParse({ ...project, members: [] }).success,
    false,
  );
});
