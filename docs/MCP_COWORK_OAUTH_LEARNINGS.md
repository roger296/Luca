# MCP + Cowork OAuth Integration — Learnings & Reference

This document captures everything discovered while getting Luca's General Ledger to connect
to Claude / Cowork via the MCP Streamable HTTP transport with OAuth 2.1. Written so that
future developers (or a future AI session) can reproduce a working setup in one pass.

---

## 1. Why localhost Never Works

**Root cause:** Cowork (and the claude.ai web interface) block connections to `localhost` /
`127.0.0.1` URLs as a security policy. When you click "Add" in the connector dialog with a
`https://localhost:3002/mcp` URL, Cowork does not make a single HTTP request to the server —
it silently fails with "Failed to add connector" before even attempting a connection.

**Evidence:** Server logs showed zero activity when the connector was added with a localhost
URL, even with a valid mkcert SSL certificate trusted by the OS.

**Solution:** Deploy the MCP server to a VPS with a real public domain and a Let's Encrypt
SSL certificate. The connector URL must be `https://yourdomain.com/mcp`.

---

## 2. OAuth 2.1 Is Required

Cowork does not support unauthenticated MCP endpoints. When it contacts a remote MCP URL,
the first thing it does is:

1. `POST /mcp` (no token) — expects a `401` response
2. Reads the `WWW-Authenticate` header on that 401 to find the resource metadata URL
3. `GET /.well-known/oauth-protected-resource` — discovers which auth server to use
4. `GET /.well-known/oauth-authorization-server` — discovers endpoints
5. `POST /register` — Dynamic Client Registration (RFC 7591)
6. `GET /authorize` — redirects user to the auth page
7. User clicks Allow → `POST /authorize` → redirect back to Cowork
8. `POST /token` — exchanges the auth code for an access token
9. All subsequent `POST /mcp` requests include `Authorization: Bearer <token>`

If any step is missing or returns an unexpected response, Cowork shows "Failed to add
connector" with no useful error message.

---

## 3. Bugs Found in Cowork / Claude.ai (and How We Worked Around Them)

### Bug 1 — WWW-Authenticate header required on 401
**Symptom:** Cowork never starts the OAuth flow even though the server responds with 401.
**Cause:** Without a `WWW-Authenticate` header, Cowork doesn't know there's an OAuth server.
**Fix:** Every 401 from the MCP endpoint must include:
```
WWW-Authenticate: Bearer realm="gl-ledger", resource_metadata="https://yourdomain.com/.well-known/oauth-protected-resource"
```
**File:** `src/mcp/oauth/middleware.ts`

### Bug 2 — OAuth endpoints must be at root paths
**Symptom:** Cowork ignores `authorization_endpoint` and `token_endpoint` values in the
discovery metadata and hardcodes `/authorize` and `/token` at the server root.
**Cause:** Cowork bug (GitHub issue #82 on anthropics/claude-ai-mcp).
**Fix:** Mount all OAuth endpoints at root — `/authorize`, `/token`, `/register` — NOT
under `/oauth/*`.
**File:** `src/mcp/oauth/router.ts`

### Bug 3 — OAuth callback must use GET redirect (not POST form)
**History:** Early research suggested Cowork's local callback returned 405 on GET, so we
implemented a self-submitting POST form. This was wrong for the production (cloud) case.
**Actual behaviour:** When connecting via claude.ai, the `redirect_uri` is
`https://claude.ai/api/mcp/auth_callback`. This endpoint expects a standard OAuth 2.0
GET redirect with `?code=xxx&state=yyy` query parameters. Sending a POST form body
returns `405 Method Not Allowed` from claude.ai.
**Fix:** Use a standard GET redirect in the POST `/authorize` handler:
```typescript
const callbackUrl = new URL(redirect_uri);
callbackUrl.searchParams.set("code", code);
if (state) callbackUrl.searchParams.set("state", state);
res.redirect(callbackUrl.toString());
```
**File:** `src/mcp/oauth/router.ts`

### Bug 4 — express.urlencoded() required for the approval form
**Symptom:** Clicking "Allow Access" on the OAuth approval page returned 500 Internal
Server Error. Log showed: `TypeError: Cannot read properties of undefined (reading 'replace')`
**Cause:** The approval page submits a standard HTML form (`application/x-www-form-urlencoded`).
The Express app only had `express.json()` middleware, so `req.body` was empty — all hidden
field values were `undefined`.
**Fix:** Add `express.urlencoded()` alongside `express.json()`:
```typescript
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
```
**File:** `src/mcp/server-http.ts`

---

## 4. Docker / VPS Deployment Issues Found

### Issue 1 — /app/data directory not writable by node user
**Symptom:** `oauth-clients.json` was never created on disk. Every container restart
generated new OAuth credentials, breaking any existing Cowork connections.
**Cause:** The Dockerfile runs the process as the `node` user. The `/app/data` directory
either didn't exist or was owned by root. When Docker mounted the `oauth_data` volume,
the `node` user couldn't write to it.
**Fix:** Added to `Dockerfile` (before `USER node`):
```dockerfile
RUN mkdir -p /app/data && chown -R node:node /app/data
```
**File:** `Dockerfile`

### Issue 2 — MCP server needs HTTP mode behind nginx
**Cause:** The original `server-http.ts` always started an HTTPS server and required TLS
certificate files. In a Docker + nginx setup, nginx handles TLS termination and proxies
plain HTTP to the container. The TLS cert files don't exist inside the container.
**Fix:** Added `MCP_TLS_DISABLE=true` environment variable support:
```typescript
const TLS_DISABLED = process.env.MCP_TLS_DISABLE === "true";
const server = TLS_DISABLED
  ? http.createServer(app)
  : https.createServer({ cert, key }, app);
server.listen(PORT, TLS_DISABLED ? "0.0.0.0" : "127.0.0.1", callback);
```
**File:** `src/mcp/server-http.ts`

### Issue 3 — Docker Compose env file with special characters
**Symptom:** `docker compose up` failed with `unexpected character "+" in variable name`.
**Cause:** Passwords generated with `openssl rand -base64 32` can contain `+`, `/`, and `=`
characters. Docker Compose env files treat unquoted `+` as a syntax error.
**Fix:** Wrap values containing special characters in double quotes in `deploy/.env`:
```
DB_PASSWORD="abc+def/ghi="
JWT_SECRET="xyz+123/456="
```
Or use `openssl rand -hex 32` to generate hex-only passwords that never need quoting.

### Issue 7 — Base64 passwords with `/` break the PostgreSQL connection URL
**Symptom:** API container kept restarting with `ECONNREFUSED 127.0.0.1:5432` even though
`DATABASE_URL` was confirmed to contain `@db:5432` (correct Docker hostname).
**Cause:** The `/` character in a base64 password (e.g. `abc+def/ghi=`) is a reserved URL
character. When the PostgreSQL client parses the connection string as a URL, it treats the
first `/` in the password as the start of the database path, discarding everything after it
including the hostname. With no hostname, it falls back to `127.0.0.1` (localhost), which
doesn't have a PostgreSQL instance — hence `ECONNREFUSED`.

This bug is invisible: `printenv DATABASE_URL` shows the correct string with `@db:5432`,
but the URL parser inside the pg library silently misreads it at connection time.

**Fix:** Always generate passwords using hex encoding — no special characters, no quoting
needed, no URL parsing ambiguity:
```bash
openssl rand -hex 32   # for DB_PASSWORD
openssl rand -hex 48   # for JWT_SECRET
```
**Rule:** Never use `openssl rand -base64` for secrets that end up in PostgreSQL connection
URLs. Hex only.

### Issue 4 — nginx config references letsencrypt files before certbot has run
**Symptom:** `nginx -t` failed with `open() "/etc/letsencrypt/options-ssl-nginx.conf" failed`.
**Cause:** The production nginx config includes `include /etc/letsencrypt/options-ssl-nginx.conf`
which is created by certbot. If you copy the production config before running certbot, nginx
won't start.
**Fix:** Two-step nginx setup:
1. First deploy a minimal HTTP-only config so nginx starts
2. Run certbot (`certbot --nginx -d ...`) which creates the letsencrypt files
3. Then deploy the full production config
```bash
# Step 1
cat > /etc/nginx/sites-available/luca-gl << 'EOF'
server { listen 80; server_name gl.yourdomain.com; location / { proxy_pass http://127.0.0.1:3000; } }
server { listen 80; server_name mcp.yourdomain.com; location / { proxy_pass http://127.0.0.1:3002; } }
EOF
nginx -t && systemctl reload nginx
# Step 2
certbot --nginx -d gl.yourdomain.com -d mcp.yourdomain.com ...
# Step 3 — replace with full config
```

### Issue 5 — certbot issues one cert for both subdomains
**Symptom:** After running certbot with `-d gl.yourdomain.com -d mcp.yourdomain.com`,
the cert is stored under `gl.yourdomain.com`. The nginx config template expects separate
cert files under each subdomain path.
**Fix:** Both nginx server blocks must point to the same cert path:
```nginx
# Both server blocks use the same certificate
ssl_certificate     /etc/letsencrypt/live/gl.yourdomain.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/gl.yourdomain.com/privkey.pem;
```

### Issue 6 — 1GB RAM insufficient for Docker build
**Symptom:** Docker build ran out of memory during `npm ci`.
**Fix:** Add a swap file before building:
```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

---

## 5. The Complete Working OAuth Flow (Step by Step)

```
Cowork                    nginx (TLS)              MCP Server (port 3002)
------                    -----------              ----------------------
POST /mcp (no token)  →→→→→→→→→→→→→→→→→→→→→→→→→  401 + WWW-Authenticate header
GET /.well-known/oauth-protected-resource  →→→→→  { resource, authorization_servers }
GET /.well-known/oauth-authorization-server →→→→  { issuer, authorization_endpoint, ... }
POST /register            →→→→→→→→→→→→→→→→→→→→→  201 { client_id, client_secret, ... }
  [browser opens]
GET /authorize?client_id=...&code_challenge=... →  HTML approval page (Allow/Deny buttons)
  [user clicks Allow]
POST /authorize (form body: client_id, code_challenge, redirect_uri, state)
                          →→→→→→→→→→→→→→→→→→→→→  302 redirect to redirect_uri?code=xxx&state=yyy
  [browser follows redirect to claude.ai]
claude.ai receives code, calls:
POST /token { grant_type=authorization_code, code, code_verifier, client_id }
                          →→→→→→→→→→→→→→→→→→→→→  { access_token, refresh_token, expires_in }
POST /mcp (Authorization: Bearer <token>)
                          →→→→→→→→→→→→→→→→→→→→→  MCP response ✓
```

---

## 6. Key Files and Their Purpose

| File | Purpose |
|------|---------|
| `src/mcp/server-http.ts` | Express server, CORS, TLS/HTTP mode toggle, mounts OAuth router and MCP endpoint |
| `src/mcp/oauth/router.ts` | All OAuth endpoints: discovery, registration, authorize, token |
| `src/mcp/oauth/middleware.ts` | Bearer token validation + WWW-Authenticate header on 401 |
| `src/mcp/oauth/store.ts` | Client/code/token storage — clients persisted to `/app/data/oauth-clients.json` |
| `src/mcp/oauth/types.ts` | TypeScript interfaces for OAuth data structures |
| `Dockerfile` | Multi-stage build — creates `/app/data` dir owned by `node` user |
| `docker-compose.vps.yml` | VPS deployment — db + api + mcp containers, MCP with `MCP_TLS_DISABLE=true` |
| `deploy/nginx/luca-gl.conf` | Nginx config template — SSL termination, proxy to ports 3000 and 3002 |
| `deploy/.env.example` | Environment variable template |
| `deploy/VPS_DEPLOYMENT.md` | Step-by-step VPS deployment guide |

---

## 7. Critical Environment Variables

| Variable | Where Used | Notes |
|----------|-----------|-------|
| `MCP_TLS_DISABLE=true` | MCP container | Run plain HTTP; nginx handles SSL |
| `JWT_SECRET` | Token signing | Must match between api and mcp containers |
| `MCP_USER_ID` | Auth context | Email/ID that MCP tool calls run as |
| `MCP_HTTP_PORT` | MCP container | Default 3002 |

---

## 8. What to Do When oauth-clients.json Is Lost

If the MCP container restarts and generates new credentials, Cowork's saved client_id
will no longer match anything in the server's store.

**Symptoms:** OAuth authorization page shows "invalid_client — Unknown client_id."

**Fix:**
1. Get the new credentials from the server logs:
   ```bash
   docker compose -f docker-compose.vps.yml --env-file deploy/.env logs mcp | grep -A 4 "OAuth ID"
   ```
2. Use the **last** set shown (most recent startup).
3. In Cowork: remove the Luca connector, re-add it with the new OAuth ID and Secret.

**Permanent fix:** Ensure the `oauth_data` Docker volume is mounted and the `/app/data`
directory inside the container is writable by the `node` user (see Issue 1 above). The
updated `Dockerfile` handles this.

---

## 9. Quick Reconnect Checklist

If the connector stops working after a server restart:

- [ ] Are all containers running? `docker compose -f docker-compose.vps.yml --env-file deploy/.env ps`
- [ ] Does `https://mcp.yourdomain.com/health` return 200?
- [ ] Does `https://mcp.yourdomain.com/.well-known/oauth-protected-resource` return JSON?
- [ ] Has `/app/data/oauth-clients.json` been created? `docker exec gl-v1-mcp cat /app/data/oauth-clients.json`
- [ ] Do the credentials in Cowork's Advanced Settings match the ones in the logs?
- [ ] If not: remove and re-add the connector with fresh credentials from the logs.

---

## 10. Lessons Learned Summary

1. **Never test with localhost** — Cowork and claude.ai both block it. Use a real domain from the start.
2. **The WWW-Authenticate header is the trigger** — without it, Cowork won't attempt OAuth at all.
3. **OAuth endpoints must be at the server root** — `/authorize` and `/token`, not `/oauth/authorize`.
4. **Use standard GET redirect for the callback** — `claude.ai/api/mcp/auth_callback` expects `?code=xxx` query params, not a POST form.
5. **Add `express.urlencoded()`** — HTML forms don't POST JSON; the approval form needs the URL-encoded body parser.
6. **Create and own `/app/data` in the Dockerfile** — the `node` user can't write to Docker volume mount points created by root.
7. **Quote secrets in `.env` files** — base64 passwords contain `+` and `/` which break Docker Compose parsing.
8. **Two-step nginx setup** — HTTP-only config first, then certbot, then full SSL config.
9. **Add swap before Docker builds on 1GB servers** — `npm ci` will OOM without it.
10. **Never use base64 passwords in PostgreSQL connection URLs** — the `/` character breaks URL parsing silently. The host gets dropped and the client falls back to `127.0.0.1`. Always use `openssl rand -hex 32` for database passwords and JWT secrets. The bug is invisible in `printenv` — it only manifests at connection time inside the pg library.
