#!/usr/bin/env bash
# 把 scripts/git-hooks/* 复制到 .git/hooks/。新机器 clone 后跑一次。
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
SRC_DIR="$REPO_ROOT/scripts/git-hooks"
DEST_DIR="$REPO_ROOT/.git/hooks"

[ -d "$SRC_DIR" ] || { echo "❌ $SRC_DIR not found"; exit 1; }

for hook in "$SRC_DIR"/*; do
  name="$(basename "$hook")"
  dest="$DEST_DIR/$name"
  cp "$hook" "$dest"
  chmod +x "$dest"
  echo "✓ installed $name → $dest"
done

echo "Done. 禁用 hook 用 git commit --no-verify（请勿，CI 会拦）"
