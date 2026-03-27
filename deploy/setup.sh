#!/usr/bin/env bash
# deploy/setup.sh
#
# One-shot VPS setup script for Luca's General Ledger.
# Run once on a fresh Ubuntu 22.04 server as a non-root user with sudo.
#
# Usage:
#   chmod +x deploy/setup.sh
#   ./deploy/setup.sh
#
# This script installs: Docker, Docker Compose plugin, Nginx, Certbot.
# It does NOT deploy the app — see VPS_DEPLOYMENT.md for the full steps.

set -euo pipefail

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

info()  { echo -e "${GREEN}[setup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $*"; }

# ── 1. System packages ────────────────────────────────────────────────────────
info "Updating package index..."
sudo apt-get update -qq

info "Installing prerequisites..."
sudo apt-get install -y -qq \
    ca-certificates curl gnupg lsb-release \
    nginx certbot python3-certbot-nginx \
    git ufw

# ── 2. Docker ─────────────────────────────────────────────────────────────────
if command -v docker &>/dev/null; then
    info "Docker already installed ($(docker --version)). Skipping."
else
    info "Installing Docker..."
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
        https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
        | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

    sudo apt-get update -qq
    sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
        docker-buildx-plugin docker-compose-plugin

    sudo usermod -aG docker "$USER"
    info "Docker installed. You may need to log out and back in for group membership to take effect."
fi

# ── 3. Firewall ───────────────────────────────────────────────────────────────
info "Configuring UFW firewall..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable
sudo ufw status

# ── 4. Nginx ──────────────────────────────────────────────────────────────────
info "Enabling nginx..."
sudo systemctl enable nginx
sudo systemctl start nginx

# ── 5. Done ───────────────────────────────────────────────────────────────────
echo ""
info "Setup complete! Next steps:"
echo "  1. Upload the project files to this server (git clone or rsync)"
echo "  2. Copy deploy/.env.example to deploy/.env and fill in all values"
echo "  3. Point your DNS records to this server's IP address"
echo "  4. Follow deploy/VPS_DEPLOYMENT.md for the remaining steps"
echo ""
warn "If Docker was just installed, log out and back in before proceeding."
