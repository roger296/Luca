import * as http from "http";
import type { AddressInfo } from "net";
import { createHmac } from "crypto";
import { knex } from "../../src/db/connection";
import { setupTestTenant, cleanupTestTenant, closeKnex } from "./helpers";
import { postTransaction } from "../../src/engine/posting";
import { processRetryQueue, signPayload } from "../../src/engine/webhooks";
import type { TransactionSubmission } from "../../src/engine/types";

// ─── Shared test helpers ──────────────────────────────────────────────────────

const BASE_INVOICE: Omit<TransactionSubmission, "idempotency_key"> = {
  transaction_type: "CUSTOMER_INVOICE",
  date: "2026-03-10",
  currency: "GBP",
  counterparty: { trading_account_id: "TA-WH-001", contact_id: "C-WH-001" },
  description: "Webhook integration test",
  lines: [
    { description: "Test service", net_amount: "100.00", tax_code: "STD", tax_amount: "20.00" },
  ],
  source: { module_id: "test-module" },
};

type CaptureHandler = (
  req: http.IncomingMessage,
  body: string,
  res: http.ServerResponse
) => void;

function createTestServer(
  handler: CaptureHandler
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => handler(req, Buffer.concat(chunks).toString(), res));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

function stopServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
}

async function waitForDelivery(
  subscriptionId: string,
  timeoutMs = 4000
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = (await knex("webhook_deliveries")
      .where({ subscription_id: subscriptionId })
      .orderBy("created_at", "desc")
      .first()) as Record<string, unknown> | undefined;
    if (row && row["status"] !== "PENDING") return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timeout: no terminal delivery found for subscription ${subscriptionId}`);
}

async function registerWebhook(
  port: number,
  eventTypes: string[],
  secret: string,
  extraFields: Record<string, unknown> = {}
): Promise<string> {
  const [row] = await knex("webhook_subscriptions")
    .insert({
      callback_url: `http://127.0.0.1:${port}/hook`,
      event_types: eventTypes,
      secret,
      is_active: true,
      failure_count: 0,
      ...extraFields,
    })
    .returning("id");
  return (row as Record<string, unknown>)["id"] as string;
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

beforeAll(setupTestTenant);
afterEach(cleanupTestTenant);
afterAll(closeKnex);

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Delivery with correct payload structure
// ─────────────────────────────────────────────────────────────────────────────

describe("Webhook: TRANSACTION_POSTED delivery", () => {
  it("sends event to callback URL with correct payload structure and headers", async () => {
    let capturedHeaders: http.IncomingHttpHeaders | null = null;
    let capturedBody = "";

    const { server, port } = await createTestServer((req, body, res) => {
      capturedHeaders = req.headers;
      capturedBody = body;
      res.writeHead(200);
      res.end("OK");
    });

    try {
      const subId = await registerWebhook(port, ["TRANSACTION_POSTED"], "secret-t1");

      await postTransaction({ ...BASE_INVOICE, idempotency_key: "wh-t1" });
      const delivery = await waitForDelivery(subId);

      expect(delivery["status"]).toBe("DELIVERED");

      const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
      expect(parsed["event_type"]).toBe("TRANSACTION_POSTED");
      expect(typeof parsed["event_id"]).toBe("string");
      expect(typeof parsed["timestamp"]).toBe("string");
      const data = parsed["data"] as Record<string, unknown>;
      expect(data["transaction_type"]).toBe("CUSTOMER_INVOICE");

      expect(capturedHeaders!["x-gl-event"]).toBe("TRANSACTION_POSTED");
      expect(capturedHeaders!["content-type"]).toMatch(/application\/json/);
      expect(capturedHeaders!["x-gl-delivery"]).toBeTruthy();
    } finally {
      await stopServer(server);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — HMAC-SHA256 signature verification
// ─────────────────────────────────────────────────────────────────────────────

describe("Webhook: HMAC-SHA256 signature", () => {
  it("X-GL-Signature matches sha256=HMAC-SHA256(payload, secret)", async () => {
    let receivedSig = "";
    let receivedBody = "";

    const { server, port } = await createTestServer((req, body, res) => {
      receivedSig = req.headers["x-gl-signature"] as string;
      receivedBody = body;
      res.writeHead(200);
      res.end();
    });

    try {
      const secret = "hmac-test-secret";
      const subId = await registerWebhook(port, ["TRANSACTION_POSTED"], secret);

      await postTransaction({ ...BASE_INVOICE, idempotency_key: "wh-t2" });
      await waitForDelivery(subId);

      const expectedSig =
        "sha256=" + createHmac("sha256", secret).update(receivedBody).digest("hex");
      expect(receivedSig).toBe(expectedSig);
      expect(receivedSig).toBe(signPayload(receivedBody, secret));
    } finally {
      await stopServer(server);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Retry: 500 on first attempt, 200 on second
// ─────────────────────────────────────────────────────────────────────────────

describe("Webhook: retry logic", () => {
  it("retries a RETRYING delivery and marks it DELIVERED on the second attempt", async () => {
    let callCount = 0;

    const { server, port } = await createTestServer((_, __, res) => {
      callCount++;
      res.writeHead(callCount === 1 ? 500 : 200);
      res.end();
    });

    try {
      const subId = await registerWebhook(port, ["TRANSACTION_POSTED"], "retry-secret");

      await postTransaction({ ...BASE_INVOICE, idempotency_key: "wh-t3" });

      const firstDelivery = await waitForDelivery(subId);
      expect(firstDelivery["status"]).toBe("RETRYING");
      expect(callCount).toBe(1);

      await knex("webhook_deliveries")
        .where({ id: firstDelivery["id"] as string })
        .update({ last_attempt_at: new Date(Date.now() - 120_000).toISOString() });

      await processRetryQueue();

      const retried = (await knex("webhook_deliveries")
        .where({ id: firstDelivery["id"] as string })
        .first()) as Record<string, unknown>;
      expect(retried["status"]).toBe("DELIVERED");
      expect(callCount).toBe(2);
    } finally {
      await stopServer(server);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Non-blocking: postTransaction returns before webhook delivery
// ─────────────────────────────────────────────────────────────────────────────

describe("Webhook: non-blocking delivery", () => {
  it("postTransaction resolves before the webhook HTTP request completes", async () => {
    let deliveryReceived = false;

    const { server, port } = await createTestServer((_, __, res) => {
      setTimeout(() => {
        deliveryReceived = true;
        res.writeHead(200);
        res.end();
      }, 200);
    });

    try {
      const subId = await registerWebhook(port, ["TRANSACTION_POSTED"], "nb-secret");

      await postTransaction({ ...BASE_INVOICE, idempotency_key: "wh-t4" });

      expect(deliveryReceived).toBe(false);

      await waitForDelivery(subId);
      expect(deliveryReceived).toBe(true);
    } finally {
      await stopServer(server);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Subscription deactivated when failure_count exceeds 10
// ─────────────────────────────────────────────────────────────────────────────

describe("Webhook: subscription deactivation", () => {
  it("deactivates the subscription when failure_count already exceeds 10", async () => {
    const [subRow] = await knex("webhook_subscriptions")
      .insert({
        callback_url: "http://127.0.0.1:1/nonexistent",
        event_types: ["TRANSACTION_POSTED"],
        secret: "deactivation-secret",
        is_active: true,
        failure_count: 11,
      })
      .returning("id");
    const subId = (subRow as Record<string, unknown>)["id"] as string;

    await knex("webhook_deliveries").insert({
      subscription_id: subId,
      event_type: "TRANSACTION_POSTED",
      payload: JSON.stringify({
        event_id: "evt-deact",
        event_type: "TRANSACTION_POSTED",
        timestamp: new Date().toISOString(),
        data: {},
      }),
      status: "RETRYING",
      attempts: 1,
      last_attempt_at: new Date(Date.now() - 120_000).toISOString(),
    });

    await processRetryQueue();

    const sub = (await knex("webhook_subscriptions")
      .where({ id: subId })
      .first()) as Record<string, unknown>;
    expect(sub["is_active"]).toBe(false);
  });
});
