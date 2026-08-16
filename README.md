# 会话额度监控插件（Quota Meter · 官方 bundle 版）

给 DSH 的**每个会话窗口**设置金额额度：按 DeepSeek 官方 API 价格用真实 token 用量记账，
在输入框上方显示消耗进度条，额度耗尽时拦截新的模型调用并弹出提示。

## 形态

本插件是 **官方 dsh 组合包（bundle）**：一个 npm 包，manifest 声明
`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`，用 `dsh plugin` 安装进 profile，
由 dsh 的插件生命周期统一管理（依赖、组合层、卸载）。采用官方 **dual-face 单包**结构
（同 `@deepseek-ai/dsh-client-connection`）：node 半部 + 浏览器半部同属一个包、一行组合。

- **Node 半部**（记账 + 拦截 + HTTP 接口）→ `index.js`
- **浏览器半部**（进度条 UI + 价格设置弹层，`dsh.client`）→ `lib/client.js`（`exports["./client"]`）
- **组合层** → `cordis.patch.yml`（单行 insert，id `quota-meter`）
- **数据通道**：Host 通过 `webServer` 注册 `/quota` HTTP 路由；Client 用 `fetch` 调用

## 安装

任意装有 dsh 的机器，一键：

```bash
# 方式一：本地 checkout（开发模式，pnpm 以链接安装，改动即时可见）
dsh plugin --profile web add /path/to/quota-meter-plugin

# 方式二：git 仓库（纯 JS、无构建步骤，源码即产物）
dsh plugin --profile web add github:ai-shushu/dsh-quota-meter

# 方式三：仓库内的一键脚本（等价于方式一）
bash install.sh        # PROFILE=web 默认；DSH_CMD 可覆盖 dsh 命令
```

生效方式：

- **Client 改动**（进度条 UI）→ 刷新浏览器页面即生效；
- **Host 改动**（记账/拦截/接口）→ 重启 dsh web 进程生效。

卸载：`dsh plugin --profile web remove quota-meter`（同时移除依赖与组合层），或 `bash uninstall.sh`。

> 源码模式运行 dsh 时（deepseek-harness checkout），把 `dsh` 换成 `pnpm dsh` 并在仓库根执行。

## 文件结构

```
quota-meter-plugin/         # bundle 包根（npm 包 quota-meter，dual-face 单包）
├── package.json            # dsh.bundle.patch + dsh.client.platform web + exports["./client"]
├── cordis.patch.yml        # 组合层：单行 insert（id: quota-meter）
├── index.js                # Node 半部：记账 / 计费 / 拦截 / HTTP 接口（零外部依赖）
├── lib/
│   └── client.js           # 浏览器半部：进度条 + 价格设置弹层 + 耗尽弹窗
├── install.sh              # 一键安装（封装 dsh plugin add .）
├── uninstall.sh            # 一键卸载（封装 dsh plugin remove）
└── README.md
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
- 未知模型回退到 `fallback` 模型价（默认 `deepseek-chat`）。

## 价格配置（面向多平台多模型）

价目表是**动态可编辑**的，默认内置 DeepSeek 两款（人民币，每 1M tokens，2025 官方价）：

| 模型 | 平台 | 输入（缓存未命中） | 输入（缓存命中） | 输出 |
|---|---|---|---|---|
| deepseek-chat | deepseek | ¥2 | ¥0.5 | ¥8 |
| deepseek-reasoner | deepseek | ¥4 | ¥1 | ¥16 |

**UI 入口**：输入框上方额度条行尾的「价格」→ 浮动弹层：

- 每个模型一行三档价格编辑（未命中 / 命中 / 输出）+ 删除；
- 「添加模型」可自由增加任意平台/模型（如 `gpt-4o` / `openai`），不改代码；
- 底部「恢复默认 / 取消 / 保存」。

**持久化**：保存后写入 `~/.dsh/storages/quota-meter/prices.json`（dsh 持久化数据目录），
重启不丢；「恢复默认」删除该文件回到内置价目。价目结构为多平台预留了扩展点
（`provider` 分组标注、`per` 计价基准；未来可按次/按量计价、多货币扩展）：

```json
{
  "version": 1,
  "unit": "¥",
  "per": "1M",
  "fallback": "deepseek-chat",
  "models": {
    "deepseek-chat": { "provider": "deepseek", "inputMiss": 2, "inputHit": 0.5, "output": 8 }
  }
}
```

## 已知行为（设计使然）

- **记账本进程内临时**：dsh 进程重启即清零；不持久化，符合"每个新会话重新设置额度"；
- **价目表进程级生效**：改价保存后即时生效（内存 + 落盘），不影响已累计的 spent；
- **不追溯历史**：插件启动**之前**已消耗的 token 不计入（无法从流里取回）；
- **辅助调用也计费**：会话标题生成、上下文压缩等（它们同样走 llm/stream 且带 sessionId）；
- **子代理独立记账**：子代理有独立 sessionId，默认不计入父会话额度；
- **拦截粒度是"下一步"**：额度耗尽只拦截之后的新模型调用，已经在途的流不会中断；
- **未设置额度时**：额度条显示"已花 ¥X（N 次调用）· 未设置额度"，消耗实时可见，但不拦截。

## 如何修改 / 重新部署

1. 改 `index.js`（host）/ `lib/client.js`（client）；
2. 安装方式是 `file:` 链接，**改动直接反映到运行位置，无需拷贝**；
3. **Client 改动**：刷新浏览器页面即生效（bundle 按请求从磁盘读取）；
   **Host 改动**：重启 dsh web 进程才生效（已注册的路由不会热更新）。

## UI 落位

- `conversation.input.dock`（id: `quota-meter`, order: 90）— 输入框正上方：一行文字
  （已花/剩余 + 改额度 + 价格）+ 2px 细进度条（覆盖卡片顶部边框线、只覆盖直线段，
  已消耗灰色痕迹 + 剩余彩色渐变流光，消耗从左侧消失）；
- `shell.overlay`（id: `quota-exhausted-toast`, order: 90）— 耗尽时的全屏弹窗。

## 迁移记录

- **v0.3.0**：价格参数配置（多平台价目表 + 弹层 UI + JSON 持久化）。
- **v0.2.0**：静态 cordis 版 → 官方 bundle 版（`dsh plugin` 管理生命周期，`file:` 链接安装）。
- **v0.1.0**：静态版（install.sh 手工拷贝 + 手写组合行），已归档于 git 历史（commit `cb77c29`）。

## 待办 / 可扩展

- [ ] 子代理消耗并入父会话额度（需要代理树映射）
- [ ] 额度持久化（如写入 settings / 会话日志，需新机制）
- [ ] `/quota` HTTP 接口加鉴权（当前仅限本机访问，若暴露到局域网需加 token）
- [ ] 价目表支持按次/按量计价、多货币（结构已预留字段，需扩展记账逻辑与 UI）
