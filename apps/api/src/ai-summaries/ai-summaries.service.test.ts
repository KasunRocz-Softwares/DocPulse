import assert from "node:assert/strict";
import { test } from "node:test";
import { ProjectRole } from "../generated/prisma/enums";
import { AiSummaryProvider } from "./ai-summary-provider";
import { AiSummariesService } from "./ai-summaries.service";

const release = { id: "release-1", projectId: "project-1" };
const candidates = [
  {
    id: "change-public-1",
    title: "Faster exports",
    category: "IMPROVEMENT",
    publicDescription: "Exports now complete faster.",
    internalDescription: "secret-token internal roadmap",
    comment: "approval comment",
    privateDocument: "private document contents",
  },
  {
    id: "change-empty",
    title: "Empty public copy",
    category: "FIX",
    publicDescription: "   ",
  },
];

function setup(
  role: ProjectRole | null = ProjectRole.DEVELOPER,
  generated = "Exports are faster.",
) {
  const providerInput: unknown[] = [];
  const auditInput: unknown[] = [];
  const changeQuery: unknown[] = [];
  const prisma = {
    release: { findUnique: async () => release },
    projectMember: {
      findUnique: async () => (role ? { role } : null),
    },
    releaseChange: {
      findMany: async (input: unknown) => {
        changeQuery.push(input);
        return candidates;
      },
    },
    auditLog: {
      create: async (input: unknown) => {
        auditInput.push(input);
        return input;
      },
    },
  };
  const provider: AiSummaryProvider = {
    providerName: "test-provider",
    generate: async (input) => {
      providerInput.push(input);
      return { summary: generated, model: "test-model" };
    },
  };
  return {
    service: new AiSummariesService(prisma as never, provider),
    providerInput,
    auditInput,
    changeQuery,
  };
}

test("generates from nonempty public candidates and returns source provenance", async () => {
  const { service, providerInput, auditInput, changeQuery } = setup();
  const result = await service.suggest(
    { id: "user-1", isSystemAdmin: false },
    "release-1",
  );

  assert.equal(result.summary, "Exports are faster.");
  assert.deepEqual(result.sourceChangeIds, ["change-public-1"]);
  assert.equal(result.generation.provider, "test-provider");
  assert.equal(result.generation.model, "test-model");
  assert.ok(Number.isFinite(Date.parse(result.generation.generatedAt)));
  assert.equal(providerInput.length, 1);
  const sent = JSON.stringify(providerInput[0]);
  assert.match(sent, /Exports now complete faster/);
  assert.doesNotMatch(
    sent,
    /secret-token|internal roadmap|private document|approval comment/i,
  );
  assert.deepEqual(
    (changeQuery[0] as { where: Record<string, unknown> }).where.visibility,
    "PUBLIC_CANDIDATE",
  );
  assert.deepEqual(
    (changeQuery[0] as { select: Record<string, boolean> }).select,
    { id: true, title: true, category: true, publicDescription: true },
  );
  assert.doesNotMatch(
    sent,
    /internalDescription|private document|secret-token|approval comment/i,
  );
  assert.equal(auditInput.length, 1);
  const audit = JSON.stringify(auditInput[0]);
  assert.match(audit, /change-public-1/);
  assert.doesNotMatch(audit, /Exports are faster\.|secret-token/);
});

test("rejects roles outside the AI summary allowlist before calling the provider", async () => {
  const { service, providerInput, auditInput } = setup(ProjectRole.REVIEWER);

  await assert.rejects(
    service.suggest({ id: "user-1", isSystemAdmin: false }, "release-1"),
    (error: { getStatus?: () => number }) => error.getStatus?.() === 403,
  );
  assert.equal(providerInput.length, 0);
  assert.equal(auditInput.length, 0);
});

test("allows Admin, Release Manager, and Developer project memberships", async () => {
  for (const role of [
    ProjectRole.ADMIN,
    ProjectRole.RELEASE_MANAGER,
    ProjectRole.DEVELOPER,
  ]) {
    const { service } = setup(role);
    const result = await service.suggest(
      { id: "user-1", isSystemAdmin: false },
      "release-1",
    );
    assert.equal(result.summary, "Exports are faster.");
  }
});

test("does not audit or return a draft when the provider fails", async () => {
  const auditInput: unknown[] = [];
  const provider = {
    providerName: "test-provider",
    generate: async () => {
      throw new Error("provider unavailable");
    },
  };
  const failing = new AiSummariesService(
    {
      release: { findUnique: async () => release },
      projectMember: {
        findUnique: async () => ({ role: ProjectRole.DEVELOPER }),
      },
      releaseChange: { findMany: async () => candidates },
      auditLog: {
        create: async (input: unknown) => {
          auditInput.push(input);
          return input;
        },
      },
    } as never,
    provider,
  );

  await assert.rejects(
    failing.suggest({ id: "user-1", isSystemAdmin: false }, "release-1"),
    /provider unavailable/,
  );
  assert.equal(auditInput.length, 0);
});
