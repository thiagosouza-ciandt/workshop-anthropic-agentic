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

# Docker Compose (plugin or standalone)
if docker compose version &>/dev/null 2>&1; then
  COMPOSE="docker compose"
elif docker-compose version &>/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  error "Docker Compose not found. Install it with: sudo apt install docker-compose-plugin"
fi
success "Compose: $($COMPOSE version --short 2>/dev/null || $COMPOSE version | head -1)"

# ── 3. Node.js ────────────────────────────────────────────────────────────────
info "Checking Node.js..."
if ! command -v node &>/dev/null; then
  info "Node.js not found — installing via nvm..."
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
  # Load nvm in current shell
  export NVM_DIR="$HOME/.nvm"
  # shellcheck source=/dev/null
  [ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"
  nvm install 20
  nvm use 20
else
  NODE_VERSION=$(node --version | tr -d 'v')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [[ "$NODE_MAJOR" -lt 18 ]]; then
    error "Node.js $NODE_VERSION found but >=18 is required. Install via nvm: nvm install 20"
  fi
  success "Node.js v$NODE_VERSION"
fi

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
cd "$SCRIPT_DIR/infra"
$COMPOSE up -d --build
cd "$SCRIPT_DIR"

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

# Wait for MCP docs server
info "Waiting for MCP docs server to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8082/health > /dev/null 2>&1; then
    success "MCP docs server is up (http://localhost:8082)"
    break
  fi
  if [[ $i -eq 30 ]]; then
    warn "MCP server did not respond at /health after 30s — it may still start correctly."
    warn "Check: $COMPOSE -f infra/docker-compose.yml logs mcp-docs"
    break
  fi
  sleep 1
done

# ── 6. npm install ────────────────────────────────────────────────────────────
info "Installing Node.js dependencies..."
npm install --prefer-offline 2>&1 | tail -3
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
