// dsh-mcp-manager-panel — 动态预览版 Host 半区 v5（pkg-6）。
// 修复：save() 对已有条目的 tier-only 更新不再强制要求 url/command——command/url 回退到既有值。
//（该缺陷在打包版 lib/index.js 同样存在，移植时一并修复。）

const REGISTRY_FILE = '/home/wangyuncai/dsh-mcp-manager-panel/preview-registry/registry.json';
const WORKSPACE_ROOT = '/home/wangyuncai/dsh-mcp-manager-panel';

const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const TIERS = ['eager', 'on-demand', 'disabled'];
const TRANSPORTS = ['stdio', 'streamable-http'];
const PROTOCOL_VERSION = '2025-06-18';
const CALL_TIMEOUT_MS = 120000;

function scalar(value, fallback) {
  return value === undefined || value === null ? fallback : value;
}

function normalizePairRecord(value) {
  const record = {};
  if (value === undefined || value === null) return record;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('期望对象（KEY: VALUE）');
  for (const key of Object.keys(value)) {
    if (key.trim() === '') continue;
    const v = value[key];
    record[key] = typeof v === 'string' ? v : String(v);
  }
  return record;
}

async function loadRegistry(fs) {
  try {
    const target = await fs.resolve(REGISTRY_FILE);
    const text = await fs.readText(target);
    const data = JSON.parse(text);
    if (data !== null && typeof data === 'object' && Array.isArray(data.entries)) return data;
  } catch (error) {
    // 缺失或损坏都按空注册表处理
  }
  return { version: 1, entries: [] };
}

async function saveRegistry(fs, registry) {
  const target = await fs.resolve(REGISTRY_FILE);
  await fs.writeText(target, JSON.stringify(registry, null, 2));
}

function buildStoredEntry(input, existing, now) {
  const e = existing || {};
  const hasOwnArgs = Object.prototype.hasOwnProperty.call(input, 'args') && input.args !== undefined && input.args !== null;
  const hasOwnEnv = Object.prototype.hasOwnProperty.call(input, 'env') && input.env !== undefined && input.env !== null;
  const hasOwnHeaders = Object.prototype.hasOwnProperty.call(input, 'headers') && input.headers !== undefined && input.headers !== null;
  return {
    id: scalar(e.id, input.name),
    name: input.name,
    tier: scalar(input.tier, scalar(e.tier, 'on-demand')),
    transport: scalar(input.transport, scalar(e.transport, null)),
    command: scalar(input.command, scalar(e.command, null)),
    args: hasOwnArgs ? input.args : Array.isArray(e.args) ? e.args : [],
    env: hasOwnEnv ? input.env : e.env || {},
    cwd: scalar(input.cwd, scalar(e.cwd, null)),
    url: scalar(input.url, scalar(e.url, null)),
    headers: hasOwnHeaders ? input.headers : e.headers || {},
    notes: scalar(input.notes, scalar(e.notes, '')),
    systemEntryId: scalar(e.systemEntryId, 'mcp-' + input.name),
    managed: scalar(e.managed, true),
    registeredAt: scalar(e.registeredAt, now),
    lastLoadAt: scalar(e.lastLoadAt, null),
    lastSyncAt: now,
    tools: Array.isArray(e.tools) ? e.tools : [],
    disabledTools: Array.isArray(e.disabledTools) ? e.disabledTools : [],
    serverName: scalar(e.serverName, ''),
    serverVersion: scalar(e.serverVersion, ''),
    serverTitle: scalar(e.serverTitle, ''),
    serverDescription: scalar(e.serverDescription, ''),
    websiteUrl: scalar(e.websiteUrl, ''),
    instructions: scalar(e.instructions, ''),
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
    env: entry.env && typeof entry.env === 'object' ? entry.env : {},
    headers: entry.headers && typeof entry.headers === 'object' ? entry.headers : {},
    notes: scalar(entry.notes, ''),
    toolCount: Array.isArray(entry.tools) ? entry.tools.length : 0,
    disabledToolCount: Array.isArray(entry.disabledTools) ? entry.disabledTools.length : 0,
    serverTitle: scalar(entry.serverTitle, ''),
    serverVersion: scalar(entry.serverVersion, ''),
    serverDescription: scalar(entry.serverDescription, ''),
    conn: conn ? { status: conn.status, error: scalar(conn.error, ''), tools: conn.tools.length } : { status: 'off', error: '', tools: 0 },
  };
}

function normalizeFromConfig(name, cfg) {
  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('配置必须是对象');
  const command = typeof cfg.command === 'string' && cfg.command !== '' ? cfg.command : null;
  const url = typeof cfg.url === 'string' && cfg.url !== '' ? cfg.url : null;
  const transport = cfg.transport === 'stdio' || cfg.transport === 'streamable-http'
    ? cfg.transport
    : command !== null
      ? 'stdio'
      : 'streamable-http';
  if (transport === 'stdio' && command === null) throw new Error('stdio 需要 command');
  if (transport === 'streamable-http' && url === null) throw new Error('需要 url');
  let tier = 'on-demand';
  if (cfg.tier !== undefined) {
    if (TIERS.indexOf(cfg.tier) < 0) throw new Error('tier 无效: ' + cfg.tier);
    tier = cfg.tier;
  } else if (cfg.disabled === true) {
    tier = 'disabled';
  }
  const args = Array.isArray(cfg.args) ? cfg.args.map((item) => String(item)) : [];
  const env = normalizePairRecord(cfg.env);
  const headers = normalizePairRecord(cfg.headers);
  return {
    name,
    tier,
    transport,
    command,
    args,
    cwd: typeof cfg.cwd === 'string' && cfg.cwd !== '' ? cfg.cwd : null,
    env,
    url,
    headers,
    notes: typeof cfg.notes === 'string' ? cfg.notes : '',
  };
}

// MCP 工具名
function publicToolName(serverName, rawName) {
  const joined = 'mcp__' + serverName + '__' + rawName;
  const normalized = joined.replace(/[^A-Za-z0-9_-]/g, '_');
  if (normalized === joined && normalized.length <= 64) return normalized;
  let hash = 0;
  for (let i = 0; i < joined.length; i++) hash = (hash * 31 + joined.charCodeAt(i)) >>> 0;
  const tag = hash.toString(16).slice(0, 12);
  return normalized.slice(0, 64 - tag.length - 1) + '_' + tag;
}

// MCP JSON Schema → DSL 裸属性表
function sanitizeParameters(inputSchema) {
  const out = {};
  const root = inputSchema && typeof inputSchema === 'object' ? inputSchema : {};
  const props = root.properties && typeof root.properties === 'object' ? root.properties : {};
  const required = Array.isArray(root.required) ? root.required : [];
  for (const key of Object.keys(props)) {
    const p = props[key] && typeof props[key] === 'object' ? props[key] : {};
    const spec = {};
    let type = Array.isArray(p.type) ? p.type[0] : p.type;
    for (const unionKey of ['anyOf', 'oneOf']) {
      if (Array.isArray(p[unionKey])) {
        const types = p[unionKey].map((m) => m && m.type).filter((t) => typeof t === 'string');
        type = types.indexOf('string') >= 0 ? 'string' : (types.indexOf('number') >= 0 || types.indexOf('integer') >= 0) ? 'number' : types.indexOf('boolean') >= 0 ? 'boolean' : 'json';
        break;
      }
    }
    if (type === 'string') spec.type = 'string';
    else if (type === 'integer' || type === 'number') spec.type = 'number';
    else if (type === 'boolean') spec.type = 'boolean';
    else spec.type = 'json';
    if (typeof p.description === 'string' && p.description !== '') spec.description = p.description;
    if (Array.isArray(p.enum) && p.enum.length > 0) spec.enum = p.enum.filter((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
    if (required.indexOf(key) >= 0) spec.required = true;
    out[key] = spec;
  }
  return out;
}

function flattenResult(result) {
  const parts = [];
  const content = Array.isArray(result && result.content) ? result.content : [];
  for (const c of content) {
    if (c && c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
    else if (c && typeof c === 'object') parts.push(JSON.stringify(c));
  }
  if (parts.length === 0 && result && result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent));
  }
  return parts.join('\n');
}

// 解码 MCP 响应体：纯 JSON 或 SSE
function decodeMcpBody(raw) {
  const trimmed = String(raw || '').trim();
  if (trimmed === '') throw new Error('MCP 无响应体');
  if (trimmed.indexOf('data:') >= 0) {
    const payloads = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const m = /^data:\s?(.*)$/.exec(line);
      if (m) payloads.push(m[1]);
    }
    if (payloads.length === 0) throw new Error('SSE 无 data 载荷: ' + trimmed.slice(0, 200));
    return JSON.parse(payloads.join('\n'));
  }
  return JSON.parse(trimmed);
}

// ── MCP 客户端（shell + curl）──────────────────────────────────────────
function createMcpManager(fs, shell, registerToolFn, log) {
  const conns = {};

  function connFor(name) {
    if (!conns[name]) conns[name] = { status: 'off', error: '', tools: [], serverTitle: '', serverVersion: '', sessionId: undefined, disposers: [] };
    return conns[name];
  }

  async function curlRequest(conn, entry, body, timeoutMs) {
    if (entry.transport !== 'streamable-http' || !entry.url) throw new Error('预览版暂只支持 streamable-http（该条目 transport=' + String(entry.transport) + '）');
    const headers = entry.headers && typeof entry.headers === 'object' ? entry.headers : {};
    const env = {};
    let command = 'curl -sS --max-time ' + Math.floor((timeoutMs || 60000) / 1000) + ' -i -X POST -H "content-type: application/json" -H "accept: application/json, text/event-stream"';
    let idx = 0;
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-type' || key.toLowerCase() === 'accept') continue;
      const envKey = 'MCP_HDR' + idx;
      env[envKey] = String(headers[key]);
      command += ' -H "' + key.replace(/"/g, '') + ': $' + envKey + '"';
      idx += 1;
    }
    if (conn.sessionId) command += ' -H "Mcp-Session-Id: ' + conn.sessionId + '"';
    command += ' --data-binary @- ' + JSON.stringify(entry.url);
    const spec = shell.resolve({
      command,
      timeoutMs: timeoutMs || 60000,
      stdoutMaxBytes: 16 * 1024 * 1024,
      env,
      stdin: JSON.stringify(body),
      sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: WORKSPACE_ROOT },
    });
    const result = await shell.run(spec);
    if (result.exitCode !== 0) {
      throw new Error('网络请求失败(exit ' + result.exitCode + '): ' + String((result.stderr && result.stderr.text) || '').slice(0, 300));
    }
    const out = String(result.stdout && result.stdout.text || '');
    const sep = out.indexOf('\r\n\r\n');
    const head = sep >= 0 ? out.slice(0, sep) : '';
    const raw = sep >= 0 ? out.slice(sep + 4) : out;
    const m = /Mcp-Session-Id:\s*([^\r\n]+)/i.exec(head);
    const sessionId = m ? m[1].trim() : undefined;
    if (sessionId) conn.sessionId = sessionId;
    let parsed;
    try {
      parsed = decodeMcpBody(raw);
    } catch (err) {
      throw new Error('MCP 响应解析失败: ' + String(err && err.message || err) + ' | 原文: ' + raw.slice(0, 200));
    }
    if (parsed && parsed.error) throw new Error('MCP 错误 ' + String(parsed.error.code) + ': ' + String(parsed.error.message || ''));
    return { result: parsed && parsed.result, sessionId };
  }

  async function load(name) {
    if (!NAME_RE.test(name)) throw new Error('name 非法');
    const registry = await loadRegistry(fs);
    const entry = registry.entries.find((e) => e.name === name);
    if (!entry) throw new Error('未找到条目: ' + name);
    await unload(name);
    const conn = connFor(name);
    conn.status = 'connecting';
    conn.error = '';
    try {
      const init = await curlRequest(conn, entry, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'dsh-mcp-manager-panel', version: '0.1.0' } } }, 30000);
      const info = init.result && init.result.serverInfo ? init.result.serverInfo : {};
      conn.serverTitle = typeof info.name === 'string' ? info.name : '';
      conn.serverVersion = typeof info.version === 'string' ? info.version : '';
      const toolsResp = await curlRequest(conn, entry, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, 30000);
      const tools = Array.isArray(toolsResp.result && toolsResp.result.tools) ? toolsResp.result.tools : [];
      conn.tools = tools.map((t) => ({ name: String(t.name || ''), description: String(t.description || '') }));
      for (const t of tools) {
        const rawName = String(t.name || '');
        if (rawName === '') continue;
        const publicName = publicToolName(name, rawName);
        const parameters = sanitizeParameters(t.inputSchema);
        try {
          const def = harness.defineTool({
            name: publicName,
            description: String(t.description || '').slice(0, 1024) || (name + ' MCP 工具'),
            parameters,
            output: {
              schema: { type: 'json' },
              render: (args, value) => [{ type: 'text', text: String(value) }],
            },
            execute: async (args, exec) => {
              const call = await curlRequest(conn, entry, { jsonrpc: '2.0', id: Date.now() % 2147483647, method: 'tools/call', params: { name: rawName, arguments: args && typeof args === 'object' ? args : {} } }, CALL_TIMEOUT_MS);
              const result = call.result || {};
              if (result.isError === true) return 'MCP 工具执行返回错误：\n' + flattenResult(result);
              return flattenResult(result);
            },
            timeoutMs: CALL_TIMEOUT_MS,
          });
          conn.disposers.push(registerToolFn(def));
        } catch (err) {
          log('工具注册失败 ' + publicName + ': ' + String(err && err.message || err));
        }
      }
      const stored = registry.entries.find((e) => e.name === name);
      if (stored) {
        stored.tools = conn.tools;
        stored.serverTitle = conn.serverTitle;
        stored.serverVersion = conn.serverVersion;
        stored.lastLoadAt = new Date().toISOString();
        stored.lastSyncAt = stored.lastLoadAt;
      }
      await saveRegistry(fs, registry);
      conn.status = 'connected';
      return { ok: true, name, tools: conn.tools.length, serverTitle: conn.serverTitle, serverVersion: conn.serverVersion };
    } catch (err) {
      conn.status = 'error';
      conn.error = String(err && err.message || err);
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
        log('注销失败 ' + name + ': ' + String(err && err.message || err));
      }
    }
    conns[name] = { status: 'off', error: '', tools: [], serverTitle: '', serverVersion: '', sessionId: undefined, disposers: [] };
    return { ok: true, name };
  }

  async function loadEager() {
    const registry = await loadRegistry(fs);
    for (const entry of registry.entries) {
      if (entry.tier === 'eager') {
        try {
          await load(entry.name);
          log('eager 自动加载 ' + entry.name + ' 完成');
        } catch (err) {
          log('eager 自动加载 ' + entry.name + ' 失败: ' + String(err && err.message || err));
        }
      }
    }
  }

  function statusFor(name) {
    const conn = conns[name];
    if (!conn) return { status: 'off', error: '', tools: 0 };
    return { status: conn.status, error: scalar(conn.error, ''), tools: conn.tools.length };
  }

  return { load, unload, loadEager, statusFor, connFor };
}

// ── 业务处理器 ──────────────────────────────────────────────────────────
function createHandlers(fs, mcp) {
  async function list() {
    const registry = await loadRegistry(fs);
    return { ok: true, path: REGISTRY_FILE, entries: registry.entries.map((e) => toSummary(e, mcp.connFor(e.name))) };
  }

  async function importText(text) {
    if (!text || !text.trim()) throw new Error('没有可解析的 JSON 文本');
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error('JSON 解析失败: ' + String(error && error.message ? error.message : error));
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON 顶层必须是对象');
    const container = data.mcpServers !== undefined && data.mcpServers !== null ? data.mcpServers : data;
    if (typeof container !== 'object' || Array.isArray(container)) throw new Error('mcpServers 必须是对象');

    const registry = await loadRegistry(fs);
    const now = new Date().toISOString();
    const rows = [];
    let changed = false;
    for (const entryName of Object.keys(container)) {
      const cfg = container[entryName];
      try {
        if (!NAME_RE.test(entryName)) throw new Error('名称需匹配 [A-Za-z0-9_-]{1,32}');
        const normalized = normalizeFromConfig(entryName, cfg);
        const idx = registry.entries.findIndex((entry) => entry.name === entryName);
        const existing = idx >= 0 ? registry.entries[idx] : undefined;
        const entry = buildStoredEntry(normalized, existing, now);
        if (idx >= 0) registry.entries[idx] = entry;
        else registry.entries.push(entry);
        changed = true;
        rows.push({ name: entryName, status: idx >= 0 ? 'updated' : 'added', tier: entry.tier });
      } catch (error) {
        rows.push({ name: entryName, status: 'error', error: String(error && error.message ? error.message : error) });
      }
    }
    if (changed) await saveRegistry(fs, registry);
    return { ok: true, rows, entryCount: registry.entries.length, path: REGISTRY_FILE };
  }

  async function save(payload) {
    const body = payload && typeof payload === 'object' ? payload : {};
    const registry = await loadRegistry(fs);
    const now = new Date().toISOString();
    const name = String(body.name === undefined ? '' : body.name);

    if (body.action === 'delete') {
      if (!NAME_RE.test(name)) throw new Error('name 需匹配 [A-Za-z0-9_-]{1,32}');
      const before = registry.entries.length;
      registry.entries = registry.entries.filter((entry) => entry.name !== name);
      if (registry.entries.length === before) throw new Error('未找到条目: ' + name);
      await saveRegistry(fs, registry);
      await mcp.unload(name);
      return { ok: true, action: 'deleted', name, path: REGISTRY_FILE, entryCount: registry.entries.length };
    }

    if (body.action === 'upsert') {
      const input = body.entry && typeof body.entry === 'object' ? body.entry : {};
      const entryName = String(input.name === undefined ? '' : input.name);
      if (!NAME_RE.test(entryName)) throw new Error('name 需匹配 [A-Za-z0-9_-]{1,32}');
      const tier = scalar(input.tier, 'on-demand');
      if (TIERS.indexOf(tier) < 0) throw new Error('tier 无效: ' + tier);

      const idx = registry.entries.findIndex((entry) => entry.name === entryName);
      const existing = idx >= 0 ? registry.entries[idx] : undefined;
      const transport = scalar(input.transport, scalar(existing ? existing.transport : undefined, null));
      if (!existing && (transport === null || transport === '')) throw new Error('新增条目需要 transport（stdio / streamable-http）');
      if (transport !== null && TRANSPORTS.indexOf(transport) < 0) throw new Error('transport 无效: ' + transport);

      // tier-only 更新：command/url 回退到既有值；显式传入仍可覆盖。
      const command = typeof input.command === 'string' && input.command !== ''
        ? input.command
        : existing && typeof existing.command === 'string' && existing.command !== '' ? existing.command : null;
      const url = typeof input.url === 'string' && input.url !== ''
        ? input.url
        : existing && typeof existing.url === 'string' && existing.url !== '' ? existing.url : null;
      if (transport === 'stdio' && command === null) throw new Error('stdio 传输需要 command');
      if (transport === 'streamable-http' && url === null) throw new Error('streamable-http 传输需要 url');

      let args = [];
      if (Array.isArray(input.args)) {
        args = input.args.map((item) => String(item));
      } else if (typeof input.args === 'string' && input.args.trim() !== '') {
        args = input.args.split(/\s+/);
      }
      const env = normalizePairRecord(input.env !== undefined ? input.env : existing ? existing.env : {});
      const headers = normalizePairRecord(input.headers !== undefined ? input.headers : existing ? existing.headers : {});

      const normalized = {
        name: entryName,
        tier,
        transport: transport === null ? undefined : transport,
        command,
        args,
        cwd: typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : null,
        env,
        url,
        headers,
        notes: typeof input.notes === 'string' ? input.notes : '',
      };
      const entry = buildStoredEntry(normalized, existing, now);
      if (idx >= 0) registry.entries[idx] = entry;
      else registry.entries.push(entry);
      await saveRegistry(fs, registry);
      if (tier === 'disabled') {
        await mcp.unload(entryName);
      } else if (tier === 'eager') {
        mcp.load(entryName).catch((err) => log('eager 加载 ' + entryName + ' 失败: ' + String(err && err.message || err)));
      }
      return { ok: true, action: idx >= 0 ? 'updated' : 'added', name: entryName, tier, path: REGISTRY_FILE, entryCount: registry.entries.length };
    }

    throw new Error('未知 action: ' + body.action);
  }

  return { list, importText, save };
}

function jsonRender(args, value) {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

return {
  apply(ctx) {
    const fs = ctx.get('fs');
    const shell = ctx.get('shell');
    if (fs === undefined || shell === undefined) {
      console.error('[mcp-panel-preview] 需要宿主 fs 与 shell Service');
      return;
    }
    const registerToolFn = (def) => ctx.tools.register(def);
    const mcp = createMcpManager(fs, shell, registerToolFn, (msg) => console.log('[mcp-panel-preview] ' + msg));
    const handlers = createHandlers(fs, mcp);

    ctx.effect(() => harness.handle('mcp-panel/list', () => handlers.list()), 'mcp-panel/list');
    ctx.effect(() => harness.handle('mcp-panel/import', (args) => handlers.importText(args && args.text)), 'mcp-panel/import');
    ctx.effect(() => harness.handle('mcp-panel/save', (args) => handlers.save(args || {})), 'mcp-panel/save');
    ctx.effect(() => harness.handle('mcp-panel/load', (args) => mcp.load(args && args.name)), 'mcp-panel/load');
    ctx.effect(() => harness.handle('mcp-panel/unload', (args) => mcp.unload(args && args.name)), 'mcp-panel/unload');
    ctx.effect(() => harness.handle('mcp-panel/status', () => (async () => {
      const registry = await loadRegistry(fs);
      return { ok: true, entries: registry.entries.map((e) => ({ name: e.name, tier: e.tier, conn: mcp.statusFor(e.name) })) };
    })()), 'mcp-panel/status');

    const mgmtTools = [
      harness.defineTool({
        name: 'mcp_load',
        description: '连接并注册一个已导入注册表的 MCP 服务：初始化握手 → tools/list → 把每个工具注册为 mcp__<服务名>__<工具名> 供直接调用。参数 name 是注册表中的服务名。',
        parameters: { name: { type: 'string', description: '注册表中的 MCP 服务名称（例如 pkulaw-law-search）', required: true } },
        output: { schema: { type: 'json' }, render: jsonRender },
        execute: async (args) => {
          const r = await mcp.load(String(args.name));
          return '已连接 ' + r.name + '（' + r.serverTitle + ' ' + r.serverVersion + '），注册 ' + r.tools + ' 个工具：mcp__' + r.name + '__*';
        },
        timeoutMs: 90000,
      }),
      harness.defineTool({
        name: 'mcp_unload',
        description: '断开一个已加载的 MCP 服务并注销其全部工具。参数 name 是注册表中的服务名。',
        parameters: { name: { type: 'string', description: '注册表中的 MCP 服务名称', required: true } },
        output: { schema: { type: 'json' }, render: jsonRender },
        execute: async (args) => {
          await mcp.unload(String(args.name));
          return '已断开 ' + args.name;
        },
      }),
      harness.defineTool({
        name: 'mcp_status',
        description: '列出注册表中所有 MCP 服务的档位与连接状态（off/connecting/connected/error、已注册工具数、错误信息）。无参数。',
        parameters: {},
        output: { schema: { type: 'json' }, render: jsonRender },
        execute: async () => {
          const registry = await loadRegistry(fs);
          return { ok: true, path: REGISTRY_FILE, entries: registry.entries.map((e) => ({ name: e.name, tier: e.tier, conn: mcp.statusFor(e.name) })) };
        },
      }),
    ];
    for (const tool of mgmtTools) {
      try {
        ctx.effect(() => ctx.tools.register(tool), 'tool ' + tool.name);
      } catch (err) {
        console.error('[mcp-panel-preview] 管理工具注册失败 ' + String(tool && tool.name) + ': ' + String(err && err.message || err));
      }
    }

    console.log('[mcp-panel-preview] RPC + MCP 运行时就绪（v5），注册表: ' + REGISTRY_FILE);
    mcp.loadEager().catch((err) => console.error('[mcp-panel-preview] eager 加载失败: ' + String(err && err.message || err)));
  },
};