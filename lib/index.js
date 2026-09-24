// dsh-mcp-manager-panel — host plugin（自足版 v0.3.4：导入兼容 Cursor 式整行 command
// （无 args 时按 shell 词法拆成 command+args）、url/command 统一 trim、url 含空格明确报错；
// upsert/import 按最终传输清另一字段（http 不落 command、stdio 不落 url），修复旧字段残留。
// v0.3.3：新增群组元数据 groups.json — 支持组头自定义显示名，list 返回 groupMeta，
// save 增加 setGroupTitle 动作；v0.3.1/0.3.2 均为客户端改动）。
// 管理面板 + MCP 运行时一体：粘贴 mcpServers JSON 导入注册表 → 连接 MCP 服务器（stdio / streamable-http）
// → 把服务器工具注册为 mcp__<名称>__<工具> 供会话调用。不依赖能力库 dsh-skill-mcp-manager。
//
// 架构（2026-09 迭代，逻辑来自会话内动态预览验证版）：
//  - 传输：@modelcontextprotocol/sdk（StreamableHTTPClientTransport / StdioClientTransport，SSE 由 SDK 处理）。
//  - 工具注册：ctx.tools.register（inject: ['tools']，profile 常驻，新会话/子代理即可见）。
//  - 档位：eager（插件启动自动连接）/ on-demand（UI 或 mcp_load 按需）/ disabled（停用即断开）。
//  - 数据：<dataDir>/registry.json（默认 $DSH_HOME/skill-mcp-manager/registry.json，与能力库共享格式，
//    但本版本运行无需能力库）。字段与能力库 buildEntry 对齐。
//  - 客户端（client/client.js）经同源 HTTP /mcp-panel/* 与本模块通信。
//
// 已知缺陷（移植修复）：
//  1) save() 对既有条目 tier-only 更新回退 command/url 到既有值（原 v1 误报"需要 url"）。
//  2) Accept 头双类型 + SSE：交由 SDK 处理（动态预览 curl 版踩过的坑，SDK 内部兼容）。

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListToolsResultSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

export const name = "dsh-mcp-manager-panel";

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const TIERS = ["eager", "on-demand", "disabled"];
const TRANSPORTS = ["stdio", "streamable-http"];
const CALL_TIMEOUT_MS = 120000;
const CONNECT_TIMEOUT_MS = 30000;

// ── 小工具 ────────────────────────────────────────────────────────────────

function scalar(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

function normalizePairRecord(value) {
  const record = {};
  if (value === undefined || value === null) return record;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("期望对象（KEY: VALUE）");
  for (const key of Object.keys(value)) {
    if (key.trim() === "") continue;
    const v = value[key];
    record[key] = typeof v === "string" ? v : String(v);
  }
  return record;
}

// 兼容 Cursor/Claude 式“整行命令”（command 含空格与参数，无独立 args）：
// 按 shell 词法拆成 command + args（支持单双引号与反斜杠转义，不做变量展开）。
function shellSplitWords(text) {
  const tokens = [];
  let cur = "";
  let quote = null;
  let escaping = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaping) {
      cur += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaping = true;
      continue;
    }
    if (quote !== null) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur !== "") {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (escaping) cur += "\\";
  if (cur !== "") tokens.push(cur);
  return tokens;
}

function dshHome() {
  return typeof process.env.DSH_HOME === "string" && process.env.DSH_HOME !== ""
    ? process.env.DSH_HOME
    : join(homedir(), ".dsh");
}

function resolveRegistryPath(config) {
  const base = typeof config.dataDir === "string" && config.dataDir.trim() !== ""
    ? config.dataDir
    : join(dshHome(), "skill-mcp-manager");
  return join(base, "registry.json");
}

async function loadRegistry(file) {
  try {
    const text = await readFile(file, "utf8");
    const data = JSON.parse(text);
    if (data !== null && typeof data === "object" && Array.isArray(data.entries)) return data;
  } catch {
    /* 缺失或损坏都按空注册表处理 */
  }
  return { version: 1, entries: [] };
}

async function saveRegistry(file, registry) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(registry, null, 2), "utf8");
}

// 群组元数据（<dataDir>/groups.json）：{ version:1, groups: { "<前缀>": { title } } }。
// 只存“自定义显示名”，不参与注册表格式（注册表仍与能力库完全对齐）。
async function loadGroups(file) {
  try {
    const text = await readFile(file, "utf8");
    const data = JSON.parse(text);
    if (data !== null && typeof data === "object" && data.groups !== null && typeof data.groups === "object") {
      return { version: 1, groups: data.groups };
    }
  } catch {
    /* 缺失或损坏都按空元数据处理 */
  }
  return { version: 1, groups: {} };
}

async function saveGroups(file, groups) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(groups, null, 2), "utf8");
}

// 与能力库 buildEntry 保持一致的落盘形状（existing 存在时保留元数据/工具快照）。
function buildStoredEntry(input, existing, now) {
  const e = existing || {};
  const hasOwnArgs = Object.prototype.hasOwnProperty.call(input, "args") && input.args !== undefined && input.args !== null;
  const hasOwnEnv = Object.prototype.hasOwnProperty.call(input, "env") && input.env !== undefined && input.env !== null;
  const hasOwnHeaders = Object.prototype.hasOwnProperty.call(input, "headers") && input.headers !== undefined && input.headers !== null;
  return {
    id: scalar(e.id, input.name),
    name: input.name,
    tier: scalar(input.tier, scalar(e.tier, "on-demand")),
    transport: scalar(input.transport, scalar(e.transport, null)),
    command: scalar(input.command, scalar(e.command, null)),
    args: hasOwnArgs ? input.args : Array.isArray(e.args) ? e.args : [],
    env: hasOwnEnv ? input.env : e.env || {},
    cwd: scalar(input.cwd, scalar(e.cwd, null)),
    url: scalar(input.url, scalar(e.url, null)),
    headers: hasOwnHeaders ? input.headers : e.headers || {},
    notes: scalar(input.notes, scalar(e.notes, "")),
    systemEntryId: scalar(e.systemEntryId, "mcp-" + input.name),
    managed: scalar(e.managed, true),
    registeredAt: scalar(e.registeredAt, now),
    lastLoadAt: scalar(e.lastLoadAt, null),
    lastSyncAt: now,
    tools: Array.isArray(e.tools) ? e.tools : [],
    disabledTools: Array.isArray(e.disabledTools) ? e.disabledTools : [],
    serverName: scalar(e.serverName, ""),
    serverVersion: scalar(e.serverVersion, ""),
    serverTitle: scalar(e.serverTitle, ""),
    serverDescription: scalar(e.serverDescription, ""),
    websiteUrl: scalar(e.websiteUrl, ""),
    instructions: scalar(e.instructions, ""),
    capabilities: scalar(e.capabilities, null),
    metaFetchedAt: scalar(e.metaFetchedAt, null),
  };
}

function toSummary(entry, conn) {
  return {
    name: entry.name,
    tier: entry.tier,
    transport: entry.transport,
    url: entry.url,
    command: entry.command,
    cwd: entry.cwd,
    args: Array.isArray(entry.args) ? entry.args : [],
    env: entry.env && typeof entry.env === "object" ? entry.env : {},
    headers: entry.headers && typeof entry.headers === "object" ? entry.headers : {},
    notes: scalar(entry.notes, ""),
    // 工具名快照（最多 200 个，供 UI 弹层/搜索；提交体积有界）。
    tools: Array.isArray(entry.tools) && entry.tools.length <= 200
      ? entry.tools
          .map((t) => (t && typeof t === "object" && typeof t.name === "string" ? t.name : String(t === null || t === undefined ? "" : t)))
          .filter((item) => item !== "")
      : [],
    toolCount: Array.isArray(entry.tools) ? entry.tools.length : 0,
    disabledToolCount: Array.isArray(entry.disabledTools) ? entry.disabledTools.length : 0,
    serverTitle: scalar(entry.serverTitle, ""),
    serverVersion: scalar(entry.serverVersion, ""),
    serverDescription: scalar(entry.serverDescription, ""),
    conn: conn ? { status: conn.status, error: scalar(conn.error, ""), tools: conn.tools.length } : { status: "off", error: "", tools: 0 },
  };
}

// 把一条 Claude/Cursor 风格配置归一化为注册表条目输入。
function normalizeFromConfig(name, cfg) {
  if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) throw new Error("配置必须是对象");
  const rawCommand = typeof cfg.command === "string" ? cfg.command.trim() : "";
  const rawUrl = typeof cfg.url === "string" ? cfg.url.trim() : "";
  const commandProvided = rawCommand !== "";
  const urlProvided = rawUrl !== "";
  const transport = cfg.transport === "stdio" || cfg.transport === "streamable-http"
    ? cfg.transport
    : commandProvided
      ? "stdio"
      : "streamable-http";
  if (transport === "stdio" && !commandProvided) throw new Error("stdio 需要 command");
  if (transport === "streamable-http" && !urlProvided) throw new Error("需要 url");
  if (urlProvided && /\s/.test(rawUrl)) throw new Error("url 不能包含空格（疑似粘贴断行/误加空格，请检查原始配置）");

  // Cursor 式整行命令（如 “npx -y mcp-remote <url>”）且未单独给 args 时拆成 command + args。
  let command = commandProvided ? rawCommand : null;
  let args = [];
  const argsProvided = Array.isArray(cfg.args);
  if (argsProvided) {
    args = cfg.args.map((item) => String(item));
  } else if (command !== null && /\s/.test(command)) {
    const words = shellSplitWords(command);
    command = words.shift() || null;
    args = words.map(String);
  }
  let tier = "on-demand";
  if (cfg.tier !== undefined) {
    if (TIERS.indexOf(cfg.tier) < 0) throw new Error("tier 无效: " + cfg.tier);
    tier = cfg.tier;
  } else if (cfg.disabled === true) {
    tier = "disabled";
  }
  const env = normalizePairRecord(cfg.env);
  const headers = normalizePairRecord(cfg.headers);
  return {
    name,
    tier,
    transport,
    // 传输一致性：http 不落 command，stdio 不落 url（归一化时即清掉另一传输专属字段）。
    command: transport === "stdio" ? command : null,
    args,
    cwd: typeof cfg.cwd === "string" && cfg.cwd.trim() !== "" ? cfg.cwd.trim() : null,
    env,
    url: transport === "streamable-http" && urlProvided ? rawUrl : null,
    headers,
    notes: typeof cfg.notes === "string" ? cfg.notes.trim() : "",
  };
}

// ── MCP 工具名（对齐 mcp__<server>__<tool>；非法字符/超长做确定性折叠）──
function publicToolName(serverName, rawName) {
  const joined = "mcp__" + serverName + "__" + rawName;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, "_");
  if (normalized === joined && normalized.length <= 64) return normalized;
  let hash = 0;
  for (let i = 0; i < joined.length; i++) hash = (hash * 31 + joined.charCodeAt(i)) >>> 0;
  const tag = hash.toString(16).slice(0, 12);
  return normalized.slice(0, 64 - tag.length - 1) + "_" + tag;
}

function flattenResult(result) {
  const parts = [];
  const content = Array.isArray(result && result.content) ? result.content : [];
  for (const c of content) {
    if (c && c.type === "text" && typeof c.text === "string") parts.push(c.text);
    else if (c && typeof c === "object") parts.push(JSON.stringify(c));
  }
  if (parts.length === 0 && result && result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent));
  }
  return parts.join("\n");
}

function outputTextBlock(args, value) {
  return [{ type: "text", text: String(value) }];
}

// ── MCP 运行时（SDK 连接 + tools 注册，进程内状态）──────────────────────
function createMcpManager({ registryFile, toolsRegister, log }) {
  const conns = {};

  function connFor(name) {
    if (!conns[name]) conns[name] = { status: "off", error: "", tools: [], serverTitle: "", serverVersion: "", client: undefined, disposers: [] };
    return conns[name];
  }

  async function load(name) {
    if (!NAME_RE.test(name)) throw new Error("name 需匹配 [A-Za-z0-9_-]{1,32}");
    const registry = await loadRegistry(registryFile);
    const entry = registry.entries.find((e) => e.name === name);
    if (!entry) throw new Error("未找到条目: " + name);
    await unload(name);
    const conn = connFor(name);
    conn.status = "connecting";
    conn.error = "";

    let client;
    try {
      client = new Client({ name: "dsh-mcp-manager-panel", version: "2.0.0" }, { capabilities: {} });
      let transport;
      if (entry.transport === "stdio") {
        const spec = { command: entry.command, args: Array.isArray(entry.args) ? entry.args : [] };
        if (entry.env && typeof entry.env === "object" && Object.keys(entry.env).length > 0) spec.env = entry.env;
        if (typeof entry.cwd === "string" && entry.cwd !== "") spec.cwd = entry.cwd;
        transport = new StdioClientTransport(spec);
      } else {
        if (!entry.url) throw new Error("streamable-http 需要 url");
        const opts = {};
        if (entry.headers && typeof entry.headers === "object" && Object.keys(entry.headers).length > 0) {
          opts.requestInit = { headers: entry.headers };
        }
        transport = new StreamableHTTPClientTransport(new URL(entry.url), opts);
      }
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) => setTimeout(() => reject(new Error("连接超时（" + CONNECT_TIMEOUT_MS + "ms）")), CONNECT_TIMEOUT_MS)),
      ]);
      // initialize 之后补发 initialized 通知（部分服务器要求）。
      try {
        await client.notification({ method: "notifications/initialized", params: {} });
      } catch {
        /* 服务器可能不要求，忽略 */
      }
      try {
        const sv = client.getServerVersion ? client.getServerVersion() : undefined;
        if (sv) {
          conn.serverTitle = String(sv.name || "");
          conn.serverVersion = String(sv.version || "");
        }
      } catch {
        /* ignore */
      }
      const tools = [];
      let cursor;
      do {
        const page = await client.request(
          { method: "tools/list", params: cursor === undefined ? {} : { cursor } },
          ListToolsResultSchema,
          { timeout: CONNECT_TIMEOUT_MS },
        );
        tools.push(...(Array.isArray(page.tools) ? page.tools : []));
        cursor = typeof page.nextCursor === "string" && page.nextCursor !== "" ? page.nextCursor : undefined;
      } while (cursor !== undefined);

      conn.tools = tools.map((t) => ({ name: String(t.name || ""), description: String(t.description || "") }));
      for (const t of tools) {
        const rawName = String(t.name || "");
        if (rawName === "") continue;
        const publicName = publicToolName(name, rawName);
        const parameters = t.inputSchema && typeof t.inputSchema === "object" && !Array.isArray(t.inputSchema)
          ? t.inputSchema
          : { type: "object", properties: {} };
        try {
          const definition = {
            name: publicName,
            description: String(t.description || "").slice(0, 1024) || name + " MCP 工具",
            parameters,
            output: { schema: { type: "string" }, render: outputTextBlock },
            timeoutMs: CALL_TIMEOUT_MS,
            execute: async (args, exec) => {
              const call = await client.request(
                { method: "tools/call", params: { name: rawName, arguments: args && typeof args === "object" ? args : {} } },
                CallToolResultSchema,
                { signal: exec && exec.signal, timeout: CALL_TIMEOUT_MS },
              );
              // Client.request 解析后直接返回 CallToolResult（{content:[...]}）；
              // 兼容历史信封形态（{result:{...}}）后取数据本体。
              const result = (call && call.result !== undefined) ? call.result : call;
              if (result && result.isError === true) return "MCP 工具执行返回错误：\n" + flattenResult(result);
              return flattenResult(result || {});
            },
          };
          conn.disposers.push(toolsRegister(definition));
        } catch (err) {
          log("warn", "工具注册失败 " + publicName + ": " + String((err && err.message) || err));
        }
      }
      conn.client = client;
      const stored = registry.entries.find((e) => e.name === name);
      if (stored) {
        stored.tools = conn.tools;
        stored.serverTitle = conn.serverTitle;
        stored.serverVersion = conn.serverVersion;
        stored.lastLoadAt = new Date().toISOString();
        stored.lastSyncAt = stored.lastLoadAt;
      }
      await saveRegistry(registryFile, registry);
      conn.status = "connected";
      return { ok: true, name, tools: conn.tools.length, serverTitle: conn.serverTitle, serverVersion: conn.serverVersion };
    } catch (err) {
      if (client) {
        try {
          await client.close();
        } catch {
          /* ignore */
        }
      }
      conn.status = "error";
      conn.error = String((err && err.message) || err);
      throw err;
    }
  }

  async function unload(name) {
    const conn = conns[name];
    if (!conn) return { ok: true, name };
    for (const dispose of conn.disposers) {
      try {
        dispose();
      } catch (err) {
        log("warn", "注销失败 " + name + ": " + String((err && err.message) || err));
      }
    }
    const client = conn.client;
    conns[name] = { status: "off", error: "", tools: [], serverTitle: "", serverVersion: "", client: undefined, disposers: [] };
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
    return { ok: true, name };
  }

  async function loadEager() {
    const registry = await loadRegistry(registryFile);
    for (const entry of registry.entries) {
      if (entry.tier === "eager") {
        try {
          await load(entry.name);
          log("info", "eager 自动加载 " + entry.name + " 完成");
        } catch (err) {
          log("warn", "eager 自动加载 " + entry.name + " 失败: " + String((err && err.message) || err));
        }
      }
    }
  }

  function statusFor(name) {
    const conn = conns[name];
    if (!conn) return { status: "off", error: "", tools: 0 };
    return { status: conn.status, error: scalar(conn.error, ""), tools: conn.tools.length };
  }

  async function closeAll() {
    for (const name of Object.keys(conns)) {
      await unload(name);
    }
  }

  return { load, unload, loadEager, statusFor, connFor, closeAll };
}

// ── 业务处理器（每次调用即时读写文件，简单可靠）─────────────────────────
function createHandlers({ registryFile, groupsFile, mcp }) {
  async function list() {
    const registry = await loadRegistry(registryFile);
    const groups = await loadGroups(groupsFile);
    return { ok: true, path: registryFile, groupMeta: groups.groups, entries: registry.entries.map((e) => toSummary(e, mcp.connFor(e.name))) };
  }

  async function importText(text) {
    if (!text || !text.trim()) throw new Error("没有可解析的 JSON 文本");
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error("JSON 解析失败: " + String(error && error.message ? error.message : error));
    }
    if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("JSON 顶层必须是对象");
    const container = data.mcpServers !== undefined && data.mcpServers !== null ? data.mcpServers : data;
    if (typeof container !== "object" || Array.isArray(container)) throw new Error("mcpServers 必须是对象");

    const registry = await loadRegistry(registryFile);
    const now = new Date().toISOString();
    const rows = [];
    let changed = false;
    for (const entryName of Object.keys(container)) {
      const cfg = container[entryName];
      try {
        if (!NAME_RE.test(entryName)) throw new Error("名称需匹配 [A-Za-z0-9_-]{1,32}");
        const normalized = normalizeFromConfig(entryName, cfg);
        const idx = registry.entries.findIndex((entry) => entry.name === entryName);
        const existing = idx >= 0 ? registry.entries[idx] : undefined;
        const entry = buildStoredEntry(normalized, existing, now);
        // 传输一致性兜底：http 条目不落 command，stdio 条目不落 url（防旧字段残留/误导出）。
        if (entry.transport === "streamable-http") entry.command = null;
        else if (entry.transport === "stdio") entry.url = null;
        if (idx >= 0) registry.entries[idx] = entry;
        else registry.entries.push(entry);
        changed = true;
        rows.push({ name: entryName, status: idx >= 0 ? "updated" : "added", tier: entry.tier });
      } catch (error) {
        rows.push({ name: entryName, status: "error", error: String(error && error.message ? error.message : error) });
      }
    }
    if (changed) await saveRegistry(registryFile, registry);
    return { ok: true, rows, entryCount: registry.entries.length, path: registryFile };
  }

  async function save(payload) {
    const body = payload && typeof payload === "object" ? payload : {};
    const registry = await loadRegistry(registryFile);
    const now = new Date().toISOString();
    const name = String(body.name === undefined ? "" : body.name);

    if (body.action === "delete") {
      if (!NAME_RE.test(name)) throw new Error("name 需匹配 [A-Za-z0-9_-]{1,32}");
      const before = registry.entries.length;
      registry.entries = registry.entries.filter((entry) => entry.name !== name);
      if (registry.entries.length === before) throw new Error("未找到条目: " + name);
      await saveRegistry(registryFile, registry);
      await mcp.unload(name);
      return { ok: true, action: "deleted", name, path: registryFile, entryCount: registry.entries.length };
    }

    if (body.action === "upsert") {
      const input = body.entry && typeof body.entry === "object" ? body.entry : {};
      const entryName = String(input.name === undefined ? "" : input.name);
      if (!NAME_RE.test(entryName)) throw new Error("name 需匹配 [A-Za-z0-9_-]{1,32}");
      const tier = scalar(input.tier, "on-demand");
      if (TIERS.indexOf(tier) < 0) throw new Error("tier 无效: " + tier);

      const idx = registry.entries.findIndex((entry) => entry.name === entryName);
      const existing = idx >= 0 ? registry.entries[idx] : undefined;
      const transport = scalar(input.transport, scalar(existing ? existing.transport : undefined, null));
      if (!existing && (transport === null || transport === "")) throw new Error("新增条目需要 transport（stdio / streamable-http）");
      if (transport !== null && TRANSPORTS.indexOf(transport) < 0) throw new Error("transport 无效: " + transport);

      // 字段显式语义：只传 name/tier 等最小更新时沿用既有值；切到 http 不落 command、切到 stdio 不落 url。
      const wantsHttp = transport === "streamable-http";
      const wantsStdio = transport === "stdio";
      const commandGiven = typeof input.command === "string" && input.command.trim() !== "";
      const urlGiven = typeof input.url === "string" && input.url.trim() !== "";
      if (urlGiven && /\s/.test(input.url.trim())) throw new Error("url 不能包含空格（疑似粘贴断行/误加空格，请检查原始配置）");
      const argsGiven = Array.isArray(input.args)
        ? input.args.map((item) => String(item))
        : typeof input.args === "string" && input.args.trim() !== ""
          ? input.args.trim().split(/\s+/)
          : null;

      let command = null;
      let url = null;
      let args = [];
      if (wantsHttp) {
        url = urlGiven ? input.url.trim() : existing && existing.url ? existing.url : null;
        if (argsGiven !== null) args = argsGiven;
      } else if (wantsStdio) {
        if (commandGiven) {
          const raw = input.command.trim();
          if (argsGiven !== null) {
            command = raw;
            args = argsGiven;
          } else if (/\s/.test(raw)) {
            // Cursor 式整行命令：拆成 command + args。
            const words = shellSplitWords(raw);
            command = words.shift() || null;
            args = words.map(String);
          } else {
            command = raw;
            args = [];
          }
        } else if (existing && typeof existing.command === "string" && existing.command !== "") {
          command = existing.command; // tier-only 更新：沿用既有 command。
          args = argsGiven !== null ? argsGiven : Array.isArray(existing.args) ? existing.args : [];
        }
      } else {
        // 无既有 transport（异常数据兜底）：显式字段优先，否则沿用既有。
        command = commandGiven ? input.command.trim() : existing && existing.command ? existing.command : null;
        url = urlGiven ? input.url.trim() : existing && existing.url ? existing.url : null;
        if (argsGiven !== null) args = argsGiven;
        else if (existing && Array.isArray(existing.args)) args = existing.args;
      }
      if (wantsStdio && command === null) throw new Error("stdio 传输需要 command");
      if (wantsHttp && url === null) throw new Error("streamable-http 传输需要 url");

      const env = normalizePairRecord(input.env !== undefined ? input.env : existing ? existing.env : {});
      const headers = normalizePairRecord(input.headers !== undefined ? input.headers : existing ? existing.headers : {});

      const normalized = {
        name: entryName,
        tier,
        transport: transport === null ? undefined : transport,
        command,
        args,
        cwd: typeof input.cwd === "string" && input.cwd.trim() !== "" ? input.cwd.trim()
          : wantsHttp ? null
            : existing && existing.cwd ? existing.cwd : null,
        env,
        url,
        headers,
        notes: typeof input.notes === "string" ? input.notes : existing ? existing.notes : "",
      };
      const entry = buildStoredEntry(normalized, existing, now);
      // 传输一致性兜底（buildStoredEntry 对空值回退既有，这里按最终传输强制清另一字段）。
      if (entry.transport === "streamable-http") entry.command = null;
      else if (entry.transport === "stdio") entry.url = null;
      if (idx >= 0) registry.entries[idx] = entry;
      else registry.entries.push(entry);
      await saveRegistry(registryFile, registry);
      // 热生效：disabled 立即断开；eager 后台加载；on-demand 仅写盘（UI 或 mcp_load 再连）。
      if (tier === "disabled") {
        await mcp.unload(entryName);
      } else if (tier === "eager") {
        mcp.load(entryName).catch((err) => log("warn", "eager 加载 " + entryName + " 失败: " + String((err && err.message) || err)));
      }
      return { ok: true, action: idx >= 0 ? "updated" : "added", name: entryName, tier, path: registryFile, entryCount: registry.entries.length };
    }

    if (body.action === "setGroupTitle") {
      const prefix = String(body.prefix === undefined ? "" : body.prefix);
      if (!NAME_RE.test(prefix)) throw new Error("group 前缀需匹配 [A-Za-z0-9_-]{1,32}");
      let title = typeof body.title === "string" ? body.title.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
      if (title.length > 40) throw new Error("组名最长 40 字符");
      const groups = await loadGroups(groupsFile);
      if (title === "") delete groups.groups[prefix];
      else groups.groups[prefix] = { title };
      await saveGroups(groupsFile, groups);
      return { ok: true, action: "group-title", prefix, title, path: groupsFile };
    }

    throw new Error("未知 action: " + body.action);
  }

  return { list, importText, save };
}

// ── HTTP 助手（同源 JSON 路由；POST 校验 Origin）────────────────────────

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

// host 归一化：去缺省端口 + 小写，避免 `localhost:80` 与 `localhost` 这类伪不匹配。
function normalizeHost(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "") return "";
  return raw.endsWith(":80") ? raw.slice(0, -3) : raw;
}

// 取出主机名（IPv6 字面量按括号处理，不能用 split(":")，否则 "[::1]:port" 会被切坏）。
function hostNameOf(host) {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host.slice(1) : host.slice(1, end);
  }
  const colon = host.indexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

function isLoopbackHost(host) {
  const name = hostNameOf(host);
  return name === "127.0.0.1" || name === "::1" || name === "localhost";
}

// 同源判定：Origin 缺失（或为 "null"）时按 RFC 6454 判定——浏览器对跨站请求必带 Origin，
// 所以“没有 Origin”只可能是非浏览器请求（桌面壳 / 反代 / curl），不应被当成跨站拒绝；
// 但仅限本机回环 Host，避免面板被绑定到外网时放过直连写请求。
function sameOrigin(request) {
  const host = normalizeHost(request.headers.host);
  if (host === "") return false;
  const origin = request.headers.origin;
  if (origin === undefined || origin === null || origin === "" || origin === "null") {
    return isLoopbackHost(host);
  }
  try {
    return normalizeHost(new URL(origin).host) === host;
  } catch {
    return false;
  }
}

async function readJsonBody(request, maxBytes = 1 << 20) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function mountRoutes(handlers, mcp, registryFile, webServer) {
  const disposers = [];
  const route = (method, path, fn) => {
    disposers.push(webServer.register({
      kind: "exact",
      path,
      handler: async (request, response) => {
        try {
          if (request.method !== method) {
            response.writeHead(405, { allow: method });
            response.end();
            return;
          }
          if (method === "POST" && !sameOrigin(request)) {
            sendJson(response, 403, { ok: false, error: "untrusted origin" });
            return;
          }
          const body = method === "POST" ? await readJsonBody(request) : {};
          const result = await fn(body, request);
          sendJson(response, 200, result);
        } catch (error) {
          sendJson(response, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
    }));
  };

  route("GET", "/mcp-panel/list", () => handlers.list());
  route("POST", "/mcp-panel/import", (body) => handlers.importText(body.text));
  route("POST", "/mcp-panel/save", (body) => handlers.save(body));
  route("POST", "/mcp-panel/load", (body) => mcp.load(String((body && body.name) || "")));
  route("POST", "/mcp-panel/unload", (body) => mcp.unload(String((body && body.name) || "")));
  route("POST", "/mcp-panel/status", async () => {
    const registry = await loadRegistry(registryFile);
    return { ok: true, entries: registry.entries.map((e) => ({ name: e.name, tier: e.tier, conn: mcp.statusFor(e.name) })) };
  });
  return disposers;
}

// ── cordis apply ───────────────────────────────────────────────────────────

export function apply(ctx, config = {}) {
  const cfg = config || {};
  const registryFile = resolveRegistryPath(cfg);
  const groupsFile = join(dirname(registryFile), "groups.json");

  const log = (level, msg) => {
    try {
      if (ctx.logger && typeof ctx.logger[level] === "function") ctx.logger[level]("[mcp-panel] " + msg);
      else console.log("[" + level + "][mcp-panel] " + msg);
    } catch {
      /* ignore */
    }
  };

  const toolsRegister = (definition) => ctx.tools.register(definition);
  const mcp = createMcpManager({ registryFile, toolsRegister, log });
  const handlers = createHandlers({ registryFile, groupsFile, mcp });
  const disposers = [];

  if (typeof ctx.inject === "function") {
    // webServer 是惰性服务：等它就绪再挂路由。
    disposers.push(ctx.inject(["webServer"], (hostCtx) => {
      const server = hostCtx && hostCtx.webServer !== undefined ? hostCtx.webServer : ctx.webServer;
      if (server === undefined) return;
      for (const dispose of mountRoutes(handlers, mcp, registryFile, server)) disposers.push(dispose);
    }));
  } else {
    for (const dispose of mountRoutes(handlers, mcp, ctx.get("webServer"))) disposers.push(dispose);
  }

  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* ignore */
        }
      }
      try {
        void mcp.closeAll();
      } catch {
        /* ignore */
      }
    });
  }

  log("info", "MCP 面板就绪，注册表: " + registryFile);

  // eager 条目后台自动加载（随 profile 常驻；新会话启动后即可见 mcp__* 工具）。
  mcp.loadEager().catch((err) => log("warn", "eager 加载失败: " + String((err && err.message) || err)));
}
