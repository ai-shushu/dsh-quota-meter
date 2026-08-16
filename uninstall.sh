#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dsh-quota-meter · 一键卸载（静态 cordis 版）
#
# 撤销 install.sh 做的事：
#   1. 删除 profile node_modules 里的 quota-meter / quota-meter-client 两个包
#   2. 从 <profile>/cordis.patch.yml 中删除本插件追加的组合块（按标记行截断，
#      只删除本脚本写入的、位于文件末尾的那一段；若你之后手动改过该文件，
#      请先人工确认再执行）
#   3. 提示重启 dsh web
#
# 用法：与 install.sh 相同的环境变量（PROFILE / DSH_HOME）
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-web}"

NM_DIR="$DSH_HOME/profiles/node_modules"
PATCH="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"

PATCH_MARKER="# ── 用户插件：会话额度监控（quota-meter，静态永久版）"

echo "==> 删除已安装的包"
rm -rf "$NM_DIR/quota-meter" "$NM_DIR/quota-meter-client"
echo "    已删除 $NM_DIR/quota-meter"
echo "    已删除 $NM_DIR/quota-meter-client"

echo "==> 清理组合行 → $PATCH"
if [ -f "$PATCH" ] && grep -qF "$PATCH_MARKER" "$PATCH"; then
  awk -v marker="$PATCH_MARKER" '
    index($0, marker) { skip = 1 }
    !skip { print }
  ' "$PATCH" > "$PATCH.tmp" && mv "$PATCH.tmp" "$PATCH"
  echo "    已删除组合块（保留 $PATCH 其余内容）"
else
  echo "    未找到组合块标记，跳过（可能已卸载）"
fi

echo
echo "✅ 卸载完成。请重启 dsh web 进程使变更生效。"
