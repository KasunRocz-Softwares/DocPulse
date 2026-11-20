import { randomBytes } from "node:crypto";

const baseUrl = (
  process.env.RDPS_E2E_API_URL ?? "http://localhost:13001/api/v1"
).replace(/\/$/, "");
const adminEmail = process.env.RDPS_E2E_ADMIN_EMAIL;
const adminPassword = process.env.RDPS_E2E_ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  throw new Error(
    "Set RDPS_E2E_ADMIN_EMAIL and RDPS_E2E_ADMIN_PASSWORD for the local Docker administrator.",
  );
}

const runId = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const request = async (
  path,
  { token, method = "GET", body, expected = 200, headers = {} } = {},
) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const result = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  if (response.status !== expected) {
    throw new Error(
      `${method} ${path}: expected HTTP ${expected}, got ${response.status}: ${JSON.stringify(result)}`,
    );
  }
  return result;
};

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const admin = await request("/internal/auth/login", {
  method: "POST",
  body: { email: adminEmail, password: adminPassword },
});
const project = await request("/internal/projects", {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  body: {
    name: `RDPS E2E ${runId}`,
    slug: `rdps-e2e-${runId}`,
    description: "Created by the full publish-flow verification.",
  },
});
const release = await request(`/internal/projects/${project.id}/releases`, {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  body: { version: "1.0.0", title: "End-to-end publication", type: "MINOR" },
});
await request(`/internal/releases/${release.id}`, {
  token: admin.accessToken,
  method: "PATCH",
  body: { publicSummary: "A verified public release." },
});
await request(`/internal/releases/${release.id}/changes`, {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  body: {
    title: "Publish workflow verified",
    category: "IMPROVEMENT",
    internalDescription:
      "Full publication path exercised from a clean project.",
    publicDescription: "Release notes are now available to customers.",
  },
});

const attachmentForm = new FormData();
attachmentForm.append(
  "file",
  new Blob([`RDPS attachment verification ${runId}`], { type: "text/plain" }),
  "verification.txt",
);
const attachmentResponse = await fetch(
  `${baseUrl}/internal/projects/${project.id}/releases/${release.id}/attachments`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${admin.accessToken}` },
    body: attachmentForm,
  },
);
if (attachmentResponse.status !== 201)
  throw new Error(
    `Attachment upload failed with HTTP ${attachmentResponse.status}.`,
  );
const uploadedAttachment = await attachmentResponse.json();
await request(
  `/internal/projects/${project.id}/releases/${release.id}/attachments/${uploadedAttachment.id}/scan`,
  { token: admin.accessToken, method: "POST", expected: 201 },
);
await request(
  `/internal/projects/${project.id}/releases/${release.id}/attachments/${uploadedAttachment.id}/public`,
  {
    token: admin.accessToken,
    method: "PATCH",
    body: { publicAllowed: true },
  },
);

const invite = await request(`/internal/projects/${project.id}/members`, {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  body: {
    email: `reviewer-${runId}@example.test`,
    displayName: "E2E Reviewer",
    role: "REVIEWER",
  },
});
const reviewerPassword = `E2e-${randomBytes(18).toString("base64url")}!`;
const reviewer = await request("/internal/auth/invitations/accept", {
  method: "POST",
  body: { token: invite.invitationToken, password: reviewerPassword },
});

const isolatedProject = await request("/internal/projects", {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  body: {
    name: `RDPS Isolated ${runId}`,
    slug: `rdps-isolated-${runId}`,
    description: "Cross-project authorization boundary fixture.",
  },
});
const isolatedRelease = await request(
  `/internal/projects/${isolatedProject.id}/releases`,
  {
    token: admin.accessToken,
    method: "POST",
    expected: 201,
    body: {
      version: "9.9.9",
      title: `RDPS_FOREIGN_SENTINEL_${runId}`,
      type: "MINOR",
    },
  },
);
const isolatedUpload = new FormData();
isolatedUpload.append(
  "file",
  new Blob([`private isolated bytes ${runId}`], { type: "text/plain" }),
  "private-isolation.txt",
);
const isolatedAttachmentResponse = await fetch(
  `${baseUrl}/internal/projects/${isolatedProject.id}/releases/${isolatedRelease.id}/attachments`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${admin.accessToken}` },
    body: isolatedUpload,
  },
);
if (isolatedAttachmentResponse.status !== 201)
  throw new Error(
    `Cross-project attachment fixture upload failed with HTTP ${isolatedAttachmentResponse.status}.`,
  );
const isolatedAttachment = await isolatedAttachmentResponse.json();

// Establish that each protected read route is valid and serves this project
// before using a non-member's 404 response as an authorization assertion.
await request(
  `/internal/projects/${isolatedProject.id}/releases/${isolatedRelease.id}/attachments/${isolatedAttachment.id}/scan`,
  { token: admin.accessToken, method: "POST", expected: 201 },
);

const isolatedReads = [
  `/internal/projects/${isolatedProject.id}`,
  `/internal/projects/${isolatedProject.id}/members`,
  `/internal/projects/${isolatedProject.id}/repositories`,
  `/internal/projects/${isolatedProject.id}/environments`,
  `/internal/projects/${isolatedProject.id}/audit`,
  `/internal/projects/${isolatedProject.id}/audit/export.csv`,
  `/internal/projects/${isolatedProject.id}/releases`,
  `/internal/releases/${isolatedRelease.id}`,
  `/internal/projects/${isolatedProject.id}/releases/${isolatedRelease.id}/documents`,
  `/internal/projects/${isolatedProject.id}/releases/${isolatedRelease.id}/attachments`,
  `/internal/projects/${isolatedProject.id}/releases/${isolatedRelease.id}/attachments/${isolatedAttachment.id}/download`,
  `/internal/projects/${isolatedProject.id}/releases/${isolatedRelease.id}/deployments`,
  `/internal/projects/${isolatedProject.id}/integration-operations`,
];
for (const path of isolatedReads)
  await request(path, { token: admin.accessToken });
for (const path of isolatedReads)
  await request(path, { token: reviewer.accessToken, expected: 404 });

const auditCsv = await request(
  `/internal/projects/${isolatedProject.id}/audit/export.csv`,
  { token: admin.accessToken },
);
if (
  !auditCsv.startsWith("timestamp,actor,action,entity,metadata\n") ||
  !auditCsv.includes('"project.audit_exported"')
)
  throw new Error("Authorized project audit export returned an invalid CSV.");

// Authorized write controls use the same endpoints and valid bodies as the
// cross-project denial checks below.
await request(`/internal/releases/${isolatedRelease.id}`, {
  token: admin.accessToken,
  method: "PATCH",
  body: { title: isolatedRelease.title },
});
await request(
  `/internal/projects/${isolatedProject.id}/releases/${isolatedRelease.id}/documents`,
  {
    token: admin.accessToken,
    method: "POST",
    expected: 201,
    body: {
      section: "private",
      title: "Authorized document control",
      content: { type: "doc", content: [] },
    },
  },
);
await request(`/internal/projects/${isolatedProject.id}/members`, {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  body: {
    email: `authorized-${runId}@example.test`,
    displayName: "Authorized control member",
    role: "DEVELOPER",
  },
});
await request(`/internal/projects/${isolatedProject.id}/repositories`, {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  body: { provider: "github", owner: "rdps-e2e", name: `control-${runId}` },
});

const isolatedEnvironments = await request(
  `/internal/projects/${isolatedProject.id}/environments`,
  { token: admin.accessToken },
);
const isolatedEnvironment = isolatedEnvironments.find(
  (item) => item.name === "STAGING",
);
if (!isolatedEnvironment)
  throw new Error("The isolated project has no staging environment.");
await request(
  `/internal/projects/${isolatedProject.id}/environments/${isolatedEnvironment.id}`,
  {
    token: admin.accessToken,
    method: "PATCH",
    body: { enabled: true },
  },
);
await request(
  `/internal/projects/${isolatedProject.id}/releases/${isolatedRelease.id}/deployments`,
  {
    token: admin.accessToken,
    method: "POST",
    expected: 201,
    body: {
      environmentId: isolatedEnvironment.id,
      status: "SUCCEEDED",
    },
  },
);
await request(`/internal/releases/${isolatedRelease.id}`, {
  token: reviewer.accessToken,
  method: "PATCH",
  body: { title: "Unauthorized modification" },
  expected: 404,
});
await request(
  `/internal/projects/${isolatedProject.id}/releases/${isolatedRelease.id}/documents`,
  {
    token: reviewer.accessToken,
    method: "POST",
    body: {
      section: "private",
      title: "Unauthorized document",
      content: { type: "doc", children: [] },
    },
    expected: 404,
  },
);
await request(`/internal/projects/${isolatedProject.id}/members`, {
  token: reviewer.accessToken,
  method: "POST",
  body: {
    email: `unauthorized-${runId}@example.test`,
    displayName: "Unauthorized member",
    role: "DEVELOPER",
  },
  expected: 404,
});
await request(`/internal/projects/${isolatedProject.id}/repositories`, {
  token: reviewer.accessToken,
  method: "POST",
  body: { provider: "github", owner: "private", name: "repo" },
  expected: 404,
});
await request(
  `/internal/projects/${isolatedProject.id}/environments/${isolatedEnvironment.id}`,
  {
    token: reviewer.accessToken,
    method: "PATCH",
    body: { enabled: false },
    expected: 404,
  },
);
await request(
  `/internal/projects/${isolatedProject.id}/releases/${isolatedRelease.id}/deployments`,
  {
    token: reviewer.accessToken,
    method: "POST",
    body: {
      environmentId: isolatedEnvironment.id,
      status: "STARTED",
    },
    expected: 404,
  },
);
const rejectedAttachmentForm = new FormData();
rejectedAttachmentForm.append(
  "file",
  new Blob(["must not be stored"], { type: "text/plain" }),
  "rejected.txt",
);
const rejectedAttachment = await fetch(
  `${baseUrl}/internal/projects/${isolatedProject.id}/releases/${isolatedRelease.id}/attachments`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${reviewer.accessToken}` },
    body: rejectedAttachmentForm,
  },
);
if (rejectedAttachment.status !== 404)
  throw new Error(
    `Cross-project attachment write returned HTTP ${rejectedAttachment.status}.`,
  );
await request(
  `/internal/projects/${isolatedProject.id}/integration-operations/events/${isolatedRelease.id}/retry`,
  {
    token: reviewer.accessToken,
    method: "POST",
    expected: 404,
  },
);
const scopedSearch = await request(
  `/internal/search?q=${encodeURIComponent(`RDPS_FOREIGN_SENTINEL_${runId}`)}`,
  { token: reviewer.accessToken },
);
if (JSON.stringify(scopedSearch).includes(`RDPS_FOREIGN_SENTINEL_${runId}`))
  throw new Error("Internal search exposed another project's release.");
const publicDirectory = await request("/public/projects");
if (
  !Array.isArray(publicDirectory.results) ||
  publicDirectory.results.some((item) => item.slug === isolatedProject.slug) ||
  JSON.stringify(
    await request(`/public/projects/${isolatedProject.slug}`, {
      expected: 404,
    }),
  ).includes(`RDPS_FOREIGN_SENTINEL_${runId}`)
)
  throw new Error("Public delivery exposed an unpublished isolated project.");
const filteredPublicDirectory = await request(
  `/public/projects?q=${encodeURIComponent(isolatedProject.slug)}`,
);
if (
  filteredPublicDirectory.total !== 0 ||
  filteredPublicDirectory.results.length !== 0
)
  throw new Error("Public project search exposed an unpublished project.");
for (const suffix of [
  "",
  "/releases",
  "/releases/latest",
  "/changelog",
  "/rss.xml",
  "/share",
]) {
  await request(`/public/projects/${isolatedProject.slug}${suffix}`, {
    expected: 404,
  });
}
for (const suffix of [
  `/releases/${isolatedRelease.version}`,
  `/releases/${isolatedRelease.version}/changes`,
  `/releases/${isolatedRelease.version}/share`,
]) {
  await request(`/public/projects/${isolatedProject.slug}${suffix}`, {
    expected: 404,
  });
}
await request(`/internal/releases/${release.id}/submit-review`, {
  token: admin.accessToken,
  method: "PATCH",
});
const revision = await request(
  `/internal/releases/${release.id}/approval-revisions`,
  {
    token: admin.accessToken,
    method: "POST",
    expected: 201,
  },
);
await request(
  `/internal/releases/${release.id}/approval-revisions/${revision.id}/approve`,
  {
    token: reviewer.accessToken,
    method: "PATCH",
    body: { comment: "Independent E2E approval." },
  },
);
const publication = await request(
  `/internal/releases/${release.id}/approval-revisions/${revision.id}/publish`,
  {
    token: admin.accessToken,
    method: "POST",
    expected: 201,
  },
);
const publicReleasePath = `/public/projects/${project.slug}/releases/${release.version}`;
const cacheMissResponse = await fetch(`${baseUrl}${publicReleasePath}`);
if (!cacheMissResponse.ok)
  throw new Error(`Public release fetch failed: ${cacheMissResponse.status}`);
const published = await cacheMissResponse.json();
const cacheHitResponse = await fetch(`${baseUrl}${publicReleasePath}`);
if (
  !cacheHitResponse.ok ||
  cacheMissResponse.headers.get("x-rdps-cache") !== "MISS" ||
  cacheHitResponse.headers.get("x-rdps-cache") !== "HIT" ||
  cacheHitResponse.headers.get("cache-control") !==
    "public, max-age=0, s-maxage=5, must-revalidate"
)
  throw new Error(
    "Anonymous public snapshots did not use the bounded shared cache.",
  );

if (
  published.title !== release.title ||
  !published.changes?.some(
    (change) => change.title === "Publish workflow verified",
  ) ||
  !published.attachments?.some(
    (attachment) => attachment.fileName === "verification.txt",
  )
) {
  throw new Error(
    "The public snapshot did not contain the approved release title and change.",
  );
}
const publicLatest = await request(
  `/public/projects/${project.slug}/releases/latest`,
);
const publicHistory = await request(
  `/public/projects/${project.slug}/releases`,
);
const publicChangelog = await request(
  `/public/projects/${project.slug}/changelog`,
);
const publicChanges = await request(
  `/public/projects/${project.slug}/releases/${release.version}/changes`,
);
const publicProjectShare = await request(
  `/public/projects/${project.slug}/share`,
);
const publicReleaseShare = await request(
  `/public/projects/${project.slug}/releases/${release.version}/share`,
);
const publicRss = await request(`/public/projects/${project.slug}/rss.xml`);
if (
  publicLatest.version !== release.version ||
  !publicHistory.results?.some((item) => item.version === release.version) ||
  !publicChangelog.results?.some((item) => item.version === release.version) ||
  !publicChanges.some(
    (change) => change.title === "Publish workflow verified",
  ) ||
  publicProjectShare.project.slug !== project.slug ||
  publicReleaseShare.version !== release.version ||
  !publicRss.includes(release.title)
)
  throw new Error(
    "A published public delivery route returned incomplete data.",
  );
const publicSearch = await request(
  `/public/projects/${project.slug}/search?q=${encodeURIComponent(`RDPS_FOREIGN_SENTINEL_${runId}`)}`,
);
if (publicSearch.total !== 0 || publicSearch.results.length !== 0)
  throw new Error("Public search crossed project boundaries.");
const publicAttachment = published.attachments.find(
  (attachment) => attachment.fileName === "verification.txt",
);
const publicAttachmentResponse = await fetch(
  `${baseUrl}/public${publicAttachment.downloadUrl}`,
);
if (
  !publicAttachmentResponse.ok ||
  !(await publicAttachmentResponse.text()).includes(runId)
)
  throw new Error(
    "Published attachment download did not return the reviewed bytes.",
  );

const environments = await request(
  `/internal/projects/${project.id}/environments`,
  {
    token: admin.accessToken,
  },
);
const environment = environments.find((item) => item.name === "STAGING");
if (!environment) throw new Error("The project has no staging environment.");
await request(
  `/internal/projects/${project.id}/environments/${environment.id}/deployment-policy`,
  {
    token: admin.accessToken,
    method: "PATCH",
    body: { enabled: true, requireApprovedRelease: true },
  },
);
const triggerPath = `/internal/projects/${project.id}/releases/${release.id}/deployment-trigger-requests`;
const trigger = await request(triggerPath, {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  headers: { "idempotency-key": `e2e-${runId}-deployment` },
  body: { environmentId: environment.id, reason: "E2E governed deployment" },
});
const replayedTrigger = await request(triggerPath, {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  headers: { "idempotency-key": `e2e-${runId}-deployment` },
  body: { environmentId: environment.id, reason: "E2E governed deployment" },
});
if (trigger.id !== replayedTrigger.id)
  throw new Error(
    "Deployment request idempotency did not replay the original request.",
  );
let completedTrigger;
for (let attempt = 0; attempt < 40; attempt += 1) {
  completedTrigger = await request(
    `/internal/projects/${project.id}/deployment-trigger-requests/${trigger.id}`,
    { token: admin.accessToken },
  );
  if (completedTrigger.status === "SUCCEEDED") break;
  if (completedTrigger.status === "FAILED")
    throw new Error(
      `Deployment runner failed: ${JSON.stringify(completedTrigger)}`,
    );
  await wait(250);
}
if (completedTrigger.status !== "SUCCEEDED")
  throw new Error("Deployment runner did not complete within 10 seconds.");

const sandboxTargetUrl = process.env.RDPS_E2E_SANDBOX_TARGET_URL;
if (!sandboxTargetUrl)
  throw new Error(
    "RDPS_E2E_SANDBOX_TARGET_URL is required to verify deployment.",
  );
const targetResponse = await fetch(new URL("/health", sandboxTargetUrl), {
  redirect: "error",
  signal: AbortSignal.timeout(5_000),
});
if (!targetResponse.ok)
  throw new Error(
    `Sandbox target health returned HTTP ${targetResponse.status}.`,
  );
const targetHealth = await targetResponse.json();
if (
  targetHealth.status !== "ok" ||
  targetHealth.activeDeployments?.[project.id]?.[environment.id]?.releaseId !==
    release.id ||
  targetHealth.deliveryAttempts?.[project.id]?.[trigger.id] !== 1
)
  throw new Error(
    "Sandbox target health did not confirm exactly one governed deployment delivery.",
  );
const deploymentRequests = await request(triggerPath, {
  token: admin.accessToken,
});
if (deploymentRequests.length !== 1 || deploymentRequests[0].id !== trigger.id)
  throw new Error("Deployment retry created an additional governed request.");

const audience = await request(
  `/internal/projects/${project.id}/client-audiences`,
  {
    token: admin.accessToken,
    method: "POST",
    expected: 201,
    body: { name: "E2E Client", slug: `e2e-${runId}` },
  },
);
const clientEmail = `client-${runId}@example.test`;
const clientInvite = await request(`/internal/projects/${project.id}/members`, {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  body: {
    email: clientEmail,
    displayName: "E2E Client",
    role: "CLIENT",
  },
});
const clientPassword = `E2e-${randomBytes(18).toString("base64url")}!`;
const client = await request("/internal/auth/invitations/accept", {
  method: "POST",
  body: { token: clientInvite.invitationToken, password: clientPassword },
});
const members = await request(`/internal/projects/${project.id}/members`, {
  token: admin.accessToken,
});
const clientMember = members.find(
  (member) => member.user.email === clientEmail,
);
if (!clientMember)
  throw new Error("Invited client membership was not created.");
await request(
  `/internal/projects/${project.id}/members/${clientMember.id}/client-audience`,
  {
    token: admin.accessToken,
    method: "PATCH",
    body: { clientAudienceId: audience.id },
  },
);

const clientRelease = await request(
  `/internal/projects/${project.id}/releases`,
  {
    token: admin.accessToken,
    method: "POST",
    expected: 201,
    body: {
      version: "1.1.0",
      title: "Client-only release",
      type: "MINOR",
    },
  },
);
await request(`/internal/releases/${clientRelease.id}`, {
  token: admin.accessToken,
  method: "PATCH",
  body: { publicSummary: "Restricted to the assigned E2E client audience." },
});
await request(`/internal/releases/${clientRelease.id}/audience`, {
  token: admin.accessToken,
  method: "PATCH",
  body: { mode: "CLIENTS", audienceIds: [audience.id] },
});
await request(`/internal/releases/${clientRelease.id}/changes`, {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  body: {
    title: "Client-only change",
    category: "IMPROVEMENT",
    internalDescription: "Internal client audience verification source.",
    publicDescription: "Available only in the assigned client portal.",
  },
});
const clientAttachmentForm = new FormData();
clientAttachmentForm.append(
  "file",
  new Blob([`RDPS client attachment ${runId}`], { type: "text/plain" }),
  "client-verification.txt",
);
const clientAttachmentResponse = await fetch(
  `${baseUrl}/internal/projects/${project.id}/releases/${clientRelease.id}/attachments`,
  {
    method: "POST",
    headers: { authorization: `Bearer ${admin.accessToken}` },
    body: clientAttachmentForm,
  },
);
if (clientAttachmentResponse.status !== 201)
  throw new Error("Client-only attachment upload failed.");
const clientAttachment = await clientAttachmentResponse.json();
await request(
  `/internal/projects/${project.id}/releases/${clientRelease.id}/attachments/${clientAttachment.id}/scan`,
  { token: admin.accessToken, method: "POST", expected: 201 },
);
await request(
  `/internal/projects/${project.id}/releases/${clientRelease.id}/attachments/${clientAttachment.id}/public`,
  {
    token: admin.accessToken,
    method: "PATCH",
    body: { publicAllowed: true },
  },
);
await request(`/internal/releases/${clientRelease.id}/submit-review`, {
  token: admin.accessToken,
  method: "PATCH",
});
const clientRevision = await request(
  `/internal/releases/${clientRelease.id}/approval-revisions`,
  { token: admin.accessToken, method: "POST", expected: 201 },
);
await request(
  `/internal/releases/${clientRelease.id}/approval-revisions/${clientRevision.id}/approve`,
  {
    token: reviewer.accessToken,
    method: "PATCH",
    body: { comment: "Client audience isolation verified." },
  },
);
const clientPublication = await request(
  `/internal/releases/${clientRelease.id}/approval-revisions/${clientRevision.id}/publish`,
  { token: admin.accessToken, method: "POST", expected: 201 },
);
const clientHistoryRelease = await request(
  `/internal/projects/${project.id}/releases`,
  {
    token: admin.accessToken,
    method: "POST",
    expected: 201,
    body: {
      version: "1.2.0",
      title: "Client history pagination release",
      type: "MINOR",
    },
  },
);
await request(`/internal/releases/${clientHistoryRelease.id}/audience`, {
  token: admin.accessToken,
  method: "PATCH",
  body: { mode: "CLIENTS", audienceIds: [audience.id] },
});
await request(`/internal/releases/${clientHistoryRelease.id}/changes`, {
  token: admin.accessToken,
  method: "POST",
  expected: 201,
  body: {
    title: "Client history pagination verified",
    category: "IMPROVEMENT",
    internalDescription: "Second version for database paging verification.",
    publicDescription: "Release history pagination is verified.",
  },
});
await request(`/internal/releases/${clientHistoryRelease.id}/submit-review`, {
  token: admin.accessToken,
  method: "PATCH",
});
const clientHistoryRevision = await request(
  `/internal/releases/${clientHistoryRelease.id}/approval-revisions`,
  { token: admin.accessToken, method: "POST", expected: 201 },
);
await request(
  `/internal/releases/${clientHistoryRelease.id}/approval-revisions/${clientHistoryRevision.id}/approve`,
  {
    token: reviewer.accessToken,
    method: "PATCH",
    body: { comment: "Second client history page verified." },
  },
);
await request(
  `/internal/releases/${clientHistoryRelease.id}/approval-revisions/${clientHistoryRevision.id}/publish`,
  { token: admin.accessToken, method: "POST", expected: 201 },
);
await request(
  `/public/projects/${project.slug}/releases/${clientRelease.version}`,
  { expected: 404 },
);
await request(
  `/public/projects/${project.slug}/releases/${clientHistoryRelease.version}`,
  { expected: 404 },
);
const anonymousHistory = await request(
  `/public/projects/${project.slug}/releases`,
);
if (
  !Array.isArray(anonymousHistory.results) ||
  anonymousHistory.results.some(
    (item) => item.version === clientRelease.version,
  ) ||
  anonymousHistory.results.some(
    (item) => item.version === clientHistoryRelease.version,
  ) ||
  anonymousHistory.totalPages < 1
)
  throw new Error("Anonymous release history exposed a client-only version.");
const firstClientPage = await request(
  `/client/projects/${project.slug}/releases?page=1&pageSize=1`,
  { token: client.accessToken },
);
if (
  firstClientPage.pagination?.page !== 1 ||
  firstClientPage.pagination?.pageSize !== 1 ||
  firstClientPage.pagination?.total !== 2 ||
  firstClientPage.pagination?.totalPages !== 2 ||
  firstClientPage.releases?.[0]?.version !== clientHistoryRelease.version
)
  throw new Error(
    "Client release history page one was not bounded or ordered.",
  );
const clientPortal = await request(
  `/client/projects/${project.slug}/releases?page=2&pageSize=1`,
  { token: client.accessToken },
);
if (
  clientPortal.pagination?.page !== 2 ||
  clientPortal.releases?.length !== 1 ||
  !clientPortal.releases?.some((item) => item.version === clientRelease.version)
)
  throw new Error("Client release history page two was not correctly scoped.");
await request(`/client/projects/${project.slug}/releases`, {
  token: reviewer.accessToken,
  expected: 404,
});
const clientAttachmentSnapshot = clientPortal.releases
  .find((item) => item.version === clientRelease.version)
  .attachments.find((item) => item.fileName === "client-verification.txt");
if (!clientAttachmentSnapshot)
  throw new Error(
    "Client-only snapshot did not include its reviewed attachment.",
  );
const leakedClientAttachment = await fetch(
  `${baseUrl}/public/projects/${project.slug}/releases/${clientRelease.version}/attachments/${clientAttachmentSnapshot.id}/download`,
);
if (leakedClientAttachment.status !== 404)
  throw new Error("Anonymous users could access a client-only attachment.");
const clientDownload = await fetch(
  `${baseUrl}${clientAttachmentSnapshot.downloadUrl}`,
  { headers: { authorization: `Bearer ${client.accessToken}` } },
);
if (!clientDownload.ok || !(await clientDownload.text()).includes(runId))
  throw new Error(
    "Assigned client could not download its published attachment.",
  );

await request("/public/analytics/events", {
  method: "POST",
  expected: 201,
  body: { projectSlug: project.slug, kind: "PROJECT_VIEW" },
});
const dashboard = await request(
  `/internal/projects/${project.id}/analytics?days=7`,
  { token: admin.accessToken },
);
if (dashboard.totals.projectViews < 1) {
  throw new Error("The anonymous public view was not counted in analytics.");
}

const exportIds = [];
for (const body of [
  { kind: "ANALYTICS_CSV", days: 7 },
  { kind: "RELEASE_PDF", releaseId: release.id },
]) {
  const job = await request(
    `/internal/projects/${project.id}/analytics/exports`,
    { token: admin.accessToken, method: "POST", expected: 201, body },
  );
  exportIds.push(job.id);
}

let exportJobs = [];
for (let attempt = 0; attempt < 40; attempt += 1) {
  exportJobs = await request(
    `/internal/projects/${project.id}/analytics/exports`,
    { token: admin.accessToken },
  );
  if (
    exportIds.every(
      (id) => exportJobs.find((job) => job.id === id)?.status === "COMPLETED",
    )
  )
    break;
  if (
    exportIds.some(
      (id) => exportJobs.find((job) => job.id === id)?.status === "FAILED",
    )
  )
    throw new Error(
      `An analytics export failed: ${JSON.stringify(exportJobs)}`,
    );
  await wait(500);
}
for (const id of exportIds) {
  if (exportJobs.find((job) => job.id === id)?.status !== "COMPLETED")
    throw new Error(
      "Analytics export jobs did not complete within 20 seconds.",
    );
  const response = await fetch(
    `${baseUrl}/internal/projects/${project.id}/analytics/exports/${id}/download`,
    { headers: { authorization: `Bearer ${admin.accessToken}` } },
  );
  if (!response.ok || (await response.arrayBuffer()).byteLength === 0)
    throw new Error(`Completed export ${id} could not be downloaded.`);
}

await request(
  `/internal/releases/${release.id}/publications/${publication.id}/unpublish`,
  { token: admin.accessToken, method: "POST", expected: 201 },
);
await request(
  `/internal/releases/${clientRelease.id}/publications/${clientPublication.id}/unpublish`,
  { token: admin.accessToken, method: "POST", expected: 201 },
);
const revokedClientPortal = await request(
  `/client/projects/${project.slug}/releases?page=2&pageSize=1`,
  { token: client.accessToken },
);
if (
  revokedClientPortal.releases.some(
    (item) => item.version === clientRelease.version,
  )
)
  throw new Error("Unpublishing did not revoke the client-only snapshot.");
const revokedClientAttachment = await fetch(
  `${baseUrl}${clientAttachmentSnapshot.downloadUrl}`,
  { headers: { authorization: `Bearer ${client.accessToken}` } },
);
if (revokedClientAttachment.status !== 404)
  throw new Error(
    "Unpublishing did not revoke the client attachment download.",
  );
const revokedSnapshotResponse = await fetch(`${baseUrl}${publicReleasePath}`);
if (
  revokedSnapshotResponse.status !== 404 ||
  revokedSnapshotResponse.headers.get("x-rdps-cache") === "HIT"
)
  throw new Error(
    "Unpublishing did not invalidate the cached public snapshot.",
  );
const revokedAttachment = await fetch(
  `${baseUrl}/public${publicAttachment.downloadUrl}`,
);
if (revokedAttachment.status !== 404)
  throw new Error(
    "Unpublishing did not revoke the public attachment download.",
  );

console.log(
  JSON.stringify(
    {
      result: "passed",
      project: project.slug,
      release: release.version,
      revision: revision.revision,
      analyticsExports: exportIds.length,
      deploymentRequest: completedTrigger.status,
      sandboxDeployment: {
        projectId: project.id,
        environmentId: environment.id,
        releaseId: release.id,
        apiTriggerCount: deploymentRequests.length,
        targetDeliveryAttempts:
          targetHealth.deliveryAttempts[project.id][trigger.id],
      },
      clientAudienceRelease: clientRelease.version,
      clientAudienceAttachment: "authorized client download verified",
      publicAttachment: "published and revoked",
      revokedPublicSnapshot: true,
      publicUrl: `${baseUrl}/public/projects/${project.slug}/releases/${release.version}`,
    },
    null,
    2,
  ),
);
