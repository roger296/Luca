
export function DataFlagBadge({ flag }: { flag?: string }) {
  if (!flag) return null;
  const cls = flag === "AUTHORITATIVE" ? "badge badge-green" : "badge badge-amber";
  return <span className={cls}>{flag}</span>;
}
