#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINICLAW_HOME="${MINICLAW_HOME:-$HOME/.miniclaw}"
CONFIG_PATH="${MINICLAW_CONFIG:-$MINICLAW_HOME/config.yaml}"
DRY_RUN=0
SKIP_BUILD=0

usage() {
  cat <<'EOF'
MiniClaw installer

Usage:
  ./install.sh [--dry-run] [--skip-build]

Options:
  --dry-run     Print the actions without writing files or running installs.
  --skip-build  Skip the final pnpm run build check.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "+ $*"
  else
    "$@"
  fi
}
fail() {
  echo "install error: $*" >&2
  exit 1
}

say "MiniClaw installer"
say "repo: $ROOT_DIR"
say "home: $MINICLAW_HOME"
say ""

if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is required. Install Node 22+ first."
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node 22+ is required, got $(node -v)."
fi
say "OK Node $(node -v)"

cd "$ROOT_DIR"

PNPM_VERSION="$(node -p 'require("./package.json").packageManager.split("@")[1]')"
if command -v corepack >/dev/null 2>&1; then
  run corepack enable
  run corepack prepare "pnpm@$PNPM_VERSION" --activate
  say "OK pnpm target $PNPM_VERSION"
elif command -v pnpm >/dev/null 2>&1; then
  say "WARN corepack not found; using existing pnpm $(pnpm -v)"
else
  fail "corepack or pnpm is required. Install pnpm or use a Node distribution with corepack."
fi

run pnpm install --frozen-lockfile

if [ "$DRY_RUN" -eq 1 ]; then
  say "+ mkdir -p $MINICLAW_HOME"
else
  mkdir -p "$MINICLAW_HOME"
fi

if [ -f "$CONFIG_PATH" ]; then
  say "OK config exists: $CONFIG_PATH"
else
  run cp "$ROOT_DIR/config.example.yaml" "$CONFIG_PATH"
  say "Created config: $CONFIG_PATH"
fi

if [ -f "$ROOT_DIR/.env" ]; then
  say "OK .env exists"
else
  run cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  say "Created .env from .env.example"
fi

if command -v pm2 >/dev/null 2>&1; then
  say "OK pm2 $(pm2 -v)"
else
  say "WARN pm2 is not installed. Install it before production local run: npm i -g pm2"
fi

if [ "$SKIP_BUILD" -eq 0 ]; then
  run pnpm run build
else
  say "SKIP pnpm run build"
fi

say ""
say "Next steps:"
say "1. Run: pnpm run setup"
say "2. Run: pnpm run doctor:setup"
say "3. Register Discord commands: pnpm register"
say "4. Start dev: pnpm dev"
say "5. Or run with PM2: pnpm run build && pm2 start ecosystem.config.cjs"
