# 自足版动态预览快照（v5 / pkg-6）— 存档说明

> 存档日期：2026-09-04。来源：本会话内以动态插件（`mcpp-1` / `pkg-6`）运行并**端到端验证通过**的
> "单插件自足"版本。动态插件是进程级的，此目录用于把验证过的代码固化到仓库，供后续移植/回放。

## 目录内容

| 文件 | 说明 |
|---|---|
| `host-source.js` | 动态插件 **Host 半区**函数体源码（= pkg-6 code.host，25.5 KB，`node --check` 通过） |
| `client-source.js` | 动态插件 **Client 半区**函数体源码（= pkg-6 code.client，19 KB，`node --check` 通过） |
| `registry-preview.json` | 验证用沙箱注册表快照（9 条北大法宝服务 + 演示档位；**含真实 Authorization token**，勿外传/勿入库） |
| `README.md` | 本说明 |

## 与打包版原文件的关系（移植时对照）

本快照是**动态插件运行环境**的代码（函数体：`return { name, inject, apply }`），**不是**可直接安装的
cordis 插件包。与打包版 `lib/index.js` / `client/client.js` 的差异与移植要点：

| 能力 | 动态版（本快照） | 打包版需替换为 |
|---|---|---|
| Client↔Host 通信 | `harness.handle` + `host.call`（包私有 RPC） | 同源 HTTP 路由（webServer，见原 `lib/index.js` 的 mountUi）或另行设计 |
| 工具定义/注册 | `harness.defineTool` + `ctx.tools.register` | `tools` Service（inject `['tools']`）+ dsh-tools `defineTool` 或等效定义 |
| 文件读写 | 宿主 `fs` Service（resolve/readText/writeText） | `node:fs/promises` 直接读写 |
| HTTP 传输 | `shell` + curl（stdin 传体） | `@modelcontextprotocol/sdk` 的 `StreamableHTTPClientTransport` / `StdioClientTransport`（推荐，支持双传输 + 会话管理） |
| CSS | `styles.insert` | 手动 `<style data-plugin-css>` 幂等注入 |
| settings 页 | `settings.section` Slot（同） | 不变（id 需区分打包版 `mcp-servers`） |

## 已验证事实（实测，非推断）

- 导入：Claude/Cursor 风格 `mcpServers` JSON 整段粘贴导入，单条失败不阻断，重复名=更新。
- 连接/注册：对北大法宝 4 个不同网关（law-search / law-keyword / case-semantic-search / case-keyword）
  完成 initialize(2025-06-18) → tools/list → 注册 `mcp__<name>__<tool>`，快照回写注册表
  （serverTitle/serverVersion/tools/lastLoadAt）。服务器版本 1.14.1 / 2.13.1。
- 真实调用：新会话（子代理）直接调用 `mcp__pkulaw-law-keyword__get_law_list`（title=民法典）
  与 `mcp__pkulaw-law-search__get_article`（刑法第一条），返回真实数据。
- 档位：eager 自动加载（插件启动即连）；disabled 立即断开；on-demand 保持待命。
- 管理工具：`mcp_load` / `mcp_unload` / `mcp_status` 注册并可用（能力库 mcp 三件套的替代）。

## 迭代中修复的缺陷（打包版原代码也需修）

1. **沙箱读文件**：动态宿主 shell 子进程读不到宿主写 /tmp 的临时文件（curl exit 26）→ 请求体走 stdin（`--data-binary @-`）+ 显式 `sandboxPolicy danger-full-access`。打包版用 SDK 后不适用，但用 curl 通道时需注意。
2. **Accept 头**：部分网关强制 `Accept` 必须同时含 `application/json` 与 `text/event-stream`（否则 -32600/-32000 Not Acceptable）→ 双类型 + 响应体兼容 SSE `data:` 解析（`decodeMcpBody`）。
3. **tier-only 校验**：save() upsert 对既有条目改档位只发 `{name, tier}`，原代码误报 "streamable-http 需要 url" → command/url 回退到既有值（`save()` 内注释标出）。**打包版 `lib/index.js` 同样存在此缺陷，移植时一并修。**

## 关键架构结论（供移植参考）

- 工具注册进 agent 工具目录后，**新启动的会话/子代理才能看到**（模型侧工具集按会话装配）；
  因此家用打包版应在 **profile 启动时** 通过 bundle patch + `inject: ['tools', …]` 常驻注册
  （参照本机 `huayu-yuandian-legal-data` 插件），重启 DSH 后新会话即可直接调用 `mcp__*` 工具。
- registry 字段与能力库 `buildEntry` 完全对齐；若家里同时装了能力库 dsh-skill-mcp-manager，
  两者共享 registry.json 时注意幂等（同名条目重复加载会被 mcp-client 的 serverName 占位检查拦下）。

## 回放方式（在本会话复现 UI）

```text
cordis_run mcpp-1 pkg-6 mode=run   （客户端批准后，设置 → MCP 服务（预览））
```
