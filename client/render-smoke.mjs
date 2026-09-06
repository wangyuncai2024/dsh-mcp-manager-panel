// SSR 冒烟测试：用 React 18 渲染 dsh-mcp-manager-panel 的新客户端组件树，
// 验证 createElement 调用全部合法、无运行期抛错，并抽查关键标记。
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const CLIENT = "/home/wangyuncai/dsh-mcp-manager-panel/dsh-mcp-manager-panel/client/client.js";
const source = readFileSync(CLIENT, "utf8");

let spec = null;
globalThis.window = {
  __ModuleLoader__: { load: (s) => { spec = s; } },
};

const localRequire = (id) => {
  if (id === "react") return React;
  throw new Error("unexpected require: " + id);
};

new Function("window", "require", source)(globalThis.window, localRequire);

if (!spec || typeof spec.factory !== "function") throw new Error("ModuleLoader.load 未捕获 factory");
const mod = spec.factory(localRequire);
if (mod.name !== "dsh-mcp-manager-panel" || mod.inject[0] !== "slots") throw new Error("模块元数据异常");

const T = mod.__test;
const C = T.components;
const h = React.createElement;
let failures = 0;
function assert(cond, label) {
  if (cond) console.log("  ok -", label);
  else { failures++; console.error("  FAIL -", label); }
}
function render(el) {
  return renderToStaticMarkup(el);
}
const noop = () => {};

// React key 警告回归检查（React 通过 console.error 输出，且按 owner 去重）
let keyWarnings = 0;
const origConsoleError = console.error;
console.error = (...args) => {
  const msg = args.map(String).join(" ");
  if (msg.includes('unique "key"') || msg.includes("unique \u0022key\u0022")) keyWarnings++;
  origConsoleError(...args);
};

// ── 纯函数 ────────────────────────────────────────────────────────────────
assert(T.hueFor("pkulaw") >= 0 && T.hueFor("pkulaw") < 360, "hueFor 确定性色相");
assert(T.vendorLabel("pkulaw") === "北大法宝 MCP", "vendorLabel 厂商中文名");
assert(T.vendorLabel("random") === "random 系列", "vendorLabel 默认样式");
assert(T.endpointText({ transport: "streamable-http", url: "https://x/mcp" }) === "https://x/mcp", "endpointText http");
assert(T.endpointText({ transport: "stdio", command: "npx", args: ["-y", "@a/b"] }) === "npx -y @a/b", "endpointText stdio");

const g = T.groupEntries([
  { name: "pkulaw-law-search" }, { name: "pkulaw-law-keyword" },
  { name: "single-tool" }, { name: "yuandian-a" }, { name: "yuandian-b" }, { name: "yuandian-c" },
]);
assert(g.filter((i) => i.kind === "group").length === 3, "同前缀成组（pkulaw/single/yuandian）");
const gSingle = g.find((i) => i.prefix === "single");
assert(gSingle && gSingle.kind === "group" && gSingle.members.length === 1, "单成员前缀也成组");
assert(!g.some((i) => i.kind === "single"), "仅无有效前缀才单条");
assert(T.groupEntries([{ name: "simplename" }])[0].kind === "group", "无连字符名称按整体前缀成单成员组");
const gOther = T.groupEntries([{ name: "" }]);
assert(gOther.length === 1 && gOther[0].kind === "single" && gOther[0].prefix === "other", "空名称归入 other 单条");

const exp = T.exportPayload([
  { name: "a-b", transport: "streamable-http", url: "https://a", headers: { Authorization: "x" }, tier: "eager", notes: "" },
  { name: "c-d", transport: "stdio", command: "npx", args: ["-y", "p"], cwd: "/tmp", env: { A: "1" } },
  { name: "e-f", transport: "streamable-http", url: "https://e", tier: "on-demand" },
]);
assert(exp.mcpServers["a-b"].url === "https://a" && exp.mcpServers["a-b"].tier === "eager", "导出 url+tier");
assert(exp.mcpServers["c-d"].command === "npx" && exp.mcpServers["c-d"].cwd === "/tmp", "导出 stdio");
assert(exp.mcpServers["e-f"].tier === undefined && exp.mcpServers["e-f"].url === "https://e", "on-demand 不写 tier");

// ── 样例数据 ──────────────────────────────────────────────────────────────
const entries = [
  { name: "pkulaw-law-search", tier: "on-demand", transport: "streamable-http", url: "https://api.example.com/mcp-search", command: null, args: [], env: {}, headers: { Authorization: "Bearer x" }, toolCount: 2, tools: ["law_search", "law_get"], serverTitle: "pkulaw-law-search", serverVersion: "2.13.1", conn: { status: "connected", error: "", tools: 2 } },
  { name: "pkulaw-law-keyword", tier: "eager", transport: "streamable-http", url: "https://api.example.com/mcp-kw", command: null, args: [], env: {}, headers: {}, toolCount: 5, tools: ["k1", "k2", "k3", "k4", "k5"], conn: { status: "connecting", error: "", tools: 0 } },
  { name: "yuandian-legal-data", tier: "on-demand", transport: "streamable-http", url: "https://yd.example.com", command: null, args: [], env: {}, headers: {}, toolCount: 1, tools: ["query"], conn: { status: "off", error: "", tools: 0 } },
  { name: "yuandian-case-search", tier: "disabled", transport: "streamable-http", url: "https://yd.example.com/case", command: null, args: [], env: {}, headers: {}, toolCount: 3, tools: ["c1", "c2", "c3"], conn: { status: "error", error: "连接超时（30000ms）", tools: 0 } },
  { name: "local-tools", tier: "on-demand", transport: "stdio", command: "npx", args: ["-y", "@local/fs"], cwd: null, env: { DEBUG: "1" }, headers: {}, toolCount: 0, tools: [], conn: { status: "off", error: "", tools: 0 } },
];

const viewProps = {
  entries, path: "/home/user/.dsh/skill-mcp-manager/registry.json",
  loading: false, error: "", importing: false, refreshing: false,
  busyNames: {}, applyingGroup: "", message: null,
  onDismissMessage: noop, onRefresh: noop, onImport: noop, onTier: noop, onDelete: noop,
  onLoad: noop, onUnload: noop, onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop,
  onGroupDelete: noop, onShowMessage: noop,
  groupMeta: {}, onSetGroupTitle: noop,
};

// ── 主视图（默认折叠） ────────────────────────────────────────────────────
const mainHtml = render(h(C.ManagerView, viewProps));
for (const probe of ["MCP 服务", "导出配置", "全部展开", "已注册的 MCP 服务", "北大法宝 MCP", "原点法律数据 MCP", "local 系列", "注册表：", "一键导入", "查看示例", "删除整组", "修改组名"]) {
  assert(mainHtml.includes(probe), "主视图包含: " + probe);
}
assert(mainHtml.includes(">2</b>") && mainHtml.includes("个在线工具"), "统计条: 在线工具=2");
assert(!mainHtml.includes("mpm-skel"), "非加载态无骨架屏");
assert(mainHtml.includes(">tools<"), "单成员组行显示短名（tools）");
assert(mainHtml.includes('title="local-tools"'), "完整名保留在行悬停提示中");

// 空态
const emptyHtml = render(h(C.ManagerView, { ...viewProps, entries: [] }));
assert(emptyHtml.includes("还没有 MCP 服务") && emptyHtml.includes("粘贴配置并导入"), "空态引导");

// ── 行（连接态 + 工具 + 错误详情） ───────────────────────────────────────
const rowProps = (extra = {}) => ({
  busyNames: {}, confirmDelete: "", confirmGroupDelete: "", errorOpen: "", toolPop: "", copied: "",
  onTier: noop, onDelete: noop, onLoad: noop, onUnload: noop, onToggleTools: noop,
  onToggleError: noop, onCopy: noop, onAskDelete: noop, onCancelDelete: noop,
  onAskGroupDelete: noop, onCancelGroupDelete: noop, onGroupDelete: noop,
  groupMeta: {}, editingTitle: "", titleDraft: "",
  onEditTitle: noop, onTitleDraft: noop, onSaveTitle: noop, onCancelTitle: noop,
  ...extra,
});
// serviceRow / toolStrip / groupCard 是普通渲染函数（非组件），直接调用并包一层 div。
const rowHtml = render(h("div", null, C.serviceRow(entries[0], null, rowProps())));
assert(rowHtml.includes("已连接 · 2 工具"), "行: 连接徽章");
assert(rowHtml.includes("断开") && !rowHtml.includes(">连接<"), "行: 已连接显示断开");
assert(rowHtml.includes("鉴权"), "行: 鉴权徽章");
for (const seg of ["常驻", "按需", "停用"]) assert(rowHtml.includes(">" + seg + "<"), "行: 段式档位 " + seg);

const errRowHtml = render(h("div", null, C.serviceRow(entries[3], "case-search", rowProps({ errorOpen: entries[3].name }))));
assert(errRowHtml.includes("失败") && errRowHtml.includes("连接超时（30000ms）"), "行: 错误详情展开");
assert(errRowHtml.includes(">停用<"), "行: disabled 档位高亮");

// ── 工具展开条 ──────────────────────────────────────────────────────────
const stripHtml = render(h("div", null, C.toolStrip(entries[0], rowProps({ copied: "mcp__pkulaw-law-search__*" }))));
for (const probe of ["pkulaw-law-search」的工具（2）", "law_search", "law_get", "✓ 已复制", "v2.13.1"]) {
  assert(stripHtml.includes(probe), "工具条包含: " + probe);
}
const stripFresh = render(h("div", null, C.toolStrip(entries[0], rowProps({ copied: "" }))));
assert(stripFresh.includes("复制前缀") && stripFresh.includes(">复制<"), "工具条: 未复制时显示“复制前缀”+“复制”");
const stripCopy = render(h("div", null, C.toolStrip(entries[0], rowProps({ copied: "mcp__pkulaw-law-search__law_search" }))));
assert(stripCopy.includes(">✓<"), "工具条: 单工具复制已反馈");

// ── 组卡（展开态） ──────────────────────────────────────────────────────
const groupHtml = render(h("div", null, C.groupCard("pkulaw", [entries[0], entries[1]], {
  ...rowProps(),
  applyingGroup: "", isOpen: () => true, onToggleGroup: noop,
  onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop, toolPop: "",
})));
for (const probe of ["北大法宝 MCP", "全部连接", "收起成员 ▲", "服务 / 端点", "已连接 1/2", "eager", "按需", "停用", "共 7 个工具"]) {
  assert(groupHtml.includes(probe), "组卡包含: " + probe);
}
const groupMixed = render(h("div", null, C.groupCard("yuandian", [entries[2], entries[3]], {
  ...rowProps(), applyingGroup: "", isOpen: () => false, onToggleGroup: noop,
  onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop, toolPop: "",
})));
assert(groupMixed.includes("档位不一致"), "组卡: 混合档位提示");

// ── 单成员组卡（与多成员组同款头部控件；“默认展开”由 ManagerView 的 isOpen 默认值提供） ──
const singleGroupHtml = render(h("div", null, C.groupCard("local", [entries[4]], {
  ...rowProps(), applyingGroup: "", isOpen: () => true, onToggleGroup: noop,
  onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop, toolPop: "",
})));
for (const probe of ["local 系列", "tools", "本机", "服务 / 端点", "按需", "停用", "全部连接", "全部断开", "删除整组", "收起成员 ▲"]) {
  assert(singleGroupHtml.includes(probe), "单成员组卡包含: " + probe);
}
assert(singleGroupHtml.includes("未连接"), "单成员组卡摘要含连接态（local-tools 未连接）");
const singleClosedHtml = render(h("div", null, C.groupCard("local", [entries[4]], {
  ...rowProps(), applyingGroup: "", isOpen: () => false, onToggleGroup: noop,
  onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop, toolPop: "",
})));
assert(singleClosedHtml.includes("展开成员 ▼ 1") && !singleClosedHtml.includes(">tools<"), "单成员组可折叠（默认展开、允许收起）");

// ── 组头圆点：只在“已有成员连接”时绿色 ────────────────────────────────────
assert(groupHtml.includes('mpm-gdot connecting'), "组头圆点: 有一成员连接中 → 琥珀");
const dotAllConnected = render(h("div", null, C.groupCard("pkulaw", [entries[0], { ...entries[0], name: "pkulaw-foo" }], {
  ...rowProps(), applyingGroup: "", isOpen: () => false, onToggleGroup: noop,
  onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop, toolPop: "",
})));
assert(dotAllConnected.includes('mpm-gdot connected'), "组头圆点: 全部已连接 → 绿色");
assert(groupMixed.includes('mpm-gdot error'), "组头圆点: 有成员失败 → 红");
assert(singleGroupHtml.includes('mpm-gdot off'), "组头圆点: 全部未连接 → 灰（不再是绿色）");

// ── 组头自定义标题 ────────────────────────────────────────────────────────
const titledGroup = render(h("div", null, C.groupCard("pkulaw", [entries[0], entries[1]], {
  ...rowProps({ groupMeta: { pkulaw: { title: "法宝法律库" } } }), applyingGroup: "", isOpen: () => true, onToggleGroup: noop,
  onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop, toolPop: "",
})));
assert(titledGroup.includes("法宝法律库") && !titledGroup.includes("北大法宝 MCP"), "组头: 自定义组名优先显示");
assert(titledGroup.includes("pkulaw · ") && titledGroup.includes("已连接 1/2"), "组头: 摘要行仍显示真实前缀");
const editGroup = render(h("div", null, C.groupCard("pkulaw", [entries[0], entries[1]], {
  ...rowProps({ editingTitle: "pkulaw", titleDraft: "新版法宝" }), applyingGroup: "", isOpen: () => true, onToggleGroup: noop,
  onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop, toolPop: "",
})));
assert(editGroup.includes('value="新版法宝"') && editGroup.includes("回车保存") && editGroup.includes("Esc 取消"), "组头: 改名输入态（回车保存/Esc 取消）");

// ── 组头删除整组（确认态） ───────────────────────────────────────────────
const groupDelHtml = render(h("div", null, C.groupCard("pkulaw", [entries[0], entries[1]], {
  ...rowProps({ confirmGroupDelete: "pkulaw" }), applyingGroup: "", isOpen: () => true, onToggleGroup: noop,
  onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop, toolPop: "",
})));
assert(groupDelHtml.includes("确认删除整组（2 个服务）？") && groupDelHtml.includes(">删除<") && groupDelHtml.includes(">取消<"),
  "组头删除确认态（含成员数提示）");

// ── 导入卡 ──────────────────────────────────────────────────────────────
const impHtml = render(h(C.ImportCard, {
  open: true, onOpen: noop, onClose: noop, text: "", onText: noop,
  importing: false, onImport: noop, onClear: noop, onRefresh: noop, refreshing: false,
  showSample: true, onToggleSample: noop, taRef: { current: null },
}));
assert(impHtml.includes("添加新的 MCP 服务") && impHtml.includes("一键导入") && impHtml.includes("mcpServers"), "导入卡: 打开态+示例");
const impClosed = render(h(C.ImportCard, {
  open: false, onOpen: noop, onClose: noop, text: "", onText: noop,
  importing: false, onImport: noop, onClear: noop, onRefresh: noop, refreshing: false,
  showSample: false, onToggleSample: noop, taRef: { current: null },
}));
assert(impClosed.includes("＋ 添加新的 MCP 服务"), "导入卡: 收起态");

// ── 原子组件 ─────────────────────────────────────────────────────────────
const segHtml = render(h(C.TierSeg, { value: null, onChange: noop }));
assert(segHtml.includes("常驻") && segHtml.includes("按需") && segHtml.includes("停用"), "TierSeg 三档");
const badgeHtml = render(h(C.StatusBadge, { status: "connecting", toolCount: 0, error: "", detailOpen: false, onDetail: noop }));
assert(badgeHtml.includes("连接中…"), "StatusBadge connecting");

// ── apply 注册 + ManagerSection 初始渲染 ─────────────────────────────────
let registered = null;
const ctx = {
  slots: {
    inject: (slot, fn) => { registered = fn(); },
    register: (meta, comp) => ({ meta, comp }),
  },
};
mod.apply(ctx);
assert(registered && registered.meta.id === "mcp-servers" && registered.meta.label === "MCP 服务", "settings.section 注册");
const secHtml = render(h(registered.comp));
assert(secHtml.includes("mpm-skel"), "ManagerSection 首屏骨架屏");

// ── 导出 ─────────────────────────────────────────────────────────────────
const exportSrc = T.exportPayload(entries);
const json = JSON.stringify(exportSrc, null, 2);
assert(json.includes('"pkulaw-law-search"') && json.includes('"eager"') && json.includes('"DEBUG": "1"'), "导出载荷完整");

// ── 汇总 ─────────────────────────────────────────────────────────────────
assert(keyWarnings === 0, "无 React key 警告（实际 " + keyWarnings + " 条）");
console.error = origConsoleError;

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);