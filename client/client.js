window.__ModuleLoader__.load({ id: "dsh-mcp-manager-panel", factory: (require) => {

  // dsh-mcp-manager-panel — 浏览器客户端（v0.4.0：对齐 DSH 设置面板）。
  //
  // 数据经同源 HTTP 路由 /mcp-panel/* 读写宿主；档位/连接即时生效。
  //
  // v0.4.0 视觉/交互对齐产品设置面板（docs/web-styling.md 的约定）：
  //  - 复用平台 seed 模块 @deepseek-ai/dsh-client-ui-primitives 的原子件：
  //    Button / Pill / Tag / StateDot / Menu / Modal / Toast / Input / 图标；
  //    不再自造按钮、徽章、下拉、弹层与状态点（原子件缺失时才退化为本地最小实现）。
  //  - 版式遵循设置页约定：max-width 760 + 12px 列间距、h2 18/600 + 13px 三级色导语、
  //    0.5px 中性描边卡片（不与 elevation 阴影同时出现）、12/11px 辅助信息、
  //    数字 tabular-nums、代码用 var(--ds-font-family-code)、只用 --dsw-alias-* 语义 token。
  //  - 结构：顶栏（搜索 + 刷新/导出/导入）→ 统计行 → 服务分组卡（组头折叠 + ⋯ 溢出菜单）
  //    → 成员行（状态点 + Tag 状态 + 连接/断开 + 档位 Pill 三连 + 工具 Pill + 删除）
  //    → 工具详情面板（内嵌 bg-module-platform 面板）。
  //  - 导入配置改为 Modal + primary 按钮；删除/整组删除改 Modal 二次确认；
  //    成功提示走顶部 Toast，失败保留可关闭的行内 alert；骨架屏用 bg-skeleton token。
  //  - 不写自定义滚动条选择器（主题 scrollbar.css 已全局接管，面板内继承 l2 缩略色）。

  const React = require("react");
  const h = React.createElement;
  const { useState, useEffect, useCallback, useMemo, useRef } = React;

  // ── 产品 UI 原子（平台 seed 模块；require 失败/缺件时退化为本地最小实现）──
  function cls() {
    let out = "";
    for (let i = 0; i < arguments.length; i++) {
      const part = arguments[i];
      if (part) out = out ? out + " " + part : String(part);
    }
    return out;
  }

  function NullIcon() { return null; }

  // 退化实现只保证结构可用，视觉尽量贴产品 token（真机上永远走真原子件）。
  const FALLBACK = {
    Button(props) {
      const { variant = "ghost", size = "md", icon: leading, className, children } = props;
      const rest = { ...props };
      delete rest.variant; delete rest.size; delete rest.icon; delete rest.className; delete rest.children;
      return h("button", { type: "button", ...rest, className: cls("mpm-fb-btn", "mpm-fb-" + variant, "mpm-fb-" + size, className) },
        leading === undefined || leading === null ? null : h("span", { className: "mpm-fb-icon" }, leading), children);
    },
    Pill(props) {
      const { active, className, children, onClick } = props;
      const rest = { ...props };
      delete rest.active; delete rest.className; delete rest.children; delete rest.onClick;
      const klass = cls("mpm-fb-pill", active ? "on" : "", className);
      return onClick ? h("button", { type: "button", ...rest, className: klass, onClick }, children) : h("span", { className: klass }, children);
    },
    Tag(props) {
      const { tone = "outline", className, children } = props;
      return h("span", { className: cls("mpm-fb-tag", className), "data-tone": tone }, children);
    },
    StateDot(props) {
      const { state, size = 10, className } = props;
      return h("span", { className: cls("mpm-fb-dot", className), "data-state": state, style: { width: size, height: size } });
    },
    Input(props) {
      const { icon: leading, className } = props;
      const rest = { ...props };
      delete rest.icon; delete rest.className;
      return h("span", { className: cls("mpm-fb-input", className) },
        leading === undefined || leading === null ? null : h("span", { className: "mpm-fb-icon" }, leading),
        h("input", rest));
    },
    Menu(props) {
      const { open, anchor, items, onSelect, onClose } = props;
      const rows = [];
      if (open) {
        for (const item of items || []) {
          if (item.type === "separator") { rows.push(h("div", { className: "mpm-fb-menu-sep", key: item.id })); continue; }
          if (item.type === "label") { rows.push(h("div", { className: "mpm-fb-menu-label", key: item.id }, item.text)); continue; }
          rows.push(h("button", {
            type: "button", key: item.id, disabled: item.disabled === true, className: "mpm-fb-menu-item",
            "data-danger": item.danger === true ? "true" : undefined,
            onClick: () => { if (!item.disabled) onSelect(item.id); },
          }, h("span", { className: "mpm-fb-icon", key: "i" }, item.icon || null), h("span", { key: "l" }, item.label)));
        }
        rows.push(h("button", { type: "button", key: "__close", className: "mpm-fb-menu-close", onClick: onClose }, "关闭菜单"));
      }
      return h("span", { className: "mpm-fb-menu" }, [
        h("span", { className: "mpm-fb-menu-anchor", key: "a" }, anchor),
        open ? h("div", { className: "mpm-fb-menu-list", key: "l" }, rows) : null,
      ]);
    },
    Modal(props) {
      const { open, onClose, title, closeLabel, description, children, footer, className } = props;
      if (!open) return null;
      return h("div", { className: cls("mpm-fb-mask", className), role: "presentation" }, [
        h("div", { className: "mpm-fb-masklayer", key: "m", "aria-hidden": "true", onClick: onClose }),
        h("div", { className: "mpm-fb-dialog", key: "d", role: "dialog", "aria-modal": "true", "aria-label": title }, [
          h("div", { className: "mpm-fb-dialog-head", key: "h" }, [
            h("h2", { key: "t" }, title),
            h("button", { type: "button", key: "c", "aria-label": closeLabel, onClick: onClose }, "✕"),
          ]),
          description ? h("p", { className: "mpm-fb-dialog-desc", key: "p" }, description) : null,
          children === undefined ? null : h("div", { className: "mpm-fb-dialog-body", key: "b" }, children),
          footer === undefined ? null : h("div", { className: "mpm-fb-dialog-foot", key: "f" }, footer),
        ]),
      ]);
    },
    Toast(props) {
      const { text, icon, onDone } = props;
      useEffect(() => {
        const timer = setTimeout(() => { if (typeof onDone === "function") onDone(); }, 4000);
        return () => clearTimeout(timer);
      }, [onDone]);
      return h("div", { className: "mpm-fb-toast", role: "alert" }, [icon || null, h("span", { key: "t" }, text)]);
    },
  };

  let atoms = {};
  try {
    atoms = require("@deepseek-ai/dsh-client-ui-primitives") || {};
  } catch (error) {
    atoms = {};
  }
  const atom = (key) => (typeof atoms[key] === "function" ? atoms[key] : FALLBACK[key]);
  const glyph = (key) => (typeof atoms[key] === "function" ? atoms[key] : NullIcon);

  const Button = atom("Button");
  const Pill = atom("Pill");
  const Tag = atom("Tag");
  const StateDot = atom("StateDot");
  const Input = atom("Input");
  const Menu = atom("Menu");
  const Modal = atom("Modal");
  const Toast = atom("Toast");
  // 剪贴板用平台的 writeClipboard（失败反馈仍由本组件给出），缺失时退回本地实现。
  const writeClipboard = typeof atoms.writeClipboard === "function" ? atoms.writeClipboard : fallbackClipboard;

  const IconCheckOutline16 = glyph("IconCheckOutline16");
  const IconChevronDownOutline14 = glyph("IconChevronDownOutline14");
  const IconChevronUpOutline14 = glyph("IconChevronUpOutline14");
  const IconCloseOutline16 = glyph("IconCloseOutline16");
  const IconCopyOutline16 = glyph("IconCopyOutline16");
  const IconDownloadOutline16 = glyph("IconDownloadOutline16");
  const IconEditOutline16 = glyph("IconEditOutline16");
  const IconEllipsisOutline16 = glyph("IconEllipsisOutline16");
  const IconLinkOutline14 = glyph("IconLinkOutline14");
  const IconPlusOutline16 = glyph("IconPlusOutline16");
  const IconRefreshOutline16 = glyph("IconRefreshOutline16");
  const IconSearchOutline16 = glyph("IconSearchOutline16");
  const IconTrashOutline16 = glyph("IconTrashOutline16");
  const IconWarningOutline16 = glyph("IconWarningOutline16");

  const name = "dsh-mcp-manager-panel";
  const inject = ["slots"];

  // ── fetch（同源 /mcp-panel/*）───────────────────────────────────────────
  async function getJson(path) {
    const res = await fetch(path, { cache: "no-store" });
    const data = await res.json().catch(() => ({ ok: false, error: "HTTP " + res.status }));
    if (!res.ok) throw new Error(data.error || "HTTP " + res.status);
    return data;
  }

  async function postJson(path, body) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body ?? {}),
    });
    const data = await res.json().catch(() => ({ ok: false, error: "HTTP " + res.status }));
    if (!res.ok || data.ok === false) throw new Error(data.error || "HTTP " + res.status);
    return data;
  }

  function errText(error) {
    return String(error && error.message ? error.message : error);
  }

  // ── 常量 ────────────────────────────────────────────────────────────────
  const TIERS = ["eager", "on-demand", "disabled"];
  const TIER_SHORT = { eager: "常驻", "on-demand": "按需", disabled: "停用" };
  const TIER_TEXT = {
    eager: "eager · 常驻（随 DSH 启动自动连接）",
    "on-demand": "on-demand · 按需加载（点“连接”才连）",
    disabled: "disabled · 停用（立即断开）",
  };
  const TIER_TITLE = "档位：eager=随启动自动连接｜on-demand=点“连接”再连｜disabled=停用";
  const VENDOR_LABEL = { pkulaw: "北大法宝", yuandian: "原点法律数据" };
  // 厂商识别补充线索：端点主机片段 → 厂商键。组键改成主机后，仍能给出中文厂商名。
  const VENDOR_HOST_HINT = { pkulaw: ["pkulaw"], yuandian: ["chineselaw", "yuandian"] };
  const SAMPLE_JSON = '{\n  "mcpServers": {\n    "pkulaw-law-search": {\n      "url": "https://example.com/mcp",\n      "headers": { "Authorization": "Bearer <令牌>" }\n    },\n    "local-fs-tools": {\n      "command": "npx",\n      "args": ["-y", "@some/mcp-server"],\n      "tier": "eager"\n    }\n  }\n}';
  const IMPORT_PLACEHOLDER = '{\n  "mcpServers": {\n    "pkulaw-law-search": {\n      "url": "https://…/mcp",\n      "headers": { "Authorization": "Bearer …" }\n    }\n  }\n}';

  // ── 纯函数（供 UI 与开发冒烟测试复用）──────────────────────────────────
  function vendorLabel(prefix) {
    return VENDOR_LABEL[prefix] ? VENDOR_LABEL[prefix] + " MCP" : prefix + " 系列";
  }

  // URL → 主机名（小写；去用户信息与端口，IPv6 保留括号）。解析不出来返回 ""。
  function hostOfUrl(url) {
    const m = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/.exec(String(url || "").trim());
    if (!m) return "";
    const authority = m[1];
    const at = authority.lastIndexOf("@");
    const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
    if (hostPort === "") return "";
    const host = hostPort.startsWith("[") ? hostPort.slice(0, hostPort.indexOf("]") + 1) : hostPort.split(":")[0];
    return host.toLowerCase();
  }

  // 名字前缀（第一个 - 之前）；空名 → "other"。
  function prefixOf(name) {
    return String(name || "").split("-")[0] || "other";
  }

  // 组键：streamable-http 按**端点主机**归组——同一个网关下的服务天然属于同一厂商，
  // 服务商给的名字怎么变都不会散开；没有可用 url 的条目（stdio 等）才退回名字前缀。
  function groupKeyOf(entry) {
    if (!entry) return "other";
    if (entry.transport !== "stdio") {
      const host = hostOfUrl(entry.url);
      if (host !== "") return host;
    }
    return prefixOf(entry.name);
  }

  // 主机形状的组键（含 "."）→ 组名兜底直接显示主机，而不是"<前缀> 系列"。
  function isHostKey(key) {
    return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(String(key || ""));
  }

  // 组键 → 厂商键：先看主机片段线索，再看组内成员的名字前缀（自建/老数据常见）。
  function vendorOfGroup(key, members) {
    const text = String(key || "").toLowerCase();
    for (const vendor of Object.keys(VENDOR_HOST_HINT)) {
      if (VENDOR_HOST_HINT[vendor].some((needle) => text.indexOf(needle) >= 0)) return vendor;
    }
    for (const member of members || []) {
      const prefix = prefixOf(member && member.name);
      if (VENDOR_LABEL[prefix]) return prefix;
    }
    return "";
  }

  // 组显示名：自定义组名 > 厂商中文名（兼容 v0.4.x 按名字前缀存的旧组名） > 主机名 / "<前缀> 系列"。
  function groupTitle(key, members, groupMeta) {
    const own = groupMeta && groupMeta[key] && groupMeta[key].title;
    if (own) return String(own);
    const vendor = vendorOfGroup(key, members);
    if (vendor) {
      const legacy = groupMeta && groupMeta[vendor] && groupMeta[vendor].title;
      if (legacy) return String(legacy);
      return VENDOR_LABEL[vendor] + " MCP";
    }
    return isHostKey(key) ? String(key) : vendorLabel(key);
  }

  // 成员行显示名：去掉名字自己的第一段。与组键无关——组键现在可能是主机，
  // 老实现用 entry.name.slice(prefix.length + 1) 会切出乱码。
  function shortNameOf(name) {
    const text = String(name || "");
    const dash = text.indexOf("-");
    return dash > 0 && dash < text.length - 1 ? text.slice(dash + 1) : text;
  }

  function endpointText(entry) {
    if (!entry) return "";
    if (entry.transport === "streamable-http") return String(entry.url || "");
    return String(entry.command || "") + (entry.args && entry.args.length ? " " + entry.args.join(" ") : "");
  }

  function statusText(status, tools) {
    if (status === "connected") return tools > 0 ? "已连接 · " + tools + " 工具" : "已连接";
    if (status === "connecting") return "连接中…";
    if (status === "error") return "连接失败";
    return "未连接";
  }

  // 行/组状态 → 产品原子件的语义取值（StateDot 状态、Tag tone）。
  function statusDot(status) {
    if (status === "connected") return "done";
    if (status === "connecting") return "ongoing";
    if (status === "error") return "error";
    return "idle";
  }

  function statusTone(status) {
    if (status === "connected") return "success";
    if (status === "connecting") return "warning";
    if (status === "error") return "danger";
    return "neutral";
  }

  // 分组：按组键（端点主机 / 名字前缀）聚合（含仅 1 个成员的情况，统一显示厂商卡片头）；
  // 只有空名落到 "other" 才平铺为单条。
  function groupEntries(entries) {
    const byKey = {};
    for (const entry of entries) {
      const key = groupKeyOf(entry);
      if (!byKey[key]) byKey[key] = [];
      byKey[key].push(entry);
    }
    const items = [];
    for (const key of Object.keys(byKey).sort()) {
      const members = byKey[key];
      if (key !== "other") {
        items.push({ kind: "group", prefix: key, members });
      } else {
        for (const single of members) items.push({ kind: "single", prefix: key, entry: single });
      }
    }
    return items;
  }

  // 组级聚合：连接状态点（失败 > 连接中 > 已连接 > 未连接）、档位是否一致、工具/成员计数。
  function groupStats(members) {
    const tierSet = {};
    let toolTotal = 0;
    let connectedCount = 0;
    let anyConnecting = false;
    let anyError = false;
    for (const member of members) {
      tierSet[member.tier] = true;
      toolTotal += member.toolCount || 0;
      const status = member.conn && member.conn.status;
      if (status === "connected") connectedCount += 1;
      else if (status === "connecting") anyConnecting = true;
      else if (status === "error") anyError = true;
    }
    const allSame = Object.keys(tierSet).length === 1;
    let dot = "idle";
    if (anyError) dot = "error";
    else if (anyConnecting) dot = "ongoing";
    else if (connectedCount > 0) dot = "done";
    return {
      count: members.length,
      connectedCount,
      toolTotal,
      allSame,
      effective: allSame ? members[0].tier : null,
      dot,
    };
  }

  // 组摘要行：真实前缀 + 档位 + 连接进度 + 工具总数（辅助信息，12px 三级色）。
  function groupSummary(prefix, count, stats) {
    const parts = [prefix];
    parts.push(stats.allSame ? TIER_SHORT[stats.effective] + "档" : "档位不一致");
    if (stats.connectedCount === 0) parts.push("未连接");
    else if (stats.connectedCount === count) parts.push("已全部连接");
    else parts.push("已连接 " + stats.connectedCount + "/" + count);
    if (stats.toolTotal > 0) parts.push("共 " + stats.toolTotal + " 个工具");
    return parts.join(" · ");
  }

  // 组展开状态：**默认全部收起**（单成员组同样收起，只有显式展开过才渲染成员行）。
  // state.expandAll 非空 = 顶栏"全部展开/收起"批量态，优先于逐组显式状态。
  function groupIsOpen(prefix, expandAll, openGroups) {
    if (expandAll !== null) return expandAll === true;
    return openGroups[prefix] === true;
  }

  // 点组头：只翻转被点的那一组。若当前处于批量态，先把批量结果固化成逐组显式状态，
  // 否则退出批量态后其余组会一起回落到"默认收起"（看起来像误折叠）。
  function toggleGroupOpen(state, prefix, prefixes) {
    const open = !groupIsOpen(prefix, state.expandAll, state.openGroups);
    const base = state.expandAll === null
      ? state.openGroups
      : prefixes.reduce((acc, item) => { acc[item] = state.expandAll === true; return acc; }, {});
    return { expandAll: null, openGroups: { ...base, [prefix]: open } };
  }

  // 反向导出：注册表条目 → Claude/Cursor 风格 mcpServers JSON。
  function exportPayload(entries) {
    const servers = {};
    for (const e of entries) {
      const s = {};
      if (e.transport === "stdio") {
        s.command = String(e.command || "");
        if (e.args && e.args.length) s.args = e.args.map(String);
        if (e.cwd) s.cwd = e.cwd;
      } else {
        s.url = String(e.url || "");
      }
      if (e.headers && typeof e.headers === "object" && Object.keys(e.headers).length > 0) s.headers = e.headers;
      if (e.env && typeof e.env === "object" && Object.keys(e.env).length > 0) s.env = e.env;
      if (e.notes) s.notes = e.notes;
      if (e.tier && e.tier !== "on-demand") s.tier = e.tier;
      servers[e.name] = s;
    }
    return { mcpServers: servers };
  }

  // ── 浏览器小工具（仅在用户事件中调用）──────────────────────────────────
  // 仅当平台未提供 writeClipboard 时才会用到（见上方解构）。
  async function fallbackClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    }
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ── 原子组件 ────────────────────────────────────────────────────────────

  // 行内小标签（传输方式 / 鉴权）：产品 models 设置行的 rowTag 尺寸，
  // 作为名称上的注释而不是第二个名字，所以是 11px + 中性描边。
  function RowTag(props) {
    return h("span", { className: "mpm-rowtag", title: props.title }, props.children);
  }

  // 图标按钮：产品 28x28 图标容器（Modal 关闭钮 / 设置关闭钮同族）。
  function IconButton(props) {
    const { label, title, expanded, haspopup, disabled, danger, onClick, children } = props;
    return h("button", {
      type: "button",
      className: "mpm-iconbtn",
      "aria-label": label,
      "aria-expanded": expanded === undefined ? undefined : expanded === true,
      "aria-haspopup": haspopup,
      title: title || label,
      disabled: disabled === true,
      "data-danger": danger === true ? "true" : undefined,
      onClick,
    }, children);
  }

  // 档位控件：三个可选中 Pill（产品 Pill 的 active 态即分段选中态）。
  // 禁用时不给 onClick（Pill 退化为静态 span），并以 aria-disabled 表意，
  // 避免把 disabled 属性渲染到非表单元素上。
  function TierPicker(props) {
    const { value, onChange, disabled, title } = props;
    const off = disabled === true;
    return h("div", { className: "mpm-tier", role: "radiogroup", "aria-label": "档位", title: title || TIER_TITLE },
      TIERS.map((tier) => h(Pill, {
        key: tier,
        className: "mpm-tier-pill",
        active: value === tier,
        role: "radio",
        "aria-checked": value === tier,
        "aria-disabled": off ? "true" : undefined,
        title: TIER_TEXT[tier],
        onClick: off ? undefined : () => onChange(tier),
      }, TIER_SHORT[tier])),
    );
  }

  // 连接状态：语义 Tag +（失败时）错误详情展开钮。
  function StatusTag(props) {
    const { status, tools, detailOpen, onDetail } = props;
    const kids = [h(Tag, { key: "t", tone: statusTone(status) }, statusText(status, tools))];
    if (status === "error" && onDetail) {
      kids.push(h(IconButton, {
        key: "d",
        label: detailOpen ? "收起错误详情" : "查看错误详情",
        onClick: onDetail,
      }, detailOpen ? h(IconChevronUpOutline14, { size: 12 }) : h(IconChevronDownOutline14, { size: 12 })));
    }
    return h("span", { className: "mpm-status" }, kids);
  }

  // 工具详情：内嵌面板（产品卡片展开区的 bg-module-platform + 顶部 0.5px 分隔）。
  function ToolPanel(props) {
    const { entry, opts } = props;
    const tools = Array.isArray(entry.tools) ? entry.tools : [];
    const prefixExpr = "mcp__" + entry.name + "__*";
    const prefixCopied = opts.copied === prefixExpr;
    const head = h("div", { className: "mpm-tools-head", key: "h" }, [
      h("span", { className: "mpm-tools-title", key: "t" }, "「" + entry.name + "」的工具（" + tools.length + "）"),
      entry.serverTitle || entry.serverVersion
        ? h("span", { className: "mpm-tools-server", key: "s" }, (entry.serverTitle || "MCP 服务") + (entry.serverVersion ? " v" + entry.serverVersion : ""))
        : null,
      h("span", { className: "mpm-spacer", key: "g" }),
      h(Button, {
        key: "c", size: "sm", variant: "ghost",
        icon: prefixCopied ? h(IconCheckOutline16, { size: 14 }) : h(IconCopyOutline16, { size: 14 }),
        onClick: () => opts.onCopy(prefixExpr, prefixExpr),
      }, prefixCopied ? "已复制" : "复制前缀"),
      h(Button, {
        key: "x", size: "sm", variant: "ghost",
        icon: h(IconChevronUpOutline14, { size: 14 }),
        onClick: () => opts.onToggleTools(entry.name),
      }, "收起"),
    ]);
    const list = tools.length === 0
      ? h("p", { className: "mpm-tools-empty", key: "e" }, "暂无工具快照；断开后重新连接会自动回写。")
      : h("ul", { className: "mpm-tools-list", key: "l" }, tools.map((tool) => {
        const full = "mcp__" + entry.name + "__" + tool;
        const done = opts.copied === full;
        return h("li", { className: "mpm-tool", key: tool }, [
          h("code", { className: "mpm-tool-name", key: "n", title: full }, tool),
          h(Button, {
            key: "c", size: "sm", variant: "ghost",
            icon: done ? h(IconCheckOutline16, { size: 14 }) : h(IconCopyOutline16, { size: 14 }),
            onClick: () => opts.onCopy(full, full),
          }, done ? "已复制" : "复制"),
        ]);
      }));
    return h("div", { className: "mpm-tools" }, [head, list]);
  }

  // 成员行 + 可选工具面板（外层 .mpm-item 承担行分隔线，最后一项去掉分隔线）。
  function MemberItem(props) {
    const { entry, shortName, opts } = props;
    const conn = entry.conn || {};
    const status = conn.status || "off";
    const err = status === "error" ? String(conn.error || "") : "";
    const liveTools = status === "connected" && typeof conn.tools === "number" ? conn.tools : (entry.toolCount || 0);
    const busy = opts.busyNames[entry.name] === true;
    const errOpen = opts.errorOpen === entry.name;
    const toolOpen = opts.toolPop === entry.name;
    const hasAuth = entry.headers && typeof entry.headers === "object" && Object.keys(entry.headers).length > 0;

    const row = h("div", { className: "mpm-row", key: "row", "data-conn": status, "aria-busy": busy ? "true" : undefined }, [
      h("div", { className: "mpm-rid", key: "id" }, [
        h("div", { className: "mpm-rnameline", key: "n" }, [
          h(StateDot, { key: "d", state: statusDot(status) }),
          h("span", { className: "mpm-rname", key: "t", title: entry.name }, shortName || entry.name),
          h(RowTag, { key: "tr" }, entry.transport === "stdio" ? "本机" : "HTTP"),
          hasAuth ? h(RowTag, { key: "au", title: "连接时携带鉴权请求头" }, "鉴权") : null,
        ]),
        h("code", { className: "mpm-rep", key: "e", title: endpointText(entry) }, endpointText(entry) || "（未配置端点）"),
        status === "error" && errOpen ? h("p", { className: "mpm-rerr", key: "er" }, err) : null,
      ]),
      h("div", { className: "mpm-ractions", key: "ac" }, [
        h(StatusTag, {
          key: "s", status, tools: liveTools, detailOpen: errOpen,
          onDetail: () => opts.onToggleError(entry.name),
        }),
        status === "connected"
          ? h(Button, { key: "b", size: "sm", variant: "ghost", disabled: busy, onClick: () => opts.onUnload(entry.name) }, busy ? "断开中…" : "断开")
          : h(Button, { key: "b", size: "sm", variant: "outline", disabled: busy, onClick: () => opts.onLoad(entry.name) }, busy ? "连接中…" : "连接"),
        h(TierPicker, { key: "t", value: entry.tier, disabled: busy, onChange: (tier) => opts.onTier(entry.name, tier) }),
        liveTools > 0
          ? h(Pill, {
            key: "p", className: "mpm-toolpill", active: toolOpen, "aria-expanded": toolOpen,
            title: "查看该服务的工具列表",
            onClick: () => opts.onToggleTools(entry.name),
          }, liveTools + " 工具")
          : null,
        h(IconButton, { key: "d", label: "删除 " + entry.name, danger: true, onClick: () => opts.onAskDelete(entry) }, h(IconTrashOutline16, { size: 14 })),
      ]),
    ]);

    return h("div", { className: "mpm-item" }, [row, toolOpen ? h(ToolPanel, { key: "tp", entry, opts }) : null]);
  }

  // 服务分组卡：组头（折叠按钮 + 状态点 + 组名 + 服务数）+ 摘要 + 动作（档位/全部连接/⋯ 菜单）。
  function GroupCard(props) {
    const { prefix, members, opts } = props; // prefix = 组键（v0.5.0 起通常是端点主机）
    const sorted = members.slice().sort((a, b) => (a.name < b.name ? -1 : 1));
    const stats = groupStats(sorted);
    const open = opts.isOpen(prefix);
    const busy = opts.applyingGroup === prefix;
    const label = groupTitle(prefix, sorted, opts.groupMeta);
    const editing = opts.editingTitle === prefix;
    const panelId = "mpm-members-" + prefix;
    const connected = stats.connectedCount === sorted.length;

    const identity = editing
      ? h("div", { className: "mpm-gtitle-edit", key: "edit" }, [
        h(Input, {
          key: "i", className: "mpm-input", value: opts.titleDraft, maxLength: 40, autoFocus: true,
          placeholder: "输入组名（只改显示名）", "aria-label": "组显示名",
          onChange: (event) => opts.onTitleDraft(event.target.value),
          onKeyDown: (event) => {
            if (event.key === "Enter") opts.onSaveTitle(prefix);
            else if (event.key === "Escape") opts.onCancelTitle();
          },
        }),
        h(IconButton, { key: "s", label: "保存组名", onClick: () => opts.onSaveTitle(prefix) }, h(IconCheckOutline16, { size: 14 })),
        h(IconButton, { key: "c", label: "取消改名", onClick: opts.onCancelTitle }, h(IconCloseOutline16, { size: 14 })),
        h("span", { className: "mpm-hint", key: "h" }, "回车保存 · Esc 取消"),
      ])
      : h("div", { className: "mpm-gtitle-row", key: "view" }, [
        h("button", {
          key: "toggle",
          type: "button", className: "mpm-gtoggle",
          "aria-expanded": open, "aria-controls": panelId,
          onClick: () => opts.onToggleGroup(prefix),
        }, [
          h(IconChevronDownOutline14, { key: "c", className: "mpm-chev", size: 12, "aria-hidden": "true" }),
          h(StateDot, { key: "d", state: stats.dot }),
          h("span", { className: "mpm-gtitle", key: "t", title: label }, label),
        ]),
        h(Tag, { key: "n", tone: "neutral" }, sorted.length + " 个服务"),
      ]);

    const menuItems = [
      { id: "rename", label: "重命名组", icon: h(IconEditOutline16, { size: 14 }) },
      { id: "copy", label: "复制调用前缀", icon: h(IconLinkOutline14, { size: 14 }) },
      { type: "separator", id: "sep" },
      { id: "unload", label: "全部断开", icon: h(IconCloseOutline16, { size: 14 }), disabled: stats.connectedCount === 0 },
      { id: "delete", label: "删除整组", icon: h(IconTrashOutline16, { size: 14 }), danger: true },
    ];

    const head = h("div", { className: "mpm-ghead", key: "h" }, [
      h("div", { className: "mpm-gid", key: "i" }, [
        identity,
        h("div", { className: "mpm-gsub", key: "s" }, groupSummary(prefix, sorted.length, stats)),
      ]),
      h("div", { className: "mpm-gactions", key: "a" }, [
        h(TierPicker, {
          key: "t", value: stats.allSame ? stats.effective : null, disabled: busy,
          onChange: (tier) => opts.onGroupTier(prefix, sorted, tier),
          title: stats.allSame
            ? "整组档位：一键应用到该组全部服务；展开后可逐条微调"
            : "成员档位不一致，点任一档位可把整组拉齐",
        }),
        h(Button, {
          key: "l", size: "sm", variant: "outline",
          disabled: busy || connected,
          onClick: () => opts.onGroupLoad(prefix, sorted),
        }, connected ? "已全部连接" : busy ? "处理中…" : "全部连接"),
        h(Menu, {
          key: "m",
          open: opts.menuFor === prefix,
          onClose: opts.onCloseMenu,
          align: "end",
          portal: true,
          items: menuItems,
          onSelect: (id) => opts.onGroupMenu(prefix, sorted, id),
          anchor: h(IconButton, {
            label: "「" + label + "」的更多操作",
            expanded: opts.menuFor === prefix,
            haspopup: "menu",
            onClick: () => opts.onToggleMenu(prefix),
          }, h(IconEllipsisOutline16, { size: 16 })),
        }),
      ]),
    ]);

    const body = open
      ? h("div", { className: "mpm-members", id: panelId, key: "b" }, sorted.map((entry) => h(MemberItem, {
        key: entry.name,
        entry,
        shortName: shortNameOf(entry.name),
        opts,
      })))
      : null;

    return h("section", {
      className: "mpm-group",
      "data-open": open ? "true" : undefined,
      "data-state": stats.dot,
    }, [head, body]);
  }

  // 无有效前缀的单条：一张只含成员行的卡片（不再造第二种组头）。
  function SingleCard(props) {
    const { entry, opts } = props;
    return h("section", { className: "mpm-group mpm-single" }, h(MemberItem, { entry, shortName: null, opts }));
  }

  // ── 顶栏 / 空态 / 骨架 ──────────────────────────────────────────────────

  // 搜索框：产品设置页搜索字段（plugin-inventory 的 .search 同款尺寸与焦点环）。
  function SearchField(props) {
    return h("label", { className: "mpm-search" }, [
      h(IconSearchOutline16, { key: "i", "aria-hidden": "true" }),
      h("span", { className: "mpm-visually-hidden", key: "l" }, "搜索 MCP 服务"),
      h("input", {
        key: "in", type: "search", value: props.value,
        placeholder: "搜索名称 / 端点 / 工具…",
        "aria-label": "搜索 MCP 服务",
        onChange: (event) => props.onChange(event.target.value),
      }),
    ]);
  }

  function StatsLine(props) {
    const { stats, expandAll, onToggleAll, disabled } = props;
    const parts = [stats.total + " 个服务", stats.connected + " 已连接", stats.tools + " 在线工具"];
    if (stats.eager > 0) parts.push(stats.eager + " 常驻");
    if (stats.disabled > 0) parts.push(stats.disabled + " 停用");
    return h("div", { className: "mpm-stats" }, [
      h("span", { className: "mpm-stats-text", key: "t" }, parts.join(" · ")),
      h("span", { className: "mpm-spacer", key: "g" }),
      h(Button, { key: "e", size: "sm", variant: "ghost", disabled, onClick: onToggleAll }, expandAll === true ? "全部收起" : "全部展开"),
    ]);
  }

  function SkeletonList() {
    const rows = [];
    for (let i = 0; i < 3; i++) {
      rows.push(h("div", { className: "mpm-skel", key: i }, [
        h("span", { className: "mpm-skel-bar", key: "a" }),
        h("span", { className: "mpm-skel-bar short", key: "b" }),
      ]));
    }
    return h("div", { className: "mpm-skels", "aria-hidden": "true" }, rows);
  }

  function EmptyState(props) {
    return h("div", { className: "mpm-empty" }, [
      h("p", { className: "mpm-empty-title", key: "t" }, "还没有 MCP 服务"),
      h("p", { className: "mpm-empty-sub", key: "s" }, "把服务商给的 mcpServers 配置粘贴进来即可开始管理；连接成功后工具以 mcp__<名称>__<工具> 供 AI 调用。"),
      h(Button, {
        key: "b", variant: "primary", icon: h(IconPlusOutline16, { size: 14 }),
        onClick: props.onImport,
      }, "粘贴配置并导入"),
    ]);
  }

  // ── 弹层：导入 / 删除确认 / 行内错误提示 ────────────────────────────────

  function NoticeAlert(props) {
    const { text, details, onDismiss } = props;
    return h("div", { className: "mpm-alert", role: "alert" }, [
      h(IconWarningOutline16, { key: "i", size: 16, className: "mpm-alert-ic" }),
      h("div", { className: "mpm-alert-body", key: "b" }, [
        h("p", { className: "mpm-alert-text", key: "t" }, text),
        details && details.length > 0
          ? h("ul", { className: "mpm-alert-list", key: "l" }, details.map((line, index) => h("li", { key: index }, line)))
          : null,
      ]),
      typeof onDismiss === "function"
        ? h(IconButton, { key: "x", label: "关闭提示", onClick: onDismiss }, h(IconCloseOutline16, { size: 14 }))
        : null,
    ]);
  }

  // 导入结果摘要 / 单行文案（宿主 rows[].status: added / updated / duplicate / error）。
  function importSummary(result) {
    const rows = result && Array.isArray(result.rows) ? result.rows : [];
    const added = rows.filter((row) => row.status === "added").length;
    const updated = rows.filter((row) => row.status === "updated").length;
    const skipped = rows.filter((row) => row.status === "duplicate").length;
    const failed = rows.filter((row) => row.status === "error").length;
    const parts = ["新增 " + added, "更新 " + updated];
    if (skipped > 0) parts.push("跳过重复 " + skipped);
    if (failed > 0) parts.push("失败 " + failed);
    return { rows, added, updated, skipped, failed, title: "导入结果：" + parts.join(" · ") };
  }

  function importRowText(row) {
    if (row.status === "error") return String(row.error || "失败");
    if (row.status === "added") return "新增";
    if (row.status === "updated") return "更新";
    if (row.status === "duplicate") {
      return "跳过 · 与已有条目 " + String(row.duplicateOf || "（同端点）") + " 指向同一端点";
    }
    return String(row.status || "");
  }

  function ImportDialog(props) {
    const { open, onClose, text, onText, onImport, importing, refreshing, onRefresh, showSample, onToggleSample, result, error } = props;
    const summary = importSummary(result);
    const resultRows = summary.rows;
    const kids = [
      h("label", { className: "mpm-field", key: "f" }, [
        h("span", { className: "mpm-field-label", key: "l" }, "mcpServers JSON"),
        h("textarea", {
          key: "t", className: "mpm-textarea", rows: 10, spellCheck: false, autoFocus: true,
          value: text, placeholder: IMPORT_PLACEHOLDER,
          onChange: (event) => onText(event.target.value),
        }),
      ]),
      h("div", { className: "mpm-dialog-tools", key: "tb" }, [
        h(Button, { key: "s", size: "sm", variant: "ghost", onClick: onToggleSample }, showSample ? "隐藏示例" : "查看示例"),
        h(Button, { key: "c", size: "sm", variant: "ghost", disabled: text === "", onClick: () => onText("") }, "清空"),
        h(Button, { key: "r", size: "sm", variant: "ghost", disabled: refreshing, onClick: onRefresh }, refreshing ? "刷新中…" : "刷新列表"),
      ]),
    ];
    if (showSample) kids.push(h("pre", { className: "mpm-sample", key: "sm" }, SAMPLE_JSON));
    if (error) {
      kids.push(h("div", { className: "mpm-alert", role: "alert", key: "err" }, [
        h(IconWarningOutline16, { key: "i", size: 16, className: "mpm-alert-ic" }),
        h("p", { className: "mpm-alert-text", key: "t" }, error),
      ]));
    }
    if (resultRows.length > 0) {
      kids.push(h("div", { className: "mpm-result", key: "res", role: "status" }, [
        h("p", { className: "mpm-result-title", key: "t" }, summary.title),
        h("ul", { className: "mpm-result-list", key: "l" }, resultRows.map((row, index) => h("li", {
          key: index, className: "mpm-result-row", "data-status": row.status,
        }, [
          row.status === "error"
            ? h(IconWarningOutline16, { key: "i", size: 14 })
            : row.status === "duplicate"
              ? h(IconCopyOutline16, { key: "i", size: 14 })
              : h(IconCheckOutline16, { key: "i", size: 14 }),
          h("code", { key: "n" }, row.name),
          h("span", { key: "s" }, importRowText(row)),
        ]))),
      ]));
    }
    return h(Modal, {
      open,
      onClose,
      title: "添加新的 MCP 服务",
      closeLabel: "关闭",
      description: "粘贴服务商给的 mcpServers JSON（Claude/Cursor 格式）：同名条目更新，同前缀自动归组；同一端点（url+凭证 / command+参数相同）换个名字再导入会被判为重复并跳过；eager 项导入后自动连接。",
      className: "mpm-dialog mpm-dialog-wide",
      contentClassName: "mpm-dialog-content",
      footer: [
        h(Button, { key: "c", variant: "outline", onClick: onClose }, "关闭"),
        h(Button, {
          key: "i", variant: "primary",
          disabled: importing || text.trim() === "",
          onClick: onImport,
        }, importing ? "导入中…" : "一键导入"),
      ],
    }, kids);
  }

  function ConfirmDialog(props) {
    const { confirm, busy, onCancel, onConfirm } = props;
    if (!confirm) return null;
    const isGroup = confirm.kind === "group";
    const memberCount = confirm.members ? confirm.members.length : 0;
    return h(Modal, {
      open: true,
      onClose: onCancel,
      title: isGroup ? "删除整组服务" : "删除 MCP 服务",
      closeLabel: "取消",
      description: isGroup
        ? "将删除「" + confirm.label + "」下的 " + memberCount + " 个服务（已连接的会先断开）。注册表条目一并移除，此操作不可撤销。"
        : "将删除「" + confirm.name + "」，已连接的会先断开。此操作不可撤销。",
      className: "mpm-dialog",
      footer: [
        h(Button, { key: "c", variant: "outline", autoFocus: true, onClick: onCancel }, "取消"),
        h(Button, {
          key: "d", variant: "outline", className: "mpm-danger",
          disabled: busy === true, onClick: onConfirm,
        }, busy === true ? "处理中…" : "删除"),
      ],
    });
  }

  // ── 主视图（纯 props 驱动，便于冒烟渲染）────────────────────────────────
  function ManagerView(props) {
    const {
      entries, path, loading, error, importing, refreshing, busyNames, applyingGroup,
      notice, groupMeta, onRefresh, onImport, onToast, onAlert, onTier, onLoad, onUnload,
      onGroupTier, onGroupLoad, onGroupUnload, onAskGroupDelete, onSetGroupTitle,
      onDismissNotice, onDelete,
    } = props;

    const [query, setQuery] = useState("");
    const [groupState, setGroupState] = useState({ expandAll: null, openGroups: {} });
    const [toolPop, setToolPop] = useState("");
    const [errorOpen, setErrorOpen] = useState("");
    const [copied, setCopied] = useState("");
    const [menuFor, setMenuFor] = useState("");
    const [editingTitle, setEditingTitle] = useState("");
    const [titleDraft, setTitleDraft] = useState("");
    const [importOpen, setImportOpen] = useState(false);
    const [importText, setImportText] = useState("");
    const [showSample, setShowSample] = useState(false);
    const [importResult, setImportResult] = useState(null);
    const [importError, setImportError] = useState("");
    const [confirm, setConfirm] = useState(null);
    const [confirmBusy, setConfirmBusy] = useState(false);

    const queryText = query.trim().toLowerCase();
    const visible = useMemo(() => {
      let list = entries;
      if (queryText) {
        list = entries.filter((entry) => {
          const hay = (entry.name + " " + endpointText(entry) + " " + (Array.isArray(entry.tools) ? entry.tools.join(" ") : "")).toLowerCase();
          return hay.indexOf(queryText) >= 0;
        });
      }
      return groupEntries(list);
    }, [entries, queryText]);

    const stats = useMemo(() => {
      let connected = 0, onlineTools = 0, eager = 0, disabled = 0;
      for (const entry of entries) {
        const status = entry.conn && entry.conn.status;
        if (status === "connected") {
          connected++;
          onlineTools += typeof entry.conn.tools === "number" ? entry.conn.tools : (entry.toolCount || 0);
        }
        if (entry.tier === "eager") eager++;
        if (entry.tier === "disabled") disabled++;
      }
      return { total: entries.length, connected, tools: onlineTools, eager, disabled };
    }, [entries]);

    // 组默认全部收起（含单成员组）：见 groupIsOpen / toggleGroupOpen 纯函数。
    const groupPrefixes = useMemo(
      () => visible.filter((item) => item.kind === "group").map((item) => item.prefix),
      [visible],
    );

    const isOpen = (prefix) => groupIsOpen(prefix, groupState.expandAll, groupState.openGroups);
    const onToggleGroup = (prefix) => setGroupState((prev) => toggleGroupOpen(prev, prefix, groupPrefixes));
    const onToggleAll = () => setGroupState((prev) => ({
      expandAll: prev.expandAll === true ? false : true,
      openGroups: prev.openGroups,
    }));

    // note 省略时按"已复制：<内容>"提示；内容很长（主机组的逐条前缀）时传自定义提示。
    const onCopy = async (text, note) => {
      const ok = await writeClipboard(text);
      setCopied(text);
      setTimeout(() => setCopied((prev) => (prev === text ? "" : prev)), 2000);
      if (ok) onToast(note && note !== text ? note : "已复制：" + text);
    };

    const openImport = () => {
      setImportResult(null);
      setImportError("");
      setImportOpen(true);
    };

    const runImport = async () => {
      setImportError("");
      setImportResult(null);
      try {
        const result = await onImport(importText);
        setImportResult(result);
        setImportText("");
        const summary = importSummary(result);
        const errorRows = summary.rows.filter((row) => row.status === "error");
        const dupRows = summary.rows.filter((row) => row.status === "duplicate");
        if (summary.failed > 0 || summary.skipped > 0) {
          const notes = [];
          for (const row of errorRows) notes.push(row.name + "：" + row.error);
          for (const row of dupRows) notes.push(row.name + " → 与 " + (row.duplicateOf || "已有条目") + " 同端点，未新增");
          const headline = "导入完成（新增 " + summary.added + " · 更新 " + summary.updated + "）"
            + (summary.skipped > 0 ? "；跳过 " + summary.skipped + " 条同端点重复" : "")
            + (summary.failed > 0 ? "；失败 " + summary.failed + " 条" : "") + "：";
          onAlert(headline, notes);
        } else {
          onToast("导入完成：" + summary.title.replace("导入结果：", "") + "（写盘即生效，eager 项自动连接）");
        }
      } catch (err) {
        setImportError(errText(err));
      }
    };

    const exportNow = () => {
      downloadJson(exportPayload(entries), "mcpServers.json");
      onToast("已导出 mcpServers.json（共 " + entries.length + " 个服务）");
    };

    const runConfirm = async () => {
      if (!confirm) return;
      setConfirmBusy(true);
      try {
        if (confirm.kind === "group") await onAskGroupDelete(confirm.prefix, confirm.members);
        else await onDelete(confirm.name);
        setConfirm(null);
      } finally {
        setConfirmBusy(false);
      }
    };

    const rowOpts = {
      busyNames: busyNames || {},
      applyingGroup: applyingGroup || "",
      toolPop,
      errorOpen,
      copied,
      groupMeta: groupMeta || {},
      editingTitle,
      titleDraft,
      menuFor,
      onTier,
      onLoad,
      onUnload,
      onToggleTools: (entryName) => setToolPop((prev) => (prev === entryName ? "" : entryName)),
      onToggleError: (entryName) => setErrorOpen((prev) => (prev === entryName ? "" : entryName)),
      onCopy,
      onAskDelete: (entry) => setConfirm({ kind: "row", name: entry.name }),
      isOpen,
      onToggleGroup,
      onGroupTier,
      onGroupLoad,
      onGroupUnload,
      onCloseMenu: () => setMenuFor(""),
      onToggleMenu: (prefix) => setMenuFor((prev) => (prev === prefix ? "" : prefix)),
      onGroupMenu: (prefix, members, id) => {
        setMenuFor("");
        if (id === "rename") {
          const current = groupMeta && groupMeta[prefix] && groupMeta[prefix].title ? String(groupMeta[prefix].title) : "";
          setEditingTitle(prefix);
          setTitleDraft(current);
        } else if (id === "copy") {
          if (isHostKey(prefix)) {
            // 组键是端点主机 → 没有“组前缀”可复制，逐条给出成员的工具前缀。
            const exprs = [];
            for (const member of members) {
              const expr = "mcp__" + member.name + "__*";
              if (exprs.indexOf(expr) < 0) exprs.push(expr);
            }
            onCopy(exprs.join("\n"), exprs.length === 1
              ? "已复制：" + exprs[0]
              : "已复制该组 " + exprs.length + " 个服务的工具前缀（每行一个）");
          } else {
            onCopy("mcp__" + prefix + "__*", "mcp__" + prefix + "__*");
          }
        } else if (id === "unload") {
          onGroupUnload(prefix, members);
        } else if (id === "delete") {
          setConfirm({ kind: "group", prefix, label: groupTitle(prefix, members, groupMeta), members });
        }
      },
      onEditTitle: (prefix) => {
        const current = groupMeta && groupMeta[prefix] && groupMeta[prefix].title ? String(groupMeta[prefix].title) : "";
        setEditingTitle(prefix);
        setTitleDraft(current);
      },
      onTitleDraft: setTitleDraft,
      onSaveTitle: (prefix) => {
        onSetGroupTitle(prefix, titleDraft);
        setEditingTitle("");
      },
      onCancelTitle: () => setEditingTitle(""),
    };

    const parts = [];

    parts.push(h("h2", { className: "mpm-title", key: "t" }, "MCP 服务"));
    parts.push(h("p", { className: "mpm-intro", key: "i" },
      "管理已注册的 MCP 服务器：粘贴配置导入、分组设置档位；连接后工具以 mcp__<名称>__<工具> 供 AI 调用。"));

    parts.push(h("div", { className: "mpm-toolbar", key: "tb" }, [
      h(SearchField, { key: "s", value: query, onChange: setQuery }),
      h(Button, {
        key: "r", size: "sm", variant: "outline",
        icon: h(IconRefreshOutline16, { size: 14 }),
        disabled: refreshing || loading,
        onClick: onRefresh,
      }, refreshing || loading ? "刷新中…" : "刷新"),
      h(Button, {
        key: "e", size: "sm", variant: "outline",
        icon: h(IconDownloadOutline16, { size: 14 }),
        disabled: entries.length === 0,
        title: "把当前注册表导出为 mcpServers JSON（下载文件）",
        onClick: exportNow,
      }, "导出"),
      h(Button, {
        key: "i", size: "sm", variant: "primary",
        icon: h(IconPlusOutline16, { size: 14 }),
        onClick: openImport,
      }, "导入配置"),
    ]));

    parts.push(h(StatsLine, {
      key: "st", stats, expandAll: groupState.expandAll, disabled: entries.length === 0 || loading, onToggleAll,
    }));

    if (notice && notice.kind === "ok") {
      parts.push(h(Toast, {
        key: "toast-" + notice.seq,
        text: notice.text,
        icon: h(IconCheckOutline16, { size: 16 }),
        onDone: onDismissNotice,
      }));
    }
    if (notice && notice.kind === "err") {
      parts.push(h(NoticeAlert, {
        key: "alert", text: notice.text, details: notice.details, onDismiss: onDismissNotice,
      }));
    }
    if (error) {
      parts.push(h(NoticeAlert, { key: "err", text: error }));
    }

    parts.push(h("div", { className: "mpm-secline", key: "sl" }, [
      h("span", { className: "mpm-sectitle", key: "t" }, "已注册的 MCP 服务"),
      query !== "" && entries.length > 0
        ? h("span", { className: "mpm-status", key: "s" }, "匹配 " + visible.length + " / " + stats.total)
        : null,
    ]));

    if (loading) {
      parts.push(h(SkeletonList, { key: "sk" }));
    } else if (entries.length === 0) {
      parts.push(h(EmptyState, { key: "em", onImport: openImport }));
    } else if (visible.length === 0) {
      parts.push(h("p", { className: "mpm-status", key: "nf" }, "没有匹配的服务：换个关键词试试，或清空搜索框。"));
    } else {
      for (const item of visible) {
        parts.push(item.kind === "group"
          ? h(GroupCard, { key: "g-" + item.prefix, prefix: item.prefix, members: item.members, opts: rowOpts })
          : h(SingleCard, { key: "s-" + item.entry.name, entry: item.entry, opts: rowOpts }));
      }
    }

    parts.push(h("p", { className: "mpm-foot", key: "ft" }, ["注册表：", h("code", { key: "c" }, path || "…")]));

    parts.push(h(ImportDialog, {
      key: "imp",
      open: importOpen,
      onClose: () => setImportOpen(false),
      text: importText,
      onText: setImportText,
      onImport: runImport,
      importing,
      refreshing: refreshing || loading,
      onRefresh,
      showSample,
      onToggleSample: () => setShowSample((prev) => !prev),
      result: importResult,
      error: importError,
    }));

    parts.push(h(ConfirmDialog, {
      key: "cfm",
      confirm,
      busy: confirmBusy,
      onCancel: () => { setConfirm(null); },
      onConfirm: runConfirm,
    }));

    return h("div", { className: "mpm-section" }, parts);
  }

  // ── 数据层：拉取 + 动作（state 挂这里，ManagerView 只管渲染）────────────
  function ManagerSection() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [path, setPath] = useState("");
    const [entries, setEntries] = useState([]);
    const [groupsMeta, setGroupsMeta] = useState({});
    const [importing, setImporting] = useState(false);
    const [applyingGroup, setApplyingGroup] = useState("");
    const [busyNames, setBusyNames] = useState({});
    const [notice, setNotice] = useState(null);
    const noticeSeq = useRef(0);

    const refresh = useCallback(async (silent) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const data = await getJson("/mcp-panel/list");
        setPath(String(data.path || ""));
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        setGroupsMeta(data.groupMeta && typeof data.groupMeta === "object" ? data.groupMeta : {});
      } catch (err) {
        setError("读取注册表失败：" + errText(err));
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // 轻量轮询：连接状态 / 档位 变化自动同步（仅页面可见时）。
    useEffect(() => {
      if (typeof document === "undefined") return undefined;
      const timer = setInterval(async () => {
        if (document.hidden) return;
        try {
          const data = await getJson("/mcp-panel/status");
          const map = {};
          for (const row of data.entries || []) {
            if (row && row.name) map[row.name] = { tier: row.tier, conn: row.conn };
          }
          setEntries((prev) => prev.map((entry) => {
            const live = map[entry.name];
            return live ? { ...entry, tier: live.tier, conn: live.conn } : entry;
          }));
        } catch { /* 轮询失败静默，下轮再试 */ }
      }, 5000);
      return () => clearInterval(timer);
    }, []);

    function showToast(text) {
      noticeSeq.current += 1;
      setNotice({ kind: "ok", seq: noticeSeq.current, text });
    }

    function showError(text, details) {
      noticeSeq.current += 1;
      setNotice({ kind: "err", seq: noticeSeq.current, text, details });
    }

    function groupLabel(prefix, members) {
      return groupTitle(prefix, members, groupsMeta);
    }

    async function onSetGroupTitle(prefix, title) {
      const clean = String(title === undefined || title === null ? "" : title).trim().slice(0, 40);
      try {
        await postJson("/mcp-panel/save", { action: "setGroupTitle", prefix, title: clean });
        showToast(clean ? "「" + clean + "」组名已保存" : "已恢复为自动组名");
        refresh(true);
      } catch (err) {
        showError("修改组名失败：" + errText(err));
      }
    }

    // 返回导入结果供弹层展示；HTTP 失败直接抛出，由弹层就地提示。
    async function onImport(text) {
      if (!text || !text.trim()) throw new Error("请先粘贴 MCP 配置 JSON");
      setImporting(true);
      try {
        const res = await postJson("/mcp-panel/import", { text });
        refresh(true);
        return { entryCount: res.entryCount, rows: Array.isArray(res.rows) ? res.rows : [] };
      } finally {
        setImporting(false);
      }
    }

    async function applyTier(entryName, tier) {
      await postJson("/mcp-panel/save", { action: "upsert", entry: { name: entryName, tier } });
    }

    async function onTier(entryName, tier) {
      try {
        await applyTier(entryName, tier);
        showToast("「" + entryName + "」档位已设为 " + TIER_TEXT[tier]);
        refresh(true);
      } catch (err) {
        showError("修改档位失败：" + errText(err));
      }
    }

    async function onGroupTier(prefix, members, tier) {
      setApplyingGroup(prefix);
      const failed = [];
      let ok = 0;
      try {
        for (const member of members) {
          try {
            await applyTier(member.name, tier);
            ok += 1;
          } catch (err) {
            failed.push(member.name + "：" + errText(err));
          }
        }
      } finally {
        setApplyingGroup("");
      }
      const label = groupLabel(prefix, members);
      if (failed.length > 0) showError("「" + label + "」整组档位部分失败（成功 " + ok + " 条）：", failed);
      else showToast("「" + label + "」整组档位已设为 " + TIER_TEXT[tier] + "（" + ok + " 个服务）");
      refresh(true);
    }

    async function onDelete(entryName) {
      try {
        await postJson("/mcp-panel/save", { action: "delete", name: entryName });
        showToast("已删除「" + entryName + "」（已连接的已立即断开）");
        refresh(true);
      } catch (err) {
        showError("删除失败：" + errText(err));
      }
    }

    async function onGroupDelete(prefix, members) {
      const failed = [];
      let ok = 0;
      for (const member of members) {
        try {
          await postJson("/mcp-panel/save", { action: "delete", name: member.name });
          ok += 1;
        } catch (err) {
          failed.push(member.name + "：" + errText(err));
        }
      }
      const label = groupLabel(prefix, members);
      if (failed.length > 0) showError("「" + label + "」删除部分失败：", failed);
      else showToast("已删除「" + label + "」整组（" + ok + " 个服务）");
      try {
        await postJson("/mcp-panel/save", { action: "setGroupTitle", prefix, title: "" });
      } catch { /* 元数据清理失败不影响删除结果 */ }
      refresh(true);
    }

    async function onLoad(entryName) {
      setBusyNames((prev) => ({ ...prev, [entryName]: true }));
      try {
        const res = await postJson("/mcp-panel/load", { name: entryName });
        showToast("「" + entryName + "」已连接，注册 " + res.tools + " 个工具（新会话可直接调用）");
        refresh(true);
      } catch (err) {
        showError("「" + entryName + "」连接失败：" + errText(err));
        refresh(true);
      } finally {
        setBusyNames((prev) => { const next = { ...prev }; delete next[entryName]; return next; });
      }
    }

    async function onUnload(entryName) {
      setBusyNames((prev) => ({ ...prev, [entryName]: true }));
      try {
        await postJson("/mcp-panel/unload", { name: entryName });
        showToast("「" + entryName + "」已断开，工具已注销");
        refresh(true);
      } catch (err) {
        showError("断开失败：" + errText(err));
      } finally {
        setBusyNames((prev) => { const next = { ...prev }; delete next[entryName]; return next; });
      }
    }

    async function onGroupLoad(prefix, members) {
      setApplyingGroup(prefix);
      const failed = [];
      let ok = 0;
      for (const member of members) {
        try {
          await postJson("/mcp-panel/load", { name: member.name });
          ok += 1;
        } catch (err) {
          failed.push(member.name + "：" + errText(err));
        }
      }
      setApplyingGroup("");
      const label = groupLabel(prefix, members);
      if (failed.length > 0) showError("「" + label + "」部分连接失败（成功 " + ok + " 条）：", failed);
      else showToast("「" + label + "」全部连接成功（" + ok + " 个服务）");
      refresh(true);
    }

    async function onGroupUnload(prefix, members) {
      setApplyingGroup(prefix);
      for (const member of members) {
        try {
          await postJson("/mcp-panel/unload", { name: member.name });
        } catch { /* 忽略单条断开失败 */ }
      }
      setApplyingGroup("");
      showToast("「" + groupLabel(prefix, members) + "」已全部断开");
      refresh(true);
    }

    return h(ManagerView, {
      entries, path, loading, error, importing,
      refreshing: loading,
      busyNames, applyingGroup, notice,
      groupMeta: groupsMeta,
      onRefresh: () => refresh(),
      onImport,
      onTier, onDelete, onLoad, onUnload,
      onGroupTier, onGroupLoad, onGroupUnload,
      onAskGroupDelete: onGroupDelete,
      onSetGroupTitle,
      onToast: showToast,
      onAlert: showError,
      onDismissNotice: () => setNotice(null),
    });
  }

  // ── CSS（产品设置页语言；只用 --dsw-alias-* 语义 token）──────────────────
  const CSS = [
    // 版式：设置页约定（max-width 760 / 列间距 12 / h2 18-600 / 13px 三级色导语）
    ".mpm-section{display:flex;flex-direction:column;gap:12px;width:100%;max-width:760px;color:var(--dsw-alias-label-primary);}",
    ".mpm-title{margin:0;font-size:18px;line-height:26px;font-weight:600;}",
    ".mpm-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);}",
    ".mpm-spacer{flex:1 1 auto;min-width:0;}",
    // 顶栏：搜索 + 动作（搜索字段沿用产品设置页搜索尺寸）
    ".mpm-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;}",
    ".mpm-search{position:relative;display:flex;flex:1 1 220px;align-items:center;min-width:180px;color:var(--dsw-alias-label-tertiary);}",
    ".mpm-search>svg{position:absolute;left:12px;pointer-events:none;}",
    ".mpm-search input{width:100%;height:36px;box-sizing:border-box;border:0.5px solid var(--dsw-alias-border-l4);border-radius:10px;padding:0 12px 0 36px;outline:none;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;}",
    ".mpm-search input::placeholder{color:var(--dsw-alias-label-tertiary);}",
    ".mpm-search input:focus-visible{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent);}",
    // 统计行
    ".mpm-stats{display:flex;align-items:center;gap:8px;padding:0 2px;}",
    ".mpm-stats-text{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}",
    // 分区标题（列表上方的小标题）
    ".mpm-secline{display:flex;align-items:baseline;gap:8px;padding:4px 2px 0;}",
    ".mpm-sectitle{font-size:13px;line-height:20px;font-weight:600;}",
    ".mpm-status{display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
    // 分组卡：0.5px 中性描边（不与 elevation 阴影同时出现）
    ".mpm-group{border:0.5px solid var(--dsw-alias-border-l4);border-radius:16px;background:transparent;min-width:0;}",
    ".mpm-ghead{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px;padding:12px 14px;}",
    ".mpm-gid{display:flex;flex-direction:column;gap:4px;flex:1 1 260px;min-width:0;}",
    ".mpm-gtitle-row{display:flex;align-items:center;gap:8px;min-width:0;}",
    ".mpm-gtoggle{display:inline-flex;align-items:center;gap:8px;min-width:0;border:0;padding:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;}",
    ".mpm-gtoggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:4px;}",
    ".mpm-chev{flex:none;color:var(--dsw-alias-label-tertiary);transform:rotate(-90deg);}",
    ".mpm-group[data-open=\"true\"] .mpm-chev{transform:none;}",
    ".mpm-gtitle{font-size:14px;line-height:22px;font-weight:500;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".mpm-gsub{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;}",
    ".mpm-gtitle-edit{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;}",
    ".mpm-input{width:min(240px,46vw);}",
    ".mpm-gactions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-left:auto;}",
    ".mpm-members{border-top:0.5px solid var(--dsw-alias-border-l2);padding:0 14px 4px;}",
    // 成员行
    ".mpm-item{border-bottom:0.5px solid var(--dsw-alias-border-l2);}",
    ".mpm-item:last-child{border-bottom:0;}",
    ".mpm-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:12px 0;}",
    ".mpm-single .mpm-row{padding:12px 14px;}",
    ".mpm-rid{display:flex;flex-direction:column;gap:2px;flex:1 1 200px;min-width:0;}",
    ".mpm-rnameline{display:flex;align-items:center;gap:8px;min-width:0;}",
    ".mpm-rname{font-size:14px;line-height:22px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".mpm-rowtag{flex:none;padding:1px 6px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);}",
    ".mpm-rep{font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".mpm-rerr{margin:4px 0 0;border-radius:8px;padding:6px 8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;overflow-wrap:anywhere;white-space:pre-wrap;max-height:120px;overflow:auto;}",
    ".mpm-ractions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-left:auto;}",
    // 档位 Pill 三连
    ".mpm-tier{display:inline-flex;align-items:center;gap:4px;flex:none;}",
    ".mpm-tier-pill{min-width:40px;justify-content:center;}",
    ".mpm-toolpill{gap:5px;}",
    // 图标按钮（产品 28x28 图标容器同族）
    ".mpm-iconbtn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;}",
    ".mpm-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
    ".mpm-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;}",
    ".mpm-iconbtn:disabled{opacity:.4;cursor:not-allowed;}",
    ".mpm-iconbtn[data-danger=\"true\"]:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);}",
    ".mpm-hint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);}",
    // 工具面板（卡片展开区）
    ".mpm-tools{margin:0 0 12px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-module-platform);overflow:hidden;min-width:0;}",
    ".mpm-tools-head{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:6px 8px 6px 12px;border-bottom:0.5px solid var(--dsw-alias-border-l2);}",
    ".mpm-tools-title{font-size:12.5px;line-height:18px;font-weight:500;}",
    ".mpm-tools-server{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".mpm-tools-list{list-style:none;margin:0;padding:6px 8px 8px 12px;max-height:240px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:2px 12px;}",
    ".mpm-tool{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0;}",
    ".mpm-tool-name{font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".mpm-tools-empty{margin:0;padding:10px 12px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}",
    // 空态 / 骨架 / 页脚
    ".mpm-empty{display:flex;flex-direction:column;align-items:flex-start;gap:6px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:16px;padding:20px;text-align:left;}",
    ".mpm-empty-title{margin:0;font-size:14px;line-height:22px;font-weight:500;}",
    ".mpm-empty-sub{margin:0 0 6px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);max-width:520px;}",
    ".mpm-skels{display:flex;flex-direction:column;gap:10px;}",
    ".mpm-skel{display:flex;flex-direction:column;gap:6px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:16px;padding:14px;}",
    ".mpm-skel-bar{height:16px;width:42%;border-radius:4px;background:var(--dsw-alias-bg-skeleton);animation:mpm-skel-pulse 2s cubic-bezier(.36,0,.64,1) infinite;}",
    ".mpm-skel-bar.short{width:22%;}",
    "@keyframes mpm-skel-pulse{0%{opacity:1}40%{opacity:.6}80%,100%{opacity:1}}",
    ".mpm-foot{margin:0;padding:0 2px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;}",
    ".mpm-foot code{font-family:var(--ds-font-family-code);}",
    // 行内提示（错误/警告）
    ".mpm-alert{display:flex;align-items:flex-start;gap:10px;border-radius:10px;padding:10px 12px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);}",
    ".mpm-alert-ic{flex:none;margin-top:2px;}",
    ".mpm-alert-body{flex:1 1 auto;min-width:0;}",
    ".mpm-alert-text{margin:0;font-size:12.5px;line-height:18px;overflow-wrap:anywhere;}",
    ".mpm-alert-list{margin:4px 0 0;padding-left:16px;font-size:12px;line-height:18px;overflow-wrap:anywhere;}",
    // 弹层内容（导入 / 确认）
    ".mpm-dialog.mpm-dialog{width:min(440px,100%);}",
    ".mpm-dialog.mpm-dialog-wide{width:min(560px,100%);}",
    ".mpm-dialog-content{max-height:min(60vh,520px);overflow-y:auto;}",
    ".mpm-field{display:flex;flex-direction:column;gap:6px;}",
    ".mpm-field-label{font-size:13px;line-height:20px;font-weight:500;}",
    ".mpm-textarea{width:100%;box-sizing:border-box;min-height:170px;padding:10px 12px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:10px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;resize:vertical;}",
    ".mpm-textarea:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary);}",
    ".mpm-dialog-tools{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:2px;}",
    ".mpm-sample{margin:2px 0 0;border:0.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code);font-size:11px;line-height:17px;white-space:pre-wrap;max-height:200px;overflow:auto;}",
    ".mpm-result{margin-top:2px;border:0.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;}",
    ".mpm-result-title{margin:0;font-size:12.5px;line-height:18px;font-weight:500;}",
    ".mpm-result-list{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:4px;max-height:200px;overflow:auto;}",
    ".mpm-result-row{display:flex;align-items:center;gap:8px;font-size:12px;line-height:18px;}",
    ".mpm-result-row code{font-family:var(--ds-font-family-code);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".mpm-result-row[data-status=\"error\"]{color:var(--dsw-alias-state-error-primary);}",
    ".mpm-result-row[data-status=\"added\"],.mpm-result-row[data-status=\"updated\"]{color:var(--dsw-alias-state-success-primary);}",
    ".mpm-result-row[data-status=\"duplicate\"]{color:var(--dsw-alias-state-warn-primary);}",
    ".mpm-danger:not(:disabled){border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);}",
    ".mpm-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);}",
    ".mpm-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;}",
    // 原子件缺失时的退化样式（真机走 ui-primitives，不经过这里）
    ".mpm-fb-btn{display:inline-flex;align-items:center;gap:4px;border:0;border-radius:14px;padding:0 10px;height:28px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;}",
    ".mpm-fb-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}",
    ".mpm-fb-btn:disabled{opacity:.4;cursor:not-allowed;}",
    ".mpm-fb-md{height:36px;border-radius:18px;padding:0 14px;font-size:14px;line-height:22px;}",
    ".mpm-fb-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);}",
    ".mpm-fb-outline{border:0.5px solid var(--dsw-alias-border-l3);}",
    ".mpm-fb-icon{display:inline-flex;align-items:center;}",
    ".mpm-fb-pill{display:inline-flex;align-items:center;gap:4px;height:24px;padding:0 8px;border:0;border-radius:12px;corner-shape:round;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;}",
    ".mpm-fb-pill.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-button-ghost-active-fill);box-shadow:inset 0 0 0 1px var(--dsw-alias-button-ghost-active-border);}",
    ".mpm-fb-tag{display:inline-flex;align-items:center;border-radius:999px;corner-shape:round;padding:1px 8px;font-size:11px;line-height:17px;font-weight:500;color:var(--dsw-alias-label-tertiary);border:0.5px solid var(--dsw-alias-border-l4);}",
    ".mpm-fb-tag[data-tone=\"success\"]{border:0;background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary);}",
    ".mpm-fb-tag[data-tone=\"warning\"]{border:0;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary);}",
    ".mpm-fb-tag[data-tone=\"danger\"]{border:0;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary);}",
    ".mpm-fb-dot{position:relative;display:inline-block;flex:none;border-radius:50%;corner-shape:round;background:currentColor;}",
    ".mpm-fb-dot[data-state=\"done\"]{color:var(--dsw-alias-state-success-primary);}",
    ".mpm-fb-dot[data-state=\"ongoing\"]{color:var(--dsw-static-deepseek-450);}",
    ".mpm-fb-dot[data-state=\"error\"]{color:var(--dsw-alias-state-error-primary);}",
    ".mpm-fb-dot[data-state=\"idle\"]{color:var(--dsw-alias-label-tertiary);}",
    ".mpm-fb-input{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-1);}",
    ".mpm-fb-input input{flex:1;min-width:0;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;}",
    ".mpm-fb-menu{position:relative;display:inline-flex;}",
    ".mpm-fb-menu-list{position:absolute;right:0;top:calc(100% + 4px);z-index:2;min-width:160px;border-radius:12px;padding:4px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-panel);}",
    ".mpm-fb-menu-item{display:flex;align-items:center;gap:8px;width:100%;border:0;border-radius:8px;padding:6px 8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer;}",
    ".mpm-fb-menu-item:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);}",
    ".mpm-fb-menu-item[data-danger=\"true\"]{color:var(--dsw-alias-state-error-primary);}",
    ".mpm-fb-menu-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2);}",
    ".mpm-fb-mask{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;}",
    ".mpm-fb-masklayer{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);}",
    ".mpm-fb-dialog{position:relative;z-index:1;display:flex;flex-direction:column;gap:12px;max-height:calc(100vh - 48px);border-radius:24px;padding:20px 24px;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);overflow:auto;}",
    ".mpm-fb-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}",
    ".mpm-fb-dialog-head h2{margin:0;font-size:16px;line-height:24px;font-weight:500;}",
    ".mpm-fb-dialog-head button{border:0;border-radius:8px;padding:4px 8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;}",
    ".mpm-fb-dialog-desc{margin:0;font-size:14px;line-height:22px;}",
    ".mpm-fb-dialog-foot{display:flex;justify-content:flex-end;gap:8px;}",
    ".mpm-fb-toast{position:fixed;top:40px;left:50%;transform:translateX(-50%);z-index:1100;pointer-events:none;display:flex;align-items:center;gap:10px;max-width:min(640px,calc(100vw - 48px));border-radius:14px;padding:12px 16px;background:var(--dsw-alias-button-contrast-fill);color:var(--dsw-alias-label-primary-inverted);font-size:14px;line-height:22px;box-shadow:var(--dsw-shadow-lv3);}",
    // 动效尊重系统偏好
    "@media (prefers-reduced-motion:reduce){.mpm-chev{transition:none;}.mpm-skel-bar{animation:none;}}",
    "@media (prefers-reduced-motion:no-preference){.mpm-chev{transition:transform 140ms var(--ds-ease-in-out);}}",
  ].join("");

  // ── CSS 注入（幂等；带版本号便于热更新时覆盖旧样式）────────────────────
  const CSS_TAG = "dsh-mcp-manager-panel-v6";
  function injectCss() {
    if (typeof document === "undefined") return;
    if (document.querySelector("style[data-plugin-css=" + JSON.stringify(CSS_TAG) + "]") !== null) return;
    const tag = document.createElement("style");
    tag.dataset.plugin = "dsh-mcp-manager-panel";
    tag.dataset.pluginCss = CSS_TAG;
    tag.textContent = CSS;
    document.head.appendChild(tag);
  }

  // ── apply ────────────────────────────────────────────────────────────────
  function apply(ctx) {
    injectCss();
    ctx.slots.inject("settings.section", () => ctx.slots.register({
      name: "settings.section",
      id: "mcp-servers",
      order: 34,
      label: "MCP 服务",
    }, ManagerSection));
  }

  return {
    name,
    inject,
    apply,
    // 开发用：可被 client/render-smoke.mjs 直接驱动。
    atoms: Object.keys(atoms),
    __test: {
      vendorLabel, endpointText, groupEntries, groupStats, groupSummary, exportPayload,
      hostOfUrl, prefixOf, groupKeyOf, isHostKey, vendorOfGroup, groupTitle, shortNameOf,
      statusText, statusDot, statusTone, importSummary, importRowText, groupIsOpen, toggleGroupOpen,
      components: {
        ManagerView, ManagerSection, ImportDialog, ConfirmDialog, NoticeAlert, ToolPanel,
        TierPicker, StatusTag, SearchField, StatsLine, EmptyState, SkeletonList,
        MemberItem, GroupCard, SingleCard,
      },
    },
  };
}});
