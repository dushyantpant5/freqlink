#!/usr/bin/env bash
set -e

# ─── FreqLink Installer ───────────────────────────────────────────────────────
# Works on macOS and Linux. Installs Node.js via nvm if not present.

REQUIRED_NODE_MAJOR=18
NVM_VERSION="v0.39.7"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

# ANSI colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

info()    { echo -e "${CYAN}  $1${RESET}"; }
success() { echo -e "${GREEN}  ✓ $1${RESET}"; }
warn()    { echo -e "${YELLOW}  ⚠ $1${RESET}"; }
error()   { echo -e "${RED}  ✗ $1${RESET}"; exit 1; }

echo ""
echo -e "${CYAN}  FreqLink — Terminal Encrypted Messaging${RESET}"
echo ""

# ─── Check / install Node.js ──────────────────────────────────────────────────

node_ok() {
  command -v node &>/dev/null || return 1
  local major
  major=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])" 2>/dev/null)
  [ "$major" -ge "$REQUIRED_NODE_MAJOR" ] 2>/dev/null
}

if node_ok; then
  success "Node.js $(node --version) found"
else
  warn "Node.js >= ${REQUIRED_NODE_MAJOR} not found. Installing via nvm..."

  # Install nvm if not present
  if [ ! -f "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh" | bash
  fi

  # Load nvm into this shell session
  [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

  if ! command -v nvm &>/dev/null; then
    error "nvm install failed. Please install Node.js >= ${REQUIRED_NODE_MAJOR} manually from https://nodejs.org and re-run this script."
  fi

  nvm install --lts --no-progress
  nvm use --lts

  if node_ok; then
    success "Node.js $(node --version) installed"
  else
    error "Node.js installation failed. Please install manually from https://nodejs.org"
  fi
fi

# ─── Launch FreqLink ──────────────────────────────────────────────────────────

success "Launching FreqLink..."
echo ""

exec npx --yes freqlink
