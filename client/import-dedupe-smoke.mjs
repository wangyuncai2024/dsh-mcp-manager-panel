// 导入去重冒烟测试（开发用，不进包）：
// 直接从 lib/index.js 抽取真实的 createHandlers（importText / save / list）与它依赖的
// 归一化、端点签名、读写函数，用临时注册表文件跑真实导入路径 —— 避免“测试副本”与线上实现漂移。
//
// 回归背景：服务商换一套 server 名字（mcp-law → pkulaw-law-keyword）指向同一 url+token，
// 旧实现只按 name 匹配 → 同一端点存两条、连两遍、工具在会话里成对出现。
//
// 用法: node client/import-dedupe-smoke.mjs
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "index.js"), "utf8");

// 抽取函数声明：跳过 async 前缀，参数表按括号配平（形参可能含 { } 解构），再定位函数体。
function extract(name) {
  let start = source.indexOf("function " + name + "(");
  if (start < 0) throw new Error("未找到函数 " + name + "（测试需同步实现）");
  if (source.slice(Math.max(0, start - 6), start) === "async ") start -= 6;
  let depth = 0;
  let i = source.indexOf("(", start);
  for (; i < source.length; i += 1) {
    if (source[i] === "(") depth += 1;
    else if (source[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        i += 1;
        break;
      }
    }
  }
  const bodyStart = source.indexOf("{", i);
  depth = 0;
  for (let j = bodyStart; j < source.length; j += 1) {
    if (source[j] === "{") depth += 1;
    else if (source[j] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, j + 1);
    }
  }
  throw new Error("函数 " + name + " 花括号不平衡");
}

// 常量按源码原样搬过来（避免测试与实现漂移）。行尾可能是 CRLF，逐行匹配。
function literal(name) {
  const m = source.match(new RegExp("^const " + name + " = (.*?);\\r?$", "m"));
  if (!m) throw new Error("未找到常量 " + name + "（测试需同步实现）");
  return "const " + name + " = " + m[1] + ";";
}

const createHandlers = new Function(
  "readFile", "writeFile", "mkdir", "dirname",
  [
    extract("scalar"),
    extract("normalizePairRecord"),
    extract("shellSplitWords"),
    extract("normalizeFromConfig"),
    extract("canonicalPairs"),
    extract("endpointSignature"),
    extract("buildStoredEntry"),
    extract("loadRegistry"),
    extract("saveRegistry"),
    extract("loadGroups"),
    extract("saveGroups"),
    extract("toSummary"),
    literal("NAME_RE"),
    literal("GROUP_RE"),
    literal("TIERS"),
    literal("TRANSPORTS"),
    extract("createHandlers"),
    "return createHandlers;",
  ].join("\n"),
)(readFile, writeFile, mkdir, dirname);

const BASE = "https://apim-gateway.pkulaw.com";
const TOKEN = { Authorization: "Bearer test-token-1" };
const other = { Authorization: "Bearer test-token-2" };

let failed = 0;
function check(label, ok, extra) {
  if (!ok) failed += 1;
  console.log((ok ? "PASS " : "FAIL ") + label + (ok || extra === undefined ? "" : " → " + extra));
}

const dir = await mkdtemp(join(tmpdir(), "mpm-import-"));
const registryFile = join(dir, "registry.json");
const groupsFile = join(dir, "groups.json");
const mcp = {
  connFor: () => null,
  unload: async () => ({ ok: true }),
  load: async () => ({ ok: true }),
};
const handlers = createHandlers({ registryFile, groupsFile, mcp });

const importText = (servers) => handlers.importText(JSON.stringify({ mcpServers: servers }));
const statuses = (result) => result.rows.map((row) => row.status).join(",");
const readEntries = async () => JSON.parse(await readFile(registryFile, "utf8")).entries;

// 1) 首导两条不同端点
const r1 = await importText({
  "mcp-law": { url: BASE + "/mcp-law", headers: TOKEN },
  "mcp-case": { url: BASE + "/mcp-case", headers: TOKEN },
});
check("首导两条不同端点 → added,added", statuses(r1) === "added,added", statuses(r1));
check("首导后 entryCount=2", r1.entryCount === 2, r1.entryCount);

// 2) 回归主场景：换一套名字重导同样两条
const r2 = await importText({
  "pkulaw-law-keyword": { url: BASE + "/mcp-law", headers: TOKEN },
  "pkulaw-case-keyword": { url: BASE + "/mcp-case", headers: TOKEN },
});
check("换名字重导同端点 → duplicate,duplicate", statuses(r2) === "duplicate,duplicate", statuses(r2));
check("duplicate 行指回已有条目名",
  r2.rows[0].duplicateOf === "mcp-law" && r2.rows[1].duplicateOf === "mcp-case",
  r2.rows.map((row) => row.duplicateOf).join(","));
check("重复导入不写盘：entryCount 仍 2", r2.entryCount === 2, r2.entryCount);
check("重复导入不落条目：文件里仍 2 条", (await readEntries()).length === 2);

// 3) headers 键大小写不敏感（HTTP 头名大小写无关）
const r3 = await importText({ "pkulaw-law-keyword-2": { url: BASE + "/mcp-law", headers: { authorization: TOKEN.Authorization } } });
check("headers 键大小写不同 → duplicate", statuses(r3) === "duplicate", statuses(r3));

// 4) 同端点换 token → 允许（一名一端点挂两套凭证）
const r4 = await importText({ "mcp-law-alt": { url: BASE + "/mcp-law", headers: other } });
check("同 url 不同 token → added", statuses(r4) === "added" && r4.entryCount === 3, statuses(r4) + "/" + r4.entryCount);

// 5) 同名 → 更新（tier-only 不重复检查）
const r5 = await importText({ "mcp-law": { url: BASE + "/mcp-law", headers: TOKEN, tier: "disabled" } });
check("同名 tier 更新 → updated 且条数不变", statuses(r5) === "updated" && r5.entryCount === 3, statuses(r5) + "/" + r5.entryCount);

// 6) 同名改端点：签名索引跟着走（旧端点腾出、新端点占用）
const r6 = await importText({ "mcp-law": { url: BASE + "/mcp-law-v2", headers: TOKEN } });
check("同名改 url → updated", statuses(r6) === "updated", statuses(r6));
const r7 = await importText({ "mcp-law-legacy": { url: BASE + "/mcp-law", headers: TOKEN } });
check("腾出的旧端点可再被新名字占用 → added", statuses(r7) === "added", statuses(r7));
const r8 = await importText({ "mcp-law-v2-alias": { url: BASE + "/mcp-law-v2", headers: TOKEN } });
check("改名后的新端点被识别为重复", statuses(r8) === "duplicate" && r8.rows[0].duplicateOf === "mcp-law",
  statuses(r8) + "/" + r8.rows[0].duplicateOf);

// 7) 同一批 JSON 内部也要去重（先到者保留）
const r9 = await importText({
  "fresh-a": { url: BASE + "/mcp-fresh", headers: TOKEN },
  "fresh-b": { url: BASE + "/mcp-fresh", headers: TOKEN },
});
check("同批两条同端点 → added,duplicate", statuses(r9) === "added,duplicate", statuses(r9));
check("同批 duplicate 指向批内先到者", r9.rows[1].duplicateOf === "fresh-a", r9.rows[1].duplicateOf);

// 8) 非法配置仍是 error，不参与去重
const r10 = await importText({ broken: {} });
check("缺 url/command → error", statuses(r10) === "error", statuses(r10));

// 9) stdio：command+args 相同即重复，env 不同则不算
const r11 = await importText({
  "std-a": { command: "npx", args: ["-y", "some-mcp"] },
  "std-b": { command: "npx", args: ["-y", "some-mcp"] },
});
check("stdio 同 command+args → added,duplicate", statuses(r11) === "added,duplicate", statuses(r11));
const r12 = await importText({ "std-c": { command: "npx", args: ["-y", "some-mcp"], env: { K: "v" } } });
check("stdio env 不同 → added", statuses(r12) === "added", statuses(r12));
const r13 = await importText({ "std-d": { command: "npx", args: ["-y", "some-mcp"], env: { k: "v" } } });
check("stdio env 键大小写不同 → duplicate", statuses(r13) === "duplicate" && r13.rows[0].duplicateOf === "std-c",
  statuses(r13) + "/" + r13.rows[0].duplicateOf);

// 10) 组名元数据（groups.json）：v0.5.0 起组键是端点主机，宿主校验必须放行 "." / ":"。
const tg = await handlers.save({ action: "setGroupTitle", prefix: "apim-gateway.pkulaw.com", title: "北大法宝" });
check("组键为主机时 setGroupTitle 通过", tg.ok === true && tg.action === "group-title", JSON.stringify(tg));
const groups1 = JSON.parse(await readFile(groupsFile, "utf8"));
check("组名落到 groups.json 的主机键上",
  groups1.groups["apim-gateway.pkulaw.com"] && groups1.groups["apim-gateway.pkulaw.com"].title === "北大法宝");
const tgBad = await handlers.save({ action: "setGroupTitle", prefix: "bad key!", title: "x" }).then(() => null, (err) => err);
check("非法组键（空格/感叹号）仍被拒绝", tgBad instanceof Error, String(tgBad));
await handlers.save({ action: "setGroupTitle", prefix: "apim-gateway.pkulaw.com", title: "" });
check("组名清空 = 删除该键", JSON.parse(await readFile(groupsFile, "utf8")).groups["apim-gateway.pkulaw.com"] === undefined);

// 11) 最终落盘条数：2(mcp-law 改名 + mcp-case) + mcp-law-alt + mcp-law-legacy + fresh-a + std-a + std-c = 7
const entries = await readEntries();
const listed = await handlers.list();
check("最终文件条目数 = 7", entries.length === 7, entries.length);
check("list() 与文件一致", listed.entries.length === entries.length, listed.entries.length);
check("落盘条目名无重复", new Set(entries.map((entry) => entry.name)).size === entries.length);

console.log(failed === 0 ? "\n全部通过" : "\n失败 " + failed + " 项");
process.exit(failed === 0 ? 0 : 1);
