
const MAP: Record<string, string> = {
  PENDING: "badge badge-amber",
  PARTIALLY_APPROVED: "badge badge-blue",
  APPROVED: "badge badge-green",
  REJECTED: "badge badge-red",
  ESCALATED: "badge badge-amber",
  OPEN: "badge badge-green",
  SOFT_CLOSE: "badge badge-amber",
  HARD_CLOSE: "badge badge-gray",
  DELIVERED: "badge badge-green",
  FAILED: "badge badge-red",
  RETRYING: "badge badge-amber",
  PROVISIONAL: "badge badge-amber",
  AUTHORITATIVE: "badge badge-green",
};

export function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  const cls = MAP[status] || "badge badge-gray";
  return <span className={cls}>{status.replace(/_/g, " ")}</span>;
}
