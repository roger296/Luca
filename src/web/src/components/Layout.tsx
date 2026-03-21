import { useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { useAuthStore } from "../store/authStore";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleSignOut = () => {
    logout();
    navigate("/login");
  };

  const primaryRole = user && user.roles && user.roles.length > 0 ? user.roles[0] : "";

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar />
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* App header: user info + sign out */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "0 16px",
            height: 44,
            borderBottom: "1px solid #e0e0e0",
            background: "#fff",
            flexShrink: 0,
            gap: 12,
          }}
        >
          {user && (
            <>
              <span style={{ fontSize: 13, color: "#444" }}>{user.display_name}</span>
              {primaryRole && (
                <span
                  className="badge"
                  style={{ fontSize: 11, padding: "2px 8px" }}
                >
                  {primaryRole}
                </span>
              )}
              <button
                className="btn"
                onClick={handleSignOut}
                style={{ fontSize: 12, padding: "4px 12px" }}
              >
                Sign Out
              </button>
            </>
          )}
        </header>

        {/* Page content */}
        {children}
      </main>
    </div>
  );
}
