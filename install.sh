#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# dsh-quota-meter · 一键安装（静态 cordis 版）
#
# 在【任意一台装有 dsh 的机器】上运行本脚本，即可把会话额度监控插件装好：
#   1. 把 host 半部安装为 profile node_modules 里的 quota-meter 包
#   2. 把 client 半部安装为 quota-meter-client 包
#   3. 向 <profile>/cordis.patch.yml 追加两行组合（幂等，重复运行安全）
#   4. 提示重启 dsh web（Host 改动需重启进程；Client 改动刷新浏览器即可）
#
# 用法：
#   bash install.sh                 # 安装到 ~/.dsh/profiles（web profile）
#   PROFILE=headless bash install.sh # 安装到其他 profile
#   DSH_HOME=/custom/.dsh bash install.sh  # 自定义 dsh home
#
# 卸载：见同目录 uninstall.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${PROFILE:-web}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/static"

NM_DIR="$DSH_HOME/profiles/node_modules"
PATCH_DIR="$DSH_HOME/profiles/$PROFILE"
PATCH="$PATCH_DIR/cordis.patch.yml"

# 本脚本写入的组合块标记（uninstall.sh 按同一标记删除）
PATCH_MARKER="# ── 用户插件：会话额度监控（quota-meter，静态永久版）"

echo "==> 安装 quota-meter → $NM_DIR"
mkdir -p "$NM_DIR/quota-meter"
cp "$SRC/host.js"             "$NM_DIR/quota-meter/index.js"
cp "$SRC/host.package.json"   "$NM_DIR/quota-meter/package.json"

mkdir -p "$NM_DIR/quota-meter-client/lib"
cp "$SRC/client.js"           "$NM_DIR/quota-meter-client/lib/client.js"
cp "$SRC/client-node-stub.js" "$NM_DIR/quota-meter-client/lib/index.js"
cp "$SRC/client.package.json" "$NM_DIR/quota-meter-client/package.json"

echo "==> 组合行 → $PATCH"
mkdir -p "$PATCH_DIR"
if [ ! -f "$PATCH" ]; then
  cat > "$PATCH" <<EOF
# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
EOF
fi

if grep -q "id: quota-meter" "$PATCH"; then
  echo "    已存在 quota-meter 组合行，跳过追加（幂等）"
else
  cat >> "$PATCH" <<EOF

${PATCH_MARKER}────────────────────────
# Host 半部：按 DeepSeek 官方价格记账（llm/stream）+ 额度耗尽拦截（agent/pre-step）
#            + HTTP 状态接口（/quota 前缀路由）
# Client 半部：浏览器 bundle（dsh.client），输入框上方进度条 + 耗尽弹窗
- insert:
    - id: quota-meter
      name: 'quota-meter'

    - id: quota-meter-client
      name: 'quota-meter-client'
EOF
  echo "    已追加组合行"
fi

echo
echo "✅ 安装完成。生效方式："
echo "   - Client 半部（进度条 UI）：刷新浏览器页面即可"
echo "   - Host 半部（记账/拦截）：需重启 dsh web 进程"
echo "   （重启前请确认 quota-meter 相关内容已出现在 ${PATCH}）"
