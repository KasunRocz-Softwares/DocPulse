import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service.js";
import { WEBHOOK_QUEUE, type WebhookQueue } from "./webhook-contracts.js";
import { WebhookController } from "./webhook.controller.js";
import { WebhookIngestionService } from "./webhook-ingestion.service.js";

test("HTTP webhook route rejects invalid signatures and stale timestamps, then deduplicates delivery", async () => {
  const oldGitHubSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const oldDeploymentSecret = process.env.DEPLOYMENT_WEBHOOK_SECRET;
  const githubSecret = "http-test-github-secret";
  const deploymentSecret = "http-test-deployment-secret";
  process.env.GITHUB_WEBHOOK_SECRET = githubSecret;
  process.env.DEPLOYMENT_WEBHOOK_SECRET = deploymentSecret;

  const events: Array<{
    id: string;
    status: string;
    provider: string;
    deliveryId: string;
    payloadHash: string;
  }> = [];
  const webhookEvent = {
    findUnique: async ({
      where,
    }: {
      where: { provider_deliveryId: { provider: string; deliveryId: string } };
    }) => {
      const match = events.find(
        (event) =>
          event.provider === where.provider_deliveryId.provider &&
          event.deliveryId === where.provider_deliveryId.deliveryId,
      );
      return match ? { id: match.id, status: match.status } : null;
    },
    findFirst: async ({
      where,
    }: {
      where: { provider: string; payloadHash: string };
    }) => {
      const match = events.find(
        (event) =>
          event.provider === where.provider &&
          event.payloadHash === where.payloadHash,
      );
      return match ? { id: match.id, status: match.status } : null;
    },
    create: async ({
      data,
    }: {
      data: { provider: string; deliveryId: string; payloadHash: string };
    }) => {
      const event = {
        ...data,
        id: `http-event-${events.length + 1}`,
        status: "RECEIVED",
      };
      events.push(event);
      return { id: event.id, status: event.status };
    },
  };
  const prisma = {
    webhookEvent,
    $transaction: async (
      callback: (tx: { webhookEvent: typeof webhookEvent }) => unknown,
    ) => callback({ webhookEvent }),
  };
  const queued: Array<{
    name: string;
    data: unknown;
    options: { jobId: string };
  }> = [];
  const queue: WebhookQueue = {
    add: async (name, data, options) => {
      queued.push({ name, data, options });
      return {} as never;
    },
  } as WebhookQueue;
  Reflect.defineMetadata(
    "design:paramtypes",
    [WebhookIngestionService],
    WebhookController,
  );
  class WebhookHttpTestModule {}
  Module({
    controllers: [WebhookController],
    providers: [
      WebhookIngestionService,
      { provide: PrismaService, useValue: prisma },
      { provide: WEBHOOK_QUEUE, useValue: queue },
    ],
  })(WebhookHttpTestModule);

  const app = await NestFactory.create(WebhookHttpTestModule, {
    rawBody: true,
    logger: false,
  });
  app.setGlobalPrefix("api/v1");

  try {
    await app.listen(0, "127.0.0.1");
    const baseUrl = `${await app.getUrl()}/api/v1/integrations`;
    const githubBody = JSON.stringify({ action: "opened" });
    const invalidGitHub = await fetch(`${baseUrl}/github/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
        "x-github-delivery": "http-invalid-signature",
        "x-github-event": "issues",
      },
      body: githubBody,
    });
    assert.equal(invalidGitHub.status, 401);

    const now = Math.floor(Date.now() / 1000);
    const staleTimestamp = String(now - 600);
    const deploymentBody = JSON.stringify({
      deploymentId: "http-deployment-1",
      projectId: "11111111-1111-4111-8111-111111111111",
      releaseId: "22222222-2222-4222-8222-222222222222",
      environmentId: "33333333-3333-4333-8333-333333333333",
      status: "succeeded",
      occurredAt: new Date(now * 1000).toISOString(),
    });
    const sign = (timestamp: string) =>
      createHmac("sha256", deploymentSecret)
        .update(`${timestamp}.`)
        .update(deploymentBody)
        .digest("hex");
    const staleResponse = await fetch(`${baseUrl}/deployments/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-rdps-signature": `sha256=${sign(staleTimestamp)}`,
        "x-rdps-timestamp": staleTimestamp,
        "x-rdps-delivery-id": "http-stale-delivery",
      },
      body: deploymentBody,
    });
    assert.equal(staleResponse.status, 401);

    const timestamp = String(now);
    const postDeployment = (deliveryId: string) =>
      fetch(`${baseUrl}/deployments/webhook`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-rdps-signature": `sha256=${sign(timestamp)}`,
          "x-rdps-timestamp": timestamp,
          "x-rdps-delivery-id": deliveryId,
        },
        body: deploymentBody,
      });
    const first = await postDeployment("http-valid-delivery-1");
    const firstText = await first.text();
    assert.equal(first.status, 202, firstText);
    const firstResult = JSON.parse(firstText);
    assert.equal(firstResult.duplicate, false);

    const duplicate = await postDeployment("http-valid-delivery-1");
    assert.equal(duplicate.status, 202);
    const duplicateResult = await duplicate.json();
    assert.equal(duplicateResult.duplicate, true);
    assert.equal(duplicateResult.eventId, firstResult.eventId);
    assert.equal(queued.length, 2);
    assert.equal(queued[0].options.jobId, queued[1].options.jobId);
    assert.equal(queued[0].options.jobId, `webhook-${firstResult.eventId}`);
  } finally {
    await app.close();
    if (oldGitHubSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET;
    else process.env.GITHUB_WEBHOOK_SECRET = oldGitHubSecret;
    if (oldDeploymentSecret === undefined)
      delete process.env.DEPLOYMENT_WEBHOOK_SECRET;
    else process.env.DEPLOYMENT_WEBHOOK_SECRET = oldDeploymentSecret;
  }
});
