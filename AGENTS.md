# AGENTS — dsh-mcp-manager-panel 开发维护指南

给接手继续开发的 AI / 开发者。改代码前先读本文件 + README.md。

## 是什么（v0.2.0 自足版）

DSH 宿主级打包插件的 **MCP 服务管理面板 + MCP 运行时一体**：
- **Host**：`lib/index.js`（ESM）。读写权威注册表 `<dataDir>/registry.json`，用
  `@modelcontextprotocol/sdk` 连接 stdio / streamable-http 服务器，把工具经 `ctx.tools.register`
  注册为 `mcp__<名称>__<工具>`；通过同源 HTTP 路由 `/mcp-panel/*` 服务浏览器端。
- **Client**：`client/client.js`（`window.__ModuleLoader__.load({id, factory})`，`require("react")`，
  禁止 JSX/TS/import）。注册 `设置 → MCP 服务`（`settings.section`，id `mcp-servers`）。
- 打包形态：`package.json` 的 `dsh.bundle.patch` 自动挂载行 + `dsh.client`（`inject: ["slots"]`、
  `platform: "web"`）。宿主行声明 `inject: [tools]`（见 `cordis.patch.yml`）。随 profile 常驻，重启不丢。
- **不依赖能力库 dsh-skill-mcp-manager**；与它共享 registry.json 但不同时重复加载同一服务器。

## 关键约定（改动前务必遵守）

- **注册表格式与能力库完全对齐**：`{ version: 1, entries: [] }`，条目字段同能力库 `buildEntry`
  （含 `tools` 工具快照、`disabledTools`、`systemEntryId: mcp-<name>`、`managed: true` 等）。
- **名称约束**：`name` 匹配 `^[A-Za-z0-9_-]{1,32}$`（拼进 `mcp__<name>__<tool>` 命名空间，同一时间只连一次）。
- **档位语义（写盘即热生效）**：`eager` = 插件启动自动连接 / 运行时改 eager 立即后台连接；
  `on-demand` = 仅写盘，点连接（UI 或等待重启）再连；`disabled` = 立即断开该服务。
- **工具定义对象**（裸对象，勿用动态 harness.defineTool）：`{ name, description, parameters: JSON Schema,
  output: { schema, render }, execute, timeoutMs }`。注册表 `tools.register` 只校验 `output`（schema 须通过
  schema 校验 + render 函数）与 name/timeoutMs；`parameters` 直接吃 MCP `inputSchema` 原样。
- **传输**：stdio 用 `StdioClientTransport({command, args, env?, cwd?})`；streamable-http 用
  `StreamableHTTPClientTransport(new URL(url), {requestInit:{headers}})`。连接后发 `notifications/initialized`
  （部分服务器要求）。SSE/JSON 均由 SDK 处理，不要再实现手写 curl 解析。
- **webServer 是惰性服务**：必须 `ctx.inject(["webServer"], (hostCtx) => …)` 后再注册路由。
- **webServer.register 同 (kind, path) 重复会抛错**：每条路由用独立 path；方法不匹配回 405；
  POST 必须校验 `sameOrigin(request)`。
- **不要从浏览器直接读注册表**：一律走 `/mcp-panel/*` 同源路由。
- **读写即时进行**（每次 handler 读文件 → 改 → 原子写）：避免维护进程内缓存与多会话不一致；
  写前 `mkdir(dirname, {recursive:true})`。
- **清理**：连接/注册全部挂在 conn.disposers + `ctx.effect`，插件停/更新时 `closeAll()`。

## 编码约定

- 纯 JavaScript。宿主 ESM 只 import node 内置模块 + `@modelcontextprotocol/sdk`。
- 客户端 `React.createElement`（可 `const h = React.createElement`），样式塞进带 `data-plugin-css`
  的 `<style>`（幂等注入），颜色用产品主题变量 `--dsw-alias-*`（明暗主题自适应）。
- 错误处理：handler 内 throw → 路由层统一 `400 {ok:false, error}`；成功一律 `200 {ok:true, …}`；
  客户端 `postJson` 把 `!res.ok || data.ok===false` 转成抛错。

## 语法检查 / 安装测试

```bash
node --check lib/index.js
node --check client/client.js
```

客户端渲染冒烟测试（开发用，不进包）：在临时目录装 react/react-dom@18 后跑
`client/render-smoke.mjs`（SSR 渲染整个组件树 + 校验纯函数，React key 警告计为失败）：

```bash
mkdir -p /tmp/mpm-smoke && cd /tmp/mpm-smoke
npm i react@18.3.1 react-dom@18.3.1
node <本包路径>/client/render-smoke.mjs
```

本地安装到 profile 测试（file: 依赖要 remove+add 才刷新）：

```bash
cd ~/.dsh/profiles/<profile>
pnpm remove dsh-mcp-manager-panel   # 首次安装跳过
用户添加：需要 pnpm install
pnpm add "file:<本包绝对路径>"
# 重启 DSH（对应 profile），打开 设置 → MCP 服务 验证
```

验证点：页面能列出注册表条目（组/单条正确分组）；粘贴一段 mcpServers JSON 导入后 registry.json 出现对齐字段的条目；
整组档位切换批量写盘；连接某条目后状态变"已连接 · N 工具"，且**新会话**能直接调用 `mcp__<名称>__*` 工具
（运行中会话从新 step 起可见）；断开后工具从新会话工具集消失；重启 DSH 后 eager 项自动重连。

## 与本机其它插件的关系

- **能力库 dsh-skill-mcp-manager**：不再需要。若家里同时安装，注意二者共享 registry.json，
  但**不要**同时让双方加载同一 serverName（mcp-client 唯一性互斥）。建议只用本面板。
- **huayu-yuandian-legal-data**：yuandian 自带 OAuth + 专用端点，**不在**共享注册表里，面板不显示/不管理
  （页面提示与 VENDOR_LABEL 保留 yuandian 名映射仅为视觉识别，不加载它）。
- 会话内的"动态插件预览"（`self-sufficient-dynamic-snapshot/`）是 v0.2.0 的原型存档，
  用 curl 通道 + harness RPC 验证过全部逻辑；打包版改用 SDK + webServer 是等价移植，勿把动态 API 搬回来。

## 已知边界 / Ideas / 待完善

- [ ] 连接是"一次性"的：注册表改动（url/headers）后需先断开再连接才生效；导入动作不改已连接条目的端点。
- [ ] 工具注册在 profile 级 → 所有新会话可见；如需"仅特定会话可用"需加 scope 逻辑（当前有意不做）。
- [ ] 断线重连策略未实现（SDK 连接失败即置 error，需手动重连；可加 reconnect 逻辑）。
- [ ] 组默认档位 + 个别行锁定持久语义（groups.json 元数据）；"一键拉齐"按钮。
- [ ] 工具级黑名单（单工具禁用，联动 `disabledTools` 字段）。
- [ ] 自定义分组名（非前缀规则）；组折叠状态持久化（当前为会话内记忆，重启还原为折叠）。
- [x] 从注册表导出 mcpServers JSON（反向导出，方便换机器）——v0.3.0 顶栏"导出配置"按钮。
