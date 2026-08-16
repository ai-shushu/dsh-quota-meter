# 会话额度监控插件（Quota Meter · 静态版）

给 DSH 的**每个会话窗口**设置金额额度：按 DeepSeek 官方 API 价格用真实 token 用量记账，
在输入框上方显示消耗进度条，额度耗尽时拦截新的模型调用并弹出提示。

## 从仓库安装（任何机器，一键）

本仓库即插件的**唯一来源**。在任意装有 dsh 的机器上：

```bash
git clone https://github.com/uncleshushushu-prog/dsh-quota-meter.git
cd dsh-quota-meter
bash install.sh        # 可选环境变量：PROFILE=web（默认）、DSH_HOME=~/.dsh
```

脚本做三件事：把 host 半部装为 `quota-meter` 包、client 半部装为 `quota-meter-client`
包（都在 `<dsh-home>/profiles/node_modules/` 下）、向 `<profile>/cordis.patch.yml`
幂等追加组合行。之后：

- **Client 改动**（进度条 UI）→ 刷新浏览器页面即生效；
- **Host 改动**（记账/拦截）→ 重启 dsh web 进程生效。

升级：`git pull` 后再跑一次 `bash install.sh`（覆盖文件 + 组合行幂等）。
卸载：`bash uninstall.sh`。

> 注意：本插件以**静态 cordis 形式**安装（文件拷贝 + 手写组合行），不是官方
> `dsh plugin add` 的 bundle 形式。当前 dsh web 进程正运行这套静态版，请勿在
> 运行中机器上改动安装布局，避免重启后插件丢失。

## 形态与安装

本插件以**静态 Cordis 插件**形式永久安装（官方 cordis 组合机制），重启 dsh 自动加载：

- **Host 半部**（记账+拦截+HTTP 接口）→ 包 `quota-meter`，装在 `~/.dsh/profiles/node_modules/quota-meter/`
- **Client 半部**（进度条 UI，`dsh.client` bundle）→ 包 `quota-meter-client`，装在 `~/.dsh/profiles/node_modules/quota-meter-client/`
- **组合行** → `~/.dsh/profiles/web/cordis.patch.yml`（`- insert:` 两行）
- **数据通道**：静态 Host 通过 `webServer` 注册 `/quota` HTTP 路由；静态 Client 用 `fetch` 调用

## 文件结构

```
quota-meter-plugin/
├── install.sh              一键安装脚本（任意机器）
├── uninstall.sh            一键卸载脚本
├── README.md               本说明
└── static/                 静态版完整快照（源码 + package.json + cordis.patch.yml）
    ├── host.js                Host 半部：记账 / 计费 / 拦截 / HTTP 接口
    ├── client.js              Client 半部：进度条 UI（conversation.input.dock）+ 耗尽弹窗（shell.overlay）
    ├── host.package.json      Host 包清单（安装为 quota-meter）
    ├── client.package.json    Client 包清单（安装为 quota-meter-client）
    ├── client-node-stub.js    Client 包的 Node 侧占位（能力在浏览器端）
    └── cordis.patch.yml       组合行（- insert: quota-meter / quota-meter-client）
```

## 工作原理

```
模型调用结束 → llm/stream 事件流里出现 {type:'usage', usage} 块
  → Host 按 options.model 查价目表折算金额（缓存命中/未命中/输出分档）
  → 累加到 options.sessionId 的记账本（spent / calls）
  → 客户端每 1s 轮询 /quota/state → 进度条前进
额度耗尽 → agent/pre-step 返回 {kind:'reject'} 拦截后续模型调用
         → shell.overlay 弹提示
```

- 计价模型：`计费输入 = inputTokens + cacheReadTokens + cacheWriteTokens`（官方价目分开计），`输出`单独计价；
- 默认价目表（人民币，每 1M tokens，2025 官方价，改 `static/host.js` 顶部 `PRICES` 即可）：

| 模型 | 输入（缓存未命中） | 输入（缓存命中） | 输出 |
|---|---|---|---|
| deepseek-chat | ¥2 | ¥0.5 | ¥8 |
| deepseek-reasoner | ¥4 | ¥1 | ¥16 |

- 未知模型回退到 deepseek-chat 价。

## 已知行为（设计使然）

- **记账本进程内临时**：dsh 进程重启即清零；不持久化，符合"每个新会话重新设置额度"；
- **不追溯历史**：插件启动**之前**已消耗的 token 不计入（无法从流里取回）；
- **辅助调用也计费**：会话标题生成、上下文压缩等（它们同样走 llm/stream 且带 sessionId）；
- **子代理独立记账**：子代理有独立 sessionId，默认不计入父会话额度；
- **拦截粒度是"下一步"**：额度耗尽只拦截之后的新模型调用，已经在途的流不会中断；
- **未设置额度时**：额度条显示"已花 ¥X（N 次调用）· 未设置额度"，消耗实时可见，但不拦截。

## 如何修改 / 重新部署

1. 改 `static/host.js` / `static/client.js`；
2. 覆盖安装到已装位置：

   ```bash
   cp static/host.js   ~/.dsh/profiles/node_modules/quota-meter/index.js
   cp static/client.js ~/.dsh/profiles/node_modules/quota-meter-client/lib/client.js
   ```

3. **Client 改动**：刷新浏览器页面即生效（bundle 按请求从磁盘读取）；**Host 改动**：需重启 dsh web 进程才生效（已注册的路由不会热更新）。

## UI 落位

- `conversation.input.dock`（id: `quota-meter`, order: 30）— 输入框正上方一整行（与官方待办条/目标条并列，居中限宽 `max-width:min(560px,100%)`，不会横向撑开）；
- `shell.overlay`（id: `quota-exhausted-toast`, order: 90）— 耗尽时的全屏弹窗。

## 待办 / 可扩展

- [ ] 子代理消耗并入父会话额度（需要代理树映射）
- [ ] 价目表做成 UI 可编辑（当前改 `static/host.js` 常量）
- [ ] 额度持久化（如写入 settings / 会话日志，需新机制）
- [ ] `/quota` HTTP 接口加鉴权（当前仅限本机访问，若暴露到局域网需加 token）
