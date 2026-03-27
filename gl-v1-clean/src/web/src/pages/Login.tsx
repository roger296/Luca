import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import type { AuthUser } from "../store/authStore";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json() as { success: boolean; data?: { token: string; user: AuthUser }; error?: { message: string } };
      if (!res.ok || !json.success) {
        setError((json.error && json.error.message) || "Login failed");
        return;
      }
      if (json.data) {
        login(json.data.token, json.data.user);
        navigate("/");
      }
    } catch {
      setError("Unable to connect to the server. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#f5f5f5" }}>
      <div className="card" style={{ width: 400, padding: 40 }}>
        <h1 style={{ textAlign: "center", marginBottom: 6, fontSize: 22, fontWeight: 700, color: "#1a1a2e" }}>
          General Ledger
        </h1>
        <p style={{ textAlign: "center", marginBottom: 28, color: "#666", fontSize: 13 }}>
          Sign in to your account
        </p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              autoComplete="email"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div style={{ color: "#c00", marginBottom: 14, fontSize: 13, padding: "8px 12px", background: "#fff0f0", borderRadius: 4, border: "1px solid #fcc" }}>
              {error}
            </div>
          )}
          <button
            className="btn btn-primary"
            type="submit"
            disabled={loading}
            style={{ width: "100%", padding: "10px", marginTop: 4 }}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        <p style={{ textAlign: "center", marginTop: 20, fontSize: 11, color: "#aaa" }}>
          General Ledger V1
        </p>
      </div>
    </div>
  );
}
