import type { Request, Response } from "express";
import { Router } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { config } from "../config/index";
import { findUserByEmail, findUserById, recordLogin } from "../db/queries/users";
import { authenticate } from "./middleware/auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function issueToken(user: {
  id: string;
  email: string;
  roles: string[];
  display_name: string;
}): { token: string; expires_at: string } {
  const payload = {
    sub: user.id,
    email: user.email,
    roles: user.roles,
    display_name: user.display_name,
  };
  const token = jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as string,
  });
  const decoded = jwt.decode(token) as { exp: number };
  const expires_at = new Date(decoded.exp * 1000).toISOString();
  return { token, expires_at };
}

function userResponse(user: {
  id: string;
  email: string;
  display_name: string;
  roles: string[];
}) {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    roles: user.roles,
  };
}

// ---------------------------------------------------------------------------
// Handlers (exported for testability)
// ---------------------------------------------------------------------------

export async function handleLogin(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: { code: "MISSING_FIELDS", message: "email and password are required" },
      });
      return;
    }

    const user = await findUserByEmail(email);

    // Constant-time check: always run bcrypt even when user not found
    // (compare against a dummy hash to prevent timing attacks)
    const dummyHash = "$2b$10$dummyhashfortimingprotectionXXXXXXXXXXXXXXXXXXXXXX";
    const hashToCheck = user ? user.password_hash : dummyHash;
    const passwordMatch = await bcrypt.compare(password, hashToCheck);

    if (!user || !passwordMatch) {
      res.status(401).json({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
      });
      return;
    }

    if (!user.is_active) {
      res.status(401).json({
        success: false,
        error: { code: "ACCOUNT_DISABLED", message: "This account has been disabled" },
      });
      return;
    }

    await recordLogin(user.id);

    const { token, expires_at } = issueToken(user);

    res.json({
      success: true,
      data: { token, user: userResponse(user), expires_at },
    });
  } catch (err) {
    console.error("[auth] Login error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "An internal error occurred" },
    });
  }
}

export async function handleRefresh(req: Request, res: Response): Promise<void> {
  try {
    const user = await findUserById(req.userId);

    if (!user || !user.is_active) {
      res.status(401).json({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "User not found or account disabled" },
      });
      return;
    }

    const { token, expires_at } = issueToken(user);

    res.json({
      success: true,
      data: { token, user: userResponse(user), expires_at },
    });
  } catch (err) {
    console.error("[auth] Refresh error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "An internal error occurred" },
    });
  }
}

export async function handleMe(req: Request, res: Response): Promise<void> {
  try {
    const user = await findUserById(req.userId);

    if (!user || !user.is_active) {
      res.status(401).json({
        success: false,
        error: { code: "INVALID_CREDENTIALS", message: "User not found or account disabled" },
      });
      return;
    }

    res.json({ success: true, data: userResponse(user) });
  } catch (err) {
    console.error("[auth] Me error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "An internal error occurred" },
    });
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

// POST /api/v1/auth/login � public, no auth middleware
router.post("/login", handleLogin);

// POST /api/v1/auth/refresh � requires valid JWT
router.post("/refresh", authenticate, handleRefresh);

// GET /api/v1/auth/me � requires valid JWT
router.get("/me", authenticate, handleMe);

export default router;
