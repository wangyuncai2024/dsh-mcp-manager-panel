# AGENTS — dsh-mcp-manager-panel 开发维护指南

给接手继续开发的 AI / 开发者。改代码前先读本文件 + README.md。

## 是什么（v0.4.0 自足版 · UI 对齐 DSH 设置面板）

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
- **客户端 UI 先复用产品原子件**：平台 seed 模块 `@deepseek-ai/dsh-client-ui-primitives`
  （`require("@deepseek-ai/dsh-client-ui-primitives")`，web 壳自带、无需声明依赖）提供
  `Button` / `Pill` / `Tag` / `StateDot` / `Input` / `Menu` / `Modal` / `Toast` / 图标集 / `writeClipboard`。
  自造控件前先看 `packages/client/ui-primitives/README.md` 的组件目录；视觉差异优先做成局部 class 而不是复制控件。
  原子件缺失时客户端退化为文件内置的 `FALLBACK`（冒烟测试会同时跑两条路径）。
- **版式照 `docs/web-styling.md`**：设置页 = `max-width 760` + 12px 列间距、`h2 18/600` + 13px 三级色导语；
  中性描边统一 `0.5px`；全圆角配 `corner-shape: round`；不要写组件级 `::-webkit-scrollbar`
  （主题 `scrollbar.css` 已全局接管，弹层/菜单由原子件自己做 elevation 重绑）；保留 `:focus-visible` 与
  `prefers-reduced-motion`；不写死颜色。
- **参考实现**：`packages/client/ui-settings-plugins`（设置页骨架/标签页）与
  `packages/client/ui-settings-plugin-inventory`（搜索框 + 分组卡 + 展开详情 + StateDot/Tag 用法）
  是本面板对齐的样板，改版式前先读它们。
- 成功提示走 `Toast`，失败用可关闭的行内告警（`role="alert"`）；破坏性操作用 `Modal` 二次确认。
- 错误处理：handler 内 throw → 路由层统一 `400 {ok:false, error}`；成功一律 `200 {ok:true, …}`；
  客户端 `postJson` 把 `!res.ok || data.ok===false` 转成抛错。

## 语法检查 / 安装测试

```bash
node --check lib/index.js
node --check client/client.js
```

客户端渲染冒烟测试（开发用，不进包）：`client/render-smoke.mjs` 用 React 18 SSR 渲染整棵组件树 +
校验纯函数 + 断言结构/文案，React key 警告计为失败。react / react-dom 从**当前工作目录**解析
（找不到再退回本包目录），所以按老流程在临时目录装 react 再跑即可；本机也可以直接用 DSH 检出里的
react/react-dom（软链进临时目录的 node_modules）：

```bash
mkdir -p /tmp/mpm-smoke/node_modules && cd /tmp/mpm-smoke
npm i react@18.3.1 react-dom@18.3.1        # 或软链一份现成的 react/react-dom@18.3.1
node <本包路径>/client/render-smoke.mjs
```

测试会跑两条路径：① `client/primitives-stub.mjs` 替身（模拟平台 seed 的 ui-primitives），
② 不提供原子件（走内置退化实现）；并交叉校验客户端读到的每个原子名都由 `ui-primitives` 真实导出
（环境变量 `DSH_CHECKOUT` 指定检出路径，默认 `/home/wangyuncai/deepseek-harness`，找不到则跳过）。

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

UI 验证点（v0.4.0 起）：顶栏三个按钮与搜索框在同一行且不换行错位；分组卡的 `⋯` 菜单 portal 到 body（不被裁剪）；
导入弹层的 textarea 自动聚焦、粘贴后"一键导入"给出逐条新增/更新/失败结果；删除走弹层确认；
成功提示出现在窗口顶部居中并自动淡出；明暗两种主题下颜色都取自 `--dsw-alias-*`（不出现写死颜色）。
客户端是普通 fetch bundle，改完 `client/client.js` 后**刷新页面**即可生效（client-plugin 热更新仅在
`pnpm run dev:web` 同时运行时免刷新）。

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
- [ ] 文案未国际化：面板文案硬编码中文，产品设置页走 `ctx.locale`；要对齐需接 locale seat（当前有意不做）。
- [ ] 弹层与设置面板都监听 document Escape（产品 Modal 的既有行为）：在导入/确认弹层按 Esc 会连设置面板一起关。
- [x] 从注册表导出 mcpServers JSON（反向导出，方便换机器）——v0.3.0 顶栏"导出"按钮。
- [x] UI 对齐 DSH 设置面板（复用 ui-primitives + `--dsw-alias-*` + 设置页排版）——v0.4.0。
