
import { useAuthStore } from "../store/authStore";

const API_BASE = "/api/v1/gl";

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = useAuthStore.getState().token;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options?.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  const res = await fetch(API_BASE + path, {
    ...options,
    headers,
  });

  // Token expired or invalid -- log out and redirect to login page
  if (res.status === 401) {
    useAuthStore.getState().logout();
    window.location.href = "/login";
    throw new Error("Session expired. Please sign in again.");
  }

  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error((json?.error?.message) || ("API error " + res.status));
  }
  return (json.data !== undefined ? json.data : json) as T;
}

export function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? ("?" + s) : "";
}

export function fmtMoney(val: string | number | undefined | null, currency?: string): string {
  if (val === undefined || val === null || val === "") return "";
  const n = parseFloat(String(val));
  if (isNaN(n)) return String(val);
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? "-" : "";
  return (currency ? (currency + " ") : "") + sign + formatted;
}

export function fmtDate(d: string | undefined | null): string {
  if (!d) return "";
  return d.slice(0, 10);
}

export function fmtDateTime(d: string | undefined | null): string {
  if (!d) return "";
  return d.replace("T", " ").slice(0, 19);
}

export function shortHash(hash: string | undefined | null): string {
  if (!hash) return "";
  return hash.slice(0, 8) + "..." + hash.slice(-8);
}
