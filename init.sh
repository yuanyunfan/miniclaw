#!/usr/bin/env bash
# 一键初始化：装依赖 + 装 git hooks + 类型检查 + 跑测试
set -euo pipefail

GREEN="\033[0;32m"; RED="\033[0;31m"; YELLOW="\033[0;33m"; BOLD="\033[1m"; NC="\033[0m"
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }

echo -e "${BOLD}MiniClaw — Environment Init${NC}"
echo "=============================="

# 1. Node 22+
node_v=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
[ -z "$node_v" ] && fail "Node 未安装"
[ "$node_v" -ge 22 ] || fail "Node 22+ required, got v$node_v"
ok "Node v$(node -v | sed 's/v//')"

# 2. pnpm
command -v pnpm >/dev/null || fail "pnpm 未安装（brew install pnpm 或 npm i -g pnpm）"
ok "pnpm $(pnpm -v)"

# 3. 依赖
pnpm install --silent
ok "依赖安装完成"

# 4. .env
if [ ! -f .env ]; then
  cp .env.example .env
  warn ".env 不存在，已从 .env.example 创建。请填入以下变量后重跑："
  echo "    DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID,"
  echo "    ANTHROPIC_API_KEY, MINICLAW_ALLOWED_USER_ID"
  exit 1
fi
ok ".env 存在"

# 5. git hooks
if [ -d scripts/git-hooks ]; then
  bash scripts/install-hooks.sh >/dev/null
  ok "git hooks 已安装"
fi

# 6. 类型检查
pnpm exec tsc --noEmit
ok "tsc --noEmit 通过"

# 7. 测试
pnpm test --silent >/dev/null
ok "单元测试通过"

echo ""
echo -e "${GREEN}${BOLD}Ready!${NC}"
echo "常用命令："
echo "  pnpm dev       → 开发模式（热重载）"
echo "  pnpm build     → 编译"
echo "  pnpm register  → 注册 Discord slash commands（首次/改 schema 后跑）"
echo "  pnpm test      → 跑测试"
echo "  pm2 start ecosystem.config.cjs  → 后台常驻"
