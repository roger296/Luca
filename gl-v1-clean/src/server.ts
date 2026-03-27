import path from "path";
import fs from "fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { config } from "./config/index";
import router from "./api/routes";
import authRouter from "./api/auth";
import { errorHandler } from "./api/middleware/errors";
import { processRetryQueue } from "./engine/webhooks";
import { escalateOverdueApprovals } from "./engine/approval";

const app = express();

// Security middleware
app.use(helmet({
  // Allow the frontend SPA to load inline scripts from the same origin
  contentSecurityPolicy: false,
}));
app.use(cors());

// Logging
app.use(morgan(config.env === "production" ? "combined" : "dev"));

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check (no auth required)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "gl-v1", timestamp: new Date().toISOString() });
});

// Auth routes (public � must come before GL routes which require authentication)
app.use("/api/v1/auth", authRouter);

// GL API routes (all protected by authenticate middleware in routes.ts)
app.use("/api/v1/gl", router);

// Serve React frontend static files (present in production Docker image)
// The compiled frontend lives at dist/web/dist relative to this file's directory
// When compiled to dist/src/server.js, __dirname is dist/src/
// The frontend was built to dist/web/dist (one level up from dist/src)
const webDistPath = path.join(__dirname, "..", "web", "dist");
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  // SPA catch-all: serve index.html for all non-API client-side routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDistPath, "index.html"));
  });
} else {
  // Development mode without built frontend: return 404 JSON for unknown routes
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Route not found" } });
  });
}

// Central error handler — must be last
app.use(errorHandler);

if (require.main === module) {
  app.listen(config.server.port, () => {
    console.log();
    if (fs.existsSync(webDistPath)) {
      console.log();
    }
  });

  // Background job: process webhook retry queue every 60 seconds
  setInterval(() => {
    void processRetryQueue().catch((err: unknown) => {
      console.error("[webhooks] Retry queue error:", err);
    });
  }, 60_000);

  // Background job: escalate overdue approvals every 15 minutes
  setInterval(() => {
    void (async () => {
      try {
        await escalateOverdueApprovals(config.webhooks.escalationHours);
      } catch (err: unknown) {
        console.error("[escalation] Error:", err);
      }
    })();
  }, 15 * 60_000);
}

export { app };
