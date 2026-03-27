
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import type { WebhookSubscription, WebhookDelivery } from "../types/api";

export function useWebhooks() {
  return useQuery<WebhookSubscription[]>({
    queryKey: ["webhooks"],
    queryFn: () => apiFetch<WebhookSubscription[]>("/webhooks"),
  });
}

export function useWebhookDeliveries(subscriptionId: string) {
  return useQuery<WebhookDelivery[]>({
    queryKey: ["webhooks", subscriptionId, "deliveries"],
    queryFn: () => apiFetch<WebhookDelivery[]>("/webhooks/" + subscriptionId + "/deliveries"),
    enabled: !!subscriptionId,
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { callback_url: string; event_types: string[]; secret: string }) =>
      apiFetch<WebhookSubscription>("/webhooks", { method: "POST", body: JSON.stringify(data) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webhooks"] }); },
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiFetch("/webhooks/" + id, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["webhooks"] }); },
  });
}
