#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dsh-quota-meter · 一键安装（官方 bundle 版）
#
# 封装 `dsh plugin add .`：把本 checkout 作为 bundle 安装进指定 profile。
# 等价于在仓库内手动执行：dsh plugin --profile <name> add .
# （相对路径 spec 锚定调用目录，所以在 repo 内 add . 安装的就是本 checkout）
#
# 用法：
#   bash install.sh                 # 安装到 web profile
#   PROFILE=headless bash install.sh
#   DSH_CMD="pnpm dsh" bash install.sh   # 源码模式（需在 harness 仓库根）
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROFILE="${PROFILE:-web}"
DSH_CMD="${DSH_CMD:-dsh}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v "$DSH_CMD" >/dev/null 2>&1; then
  echo "错误：找不到命令 $DSH_CMD。" >&2
  echo "      已安装 dsh 的机器直接运行本脚本；源码模式请先安装 dsh，或" >&2
  echo "      在 deepseek-harness 仓库根执行：pnpm dsh plugin --profile $PROFILE add $REPO" >&2
  exit 1
fi

echo "==> 安装 quota-meter bundle → profile: $PROFILE"
(cd "$REPO" && "$DSH_CMD" plugin --profile "$PROFILE" add .)

echo
echo "✅ 安装完成。生效方式："
echo "   - Client 半部（进度条 UI）：刷新浏览器页面即可"
echo "   - Host 半部（记账/拦截）：需重启 dsh web 进程"
