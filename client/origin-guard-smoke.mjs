// 同源守卫冒烟测试（开发用，不进包）：
// 直接从 lib/index.js 里抽取 normalizeHost / isLoopbackHost / sameOrigin 的真实实现，
// 用真实请求头形状验证判定结果——避免"测试副本"与线上实现漂移。
//
// 用法: node client/origin-guard-smoke.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "lib", "index.js"), "utf8");

function extract(name) {
  const start = source.indexOf("function " + name + "(");
  if (start < 0) throw new Error("未找到函数 " + name + "（测试需同步实现）");
  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("函数 " + name + " 花括号不平衡");
}

const { normalizeHost, isLoopbackHost, sameOrigin } = new Function(
  extract("normalizeHost") + "\n" + extract("hostNameOf") + "\n" + extract("isLoopbackHost") + "\n" +
    extract("sameOrigin") +
    "\nreturn { normalizeHost, isLoopbackHost, sameOrigin };",
)();

const req = (headers) => ({ headers });

const cases = [
  // [说明, request, 期望]
  ["浏览器同源 POST（正常路径）", req({ host: "127.0.0.1:19387", origin: "http://127.0.0.1:19387" }), true],
  ["localhost 同源", req({ host: "localhost:19387", origin: "http://localhost:19387" }), true],
  ["缺省端口归一化 :80", req({ host: "localhost", origin: "http://localhost:80" }), true],
  ["大小写归一化", req({ host: "LocalHost:19387", origin: "http://localhost:19387" }), true],
  ["跨站 Origin（必须拒绝）", req({ host: "127.0.0.1:19387", origin: "https://evil.example" }), false],
  ["跨站但同端口（必须拒绝）", req({ host: "127.0.0.1:19387", origin: "http://evil.example:19387" }), false],
  ["不透明 Origin null（file:// 等）", req({ host: "127.0.0.1:19387", origin: "null" }), true],
  ["非法 Origin（必须拒绝）", req({ host: "127.0.0.1:19387", origin: "not a url" }), false],
  ["无 Origin + 回环（桌面壳 / 反代 / curl）", req({ host: "127.0.0.1:19387" }), true],
  ["无 Origin + localhost", req({ host: "localhost:19387" }), true],
  ["无 Origin + [::1]", req({ host: "[::1]:19387" }), true],
  ["无 Origin + [::1] 无端口", req({ host: "[::1]" }), true],
  ["[::1] 同源显式 Origin", req({ host: "[::1]:19387", origin: "http://[::1]:19387" }), true],
  ["无 Origin + 外网 Host（必须拒绝）", req({ host: "example.com:19387" }), false],
  ["无 Host（无法判定，必须拒绝）", req({ origin: "http://127.0.0.1:19387" }), false],
  ["Host 与 Origin 都缺（必须拒绝）", req({}), false],
  ["显式空 Origin + 回环", req({ host: "127.0.0.1:19387", origin: "" }), true],
  ["显式空 Origin + 外网 Host（必须拒绝）", req({ host: "example.com", origin: "" }), false],
];

let failed = 0;
for (const [label, request, expected] of cases) {
  const actual = sameOrigin(request);
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log((ok ? "PASS " : "FAIL ") + label + " → " + actual + "（期望 " + expected + "）");
}

// 旧实现会把这条真实故障情形判成跨站：POST 无 Origin 头 → 403 untrusted origin。
const regression = req({ host: "127.0.0.1:19387" });
if (sameOrigin(regression) !== true) {
  failed += 1;
  console.log("FAIL 故障回归：无 Origin 的 /mcp-panel/load 仍被拒绝");
}

console.log(failed === 0 ? "\n全部通过（" + (cases.length + 1) + " 项）" : "\n失败 " + failed + " 项");
process.exit(failed === 0 ? 0 : 1);
