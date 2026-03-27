# VPS Deployment Guide — Luca's General Ledger

This guide deploys the full stack to a cloud VPS so Cowork can connect to the MCP server
over a real public HTTPS URL. Cowork blocks `localhost` connections, so this is required
to use the Cowork connector with Luca.

---

## What You Will End Up With

| Service | URL | Purpose |
|---------|-----|---------|
| GL web app | `https://gl.yourdomain.com` | Browser UI, REST API |
| MCP server | `https://mcp.yourdomain.com/mcp` | Cowork connector URL |
| OAuth login | `https://mcp.yourdomain.com/authorize` | Shown automatically by Cowork |

---

## Prerequisites

Before you start you need:

- A VPS running **Ubuntu 22.04** (any provider — DigitalOcean, Hetzner, Linode, Vultr etc.)
  Minimum spec: 1 vCPU, 2 GB RAM, 20 GB disk. A $6/month Hetzner CAX11 is more than enough.
- A domain name you control (e.g. `yourdomain.com`)
- SSH access to the VPS as a non-root user with `sudo`

---

## Step 1 — Point DNS at Your Server

Log in to your domain registrar's DNS panel and create two A records:

| Name | Type | Value |
|------|------|-------|
| `gl` | A | `<your VPS IP address>` |
| `mcp` | A | `<your VPS IP address>` |

DNS changes can take a few minutes to an hour to propagate. You can check with:

```
nslookup gl.yourdomain.com
nslookup mcp.yourdomain.com
```

Both should return your VPS IP before you proceed to Step 4.

---

## Step 2 — Initial Server Setup

SSH into your VPS and upload the project:

```bash
# On your local machine — copy the project to the server
rsync -avz --exclude node_modules --exclude dist --exclude .git \
    "C:/Users/roger/Product Search - CleverDeals/Accounts Package/lucas-general-ledger-v1-clean/" \
    user@YOUR_VPS_IP:~/luca-gl/
```

Then SSH in and run the setup script:

```bash
ssh user@YOUR_VPS_IP
cd ~/luca-gl
chmod +x deploy/setup.sh
./deploy/setup.sh
```

This installs Docker, Nginx, Certbot, and configures the firewall. It takes about 2 minutes.

If the script says Docker was just installed, **log out and back in** before continuing:

```bash
exit
ssh user@YOUR_VPS_IP
```

---

## Step 3 — Configure Environment Variables

```bash
cd ~/luca-gl
cp deploy/.env.example deploy/.env
nano deploy/.env
```

Fill in every value:

| Variable | What to put |
|----------|-------------|
| `GL_DOMAIN` | `gl.yourdomain.com` (your actual domain) |
| `MCP_DOMAIN` | `mcp.yourdomain.com` (your actual domain) |
| `DB_PASSWORD` | Run `openssl rand -base64 32` and paste the output |
| `JWT_SECRET` | Run `openssl rand -base64 48` and paste the output |
| `MCP_USER_ID` | Your email address, e.g. `roger@etailsupport.com` |
| `DB_NAME`, `DB_USER`, `MCP_TENANT_ID` | Leave as defaults |

Save and exit nano with `Ctrl+O`, `Enter`, `Ctrl+X`.

---

## Step 4 — Configure Nginx

```bash
# Read your domain from .env
source deploy/.env

# Copy the template and substitute your actual domain names
sed "s/yourdomain\.com/${GL_DOMAIN#gl.}/g" deploy/nginx/luca-gl.conf \
    | sudo tee /etc/nginx/sites-available/luca-gl > /dev/null

sudo ln -sf /etc/nginx/sites-available/luca-gl /etc/nginx/sites-enabled/luca-gl

# Remove the default site if it exists
sudo rm -f /etc/nginx/sites-enabled/default

# Test the config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

---

## Step 5 — Get SSL Certificates (Let's Encrypt)

```bash
source deploy/.env

# Get certificates for both subdomains
sudo certbot --nginx \
    -d gl.yourdomain.com \
    -d mcp.yourdomain.com \
    --non-interactive \
    --agree-tos \
    --email roger@etailsupport.com
```

Certbot will automatically update the nginx config with the certificate paths and set up
auto-renewal. Verify it worked:

```bash
sudo systemctl reload nginx
curl -I https://gl.yourdomain.com/health
curl -I https://mcp.yourdomain.com/health
```

Both should return `HTTP/2 200`.

---

## Step 6 — Build and Start the Stack

```bash
cd ~/luca-gl

# Build both Docker images and start all three containers (db, api, mcp)
docker compose -f docker-compose.vps.yml --env-file deploy/.env up -d --build
```

This takes 3–5 minutes the first time (downloading base images, npm install, esbuild compile).

Check that all containers started:

```bash
docker compose -f docker-compose.vps.yml ps
```

You should see `gl-v1-db`, `gl-v1-api`, and `gl-v1-mcp` all showing status `running`.

Check the MCP server credentials (you need these for Step 7):

```bash
docker compose -f docker-compose.vps.yml logs mcp | grep -A 8 "Cowork Connector"
```

This prints the OAuth ID and Secret the MCP server generated.

---

## Step 7 — Add the Connector in Cowork

1. Open the **Claude desktop app** and go to **Customize → Connectors → Add custom connector**
2. Enter a name: `Luca`
3. Enter the URL: `https://mcp.yourdomain.com/mcp`
4. Open **Advanced Settings**
5. Paste the **OAuth ID** and **OAuth Secret** from Step 6
6. Click **Add**

Cowork will open a browser window to `https://mcp.yourdomain.com/authorize` showing the
"Luca's General Ledger — Allow Access" page. Click **Allow Access**.

The connector should then show as connected.

---

## Day-to-Day Operations

**View live logs:**
```bash
docker compose -f docker-compose.vps.yml logs -f mcp
docker compose -f docker-compose.vps.yml logs -f api
```

**Restart a service after a code change:**
```bash
# Upload new files first (rsync command from Step 2)
docker compose -f docker-compose.vps.yml --env-file deploy/.env up -d --build mcp
```

**Stop everything:**
```bash
docker compose -f docker-compose.vps.yml down
```

**Database backup:**
```bash
docker exec gl-v1-db pg_dump -U gl_admin gl_ledger > backup-$(date +%Y%m%d).sql
```

---

## Troubleshooting

**"Connection refused" when curling the health endpoints:**
The containers haven't started yet or failed. Check `docker compose logs`.

**"Failed to add connector" in Cowork after Step 7:**
Check that `https://mcp.yourdomain.com/.well-known/oauth-protected-resource` returns JSON.
If it returns an nginx 502, the MCP container isn't running — check `docker compose ps`.

**The authorization page shows but "Allow Access" doesn't complete:**
The OAuth callback POST is going to Cowork's callback URL. Check the MCP logs for any errors
on the `POST /token` request that follows the callback.

**SSL certificate errors:**
Run `sudo certbot renew --dry-run` to check that auto-renewal is working.

**Container fails to start with "MCP_TLS_DISABLE is required":**
You're running the VPS compose file but forgot `--env-file deploy/.env`. The `.env` file
must be passed explicitly because it's not named `.env` in the project root.

---

## Security Notes

- Port 3000 and 3002 are bound to `127.0.0.1` only — they are never directly accessible
  from the internet. All traffic goes through nginx which enforces HTTPS.
- The `deploy/.env` file contains secrets — keep it off git (it's in `.gitignore`).
- The database is not exposed to the host network at all — it's internal to Docker.
- JWT tokens expire after 1 hour; Cowork will use the refresh token automatically.
