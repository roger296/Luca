import { create } from "zustand";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  roles: string[];
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem("gl_token"),
  user: (() => {
    try {
      return JSON.parse(localStorage.getItem("gl_user") || "null") as AuthUser | null;
    } catch {
      return null;
    }
  })(),
  isAuthenticated: !!localStorage.getItem("gl_token"),
  login: (token: string, user: AuthUser) => {
    localStorage.setItem("gl_token", token);
    localStorage.setItem("gl_user", JSON.stringify(user));
    set({ token, user, isAuthenticated: true });
  },
  logout: () => {
    localStorage.removeItem("gl_token");
    localStorage.removeItem("gl_user");
    set({ token: null, user: null, isAuthenticated: false });
  },
}));
