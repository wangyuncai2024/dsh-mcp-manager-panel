// SSR 冒烟测试（开发用，不进包）：用 React 18 渲染 dsh-mcp-manager-panel 的
// 客户端组件树，验证 createElement 调用合法、无运行期抛错、无 React key 警告，
// 并抽查关键结构/文案。两条路径都跑：
//   A. 正常路径 —— require 平台 seed 模块 @deepseek-ai/dsh-client-ui-primitives（用替身）
//   B. 退化路径 —— 原子件缺失，走客户端内置的本地最小实现
//
// ── 用法（在装了 react/react-dom@18 的目录下）：
//   node <本包路径>/client/render-smoke.mjs
// react / react-dom 从当前工作目录解析（找不到再退回本包目录），
// 因此支持“在临时目录装 react 后跑本包脚本”的既有流程。
// 可选环境变量：
//   MPM_CLIENT   客户端文件路径（默认 ./client.js）
//   DSH_CHECKOUT DSH 检出路径，用于校验原子名确实由 ui-primitives 导出
//                （默认 /home/wangyuncai/deepseek-harness；不存在则跳过该校验）
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createPrimitives } from "./primitives-stub.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const CLIENT = process.env.MPM_CLIENT || join(HERE, "client.js");
const DSH_CHECKOUT = process.env.DSH_CHECKOUT || "/home/wangyuncai/deepseek-harness";
const source = readFileSync(CLIENT, "utf8");

/** 从 cwd 优先解析 react / react-dom（两者必须来自同一份安装）。 */
function loadReactRuntime() {
  const bases = [join(process.cwd(), "package.json"), join(HERE, "package.json")];
  let lastError = null;
  for (const base of bases) {
    try {
      const req = createRequire(base);
      return { React: req("react"), renderToStaticMarkup: req("react-dom/server").renderToStaticMarkup };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const { React, renderToStaticMarkup } = loadReactRuntime();

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
const keyWarningMsgs = [];
const origConsoleError = console.error;
console.error = (...args) => {
  const msg = args.map(String).join(" ");
  if (msg.includes('unique "key"') || msg.includes("unique \u0022key\u0022")) {
    keyWarnings++;
    keyWarningMsgs.push(msg.split("\n").slice(0, 5).join("\n"));
  }
  origConsoleError(...args);
};

// ── 载入客户端（同一份源码，两种 require 环境）────────────────────────────
function loadClient(requireImpl) {
  let spec = null;
  const win = { __ModuleLoader__: { load: (s) => { spec = s; } } };
  new Function("window", "require", source)(win, requireImpl);
  if (!spec || typeof spec.factory !== "function") throw new Error("ModuleLoader.load 未捕获 factory");
  return spec.factory(requireImpl);
}

const stub = createPrimitives(React);
const mod = loadClient((id) => {
  if (id === "react") return React;
  if (id === "@deepseek-ai/dsh-client-ui-primitives") return stub.primitives;
  throw new Error("unexpected require: " + id);
});
if (mod.name !== "dsh-mcp-manager-panel" || mod.inject[0] !== "slots") throw new Error("模块元数据异常");

const modFb = loadClient((id) => {
  if (id === "react") return React;
  throw new Error("unexpected require: " + id);
});

const T = mod.__test;
const TFb = modFb.__test;
const C = T.components;
const h = React.createElement;

// ── 原子件依赖校验 ────────────────────────────────────────────────────────
assert(mod.atoms.length > 0 && stub.misses.length === 0, "客户端读取的原子件名都在替身里（未命中：" + stub.misses.join(",") + "）");
assert(modFb.atoms.length === 0, "退化路径：原子件缺失时 atoms 为空且不抛错");
const primIndex = join(DSH_CHECKOUT, "packages/client/ui-primitives/src/index.ts");
const iconIndex = join(DSH_CHECKOUT, "packages/client/ui-primitives/src/icons/index.tsx");
if (existsSync(primIndex) && existsSync(iconIndex)) {
  const names = new Set();
  for (const line of readFileSync(primIndex, "utf8").split("\n")) {
    const m = /^export \{ ([^}]+) \}/.exec(line.trim());
    if (m) for (const piece of m[1].split(",")) names.add(piece.trim().split(" as ").pop());
  }
  for (const line of readFileSync(iconIndex, "utf8").split("\n")) {
    const m = /^export const (Icon[A-Za-z0-9]+)/.exec(line.trim());
    if (m) names.add(m[1]);
  }
  const unknown = [...new Set(stub.reads)].filter((n) => !names.has(n));
  assert(unknown.length === 0, "ui-primitives 真实导出包含客户端读取的全部原子名（多余：" + unknown.join(",") + "）");
} else {
  console.log("  skip - 未找到 DSH 检出，跳过 ui-primitives 导出交叉校验");
}

// 图标两代命名都要能接（回归：DSH 4937343a5e 把 ...16/14 改名为 ...Regular 后，
// 客户端只按旧名 require，图标静默退化成"没有图标"，按钮只剩文字）。
{
  const stubNew = createPrimitives(React);
  const stubOld = createPrimitives(React, { legacyIcons: true });
  const modOf = (stubImpl) => loadClient((id) => {
    if (id === "react") return React;
    if (id === "@deepseek-ai/dsh-client-ui-primitives") return stubImpl.primitives;
    throw new Error("unexpected require: " + id);
  });
  const modNew = modOf(stubNew);
  const modOld = modOf(stubOld);
  const emptyView = (mod2) => render(h("div", null, h(mod2.__test.components.ManagerView, {
    entries: [], path: "/r.json", loading: false, error: "", importing: false, refreshing: false,
    busyNames: {}, applyingGroup: "", notice: null, groupMeta: {},
    onRefresh: noop, onImport: noop, onToast: noop, onAlert: noop, onTier: noop, onDelete: noop,
    onLoad: noop, onUnload: noop, onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop,
    onAskGroupDelete: noop, onSetGroupTitle: noop, onDismissNotice: noop,
  })));
  // 新壳：客户端读到的每个名字都真实存在（没有白读的键）。
  assert([...new Set(stubNew.reads)].length > 0 && stubNew.misses.length === 0,
    "新壳（...Regular）：无未实现读取（未命中：" + stubNew.misses.join(",") + "）");
  assert(emptyView(modNew).includes('data-icon="IconPlusOutlineRegular"'), "新壳下图标真的渲染出来（不再是空图标）");
  // 旧壳：新名字 miss 是预期的（回退链的第一步），关键是**图标照样渲染**，走旧代名字。
  assert(stubOld.reads.includes("IconPlusOutline16"), "旧壳（...16/14）：回退到旧代名");
  assert(emptyView(modOld).includes('data-icon="IconPlusOutline16"'), "旧壳下图标同样渲染出来（兼容不破）");
}

// ── 纯函数 ────────────────────────────────────────────────────────────────
assert(T.vendorLabel("pkulaw") === "北大法宝 MCP", "vendorLabel 厂商中文名");
assert(T.vendorLabel("random") === "random 系列", "vendorLabel 默认样式");
assert(T.endpointText({ transport: "streamable-http", url: "https://x/mcp" }) === "https://x/mcp", "endpointText http");
assert(T.endpointText({ transport: "stdio", command: "npx", args: ["-y", "@a/b"] }) === "npx -y @a/b", "endpointText stdio");

assert(T.statusText("connected", 2) === "已连接 · 2 工具" && T.statusText("connected", 0) === "已连接", "statusText 已连接");
assert(T.statusText("connecting") === "连接中…" && T.statusText("error") === "连接失败" && T.statusText("off") === "未连接", "statusText 其余状态");
assert(T.statusDot("connected") === "done" && T.statusDot("connecting") === "ongoing" && T.statusDot("error") === "error" && T.statusDot("off") === "idle", "statusDot 映射");
assert(T.statusTone("connected") === "success" && T.statusTone("connecting") === "warning" && T.statusTone("error") === "danger" && T.statusTone("off") === "neutral", "statusTone 映射");

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

// ── 组键 = 端点主机（v0.5.0）──────────────────────────────────────────────
// 同一个网关下的服务，名字起得再乱（pkulaw-* / mcp-* / 无连字符）也必须归同一组。
const hostG = T.groupEntries([
  { name: "pkulaw-law-search", transport: "streamable-http", url: "https://apim-gateway.pkulaw.com/mcp-law-search-service" },
  { name: "mcp-law-agg", transport: "streamable-http", url: "https://apim-gateway.pkulaw.com/mcp-law-agg/mcp" },
  { name: "law_recognition", transport: "streamable-http", url: "https://apim-gateway.pkulaw.com/law_recognition" },
  { name: "yuandian-open-platform", transport: "streamable-http", url: "https://open.chineselaw.com/mcp" },
  { name: "local-tools", transport: "stdio", command: "npx", args: ["-y", "@a/b"] },
]);
assert(hostG.length === 3 && hostG.every((i) => i.kind === "group"), "按主机分组：网关 1 组 + 元典 1 组 + stdio 前缀 1 组");
const pkHostGroup = hostG.find((i) => i.prefix === "apim-gateway.pkulaw.com");
assert(pkHostGroup && pkHostGroup.members.length === 3, "名字完全不同仍归同一主机组（pkulaw-* / mcp-* / 无连字符）");
assert(hostG.find((i) => i.prefix === "open.chineselaw.com").members.length === 1, "元典端点自成一组");
assert(hostG.find((i) => i.prefix === "local").kind === "group", "stdio 无 url → 退回名字前缀");
assert(T.groupKeyOf({ name: "a-b", transport: "streamable-http", url: null }) === "a", "http 缺 url → 退回名字前缀");
assert(T.hostOfUrl("https://User:pw@Example.COM:8443/path") === "example.com" && T.hostOfUrl("not a url") === "",
  "hostOfUrl：去用户信息与端口、小写、非法输入返回空");
assert(T.hostOfUrl("http://[::1]:8080/mcp") === "[::1]", "hostOfUrl：IPv6 保留括号");

// 组显示名：主机键 → 厂商中文名；认不出厂商也要给"短名 系列"，**绝不能把整串网址当组名**。
assert(T.groupTitle("apim-gateway.pkulaw.com", pkHostGroup.members, {}) === "北大法宝 MCP", "主机组 → 厂商中文名");
assert(T.groupTitle("apim-gateway.pkulaw.com", pkHostGroup.members, { "apim-gateway.pkulaw.com": { title: "北大法宝" } }) === "北大法宝",
  "自定义组名优先于厂商自动名");
assert(T.groupTitle("open.chineselaw.com", [{ name: "yuandian-open-platform" }], { yuandian: { title: "华宇元典法律连接器" } }) === "华宇元典法律连接器",
  "组名兼容：v0.4.x 按名字前缀存的旧组名仍然生效");
assert(T.groupTitle("local", [{ name: "local-tools" }], {}) === "local 系列", "非主机组键仍走 <前缀> 系列");

// v0.5.1：认不出厂商的主机组给可读短名（回归：曾把 api.githubcopilot.com 整串当组名显示）。
assert(T.groupTitle("api.githubcopilot.com", [{ name: "github" }], {}) === "GitHub MCP",
  "api.githubcopilot.com → 厂商名 GitHub");
assert(T.groupTitle("mcp.tavily.com", [{ name: "tavily-remote-mcp" }], {}) === "Tavily MCP", "mcp.tavily.com → Tavily");
assert(T.groupTitle("mcp.context7.com", [{ name: "context7" }], {}) === "Context7 MCP", "mcp.context7.com → Context7");
// 未登记的厂商：去掉接入子域与公共后缀，给 "<主体> 系列"，而不是域名。
assert(T.groupTitle("mcp.internal", [{ name: "foo-bar" }], {}) === "internal 系列", "未登记主机：mcp.internal → internal 系列");
assert(T.groupTitle("mcp.some-vendor.example.com", [{ name: "x-y" }], {}) === "some-vendor 系列",
  "未登记主机：去掉 mcp 子域与 .example.com 后缀");
assert(T.groupTitle("api.acme.co.uk", [{ name: "a-b" }], {}) === "acme 系列", "二层公共后缀（co.uk）也要摘掉");
assert(T.groupTitle("mcp.vendor.cn", [{ name: "a-b" }], {}) === "vendor 系列", "国家后缀（.cn）也要摘掉");
// 单标签主机 / IPv6 字面量没有可读主体：原样显示，但不得拼出"无意义短名"。
assert(T.groupTitle("vendor.com", [{ name: "a-b" }], {}) === "vendor 系列", "单标签主体（vendor.com）→ vendor 系列");
assert(T.groupTitle("localhost", [{ name: "a-b" }], {}) === "localhost 系列", "非主机组键不受影响");
assert(T.groupTitle("[::1]", [{ name: "a-b" }], {}) === "[::1]", "IPv6 字面量原样显示（没有可读主体）");
assert(T.hostShortName("mcp.tavily.com") === "tavily" && T.hostShortName("api.githubcopilot.com") === "githubcopilot",
  "hostShortName：摘后缀 + 跳过接入子域");
assert(!/[:/]/.test(T.groupTitle("api.githubcopilot.com", [{ name: "github" }], {})), "组名不含协议或斜杠");
assert(T.shortNameOf("pkulaw-law-search") === "law-search" && T.shortNameOf("law_recognition") === "law_recognition",
  "成员显示名：去掉名字自己第一段（不再依赖组键，主机键也不会切出乱码）");

assert(T.groupIsOpen("local", null, {}) === false && T.groupIsOpen("local", null, { local: true }) === true,
  "组展开：默认全部收起，只有显式展开过才打开");
assert(T.groupIsOpen("local", true, {}) === true && T.groupIsOpen("local", false, { local: true }) === false,
  "组展开：顶栏批量态优先于逐组状态");
const togOne = T.toggleGroupOpen({ expandAll: null, openGroups: {} }, "local", ["local"]);
assert(togOne.expandAll === null && togOne.openGroups.local === true, "默认收起时点组头 → 只展开该组");
const togFromAll = T.toggleGroupOpen({ expandAll: true, openGroups: {} }, "pkulaw", ["pkulaw", "local"]);
assert(togFromAll.expandAll === null && togFromAll.openGroups.pkulaw === false && togFromAll.openGroups.local === true,
  "全部展开后收起一组：其余组保持展开（批量态固化成逐组状态）");
const togFromNone = T.toggleGroupOpen({ expandAll: false, openGroups: {} }, "local", ["local"]);
assert(togFromNone.openGroups.local === true, "全部收起后点组头 → 展开该组");

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

// 组聚合：1 连接 + 1 连接中 ⇒ 连接中优先于已连接；档位不一致。
const pkulawStats = T.groupStats([entries[0], entries[1]]);
assert(pkulawStats.dot === "ongoing" && pkulawStats.connectedCount === 1 && pkulawStats.toolTotal === 7 && pkulawStats.allSame === false,
  "groupStats：连接中优先、计数正确、档位不一致");
const ydStats = T.groupStats([entries[2], entries[3]]);
assert(ydStats.dot === "error", "groupStats：任一失败 → error 点");
const localStats = T.groupStats([entries[4]]);
assert(localStats.dot === "idle" && localStats.effective === "on-demand", "groupStats：单成员未连接 → idle + 档位一致");
assert(T.groupSummary("pkulaw", 2, pkulawStats) === "pkulaw · 档位不一致 · 已连接 1/2 · 共 7 个工具", "groupSummary 多成员摘要");
assert(T.groupSummary("local", 1, localStats) === "local · 按需档 · 未连接", "groupSummary 单成员未连接摘要");

const sum = T.importSummary({ rows: [{ status: "added" }, { status: "added" }, { status: "error" }] });
assert(sum.added === 2 && sum.failed === 1 && sum.title === "导入结果：新增 2 · 更新 0 · 失败 1", "importSummary 计数与标题");
assert(T.importSummary(null).title === "导入结果：新增 0 · 更新 0", "importSummary 空结果");
// 同端点换名字导入会被宿主判为 duplicate：计数进"跳过重复"，行文案点出与谁重复。
const sumDup = T.importSummary({ rows: [{ status: "added" }, { status: "duplicate" }, { status: "duplicate" }, { status: "error" }] });
assert(sumDup.skipped === 2 && sumDup.title === "导入结果：新增 1 · 更新 0 · 跳过重复 2 · 失败 1", "importSummary：重复条目计入跳过");
assert(T.importRowText({ status: "duplicate", duplicateOf: "mcp-law" }) === "跳过 · 与已有条目 mcp-law 指向同一端点", "importRowText：重复行文案");
assert(T.importRowText({ status: "duplicate" }).includes("同端点"), "importRowText：缺 duplicateOf 时仍可读");
assert(T.importRowText({ status: "error", error: "需要 url" }) === "需要 url" && T.importRowText({ status: "added" }) === "新增", "importRowText：错误与新增文案");

const viewProps = {
  entries, path: "/home/user/.dsh/skill-mcp-manager/registry.json",
  loading: false, error: "", importing: false, refreshing: false,
  busyNames: {}, applyingGroup: "", notice: null,
  groupMeta: {}, onRefresh: noop, onImport: noop, onToast: noop, onAlert: noop, onTier: noop, onDelete: noop,
  onLoad: noop, onUnload: noop, onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop,
  onAskGroupDelete: noop, onSetGroupTitle: noop, onDismissNotice: noop,
};

// ── 主视图 ────────────────────────────────────────────────────────────────
const mainHtml = render(h(C.ManagerView, viewProps));
for (const probe of [
  'class="mpm-section"', "MCP 服务", "导入配置", "刷新", "导出", "已注册的 MCP 服务",
  "北大法宝 MCP", "原点法律数据 MCP", "local 系列", "注册表：", "全部展开",
  "5 个服务", "1 已连接", "2 在线工具", "1 常驻", "1 停用",
]) {
  assert(mainHtml.includes(probe), "主视图包含: " + probe);
}
assert(!mainHtml.includes("mpm-textarea"), "导入弹层默认关闭（页面不再常驻粘贴框）");
assert(!mainHtml.includes('class="mpm-row"') && !mainHtml.includes('data-open="true"'),
  "打开面板时所有分组（含单成员组）一致默认收起：不渲染成员行");
assert(mainHtml.includes('aria-expanded="false"'), "默认收起：组头折叠钮 aria-expanded=false");
assert(!mainHtml.includes("mpm-skel"), "非加载态无骨架屏");

const loadingHtml = render(h(C.ManagerView, { ...viewProps, loading: true, entries: [] }));
assert(loadingHtml.includes("mpm-skel") && loadingHtml.includes("mpm-skel-bar"), "加载态：bg-skeleton 骨架");

const emptyHtml = render(h(C.ManagerView, { ...viewProps, entries: [] }));
assert(emptyHtml.includes("还没有 MCP 服务") && emptyHtml.includes("粘贴配置并导入"), "空态引导");

const errorHtml = render(h(C.ManagerView, { ...viewProps, error: "读取注册表失败：boom" }));
assert(errorHtml.includes('role="alert"') && errorHtml.includes("读取注册表失败：boom"), "读取失败 → 行内 alert");

const okHtml = render(h(C.ManagerView, { ...viewProps, notice: { kind: "ok", seq: 1, text: "「local-tools」已连接" } }));
assert(okHtml.includes("stub-toast") && okHtml.includes("「local-tools」已连接"), "成功提示走 Toast");
const errNoticeHtml = render(h(C.ManagerView, { ...viewProps, notice: { kind: "err", seq: 2, text: "部分失败：", details: ["a：超时"] } }));
assert(errNoticeHtml.includes('role="alert"') && errNoticeHtml.includes("a：超时"), "失败提示保留行内 alert + 明细");

// 前缀为 other（无可辨识厂商前缀）→ 单条平铺卡，不再造组头。
const bareEntry = { ...entries[4], name: "other-tool" };
const singleViewHtml = render(h(C.ManagerView, { ...viewProps, entries: [bareEntry] }));
assert(singleViewHtml.includes("mpm-single") && singleViewHtml.includes(">other-tool<"), "无厂商前缀的单条走平铺卡");

// ── 成员行 ────────────────────────────────────────────────────────────────
const rowOpts = (extra = {}) => ({
  busyNames: {}, applyingGroup: "", toolPop: "", errorOpen: "", copied: "",
  groupMeta: {}, editingTitle: "", titleDraft: "", menuFor: "",
  onTier: noop, onLoad: noop, onUnload: noop, onToggleTools: noop, onToggleError: noop,
  onCopy: noop, onAskDelete: noop, isOpen: () => false, onToggleGroup: noop,
  onGroupTier: noop, onGroupLoad: noop, onGroupUnload: noop,
  onCloseMenu: noop, onToggleMenu: noop, onGroupMenu: noop,
  onEditTitle: noop, onTitleDraft: noop, onSaveTitle: noop, onCancelTitle: noop,
  ...extra,
});

const rowHtml = render(h("div", null, h(C.MemberItem, { entry: entries[0], shortName: null, opts: rowOpts() })));
for (const probe of ["已连接 · 2 工具", 'data-tone="success"', 'data-state="done"', ">断开<", "鉴权", ">HTTP<", "常驻", "按需", "停用", "2 工具"]) {
  assert(rowHtml.includes(probe), "成员行包含: " + probe);
}
assert(rowHtml.includes('data-active="true"') && rowHtml.includes(">按需<"), "成员行：当前档位 Pill 高亮");
assert(rowHtml.includes('aria-label="删除 pkulaw-law-search"'), "成员行：删除是带无障碍名的图标钮");
assert(rowHtml.includes("https://api.example.com/mcp-search"), "成员行：端点以等宽辅助行显示");

const connectingHtml = render(h("div", null, h(C.MemberItem, { entry: entries[1], shortName: null, opts: rowOpts() })));
assert(connectingHtml.includes("连接中…") && connectingHtml.includes('data-state="ongoing"'), "成员行：连接中状态");
const errRowHtml = render(h("div", null, h(C.MemberItem, { entry: entries[3], shortName: "case-search", opts: rowOpts({ errorOpen: "yuandian-case-search" }) })));
assert(errRowHtml.includes("连接失败") && errRowHtml.includes('data-tone="danger"') && errRowHtml.includes("连接超时（30000ms）"), "成员行：失败状态 + 错误详情");
const busyHtml = render(h("div", null, h(C.MemberItem, { entry: entries[4], shortName: null, opts: rowOpts({ busyNames: { "local-tools": true } }) })));
assert(busyHtml.includes("连接中…") && busyHtml.includes('aria-busy="true"'), "成员行：忙碌态按钮与 aria-busy");

// ── 工具面板 ──────────────────────────────────────────────────────────────
const panelHtml = render(h("div", null, h(C.ToolPanel, { entry: entries[0], opts: rowOpts() })));
for (const probe of ["「pkulaw-law-search」的工具（2）", "law_search", "law_get", "复制前缀", "收起", "v2.13.1"]) {
  assert(panelHtml.includes(probe), "工具面板包含: " + probe);
}
const panelCopied = render(h("div", null, h(C.ToolPanel, { entry: entries[0], opts: rowOpts({ copied: "mcp__pkulaw-law-search__law_search" }) })));
assert(panelCopied.includes("已复制"), "工具面板：复制反馈");
const panelEmpty = render(h("div", null, h(C.ToolPanel, { entry: entries[4], opts: rowOpts() })));
assert(panelEmpty.includes("暂无工具快照"), "工具面板：空快照提示");

// ── 分组卡 ────────────────────────────────────────────────────────────────
const groupHtml = render(h("div", null, h(C.GroupCard, { prefix: "pkulaw", members: [entries[0], entries[1]], opts: rowOpts() })));
for (const probe of [
  "北大法宝 MCP", "2 个服务", "pkulaw · 档位不一致 · 已连接 1/2 · 共 7 个工具",
  "全部连接", "mpm-chev", 'data-state="ongoing"', 'aria-label="「北大法宝 MCP」的更多操作"',
]) {
  assert(groupHtml.includes(probe), "分组卡包含: " + probe);
}
assert(!groupHtml.includes("mpm-row"), "多成员组默认折叠（不渲染成员行）");
assert(!groupHtml.includes("删除整组"), "组动作收进 ⋯ 菜单（未展开时不渲染菜单项）");

const groupOpenHtml = render(h("div", null, h(C.GroupCard, { prefix: "pkulaw", members: [entries[0], entries[1]], opts: rowOpts({ isOpen: () => true }) })));
assert(groupOpenHtml.includes('data-open="true"') && groupOpenHtml.includes("mpm-row"), "展开的分组卡渲染成员行");
assert(!groupOpenHtml.includes("mcp__pkulaw-law-search__"), "未点开工具时行内不铺工具名");

const menuHtml = render(h("div", null, h(C.GroupCard, { prefix: "pkulaw", members: [entries[0], entries[1]], opts: rowOpts({ menuFor: "pkulaw" }) })));
for (const probe of ["重命名组", "复制调用前缀", "全部断开", "删除整组", 'data-danger="true"']) {
  assert(menuHtml.includes(probe), "组 ⋯ 菜单包含: " + probe);
}

const titledHtml = render(h("div", null, h(C.GroupCard, { prefix: "pkulaw", members: [entries[0], entries[1]], opts: rowOpts({ groupMeta: { pkulaw: { title: "法宝法律库" } } }) })));
assert(titledHtml.includes("法宝法律库") && !titledHtml.includes("北大法宝 MCP"), "组头：自定义组名优先");
assert(titledHtml.includes("pkulaw · "), "组头：摘要行仍显示真实前缀");

const editHtml = render(h("div", null, h(C.GroupCard, { prefix: "pkulaw", members: [entries[0], entries[1]], opts: rowOpts({ editingTitle: "pkulaw", titleDraft: "新版法宝" }) })));
assert(editHtml.includes('value="新版法宝"') && editHtml.includes("回车保存 · Esc 取消"), "组头：改名输入态（回车保存 / Esc 取消）");
assert(editHtml.includes('aria-label="保存组名"') && editHtml.includes('aria-label="取消改名"'), "组头：改名有保存/取消图标钮");

const singleHtml = render(h("div", null, h(C.SingleCard, { entry: entries[4], opts: rowOpts() })));
assert(singleHtml.includes("tools") && singleHtml.includes("本机") && singleHtml.includes("未连接"), "无前缀单条：直接渲染成员行");

// ── 弹层 ──────────────────────────────────────────────────────────────────
const importHtml = render(h(C.ImportDialog, {
  open: true, onClose: noop, text: '{"mcpServers":{}}', onText: noop, onImport: noop,
  importing: false, refreshing: false, onRefresh: noop, showSample: true, onToggleSample: noop,
  result: null, error: "",
}));
for (const probe of [
  "添加新的 MCP 服务", "mcpServers JSON", "一键导入", ">关闭<", "隐藏示例", "清空", "刷新列表",
  'role="dialog"', "mcpServers",
]) {
  assert(importHtml.includes(probe), "导入弹层包含: " + probe);
}
const importNoSample = render(h(C.ImportDialog, {
  open: true, onClose: noop, text: "", onText: noop, onImport: noop,
  importing: false, refreshing: false, onRefresh: noop, showSample: false, onToggleSample: noop,
  result: null, error: "",
}));
assert(importNoSample.includes("查看示例") && !importNoSample.includes("mpm-sample"), "导入弹层：示例可切换");
const importBusy = render(h(C.ImportDialog, {
  open: true, onClose: noop, text: "{}", onText: noop, onImport: noop,
  importing: true, refreshing: false, onRefresh: noop, showSample: false, onToggleSample: noop,
  result: null, error: "",
}));
assert(importBusy.includes("导入中…"), "导入弹层：进行中态");
const importErr = render(h(C.ImportDialog, {
  open: true, onClose: noop, text: "{}", onText: noop, onImport: noop,
  importing: false, refreshing: false, onRefresh: noop, showSample: false, onToggleSample: noop,
  result: null, error: "JSON 解析失败",
}));
assert(importErr.includes("JSON 解析失败") && importErr.includes('role="alert"'), "导入弹层：就地报错");
const importResult = render(h(C.ImportDialog, {
  open: true, onClose: noop, text: "", onText: noop, onImport: noop,
  importing: false, refreshing: false, onRefresh: noop, showSample: false, onToggleSample: noop,
  result: { entryCount: 2, rows: [{ name: "a-b", status: "added" }, { name: "c-d", status: "error", error: "需要 url" }] },
  error: "",
}));
assert(importResult.includes("导入结果：新增 1 · 更新 0 · 失败 1") && importResult.includes("需要 url"), "导入弹层：结果明细（新增/更新/失败计数）");
const importDup = render(h(C.ImportDialog, {
  open: true, onClose: noop, text: "", onText: noop, onImport: noop,
  importing: false, refreshing: false, onRefresh: noop, showSample: false, onToggleSample: noop,
  result: { entryCount: 1, rows: [{ name: "pkulaw-law-keyword", status: "duplicate", duplicateOf: "mcp-law" }] },
  error: "",
}));
assert(importDup.includes("跳过重复 1") && importDup.includes('data-status="duplicate"') && importDup.includes("mcp-law"),
  "导入弹层：重复条目单列并指回已有条目");

const confirmRow = render(h(C.ConfirmDialog, { confirm: { kind: "row", name: "a-b" }, busy: false, onCancel: noop, onConfirm: noop }));
assert(confirmRow.includes("删除 MCP 服务") && confirmRow.includes("「a-b」") && confirmRow.includes("mpm-danger"), "删除单条确认弹层");
const confirmGroup = render(h(C.ConfirmDialog, { confirm: { kind: "group", prefix: "pkulaw", label: "北大法宝 MCP", members: [entries[0], entries[1]] }, busy: false, onCancel: noop, onConfirm: noop }));
assert(confirmGroup.includes("删除整组服务") && confirmGroup.includes("北大法宝 MCP") && confirmGroup.includes("2 个服务"), "删除整组确认弹层（含成员数）");
assert(render(h(C.ConfirmDialog, { confirm: null, busy: false, onCancel: noop, onConfirm: noop })) === "", "无确认目标时不渲染");

// ── 退化路径（无 ui-primitives）────────────────────────────────────────────
const fbMain = render(h(TFb.components.ManagerView, viewProps));
assert(fbMain.includes("MCP 服务") && fbMain.includes("导入配置") && fbMain.includes("北大法宝 MCP"), "退化路径：主视图仍可渲染");
const fbGroup = render(h("div", null, h(TFb.components.GroupCard, { prefix: "pkulaw", members: [entries[0], entries[1]], opts: rowOpts() })));
assert(fbGroup.includes("北大法宝 MCP") && fbGroup.includes("全部连接"), "退化路径：分组卡仍可渲染");

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

// ── 汇总 ─────────────────────────────────────────────────────────────────
const capturedKeyWarnings = keyWarningMsgs.slice();
console.error = origConsoleError;
for (const msg of capturedKeyWarnings) console.error(msg);
assert(keyWarnings === 0, "无 React key 警告（实际 " + keyWarnings + " 条）");
console.error = origConsoleError;

console.log(failures === 0 ? "\nALL PASS" : "\n" + failures + " FAILURES");
process.exit(failures === 0 ? 0 : 1);
