import { useState } from "react";
import { useWebhooks, useWebhookDeliveries, useCreateWebhook, useDeleteWebhook } from "../hooks/useWebhooks";
import { fmtDateTime } from "../lib/api";
import { StatusBadge } from "../components/StatusBadge";
import { Modal } from "../components/Modal";
import type { WebhookSubscription, WebhookDelivery } from "../types/api";

const ALL_EVENT_TYPES = [
  "TRANSACTION_POSTED",
  "TRANSACTION_APPROVED",
  "TRANSACTION_REJECTED",
  "PERIOD_SOFT_CLOSED",
  "PERIOD_CLOSED",
  "APPROVAL_ESCALATED",
];

function DeliveryHistoryRow({ delivery }: { delivery: WebhookDelivery }) {
  return (
    <tr>
      <td className="text-sm">{delivery.event_type}</td>
      <td><StatusBadge status={delivery.status} /></td>
      <td className="num text-sm">{delivery.attempts}</td>
      <td className="text-sm">{delivery.last_response_status ?? ""}</td>
      <td className="text-sm muted">{fmtDateTime(delivery.last_attempt_at)}</td>
      <td className="text-sm" style={{ color: delivery.last_error ? "#dc2626" : undefined }}>
        {delivery.last_error || ""}
      </td>
    </tr>
  );
}

function DeliveryHistoryPanel({ subscriptionId }: { subscriptionId: string }) {
  const { data: deliveries, isLoading, error } = useWebhookDeliveries(subscriptionId);

  if (isLoading) return <div className="loading" style={{ margin: "8px 0" }}>Loading deliveries...</div>;
  if (error) return <div className="error-box">{"Error: " + (error as Error).message}</div>;
  if (!deliveries || deliveries.length === 0) {
    return <div className="muted text-sm" style={{ padding: "8px 0" }}>No deliveries recorded yet.</div>;
  }

  return (
    <table className="tbl" style={{ marginTop: 8 }}>
      <thead>
        <tr>
          <th>Event Type</th>
          <th>Status</th>
          <th className="num">Attempts</th>
          <th>Response</th>
          <th>Last Attempt</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {deliveries.map(function(d: WebhookDelivery) {
          return <DeliveryHistoryRow key={d.id} delivery={d} />;
        })}
      </tbody>
    </table>
  );
}

function AddWebhookModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  const createMutation = useCreateWebhook();

  function toggleEvent(evt: string) {
    setSelectedEvents(function(prev) {
      if (prev.indexOf(evt) !== -1) return prev.filter(function(e) { return e !== evt; });
      return prev.concat([evt]);
    });
  }

  async function handleSubmit() {
    if (!url.trim()) { setErr("Callback URL is required."); return; }
    if (selectedEvents.length === 0) { setErr("Select at least one event type."); return; }
    if (!secret.trim()) { setErr("Secret is required."); return; }
    setErr("");
    setSubmitting(true);
    try {
      await createMutation.mutateAsync({ callback_url: url.trim(), event_types: selectedEvents, secret: secret.trim() });
      onClose();
    } catch (e) {
      setErr((e as Error).message || "Failed to create subscription.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Add Webhook Subscription" onClose={onClose}>
      <div style={{ padding: "0 0 12px", minWidth: 420 }}>
        <div className="form-row" style={{ marginBottom: 12 }}>
          <label className="form-label">Callback URL</label>
          <input
            className="form-input"
            type="url"
            placeholder="https://your-service.example.com/gl-events"
            value={url}
            onChange={function(e) { setUrl(e.target.value); }}
            style={{ width: "100%" }}
          />
        </div>

        <div className="form-row" style={{ marginBottom: 12 }}>
          <label className="form-label">Event Types</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
            {ALL_EVENT_TYPES.map(function(evt) {
              return (
                <label key={evt} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={selectedEvents.indexOf(evt) !== -1}
                    onChange={function() { toggleEvent(evt); }}
                  />
                  <span className="text-sm">{evt}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="form-row" style={{ marginBottom: 12 }}>
          <label className="form-label">HMAC Secret</label>
          <input
            className="form-input"
            type="text"
            placeholder="Shared secret for payload signing"
            value={secret}
            onChange={function(e) { setSecret(e.target.value); }}
            style={{ width: "100%" }}
          />
        </div>

        {err && <div className="error-box" style={{ marginBottom: 8 }}>{err}</div>}
      </div>
      <div className="modal-actions">
        <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Saving..." : "Add Subscription"}
        </button>
      </div>
    </Modal>
  );
}

function SubscriptionRow({ sub }: { sub: WebhookSubscription }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMutation = useDeleteWebhook();

  const urlDisplay = sub.callback_url.length > 60
    ? sub.callback_url.slice(0, 57) + "..."
    : sub.callback_url;

  async function handleDelete() {
    await deleteMutation.mutateAsync(sub.id);
    setConfirmDelete(false);
  }

  return (
    <>
      <tr>
        <td className="text-sm">
          <span title={sub.callback_url}>{urlDisplay}</span>
        </td>
        <td>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {sub.event_types.map(function(evt) {
              return (
                <span key={evt} className="badge badge-blue" style={{ fontSize: 10 }}>
                  {evt.replace(/_/g, " ")}
                </span>
              );
            })}
          </div>
        </td>
        <td>
          <span className={sub.is_active ? "badge badge-green" : "badge badge-gray"}>
            {sub.is_active ? "Active" : "Inactive"}
          </span>
        </td>
        <td>
          {sub.failure_count > 0 ? (
            <span className="badge badge-red">{sub.failure_count}</span>
          ) : (
            <span className="muted text-sm">0</span>
          )}
        </td>
        <td className="text-sm muted">{fmtDateTime(sub.last_delivery_at)}</td>
        <td>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={function() { setExpanded(function(v) { return !v; }); }}
            >
              {expanded ? "Hide" : "History"}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={function() { alert("Test delivery not yet implemented."); }}
            >
              Test
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={function() { setConfirmDelete(true); }}
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} style={{ background: "var(--bg-alt, #f9fafb)", padding: "8px 16px" }}>
            <DeliveryHistoryPanel subscriptionId={sub.id} />
          </td>
        </tr>
      )}
      {confirmDelete && (
        <Modal title="Confirm Deletion" onClose={function() { setConfirmDelete(false); }}>
          <div style={{ padding: "0 0 16px" }}>
            <p className="text-sm">
              Delete webhook subscription for <strong>{sub.callback_url}</strong>?
              This cannot be undone.
            </p>
          </div>
          <div className="modal-actions">
            <button className="btn btn-secondary btn-sm" onClick={function() { setConfirmDelete(false); }}>
              Cancel
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function WebhookManagement() {
  const [showAdd, setShowAdd] = useState(false);
  const { data: subs, isLoading, error } = useWebhooks();

  return (
    <div className="page">
      <div className="page-header">
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--text-h)" }}>
          Webhooks
        </h1>
        <div className="page-header-actions">
          <button className="btn btn-primary btn-sm" onClick={function() { setShowAdd(true); }}>
            Add Subscription
          </button>
        </div>
      </div>

      <div className="page-body">
        {isLoading && <div className="loading">Loading webhook subscriptions...</div>}
        {error && <div className="error-box">{"Error: " + (error as Error).message}</div>}

        {!isLoading && !error && subs && subs.length === 0 && (
          <div className="empty">
            No webhook subscriptions configured. Add one to start receiving events.
          </div>
        )}

        {!isLoading && !error && subs && subs.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Callback URL</th>
                <th>Event Types</th>
                <th>Status</th>
                <th>Failures</th>
                <th>Last Delivery</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {subs.map(function(sub: WebhookSubscription) {
                return <SubscriptionRow key={sub.id} sub={sub} />;
              })}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && <AddWebhookModal onClose={function() { setShowAdd(false); }} />}
    </div>
  );
}
