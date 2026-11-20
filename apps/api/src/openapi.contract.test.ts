import * as assert from "node:assert/strict";
import "reflect-metadata";
import { afterEach, test } from "node:test";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from "@nestjs/swagger";
import { IntegrationSuggestionsController } from "./integrations/integration-suggestions.controller";
import { IntegrationSuggestionsService } from "./integrations/integration-suggestions.service";
import {
  PublishingController,
  ApprovalQueueController,
} from "./publishing/publishing.controller";
import { PublishingService } from "./publishing/publishing.service";
import { ReleaseContentController } from "./release-content/release-content.controller";
import { ReleaseContentService } from "./release-content/release-content.service";
import { ClientReleaseController } from "./client-visibility/client-visibility.controller";
import { ClientVisibilityService } from "./client-visibility/client-visibility.service";

const applications: INestApplication[] = [];

async function createOpenApiDocument(): Promise<OpenAPIObject> {
  const module = await Test.createTestingModule({
    controllers: [
      PublishingController,
      ApprovalQueueController,
      ReleaseContentController,
      IntegrationSuggestionsController,
      ClientReleaseController,
    ],
    providers: [
      { provide: PublishingService, useValue: {} },
      { provide: ReleaseContentService, useValue: {} },
      { provide: IntegrationSuggestionsService, useValue: {} },
      { provide: ClientVisibilityService, useValue: {} },
    ],
  }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix("api/v1");
  await app.init();
  applications.push(app);

  const config = new DocumentBuilder()
    .setTitle("RDPS API contract test")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

function operation(
  document: OpenAPIObject,
  path: string,
  method: "get" | "post" | "patch",
) {
  const result = document.paths[path]?.[method];
  assert.ok(
    result,
    `Expected OpenAPI operation ${method.toUpperCase()} ${path}`,
  );
  return result;
}

afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

test("OpenAPI documents high-value release publishing, attachment, and suggestion contracts", async () => {
  const document = await createOpenApiDocument();

  const publishingOperations = [
    ["/api/v1/internal/releases/{releaseId}/approval-revisions", "post"],
    [
      "/api/v1/internal/releases/{releaseId}/approval-revisions/{revisionId}/approve",
      "patch",
    ],
    [
      "/api/v1/internal/releases/{releaseId}/approval-revisions/{revisionId}/reject",
      "patch",
    ],
    [
      "/api/v1/internal/releases/{releaseId}/approval-revisions/{revisionId}/publish",
      "post",
    ],
    ["/api/v1/internal/approval-revisions", "get"],
  ] as const;
  for (const [path, method] of publishingOperations) {
    assert.ok(operation(document, path, method).security?.length);
  }

  const attachmentPath =
    "/api/v1/internal/projects/{projectId}/releases/{releaseId}/attachments";
  const attachmentList = operation(document, attachmentPath, "get");
  const upload = operation(document, attachmentPath, "post");
  const uploadBody = upload.requestBody;
  assert.ok(uploadBody && !("$ref" in uploadBody));
  const multipart = uploadBody.content["multipart/form-data"];
  assert.ok(multipart, "attachment upload must use multipart/form-data");
  assert.deepEqual(multipart.schema, {
    type: "object",
    properties: { file: { type: "string", format: "binary" } },
  });
  assert.ok(attachmentList.security?.length);
  assert.ok(
    operation(document, `${attachmentPath}/{attachmentId}/scan`, "post")
      .security?.length,
  );
  assert.ok(
    operation(document, `${attachmentPath}/{attachmentId}/public`, "patch")
      .security?.length,
  );
  assert.ok(
    operation(document, `${attachmentPath}/{attachmentId}/download`, "get")
      .security?.length,
  );

  const suggestionsPath =
    "/api/v1/internal/projects/{projectId}/integration-suggestions";
  assert.ok(operation(document, suggestionsPath, "get").security?.length);
  const accept = operation(
    document,
    `${suggestionsPath}/{suggestionId}/accept`,
    "patch",
  );
  assert.ok(accept.security?.length);
  const acceptBody = accept.requestBody;
  assert.ok(acceptBody && !("$ref" in acceptBody));
  const acceptSchema = acceptBody.content["application/json"]?.schema;
  assert.ok(acceptSchema && "$ref" in acceptSchema);
  assert.deepEqual(document.components?.schemas?.AcceptSuggestionInput, {
    type: "object",
    properties: { releaseId: { type: "string", format: "uuid" } },
    required: ["releaseId"],
  });
  assert.ok(
    operation(document, `${suggestionsPath}/{suggestionId}/dismiss`, "patch")
      .security?.length,
  );
});

test("OpenAPI documents pagination and bearer auth for client release history", async () => {
  const document = await createOpenApiDocument();
  const list = operation(
    document,
    "/api/v1/client/projects/{projectSlug}/releases",
    "get",
  );

  assert.ok(list.security?.length);
  assert.deepEqual(
    list.parameters
      ?.filter((parameter) => "name" in parameter)
      .map((parameter) => ("name" in parameter ? parameter.name : ""))
      .sort(),
    ["page", "pageSize", "projectSlug"],
  );
});
