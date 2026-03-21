
import { NavLink } from "react-router-dom";

interface NavGroup { label: string; items: { to: string; label: string; icon: string }[] }

const NAV: NavGroup[] = [
  {
    label: "Daily Work",
    items: [
      { to: "/", label: "Dashboard", icon: "D" },
      { to: "/journal", label: "Journal", icon: "J" },
      { to: "/approvals", label: "Approvals", icon: "A" },
    ],
  },
  {
    label: "Reports",
    items: [
      { to: "/trial-balance", label: "Trial Balance", icon: "T" },
      { to: "/profit-and-loss", label: "Profit & Loss", icon: "P" },
      { to: "/balance-sheet", label: "Balance Sheet", icon: "B" },
      { to: "/cash-flow", label: "Cash Flow", icon: "C" },
    ],
  },
  {
    label: "Settings",
    items: [
      { to: "/accounts", label: "Chart of Accounts", icon: "L" },
      { to: "/periods", label: "Period Management", icon: "M" },
      { to: "/audit-trail", label: "Audit Trail", icon: "H" },
      { to: "/webhooks", label: "Webhooks", icon: "W" },
    ],
  },
];

const S: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 220, minWidth: 220, background: "var(--color-nav-bg)", color: "var(--color-nav-text)",
    display: "flex", flexDirection: "column", height: "100vh", overflowY: "auto", flexShrink: 0,
  },
  logo: {
    padding: "20px 16px 16px", fontSize: 15, fontWeight: 700, color: "#fff",
    borderBottom: "1px solid rgba(255,255,255,.1)", letterSpacing: "-.3px",
  },
  logoSub: { fontSize: 11, fontWeight: 400, color: "rgba(255,255,255,.4)", display: "block", marginTop: 2 },
  group: { padding: "16px 0 4px" },
  groupLabel: {
    fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: ".1em",
    color: "rgba(255,255,255,.35)", padding: "0 16px 6px",
  },
  item: {
    display: "flex", alignItems: "center", gap: 10, padding: "7px 16px",
    fontSize: 13, color: "var(--color-nav-text)", textDecoration: "none", borderRadius: 0,
    transition: "background .1s",
  },
  icon: {
    width: 22, height: 22, borderRadius: 4, background: "rgba(255,255,255,.12)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 11, fontWeight: 700, flexShrink: 0, color: "#fff",
  },
};

export function Sidebar() {
  return (
    <nav style={S.sidebar}>
      <div style={S.logo}>
        CleverDeals GL
        <span style={S.logoSub}>General Ledger v1</span>
      </div>
      {NAV.map((g) => (
        <div key={g.label} style={S.group}>
          <div style={S.groupLabel}>{g.label}</div>
          {g.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              style={({ isActive }) => ({
                ...S.item,
                background: isActive ? "rgba(37,99,235,.7)" : "transparent",
                color: isActive ? "#fff" : "var(--color-nav-text)",
              })}
            >
              <span style={S.icon}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}
