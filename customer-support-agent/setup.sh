#!/usr/bin/env bash
set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  CorpBank — Setup Script               ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# ── 1. OS check ───────────────────────────────────────────────────────────────
if [[ "$(uname -s)" != "Linux" ]]; then
  error "This script targets Ubuntu/Debian Linux."
fi

# ── 2. Docker ─────────────────────────────────────────────────────────────────
info "Checking Docker..."
if ! command -v docker &>/dev/null; then
  info "Docker not found — installing..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq ca-certificates curl gnupg lsb-release

  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update -qq
  sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin

  sudo usermod -aG docker "$USER"
  warn "Docker installed. You may need to log out and back in for group changes to take effect."
  warn "If 'docker compose' fails below, run: newgrp docker"
else
  success "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
fi

# Determine whether docker needs sudo.
# Tests with docker info (requires daemon access) — not just docker version.
SUDO=""
if ! docker info &>/dev/null 2>&1; then
  if sudo docker info &>/dev/null 2>&1; then
    SUDO="sudo"
    warn "Docker socket not accessible without sudo — running with sudo."
    warn "To fix permanently: sudo usermod -aG docker \$USER  (then log out and back in)"
  else
    error "Cannot connect to Docker daemon. Is it running? Try: sudo systemctl start docker"
  fi
fi

# Build compose command — always prefix with $SUDO so it matches docker access
if ${SUDO:+$SUDO} docker compose version &>/dev/null 2>&1; then
  COMPOSE="${SUDO:+$SUDO }docker compose"
elif ${SUDO:+$SUDO} docker-compose version &>/dev/null 2>&1; then
  COMPOSE="${SUDO:+$SUDO }docker-compose"
else
  error "Docker Compose not found. Install it with: sudo apt install docker-compose-plugin"
fi
success "Compose: $($COMPOSE version --short 2>/dev/null || $COMPOSE version | head -1)"

# ── 3. Node.js + npm ─────────────────────────────────────────────────────────
info "Checking Node.js and npm..."

NODE_OK=false
if command -v node &>/dev/null; then
  NODE_MAJOR=$(node --version | tr -d 'v' | cut -d. -f1)
  [[ "$NODE_MAJOR" -ge 18 ]] && NODE_OK=true
fi

if [[ "$NODE_OK" == false ]]; then
  info "Installing Node.js 20 via NodeSource (removing old version first)..."
  sudo apt-get update -qq
  sudo apt-get remove -y -qq nodejs npm 2>/dev/null || true
  sudo apt-get autoremove -y -qq 2>/dev/null || true
  sudo apt-get install -y -qq curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs

  # Reload PATH so the new node is found immediately
  hash -r
fi

# Verify version after install
NODE_MAJOR=$(node --version | tr -d 'v' | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  error "Node.js $(node --version) is still active after install. Open a new shell and retry."
fi

NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
success "Node.js $NODE_VERSION  |  npm $NPM_VERSION"

# ── 4. .env.local ─────────────────────────────────────────────────────────────
info "Checking .env.local..."
ENV_FILE="$SCRIPT_DIR/.env.local"

if [[ -f "$ENV_FILE" ]]; then
  success ".env.local already exists — skipping"
else
  warn ".env.local not found — creating template"
  cat > "$ENV_FILE" << 'EOF'
# AWS region where Bedrock is enabled
AWS_REGION=us-east-1

# Bearer token for Bedrock access (from your AWS account)
AWS_BEARER_TOKEN_BEDROCK=REPLACE_WITH_YOUR_TOKEN

# Shared secret for backoffice endpoints (set any value)
BACKOFFICE_SECRET=workshop

# CorpDB REST API (started by docker compose)
CORPDB_URL=http://localhost:3001

# MCP filesystem server (started by docker compose)
MCP_DOCS_URL=http://localhost:8082/sse
EOF
  warn "Fill in AWS_BEARER_TOKEN_BEDROCK in .env.local before starting the app."
fi

# Validate required variables
source "$ENV_FILE"
MISSING=()
[[ -z "${AWS_REGION:-}" ]]                && MISSING+=("AWS_REGION")
[[ -z "${AWS_BEARER_TOKEN_BEDROCK:-}" || "${AWS_BEARER_TOKEN_BEDROCK}" == "REPLACE_WITH_YOUR_TOKEN" ]] \
  && MISSING+=("AWS_BEARER_TOKEN_BEDROCK")
[[ -z "${CORPDB_URL:-}" ]]                && MISSING+=("CORPDB_URL")
[[ -z "${MCP_DOCS_URL:-}" ]]              && MISSING+=("MCP_DOCS_URL")

if [[ ${#MISSING[@]} -gt 0 ]]; then
  warn "The following variables are missing or unset in .env.local:"
  for v in "${MISSING[@]}"; do echo "    - $v"; done
  warn "Set them before running 'npm run dev'."
fi

# ── 5. Docker infrastructure ──────────────────────────────────────────────────
info "Starting Docker containers (CorpDB + MCP docs)..."
export DOCS_PATH="$SCRIPT_DIR/docs"
if [[ ! -d "$DOCS_PATH" ]]; then
  error "docs/ folder not found at $DOCS_PATH — make sure you cloned the full repository."
fi
info "Docs path: $DOCS_PATH"
cd "$SCRIPT_DIR/infra"
# --force-recreate ensures any existing container picks up the correct DOCS_PATH volume
DOCS_PATH="$DOCS_PATH" $COMPOSE up -d --build --force-recreate
cd "$SCRIPT_DIR"

# Verify the docs volume mounted correctly inside the container
info "Verifying docs volume inside mcp-docs container..."
sleep 3
DOC_COUNT=$(${SUDO:+$SUDO} docker exec corpbank-mcp-docs ls /docs 2>/dev/null | wc -l || echo 0)
if [[ "$DOC_COUNT" -eq 0 ]]; then
  error "docs/ did not mount into the container. Check DOCS_PATH=$DOCS_PATH and re-run setup."
fi
success "Docs mounted: $DOC_COUNT file(s) found in /docs"

# Wait for CorpDB
info "Waiting for CorpDB to be ready..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    success "CorpDB is up (http://localhost:3001)"
    break
  fi
  if [[ $i -eq 20 ]]; then
    error "CorpDB did not respond after 20s. Check: docker compose logs sqlite-api"
  fi
  sleep 1
done

# Wait for MCP docs server — supergateway exposes /sse, not /health
info "Waiting for MCP docs server to be ready..."
for i in $(seq 1 30); do
  if curl -sf --max-time 2 http://localhost:8082/sse > /dev/null 2>&1; then
    success "MCP docs server is up (http://localhost:8082/sse)"
    break
  fi
  if [[ $i -eq 30 ]]; then
    warn "MCP server did not respond after 30s."
    warn "Check logs: $COMPOSE logs mcp-docs"
    break
  fi
  sleep 1
done

# ── 6. npm install ────────────────────────────────────────────────────────────
info "Installing Node.js dependencies..."
# Remove stale build artifacts — .next built on another machine causes 404s on static chunks
rm -rf "$SCRIPT_DIR/.next"
npm install 2>&1 | tail -3
success "npm install done"

# ── 7. Done ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Setup complete!                       ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  Start the app:   npm run dev"
echo ""
echo "  URLs:"
echo "    Customer chat  →  http://localhost:3000"
echo "    Backoffice     →  http://localhost:3000/backoffice"
echo "    Database UI    →  http://localhost:3000/db"
echo ""
echo "  Test customers:"
echo "    Alice Johnson   +1-555-0101   credit \$2,000"
echo "    Bob Smith       +1-555-0102   credit \$500"
echo "    Carol Martinez  +1-555-0103   credit \$10,000"
echo "    David Lee       +1-555-0104   credit \$300"
echo ""
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo -e "  ${YELLOW}Action needed: fill in .env.local before starting.${NC}"
  echo ""
fi
