import { knex } from "../connection";
import type { WebhookSubscription, WebhookEventType } from "../../engine/types";

export interface WebhookDelivery {
  id: string;
  subscription_id: string;
  event_type: string;
  payload: object;
  status: string;
  attempts: number;
  last_attempt_at: string | null;
  last_response_status: number | null;
  last_error: string | null;
  created_at: string;
}

export async function listSubscriptions(): Promise<WebhookSubscription[]> {
  const rows = await knex("webhook_subscriptions")
    .orderBy("created_at", "desc");
  return rows as WebhookSubscription[];
}

export async function getSubscription(
  id: string
): Promise<WebhookSubscription | null> {
  const row = await knex("webhook_subscriptions")
    .where({ id })
    .first();
  return row ? (row as WebhookSubscription) : null;
}

export async function insertSubscription(
  data: { callback_url: string; event_types: string[]; secret: string }
): Promise<WebhookSubscription> {
  const [row] = await knex("webhook_subscriptions")
    .insert({
      ...data,
      is_active: true,
      failure_count: 0,
    })
    .returning("*");
  return row as WebhookSubscription;
}

export async function deleteSubscription(
  id: string
): Promise<void> {
  await knex("webhook_subscriptions")
    .where({ id })
    .delete();
}

export async function getActiveSubscriptionsForEvent(
  eventType: WebhookEventType
): Promise<WebhookSubscription[]> {
  const rows = await knex("webhook_subscriptions")
    .where("is_active", true)
    .whereRaw("? = ANY(event_types)", [eventType]);
  return rows as WebhookSubscription[];
}

export async function insertDelivery(data: {
  subscription_id: string;
  event_type: string;
  payload: object;
}): Promise<WebhookDelivery> {
  const [row] = await knex("webhook_deliveries")
    .insert({
      ...data,
      status: "PENDING",
      attempts: 0,
    })
    .returning("*");
  return row as WebhookDelivery;
}

export async function updateDeliveryStatus(
  id: string,
  status: string,
  data: {
    last_response_status?: number;
    last_error?: string;
    attempts?: number;
    last_attempt_at?: string;
  }
): Promise<void> {
  const update: Record<string, unknown> = { status };

  if (data.last_response_status !== undefined)
    update.last_response_status = data.last_response_status;
  if (data.last_error !== undefined) update.last_error = data.last_error;
  if (data.attempts !== undefined) update.attempts = data.attempts;
  if (data.last_attempt_at !== undefined)
    update.last_attempt_at = data.last_attempt_at;

  await knex("webhook_deliveries").where("id", id).update(update);
}

export async function listDeliveriesForSubscription(
  subscriptionId: string,
  limit = 100
): Promise<WebhookDelivery[]> {
  const rows = await knex("webhook_deliveries")
    .where("subscription_id", subscriptionId)
    .orderBy("created_at", "desc")
    .limit(limit);
  return rows as WebhookDelivery[];
}

export async function getRetryableDeliveries(
  maxAttempts: number
): Promise<WebhookDelivery[]> {
  const rows = await knex("webhook_deliveries")
    .where("status", "RETRYING")
    .where("attempts", "<", maxAttempts)
    .orderBy("created_at", "asc");
  return rows as WebhookDelivery[];
}

export async function incrementSubscriptionFailureCount(
  subscriptionId: string
): Promise<void> {
  await knex("webhook_subscriptions")
    .where("id", subscriptionId)
    .increment("failure_count", 1);
}

export async function deactivateSubscription(
  subscriptionId: string
): Promise<void> {
  await knex("webhook_subscriptions")
    .where("id", subscriptionId)
    .update({ is_active: false });
}
