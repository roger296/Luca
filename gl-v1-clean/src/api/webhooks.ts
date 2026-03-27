import type { Request, Response, NextFunction } from "express";
import * as webhooksDb from "../db/queries/webhooks";
import { signPayload } from "../engine/webhooks";
import { v4 as uuidv4 } from "uuid";

// ─── GET /webhooks ────────────────────────────────────────────────────────────

export async function listWebhooks(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const subscriptions = await webhooksDb.listSubscriptions();

    // Mask secrets before returning — only expose the first 4 chars
    const masked = subscriptions.map((s) => ({
      ...s,
      secret: s.secret.slice(0, 4) + "****",
    }));

    res.json({ success: true, data: masked });
  } catch (err) {
    next(err);
  }
}

// ─── POST /webhooks ───────────────────────────────────────────────────────────

export async function createWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { callback_url, event_types, secret } = req.body as {
      callback_url: string;
      event_types: string[];
      secret: string;
    };

    if (!callback_url || !event_types || !secret) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "callback_url, event_types, and secret are required",
        },
      });
      return;
    }

    if (!Array.isArray(event_types) || event_types.length === 0) {
      res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "event_types must be a non-empty array" },
      });
      return;
    }

    const validEventTypes = [
      "TRANSACTION_POSTED",
      "TRANSACTION_APPROVED",
      "TRANSACTION_REJECTED",
      "PERIOD_SOFT_CLOSED",
      "PERIOD_CLOSED",
      "APPROVAL_ESCALATED",
    ];

    const invalidTypes = event_types.filter((t) => !validEventTypes.includes(t));
    if (invalidTypes.length > 0) {
      res.status(400).json({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: `Invalid event types: ${invalidTypes.join(", ")}. Valid types: ${validEventTypes.join(", ")}`,
        },
      });
      return;
    }

    const subscription = await webhooksDb.insertSubscription({
      callback_url,
      event_types,
      secret,
    });

    // Mask secret in response
    res.status(201).json({
      success: true,
      data: {
        ...subscription,
        secret: subscription.secret.slice(0, 4) + "****",
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /webhooks/:id ─────────────────────────────────────────────────────

export async function deleteWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const subscription = await webhooksDb.getSubscription(id);
    if (!subscription) {
      res.status(404).json({
        success: false,
        error: { code: "WEBHOOK_NOT_FOUND", message: `Webhook subscription ${id} not found` },
      });
      return;
    }

    await webhooksDb.deleteSubscription(id);

    res.json({ success: true, data: { deleted: true, id } });
  } catch (err) {
    next(err);
  }
}

// ─── GET /webhooks/:id/deliveries ─────────────────────────────────────────────

export async function getWebhookDeliveries(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;

    const subscription = await webhooksDb.getSubscription(id);
    if (!subscription) {
      res.status(404).json({
        success: false,
        error: { code: "WEBHOOK_NOT_FOUND", message: `Webhook subscription ${id} not found` },
      });
      return;
    }

    const deliveries = await webhooksDb.listDeliveriesForSubscription(id);

    res.json({ success: true, data: deliveries });
  } catch (err) {
    next(err);
  }
}

// ─── POST /webhooks/:id/test ──────────────────────────────────────────────────

export async function testWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const subscription = await webhooksDb.getSubscription(id);
    if (!subscription) {
      res.status(404).json({
        success: false,
        error: { code: "WEBHOOK_NOT_FOUND", message: `Webhook subscription ${id} not found` },
      });
      return;
    }

    const testPayload = JSON.stringify({
      event_id: uuidv4(),
      event_type: "TEST",
      timestamp: new Date().toISOString(),
      data: { message: "Test delivery from GL V1" },
    });

    const signature = signPayload(testPayload, subscription.secret);
    let reachable = false;
    let statusCode: number | null = null;
    let error: string | null = null;

    try {
      const resp = await fetch(subscription.callback_url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-GL-Signature": signature,
          "X-GL-Event": "TEST",
        },
        body: testPayload,
        signal: AbortSignal.timeout(10_000),
      });
      reachable = resp.ok;
      statusCode = resp.status;
    } catch (fetchErr: unknown) {
      error = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    }

    res.json({ success: true, data: { reachable, status_code: statusCode, error } });
  } catch (err) {
    next(err);
  }
}
