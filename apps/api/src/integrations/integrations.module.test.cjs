const assert = require("node:assert/strict");
const test = require("node:test");
const { Test } = require("@nestjs/testing");
const { IntegrationsModule } = require("./integrations.module");
const { WebhookIngestionService } = require("./webhook-ingestion.service");
const { WebhookProcessingService } = require("./webhook-processing.service");
const {
  IntegrationSuggestionsService,
} = require("./integration-suggestions.service");
const { WEBHOOK_QUEUE } = require("./webhook-contracts");
const { PrismaService } = require("../prisma/prisma.service");

test("wires queue-backed ingestion and processing services in IntegrationsModule", async () => {
  const enqueued = [];
  const prisma = {
    webhookEvent: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async () => ({ id: "event-id", status: "RECEIVED" }),
    },
    $transaction: async (operation) =>
      operation({
        webhookEvent: {
          findUnique: async () => null,
          findFirst: async () => null,
          create: async () => ({ id: "event-id", status: "RECEIVED" }),
        },
      }),
  };
  const moduleRef = await Test.createTestingModule({
    imports: [IntegrationsModule],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .overrideProvider(WEBHOOK_QUEUE)
    .useValue({
      add: async (...args) => {
        enqueued.push(args);
      },
    })
    .compile();

  try {
    const ingestion = moduleRef.get(WebhookIngestionService);
    assert.ok(moduleRef.get(WebhookProcessingService));
    assert.ok(moduleRef.get(IntegrationSuggestionsService));
    await ingestion.ingest({
      provider: "github",
      deliveryId: "delivery",
      eventType: "push",
      payloadHash: "a".repeat(64),
      job: {
        kind: "github",
        eventType: "push",
        repository: "acme/app",
        action: "push",
        reference: {
          kind: "commit",
          externalId: "b".repeat(40),
          revision: "b".repeat(40),
        },
      },
    });
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0][2].jobId, "webhook-event-id");
  } finally {
    await moduleRef.close();
  }
});
