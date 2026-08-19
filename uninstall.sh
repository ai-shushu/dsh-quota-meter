#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dsh-quota-meter · 一键卸载（官方 bundle 版）
#
# 封装 `dsh plugin remove`：同时移除 profile 依赖与组合层。
#
# 用法：
#   bash uninstall.sh                 # 卸载 web profile
#   PROFILE=headless bash uninstall.sh
#   DSH_CMD="pnpm dsh" bash uninstall.sh   # 源码模式（需在 harness 仓库根）
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

PROFILE="${PROFILE:-web}"
DSH_CMD="${DSH_CMD:-dsh}"

if ! command -v "$DSH_CMD" >/dev/null 2>&1; then
  echo "错误：找不到命令 $DSH_CMD。" >&2
  echo "      已安装 dsh 的机器直接运行本脚本；源码模式请先安装 dsh，或" >&2
  echo "      在 deepseek-harness 仓库根执行：pnpm dsh plugin --profile $PROFILE remove quota-meter-shushu" >&2
  exit 1
fi

echo "==> 卸载 quota-meter-shushu bundle → profile: $PROFILE"
"$DSH_CMD" plugin --profile "$PROFILE" remove quota-meter-shushu

echo
echo "✅ 卸载完成。请重启 dsh web 进程使变更生效。"
