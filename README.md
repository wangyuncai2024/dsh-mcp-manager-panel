# dsh-mcp-manager-panel

DSH（DeepSeek Harness）的 **MCP 服务管理面板**（宿主级打包插件，随 profile 常驻）——**自足版**：除了管理注册表，插件**自带 MCP 连接、工具注册与调用**，不再依赖能力库 `dsh-skill-mcp-manager`。

把服务商给的 MCP 配置（Claude/Cursor 风格的 `mcpServers` JSON）**整段粘贴 → 一键导入**注册表；同厂商服务自动分组；每行/每组显示**连接状态**并可一键 连接/断开；支持"先整组设档位、再逐条微调"。连接成功的服务器，其工具会以 `mcp__<名称>__<工具>` 注册进 DSH——**新会话 / 子代理即可直接调用**。

## 功能

- **粘贴导入**：顶栏"导入配置"打开弹层，粘贴 `{ "mcpServers": { 名称: { url / command, headers, env, args, cwd, tier, disabled } } }`（也可不带外层 `mcpServers`）；弹层内实时给出**新增 / 更新 / 失败**计数与逐条结果，重复名称=更新，单条失败不阻断其余条目。
- **界面与 DSH 设置面板一致**：客户端复用平台 seed 模块 `@deepseek-ai/dsh-client-ui-primitives` 的原子件（`Button` / `Pill` / `Tag` / `StateDot` / `Menu` / `Modal` / `Toast` / 图标集），版式沿用设置页约定（`max-width 760` + `h2 18/600` + 13px 三级色导语 + 0.5px 中性描边卡片 + `--dsw-alias-*` 语义 token）；明暗主题、聚焦环、圆角与滚动条都由产品主题统一接管。
- **自足连接**：`eager`（随 DSH 启动自动连接并注册工具）/ `on-demand`（点"连接"或重启前手动加载）/ `disabled`（停用并立即断开）。传输用 `@modelcontextprotocol/sdk`，支持 **stdio** 与 **streamable-http**（SSE 由 SDK 处理）。
- **厂商分组**：名称同前缀（第一个 `-` 之前）自动成组，**含仅 1 个成员的情况**——同样显示厂商卡片头（状态点 + 名称 + 成员数 + 摘要行）；真正的"单条平铺"只留给前缀为 `other` 的条目。组头状态点按组聚合（未连接灰 / 连接中琥珀 / 已有成员连接绿 / 有失败红），支持折叠与展开；组头行内是"整组档位 + 全部连接"，其余动作（**重命名组**、复制调用前缀、全部断开、删除整组）收进 `⋯` 溢出菜单（产品 `Menu`，portal 到 body，不会被滚动容器裁切）。组名改名写 `groups.json` 持久化，只改显示不影响前缀分组，回车保存 / Esc 取消。
- **两级档位**：组头三段 `Pill` = 整组一键 `eager` / `on-demand` / `disabled`；展开后每行可单独调（写盘即热生效：eager 立即后台连接、disabled 立即断开）。
- **连接管理**：每行"连接/断开 + 状态 `Tag`"（已连接 · N 工具 / 连接中 / 连接失败，失败可展开错误详情）；连接成功会把工具快照/服务版本回写注册表；页面每 5s 轻量轮询同步连接状态。
- **工具浏览**：点击"N 工具" `Pill` 展开内嵌详情面板，可一键复制 `mcp__<名称>__<工具>` 或整组前缀（复制带 ✓ 反馈）。
- **搜索 / 导出**：按名称、端点、工具名全局过滤（显示"匹配 N / M"）；顶栏"导出"把注册表反向导出为 `mcpServers.json`（方便换机器）。
- **反馈与确认**：成功提示走产品 `Toast`（顶部居中、自动淡出），失败保留可关闭的行内告警并列出逐条明细；删除单条/整组走产品 `Modal` 二次确认；列表加载用 `bg-skeleton` 骨架屏。

## 工具注册说明（重要）

- 注册的模型工具命名 `mcp__<注册表名称>__<服务器工具名>`（长度/非法字符做确定性折叠）。
- 模型侧工具集按**会话**装配：已在运行的会话从**新 step** 起可见；**新建会话/子代理**开箱即用。
- 同一注册表名称同时只允许一个连接（serverName 唯一）。

## 依赖

- **运行时**：`@modelcontextprotocol/sdk`（npm 公共包，`pnpm add file:...` 时会自动安装）。
- **客户端 UI**：`@deepseek-ai/dsh-client-ui-primitives` —— DSH web 壳的**平台 seed 模块**（随壳一起加载，
  无需声明依赖、无需打包）：客户端 `require()` 即可拿到产品的 `Button` / `Pill` / `Tag` / `StateDot` /
  `Menu` / `Modal` / `Toast` / `Input` / 图标集与 `writeClipboard`。若该模块缺失（极旧版本），
  客户端会退化为内置的最小实现，页面仍可用。
- 不需要能力库 `dsh-skill-mcp-manager`；若机器上同时装有它，本面板与它共享 `registry.json`，
  但**不要同时**让它与本插件重复加载同名服务器（mcp-client serverName 会互斥报错）。二选一使用。

## 数据文件

- 权威注册表：`<DSH_HOME>/skill-mcp-manager/registry.json`（默认，可用 `config.dataDir` 改目录）。
  格式 `{ version: 1, entries: [] }`，条目字段与能力库 `buildEntry` 对齐（`systemEntryId` / `managed` / `tools` 快照等），
  以保持机器间/与旧能力库数据的兼容。
- 本插件启动时自动连接所有 `tier: eager` 条目并回写工具快照；写盘即时生效。
- 群组元数据：`<dataDir>/groups.json`（`{ version: 1, groups: { "<前缀>": { title } } }`），
  只存组头自定义显示名，默认自动名不落盘；注册表格式不受影响。删除整组时客户端会顺带清掉对应元数据。

## 安装（家里）

1. 解压后把 `dsh-mcp-manager-panel` 文件夹放到本机任意位置。
2. 进入目标 profile 目录（如 `~/.dsh/profiles/web`），安装本地包：

```bash
pnpm add "file:C:/路径/dsh-mcp-manager-panel"
```

3. 重启 DSH（web/对应 profile）——bundle patch 自动挂载，eager 服务随启动连接。
4. 打开 **设置 → MCP 服务** 使用；新会话里 AI 即可调用 `mcp__*` 工具。

更新代码后重装（file: 依赖要先 remove 再 add，pnpm 才刷新）：

```bash
pnpm remove dsh-mcp-manager-panel
pnpm add "file:C:/路径/dsh-mcp-manager-panel"
```

## 配置（可选）

在 profile 的 `cordis.patch.yml` 用同 id 覆盖行设置（默认即可）：

```yaml
- insert:
    - id: mcp-manager-panel
      name: 'dsh-mcp-manager-panel'
      inject: [tools]          # 必须声明 tools，宿主才可注册 MCP 工具
      config:
        dataDir: ''            # 注册表目录；空 = $DSH_HOME/skill-mcp-manager
```

## 开发

- 纯 JavaScript（宿主 ESM + 浏览器客户端 `__ModuleLoader__.load` 格式、无 JSX）。
- 语法检查：`node --check lib/index.js && node --check client/client.js`。
- 客户端渲染冒烟测试（开发用，不进包）：`client/render-smoke.mjs` 用 React 18 SSR 渲染整棵组件树，
  同时跑"有 ui-primitives"与"缺 ui-primitives（退化实现）"两条路径，断言结构/文案/无 React key 警告，
  并交叉校验所读原子名确实由 `ui-primitives` 导出（找不到 DSH 检出时自动跳过该校验）。
  需要 React：见 `AGENTS.md` 的跑法（react / react-dom 从当前工作目录解析）。
- 宿主：`lib/index.js` = 注册表读写 + SDK MCP 运行时（`lib/index.js` 内 `createMcpManager`）+ 同源 HTTP 路由
  `/mcp-panel/list`(GET)、`/mcp-panel/import|save|load|unload|status`(POST)；POST 校验 `Origin`；`webServer` 是惰性服务，
  用 `ctx.inject(['webServer'], …)` 等它就绪。
- 工具定义对象 = 裸 `{ name, description, parameters(JSON Schema), output:{schema, render}, execute, timeoutMs }`，
  经 `ctx.tools.register(def)` 注册（无需 dsh-tools defineTool 包装，注册表只校验 output 形状 + schema）。
- 客户端 UI：**先用 `ui-primitives` 的原子件，再考虑自造**；自定义样式只用 `--dsw-alias-*` 语义 token，
  0.5px 中性描边 + `corner-shape: round` 配对、不自定义滚动条（主题全局接管）、聚焦可见性与 reduced-motion 都要保留——
  与 `docs/web-styling.md` 的约定一致。参考实现：`ui-settings-plugins` / `ui-settings-plugin-inventory` 两个设置页。
- 设置入口：`settings.section`，id `mcp-servers`，order 34。

## 安全提示

本包**不含任何密钥与配置数据**（打包时已剔除注册表）。服务商 Token 存于注册表文件（明文）——
机器间拷贝时注意脱敏；Token 只在连接/调用时经 SDK 请求头发送，不会写入日志。

## 历史说明

- v0.1.0：纯管理面板，依赖能力库 `dsh-skill-mcp-manager` 提供 mcp 三件套（已废弃该依赖方式）。
- v0.2.0：自足版。逻辑先在会话内以动态插件做过端到端验证（北大法宝 4 个网关连接 + 真实工具调用），
  见仓库内 `self-sufficient-dynamic-snapshot/`（动态版源码存档 + 移植对照）。
- v0.3.0：UI 重构。顶栏统计 + 全局搜索 + 段式档位控件 + 状态徽章（含错误详情展开）+ 5s 轮询 +
  工具列表展开条（复制工具名/前缀）+ mcpServers 反向导出 + 骨架屏/空态；宿主 `list` 摘要新增工具名快照（≤200）。
- v0.3.1：单成员前缀也渲染为厂商卡片头（色点 + 名称 + 摘要 + 成员行常驻展开），与多成员组排版统一；
  不再有"单条平铺/组卡"两种形态（`other` 除外）。
- v0.3.2：组头控件与多成员组完全同款（全部连接/全部断开/整组档位/展开成员），单成员组默认展开、可折叠；
  组头新增"删除整组"（逐条走宿主 delete 路由，已连接的先断开）；成员行删除确认改为紧凑堆叠块、末列宽度自适应；
  工具列表条服务名超长截断 + 滚动区细滚动条。
- v0.3.3：组头圆点改为按组连接状态着色（仅"已有成员连接"才绿，未连接灰/连接中琥珀/有失败红），
  不再用前缀色相冒充状态；组头支持自定义显示名（铅笔编辑 + 回车保存/Esc 取消，宿主新增 `groups.json`
  元数据与 `save setGroupTitle` 动作，`list` 返回 `groupMeta`；空名恢复自动名）。
- v0.4.0：客户端 UI 对齐 DSH 自身设置面板。改为复用平台 seed 模块 `@deepseek-ai/dsh-client-ui-primitives`
  （Button / Pill / Tag / StateDot / Menu / Modal / Toast / Input / 图标 / writeClipboard，缺失时退化为内置最小实现）；
  版式换成设置页约定（760 宽、h2 18/600 + 13px 三级色导语、0.5px 描边卡片、等宽端点行、tabular-nums 统计）。
  交互重构：导入从常驻粘贴框改为弹层（带逐条新增/更新/失败结果），删除单条/整组改为 Modal 二次确认，
  成功提示改 Toast、失败保留行内告警明细，组动作收进 `⋯` 菜单（含重命名），工具列表改内嵌详情面板，
  加载骨架改用 `bg-skeleton`，并去掉自造滚动条样式（交给主题全局规则）。
