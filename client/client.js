window.__ModuleLoader__.load({ id: "dsh-mcp-manager-panel", factory: (require) => {

  // dsh-mcp-manager-panel — browser client（自足版 v0.3.3，UI 重构版）。
  // 注册 设置 → MCP 服务 页面：粘贴 mcpServers JSON 一键导入 + 厂商分组管理
  // + 每行/每组 连接状态与 连接/断开 按钮 + 工具列表展开条 + 配置导出。
  // 数据经同源 HTTP 路由 /mcp-panel/* 读写宿主；档位/连接即时生效。
  //
  // UI 特性（v0.3.0）：
  //  - 顶栏统计（服务数 / 已连接 / 在线工具 / 常驻 / 停用）+ 一键刷新 / 导出 mcpServers JSON
  //  - 全局搜索（名称 / 端点 / 工具名）与“全部展开 / 收起”
  //  - 段式档位控件（常驻 / 按需 / 停用），组头一键整组拉齐
  //  - 状态徽章（已连接 · N 工具 / 连接中 / 失败，失败可展开错误详情）+ 5s 轻量轮询
  //  - 已连接服务可展开工具列表条，复制 mcp__<名称>__<工具> / 前缀
  //  - 导入卡可折叠，内置示例 JSON；加载骨架屏 / 空态引导
  //
  //  v0.3.1：单成员前缀也渲染为厂商卡片头，与 ≥2 成员组视觉统一。
  //  v0.3.2：组头控件与多成员组完全同款（全部连接/全部断开/整组档位/展开成员），
  //    单成员组默认展开、可折叠；组头新增“删除整组”（逐条走宿主 delete 路由）；
  //    二级（成员行）删除确认改为紧凑堆叠块、末列自适应宽度；三级（工具列表条）
  //    服务名超长截断、滚动区域改用细滚动条。
  //  v0.3.3：组头小圆点按组连接状态着色（仅已有成员连接才绿；未连接为灰、
  //    连接中琥珀闪动、任一条失败为红），不再用前缀色相冒充状态；组头标题支持
  //    自行改名（宿主 groups.json 元数据 + save setGroupTitle，list 返回 groupMeta；
  //    保存后组名持久，空名恢复自动名；只影响显示，不影响前缀分组）。

  const React = require("react");
  const h = React.createElement;
  const { useState, useEffect, useCallback, useMemo, useRef } = React;

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

  // ── 常量 ─────────────────────────────────────────────────────────────────
  const TIERS = ["eager", "on-demand", "disabled"];
  const TIER_SHORT = { eager: "常驻", "on-demand": "按需", disabled: "停用" };
  const TIER_TEXT = {
    eager: "eager · 常驻（启动自动连接）",
    "on-demand": "on-demand · 按需加载",
    disabled: "disabled · 停用（立即断开）",
  };
  const TIER_TITLE = "档位：eager=随启动自动连接｜on-demand=点“连接”再连｜disabled=停用";
  const CONN_TEXT = { off: "未连接", connecting: "连接中…", connected: "已连接", error: "失败" };
  const VENDOR_LABEL = { pkulaw: "北大法宝", yuandian: "原点法律数据" };
  const SAMPLE_JSON = '{\n  "mcpServers": {\n    "pkulaw-law-search": {\n      "url": "https://example.com/mcp",\n      "headers": { "Authorization": "Bearer <令牌>" }\n    },\n    "local-fs-tools": {\n      "command": "npx",\n      "args": ["-y", "@some/mcp-server"],\n      "tier": "eager"\n    }\n  }\n}';

  // ── 纯函数（供 UI 与开发冒烟测试复用）──────────────────────────────────
  function hueFor(prefix) {
    let acc = 0;
    for (let i = 0; i < prefix.length; i++) acc = (acc * 31 + prefix.charCodeAt(i)) >>> 0;
    return acc % 360;
  }

  function vendorLabel(prefix) {
    return VENDOR_LABEL[prefix] ? VENDOR_LABEL[prefix] + " MCP" : prefix + " 系列";
  }

  function endpointText(entry) {
    if (!entry) return "";
    if (entry.transport === "streamable-http") return String(entry.url || "");
    return String(entry.command || "") + (entry.args && entry.args.length ? " " + entry.args.join(" ") : "");
  }

  // 按名称前缀分组：同前缀（第一个 - 之前）自动归组（含仅 1 个成员的情况，
  // 统一显示厂商卡片头）；"other"（无有效前缀）才平铺为单条。
  function groupEntries(entries) {
    const byPrefix = {};
    for (const entry of entries) {
      const prefix = String(entry.name || "").split("-")[0] || "other";
      if (!byPrefix[prefix]) byPrefix[prefix] = [];
      byPrefix[prefix].push(entry);
    }
    const items = [];
    for (const prefix of Object.keys(byPrefix).sort()) {
      const members = byPrefix[prefix];
      if (prefix !== "other") {
        items.push({ kind: "group", prefix, members });
      } else {
        for (const single of members) items.push({ kind: "single", prefix, entry: single });
      }
    }
    return items;
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
  async function copyText(text) {
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

  // 段式档位控件：常驻 / 按需 / 停用
  function TierSeg(props) {
    const { value, onChange, disabled, title } = props;
    return h("div", { className: "mpm-seg", role: "radiogroup", title: title || TIER_TITLE }, TIERS.map((val) =>
      h("button", {
        key: val,
        type: "button",
        role: "radio",
        "aria-checked": value === val,
        className: "mpm-seg-btn" + (value === val ? " on" : ""),
        disabled: disabled === true,
        title: TIER_TEXT[val],
        onClick: () => { if (onChange && !disabled) onChange(val); },
      }, TIER_SHORT[val]),
    ));
  }

  // 状态徽章：● 已连接 · N 工具 / 连接中… / 失败（可展开详情）
  function StatusBadge(props) {
    const { status, toolCount, error, detailOpen, onDetail } = props;
    const kids = [h("span", { className: "mpm-bdot " + status, key: "d" })];
    if (status === "connected") {
      kids.push(h("span", { className: "mpm-btxt", key: "t" }, "已连接" + (toolCount > 0 ? " · " + toolCount + " 工具" : "")));
    } else {
      kids.push(h("span", { className: "mpm-btxt", key: "t" }, CONN_TEXT[status] || status));
    }
    if (status === "error" && error) {
      kids.push(h("button", {
        type: "button", key: "x", className: "mpm-blink",
        onClick: onDetail, title: "查看错误详情", "aria-label": "查看错误详情",
      }, detailOpen ? "▴" : "▾"));
    }
    return h("span", { className: "mpm-badge " + status, title: status === "error" ? error : undefined }, kids);
  }

  function MessageBanner(props) {
    const { message, onDismiss } = props;
    if (!message) return null;
    return h("div", { className: "mpm-msg " + message.kind, role: "status" }, [
      h("span", { className: "mpm-msg-icon", key: "i" }, message.kind === "ok" ? "✓" : "⚠"),
      h("span", { className: "mpm-msg-text", key: "t" }, message.text),
      h("button", { type: "button", className: "mpm-msg-x", key: "x", onClick: onDismiss, "aria-label": "关闭提示" }, "✕"),
    ]);
  }

  // 工具列表展开条（在行下方内联展开，避免被滚动容器裁切）
  function toolStrip(entry, opts) {
    const tools = Array.isArray(entry.tools) ? entry.tools : [];
    const prefix = "mcp__" + entry.name + "__*";
    return h("div", { className: "mpm-toolstrip", key: "ts-" + entry.name }, [
      h("div", { className: "mpm-toolstrip-head", key: "h" }, [
        h("span", { className: "mpm-tp-title", key: "t" }, "「" + entry.name + "」的工具（" + tools.length + "）"),
        entry.serverTitle || entry.serverVersion
          ? h("span", { className: "mpm-tp-server", key: "s" }, (entry.serverTitle || "MCP 服务") + (entry.serverVersion ? " v" + entry.serverVersion : ""))
          : null,
        h("span", { className: "mpm-toolstrip-grow", key: "g" }),
        h("button", {
          type: "button", className: "mpm-btn tiny", key: "c",
          onClick: () => opts.onCopy(prefix, prefix),
          title: "复制整组调用前缀",
        }, opts.copied === prefix ? "✓ 已复制" : "复制前缀"),
        h("button", { type: "button", className: "mpm-btn tiny", key: "x", onClick: () => opts.onToggleTools(entry.name) }, "收起 ▴"),
      ]),
      tools.length === 0
        ? h("div", { className: "mpm-tp-empty", key: "e" }, "暂无工具列表（注册表快照为空；断开重连后自动回写）。")
        : h("ul", { className: "mpm-tp-grid", key: "l" }, tools.map((t) => {
            const full = "mcp__" + entry.name + "__" + t;
            return h("li", { key: t }, [
              h("code", { className: "mpm-tp-name", key: "n" }, t),
              h("button", {
                type: "button", className: "mpm-btn tiny", key: "k",
                onClick: () => opts.onCopy(full, full),
                title: "复制 " + full,
              }, opts.copied === full ? "✓" : "复制"),
            ]);
          })),
    ]);
  }

  // ── 行 / 组渲染 ─────────────────────────────────────────────────────────

  // 调用方负责在行后追加 toolStrip（见 groupCard / 单条渲染）。
  function serviceRow(entry, shortName, opts) {
    const conn = entry.conn || {};
    const st = conn.status || "off";
    const err = st === "error" ? String(conn.error || "") : "";
    const liveTools = st === "connected" && typeof conn.tools === "number" ? conn.tools : (entry.toolCount || 0);
    const busy = opts.busyNames[entry.name] === true;
    const isErrOpen = opts.errorOpen === entry.name;
    const isToolOpen = opts.toolPop === entry.name;
    const transport = entry.transport === "stdio" ? "本机" : "HTTP";
    const hasAuth = entry.headers && typeof entry.headers === "object" && Object.keys(entry.headers).length > 0;

    const nameCell = h("div", { className: "mpm-tname", key: "nm" }, [
      h("div", { className: "mpm-tnameline", key: "ln" }, [
        h("span", { className: "mpm-tfull", key: "f", title: entry.name }, shortName || entry.name),
        h("span", { className: "mpm-tbadge " + (entry.transport === "stdio" ? "cli" : "http"), key: "tb" }, transport),
        hasAuth ? h("span", { className: "mpm-tbadge auth", key: "au", title: "携带鉴权请求头" }, "鉴权") : null,
      ]),
      h("div", { className: "mpm-tep", key: "ep", title: endpointText(entry) }, endpointText(entry) || "（未配置端点）"),
      st === "error" && isErrOpen ? h("div", { className: "mpm-terr", key: "er" }, err) : null,
    ]);

    const connCell = h("div", { className: "mpm-tconnwrap", key: "co" }, [
      h(StatusBadge, {
        key: "bd",
        status: st,
        toolCount: liveTools,
        error: err,
        detailOpen: isErrOpen,
        onDetail: () => opts.onToggleError(entry.name),
      }),
      st === "connected"
        ? h("button", { type: "button", className: "mpm-btn", key: "u", onClick: () => opts.onUnload(entry.name), disabled: busy }, "断开")
        : h("button", { type: "button", className: "mpm-btn primary", key: "l", onClick: () => opts.onLoad(entry.name), disabled: busy }, busy ? "连接中…" : "连接"),
    ]);

    const tierCell = h(TierSeg, { key: "ti", value: entry.tier, onChange: (next) => opts.onTier(entry.name, next), disabled: busy });

    const toolsCell = h("div", { className: "mpm-ttools", key: "tc" }, [
      liveTools > 0
        ? h("button", {
            type: "button", className: "mpm-chip", key: "chip",
            onClick: () => opts.onToggleTools(entry.name),
            "aria-expanded": isToolOpen,
            title: "查看该服务的工具列表",
          }, [
            h("span", { key: "i", className: "mpm-chip-ic" }, "⚙"),
            h("span", { key: "t" }, liveTools + " 工具" + (isToolOpen ? " ▴" : " ▾")),
          ])
        : h("span", { className: "mpm-muted", key: "no" }, "—"),
    ]);

    const delCell = opts.confirmDelete === entry.name
      ? h("div", { className: "mpm-tdel confirm", key: "dl" }, [
          h("span", { className: "mpm-confirm", key: "t" }, "确认删除？"),
          h("div", { className: "mpm-tdel-btns", key: "b" }, [
            h("button", { type: "button", className: "mpm-btn danger tiny", key: "y", onClick: () => opts.onDelete(entry.name) }, "删除"),
            h("button", { type: "button", className: "mpm-btn tiny", key: "n", onClick: () => opts.onCancelDelete() }, "取消"),
          ]),
        ])
      : h("button", { type: "button", className: "mpm-btn danger tiny", key: "dl", onClick: () => opts.onAskDelete(entry.name), title: "删除该服务" }, "删除");

    return h("div", { className: "mpm-grid mpm-trow", key: entry.name }, [nameCell, connCell, tierCell, toolsCell, delCell]);
  }

  function groupCard(prefix, members, opts) {
    const sorted = members.slice().sort((a, b) => (a.name < b.name ? -1 : 1));
    const single = sorted.length === 1;
    const tierSet = {};
    let toolTotal = 0;
    let connectedCount = 0;
    let anyConnecting = false;
    let anyError = false;
    for (const m of sorted) {
      tierSet[m.tier] = true;
      toolTotal += m.toolCount || 0;
      const st = m.conn && m.conn.status;
      if (st === "connected") connectedCount += 1;
      else if (st === "connecting") anyConnecting = true;
      else if (st === "error") anyError = true;
    }
    // 组头圆点：仅在“已有成员连接”时绿色；失败为红、连接中琥珀闪动、否则灰。
    let dot = "off";
    if (anyError) dot = "error";
    else if (anyConnecting) dot = "connecting";
    else if (connectedCount > 0) dot = "connected";
    const allSame = Object.keys(tierSet).length === 1;
    const effective = allSame ? sorted[0].tier : null;
    // 折叠状态统一读 isOpen：单成员组的“默认展开”由 ManagerView 提供的默认值实现。
    const open = opts.isOpen(prefix);
    const allConnected = connectedCount === sorted.length;
    const busy = opts.applyingGroup === prefix;
    // 组名：自定义名（groups.json）优先，否则厂商自动名；只影响显示。
    const metaTitle = opts.groupMeta && opts.groupMeta[prefix] && opts.groupMeta[prefix].title
      ? String(opts.groupMeta[prefix].title) : "";
    const label = metaTitle || vendorLabel(prefix);
    const editing = opts.editingTitle === prefix;
    const sub = (single
      ? prefix + " · " + (allSame ? TIER_SHORT[effective] + "档" : "档位不一致") +
        " · " + (connectedCount === 1 ? "已连接" : "未连接") +
        (toolTotal > 0 ? " · 共 " + toolTotal + " 个工具" : "")
      : prefix + " · " + sorted.length + " 个服务 · " + (allSame ? TIER_SHORT[effective] + "档" : "档位不一致") +
        " · 已连接 " + connectedCount + "/" + sorted.length +
        (toolTotal > 0 ? " · 共 " + toolTotal + " 个工具" : ""));

    // 组头动作：多成员组与单成员组同款（全部连接/全部断开/整组档位/展开成员/删除整组）。
    const dotTip = dot === "connected" ? "已有成员已连接" : dot === "connecting" ? "有成员连接中" : dot === "error" ? "有成员连接失败" : "全部未连接";
    const headKids = [
      h("span", { className: "mpm-gdot " + dot, key: "d", title: dotTip }),
      h("div", { className: "mpm-ginfo", key: "i" }, [
        h("div", { className: "mpm-gtitle-row", key: "t" }, editing
          ? [
              h("input", {
                key: "in", className: "mpm-gtitle-input", type: "text",
                value: opts.titleDraft, maxLength: 40, autoFocus: true,
                placeholder: "输入组名（只改显示名）",
                onChange: (event) => opts.onTitleDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") opts.onSaveTitle(prefix);
                  else if (event.key === "Escape") opts.onCancelTitle();
                },
              }),
              h("span", { className: "mpm-gtitle-tip", key: "tip" }, "回车保存 · Esc 取消"),
            ]
          : [
              h("span", { className: "mpm-gtitle", key: "tx" }, label),
              h("button", { type: "button", className: "mpm-gedit-btn", key: "ed",
                onClick: () => opts.onEditTitle(prefix),
                title: "修改组名（只改显示名，不影响服务前缀）", "aria-label": "修改组名 " + prefix }, "✎"),
            ]),
        h("div", { className: "mpm-gsub", key: "s" }, sub),
      ]),
      h("div", { className: "mpm-grow", key: "g" }),
      h("div", { className: "mpm-gactions", key: "a" }, [
        h("button", { type: "button", className: "mpm-btn", key: "gl", onClick: () => opts.onGroupLoad(prefix, sorted), disabled: busy || allConnected },
          allConnected ? "已全部连接" : "全部连接"),
        h("button", { type: "button", className: "mpm-btn", key: "gu", onClick: () => opts.onGroupUnload(prefix, sorted), disabled: busy || connectedCount === 0 },
          "全部断开"),
        h(TierSeg, {
          key: "seg",
          value: effective,
          onChange: (tier) => opts.onGroupTier(prefix, sorted, tier),
          disabled: busy,
          title: effective ? "整体档位：一键应用到该组全部服务；展开后可逐条微调" : "成员档位不一致，点击任一档位可将整组拉齐",
        }),
        h("button", { type: "button", className: "mpm-btn", key: "tg", onClick: () => opts.onToggleGroup(prefix) },
          open ? "收起成员 ▲" : "展开成员 ▼ " + sorted.length),
        opts.confirmGroupDelete === prefix
          ? h("div", { className: "mpm-gdel confirm", key: "gd" }, [
              h("span", { className: "mpm-confirm", key: "t" }, "确认删除整组（" + sorted.length + " 个服务）？"),
              h("div", { className: "mpm-gdel-btns", key: "b" }, [
                h("button", { type: "button", className: "mpm-btn danger tiny", key: "y", onClick: () => opts.onGroupDelete(prefix, sorted) }, "删除"),
                h("button", { type: "button", className: "mpm-btn tiny", key: "n", onClick: () => opts.onCancelGroupDelete() }, "取消"),
              ]),
            ])
          : h("button", { type: "button", className: "mpm-btn danger tiny", key: "gd", onClick: () => opts.onAskGroupDelete(prefix), title: "删除整组（" + sorted.length + " 个服务，已连接的会立即断开）" }, "删除整组"),
      ]),
    ];

    const children = [h("div", { className: "mpm-ghead", key: "h" }, headKids)];
    if (open) {
      const rows = [h("div", { className: "mpm-grid mpm-thead", key: "th" }, [
        h("span", { key: "c1" }, "服务 / 端点"),
        h("span", { key: "c2" }, "连接"),
        h("span", { key: "c3" }, "档位"),
        h("span", { key: "c4" }, "工具"),
        h("span", { key: "c5" }, "操作"),
      ])];
      for (const entry of sorted) {
        rows.push(serviceRow(entry, entry.name.slice(prefix.length + 1), opts));
        if (opts.toolPop === entry.name) rows.push(toolStrip(entry, opts));
      }
      children.push(h("div", { className: "mpm-members mpm-scroll", key: "m" }, rows));
    }
    return h("div", { className: "mpm-group", key: "g-" + prefix }, children);
  }

  // ── 导入卡片 ────────────────────────────────────────────────────────────
  function ImportCard(props) {
    const { open, onOpen, onClose, text, onText, importing, onImport, onClear, onRefresh, refreshing, showSample, onToggleSample, taRef } = props;
    if (!open) {
      return h("div", { className: "mpm-card mpm-import-closed" }, [
        h("button", { type: "button", className: "mpm-sec-btn", key: "b", onClick: onOpen }, "＋ 添加新的 MCP 服务"),
        h("span", { className: "mpm-cap muted", key: "hint" }, "粘贴服务商配置（Claude/Cursor 格式 mcpServers JSON）一键导入 · eager 自动连接"),
      ]);
    }
    return h("div", { className: "mpm-card" }, [
      h("div", { className: "mpm-cardhead", key: "hd" }, [
        h("div", { key: "t" }, [
          h("div", { className: "mpm-sec", key: "t" }, "添加新的 MCP 服务"),
          h("div", { className: "mpm-cap", key: "c" }, "可整段粘贴 mcpServers JSON；重复名称会更新，同前缀自动归组；eager 项导入后自动连接，disabled 立即断开。"),
        ]),
        h("button", { type: "button", className: "mpm-btn", key: "cl", onClick: onClose, title: "收起导入区" }, "收起 ▲"),
      ]),
      h("textarea", {
        className: "mpm-import", key: "ta", rows: 7, spellCheck: false,
        ref: taRef,
        value: text,
        onChange: (event) => onText(event.target.value),
        placeholder: '{\n  "mcpServers": {\n    "pkulaw-law-search": {\n      "url": "https://…/mcp",\n      "headers": { "Authorization": "Bearer …" }\n    }\n  }\n}',
      }),
      showSample ? h("pre", { className: "mpm-sample", key: "sm" }, SAMPLE_JSON) : null,
      h("div", { className: "mpm-toolbar", key: "b" }, [
        h("button", { type: "button", className: "mpm-btn primary", key: "go", onClick: onImport, disabled: importing }, importing ? "导入中…" : "一键导入"),
        h("button", { type: "button", className: "mpm-btn", key: "ex", onClick: onToggleSample }, showSample ? "隐藏示例" : "查看示例"),
        h("button", { type: "button", className: "mpm-btn", key: "cl", onClick: onClear, disabled: text === "" }, "清空"),
        h("button", { type: "button", className: "mpm-btn", key: "rf", onClick: onRefresh, disabled: refreshing }, "刷新列表"),
      ]),
    ]);
  }

  // ── 主视图（纯 props 驱动，便于冒烟渲染）────────────────────────────────
  function ManagerView(props) {
    const {
      entries, path, loading, error, importing, refreshing,
      busyNames, applyingGroup, message, onDismissMessage,
      onRefresh, onImport, onTier, onDelete, onLoad, onUnload,
      onGroupTier, onGroupLoad, onGroupUnload, onGroupDelete, onShowMessage,
      groupMeta, onSetGroupTitle,
    } = props;

    const [query, setQuery] = useState("");
    const [expandAll, setExpandAll] = useState(null);
    const [openGroups, setOpenGroups] = useState({});
    const [importOpen, setImportOpen] = useState(true);
    const [importText, setImportText] = useState("");
    const [showSample, setShowSample] = useState(false);
    const [toolPop, setToolPop] = useState("");
    const [errorOpen, setErrorOpen] = useState("");
    const [confirmDelete, setConfirmDelete] = useState("");
    const [confirmGroupDelete, setConfirmGroupDelete] = useState("");
    const [copied, setCopied] = useState("");
    const [editingTitle, setEditingTitle] = useState("");
    const [titleDraft, setTitleDraft] = useState("");
    const importTaRef = useRef(null);

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
      for (const e of entries) {
        const st = e.conn && e.conn.status;
        if (st === "connected") {
          connected++;
          onlineTools += typeof e.conn.tools === "number" ? e.conn.tools : (e.toolCount || 0);
        }
        if (e.tier === "eager") eager++;
        if (e.tier === "disabled") disabled++;
      }
      return { total: entries.length, connected, tools: onlineTools, eager, disabled };
    }, [entries]);

    // 单成员组默认展开：未显式折叠前视为打开（多成员组默认折叠）。
    const singlePrefixes = useMemo(() => {
      const s = new Set();
      for (const item of visible) {
        if (item.kind === "group" && item.members.length === 1) s.add(item.prefix);
      }
      return s;
    }, [visible]);

    const isOpen = (prefix) => {
      if (expandAll !== null) return expandAll;
      if (openGroups[prefix] !== undefined) return openGroups[prefix] === true;
      return singlePrefixes.has(prefix);
    };
    const onToggleGroup = (prefix) => {
      setExpandAll(null);
      setOpenGroups((prev) => ({ ...prev, [prefix]: !(prev[prefix] === true) }));
    };
    const onToggleAll = () => setExpandAll(expandAll === true ? false : true);

    const toggleTools = (entryName) => setToolPop((prev) => (prev === entryName ? "" : entryName));
    const toggleError = (entryName) => setErrorOpen((prev) => (prev === entryName ? "" : entryName));

    const onCopy = async (label, text) => {
      const ok = await copyText(text);
      setCopied(text);
      setTimeout(() => setCopied((prev) => (prev === text ? "" : prev)), 2000);
      if (ok) onShowMessage("ok", "已复制：" + text);
    };

    const focusImport = () => {
      setImportOpen(true);
      setTimeout(() => { if (importTaRef.current) importTaRef.current.focus(); }, 50);
    };

    const rowOpts = {
      busyNames, applyingGroup,
      toolPop, errorOpen, confirmDelete, confirmGroupDelete, copied,
      onTier, onDelete, onLoad, onUnload,
      onToggleTools: toggleTools,
      onToggleError: toggleError,
      onCopy,
      onAskDelete: setConfirmDelete,
      onCancelDelete: () => setConfirmDelete(""),
      isOpen,
      onToggleGroup,
      onGroupTier: props.onGroupTier,
      onGroupLoad: props.onGroupLoad,
      onGroupUnload: props.onGroupUnload,
      onAskGroupDelete: setConfirmGroupDelete,
      onCancelGroupDelete: () => setConfirmGroupDelete(""),
      onGroupDelete: props.onGroupDelete,
      groupMeta: groupMeta || {},
      editingTitle,
      titleDraft,
      onEditTitle: (prefix) => {
        const cur = groupMeta && groupMeta[prefix] && groupMeta[prefix].title ? String(groupMeta[prefix].title) : "";
        setEditingTitle(prefix);
        setTitleDraft(cur);
      },
      onTitleDraft: setTitleDraft,
      onSaveTitle: (prefix) => {
        onSetGroupTitle(prefix, titleDraft);
        setEditingTitle("");
      },
      onCancelTitle: () => setEditingTitle(""),
    };

    const parts = [];

    // 顶栏
    parts.push(h("div", { className: "mpm-head", key: "hd" }, [
      h("div", { key: "t" }, [
        h("h2", { className: "mpm-title", key: "t" }, "MCP 服务"),
        h("p", { className: "mpm-sub", key: "s" }, "管理已注册的 MCP 服务器：粘贴配置导入、分组设置档位；连接后工具以 mcp__<名称>__<工具> 供 AI 调用。"),
      ]),
      h("div", { className: "mpm-head-actions", key: "a" }, [
        h("button", { type: "button", className: "mpm-btn", key: "rf", onClick: onRefresh, disabled: refreshing || loading, title: "重新读取注册表" },
          refreshing || loading ? "刷新中…" : "↻ 刷新"),
        h("button", {
          type: "button", className: "mpm-btn", key: "ex",
          disabled: entries.length === 0,
          title: "把当前注册表导出为 mcpServers JSON（下载文件）",
          onClick: () => {
            downloadJson(exportPayload(entries), "mcpServers.json");
            onShowMessage("ok", "已导出 mcpServers.json（共 " + entries.length + " 个服务）。");
          },
        }, "导出配置"),
      ]),
    ]));

    // 统计条
    parts.push(h("div", { className: "mpm-stats", key: "st" }, [
      h("span", { className: "mpm-stat", key: "a" }, [h("b", { key: "v" }, String(stats.total)), h("span", { key: "l" }, "个服务")]),
      h("span", { className: "mpm-stat ok", key: "b" }, [h("b", { key: "v" }, String(stats.connected)), h("span", { key: "l" }, "已连接")]),
      h("span", { className: "mpm-stat brand", key: "c" }, [h("b", { key: "v" }, String(stats.tools)), h("span", { key: "l" }, "个在线工具")]),
      h("span", { className: "mpm-stat eager", key: "d" }, [h("b", { key: "v" }, String(stats.eager)), h("span", { key: "l" }, "常驻")]),
      stats.disabled > 0 ? h("span", { className: "mpm-stat off", key: "e" }, [h("b", { key: "v" }, String(stats.disabled)), h("span", { key: "l" }, "停用")]) : null,
    ]));

    // 工具条：搜索 + 全部展开/收起
    parts.push(h("div", { className: "mpm-bar", key: "bar" }, [
      h("label", { className: "mpm-search", key: "s" }, [
        h("span", { className: "mpm-search-ic", key: "i" }, "⌕"),
        h("input", {
          key: "in", type: "search",
          placeholder: "搜索名称 / 端点 / 工具…",
          value: query,
          onChange: (event) => setQuery(event.target.value),
        }),
        query !== "" ? h("button", { type: "button", className: "mpm-icbtn", key: "x", onClick: () => setQuery(""), "aria-label": "清空搜索" }, "✕") : null,
      ]),
      h("button", { type: "button", className: "mpm-btn", key: "exp", onClick: onToggleAll, disabled: entries.length === 0 },
        expandAll === true ? "全部收起" : "全部展开"),
    ]));

    // 消息
    parts.push(h(MessageBanner, { key: "msg", message, onDismiss: onDismissMessage }));

    if (error) parts.push(h("div", { className: "mpm-msg err", key: "e" }, [
      h("span", { className: "mpm-msg-icon", key: "i" }, "⚠"),
      h("span", { className: "mpm-msg-text", key: "t" }, error),
    ]));

    // 导入卡
    parts.push(h(ImportCard, {
      key: "imp",
      open: importOpen,
      onOpen: () => setImportOpen(true),
      onClose: () => setImportOpen(false),
      text: importText,
      onText: setImportText,
      importing,
      onImport: () => onImport(importText),
      onClear: () => setImportText(""),
      onRefresh,
      refreshing: refreshing || loading,
      showSample,
      onToggleSample: () => setShowSample((prev) => !prev),
      taRef: importTaRef,
    }));

    // 服务列表
    parts.push(h("div", { className: "mpm-sec-line", key: "ls" }, [
      h("span", { className: "mpm-sec", key: "t" }, "已注册的 MCP 服务"),
      entries.length > 0 ? h("span", { className: "mpm-count", key: "c" }, String(entries.length)) : null,
      query !== "" && visible.length === 0 && entries.length > 0
        ? h("button", { type: "button", className: "mpm-link", key: "clr", onClick: () => setQuery("") }, "清空搜索") : null,
    ]));

    if (loading) {
      parts.push(h("div", { className: "mpm-skels", key: "sk" }, [0, 1, 2].map((i) => h("div", { className: "mpm-skel", key: i }))));
    } else if (entries.length === 0) {
      parts.push(h("div", { className: "mpm-card mpm-empty", key: "em" }, [
        h("div", { className: "mpm-empty-ic", key: "i" }, "🔌"),
        h("div", { className: "mpm-empty-title", key: "t" }, "还没有 MCP 服务"),
        h("div", { className: "mpm-empty-sub", key: "s" }, "把服务商给的 mcpServers 配置粘贴到上方导入区，即可开始管理。"),
        h("button", { type: "button", className: "mpm-btn primary", key: "b", onClick: focusImport }, "粘贴配置并导入 →"),
      ]));
    } else if (visible.length === 0) {
      parts.push(h("div", { className: "mpm-card mpm-empty small", key: "nf" }, [
        h("span", { className: "mpm-empty-ic", key: "i" }, "⌕"),
        h("div", { className: "mpm-empty-title", key: "t" }, "没有匹配的服务"),
        h("div", { className: "mpm-empty-sub", key: "s" }, "换个关键词试试，或清空搜索。"),
      ]));
    } else {
      for (const item of visible) {
        if (item.kind === "group") {
          parts.push(groupCard(item.prefix, item.members, rowOpts));
        } else {
          const entry = item.entry;
          const kids = [serviceRow(entry, null, { ...rowOpts })];
          if (rowOpts.toolPop === entry.name) kids.push(toolStrip(entry, rowOpts));
          parts.push(h("div", { className: "mpm-card mpm-single", key: "s-" + entry.name }, kids));
        }
      }
    }

    // 页脚：注册表路径
    parts.push(h("div", { className: "mpm-foot", key: "ft" }, [
      "注册表：", h("code", { key: "p" }, path || "…"),
    ]));

    return h("div", { className: "mpm-wrap" }, parts);
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
    const [message, setMessage] = useState(null);

    const refresh = useCallback(async (silent) => {
      if (!silent) setLoading(true);
      setError("");
      try {
        const data = await getJson("/mcp-panel/list");
        setPath(String(data.path || ""));
        setEntries(Array.isArray(data.entries) ? data.entries : []);
        const meta = data.groupMeta && typeof data.groupMeta === "object" ? data.groupMeta : {};
        setGroupsMeta(meta);
      } catch (err) {
        setError("读取注册表失败: " + errText(err));
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => { refresh(); }, [refresh]);

    // 轻量轮询：连接状态 / 档位 变化自动同步（仅页面可见时）
    useEffect(() => {
      if (typeof document === "undefined") return undefined;
      const timer = setInterval(async () => {
        if (document.hidden) return;
        try {
          const data = await getJson("/mcp-panel/status");
          const map = {};
          for (const s of data.entries || []) {
            if (s && s.name) map[s.name] = { tier: s.tier, conn: s.conn };
          }
          setEntries((prev) => prev.map((entry) => {
            const m = map[entry.name];
            return m ? { ...entry, tier: m.tier, conn: m.conn } : entry;
          }));
        } catch { /* 轮询失败静默，下轮再试 */ }
      }, 5000);
      return () => clearInterval(timer);
    }, []);

    // ok 类消息自动消失
    useEffect(() => {
      if (!message || message.kind !== "ok") return undefined;
      const t = setTimeout(() => setMessage(null), 6000);
      return () => clearTimeout(t);
    }, [message]);

    function showMessage(kind, text) {
      setMessage({ kind, text });
    }

    // 组显示名：自定义标题优先，否则厂商自动名（用于消息与组头）。
    function groupLabel(prefix) {
      const m = groupsMeta && groupsMeta[prefix];
      return m && m.title ? String(m.title) : vendorLabel(prefix);
    }

    async function onSetGroupTitle(prefix, title) {
      const clean = String(title === undefined || title === null ? "" : title).trim().slice(0, 40);
      try {
        await postJson("/mcp-panel/save", { action: "setGroupTitle", prefix, title: clean });
        showMessage("ok", clean ? "「" + clean + "」组名已保存。" : "已恢复为自动组名。");
        refresh(true);
      } catch (err) {
        showMessage("err", "修改组名失败: " + errText(err));
      }
    }

    async function onImport(text) {
      if (!text || !text.trim()) {
        showMessage("err", "请先粘贴 MCP 配置 JSON。");
        return;
      }
      setImporting(true);
      setMessage(null);
      try {
        const res = await postJson("/mcp-panel/import", { text });
        const lines = (res.rows || []).map((row) => {
          if (row.status === "error") return "✗ " + row.name + "：" + row.error;
          return "✓ " + row.name + "（" + (row.status === "added" ? "新增" : "更新") + "）";
        });
        showMessage("ok", "导入完成：" + res.entryCount + " 个服务。\n" + lines.join("\n") + "\n写盘即生效：eager 项自动连接，其余可点“连接”。");
        refresh(true);
      } catch (err) {
        showMessage("err", "导入失败: " + errText(err));
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
        showMessage("ok", "「" + entryName + "」档位已设为 " + TIER_TEXT[tier] + "。");
        refresh(true);
      } catch (err) {
        showMessage("err", "修改出错: " + errText(err));
      }
    }

    async function onGroupTier(prefix, members, tier) {
      setApplyingGroup(prefix);
      setMessage(null);
      const ok = [];
      const bad = [];
      try {
        for (const member of members) {
          try {
            await applyTier(member.name, tier);
            ok.push(member.name);
          } catch (err) {
            bad.push(member.name + ": " + errText(err));
          }
        }
      } finally {
        setApplyingGroup("");
      }
      const label = groupLabel(prefix);
      if (bad.length > 0) showMessage("err", "「" + label + "」整体档位部分失败：\n" + bad.join("\n"));
      else showMessage("ok", "「" + label + "」整体档位已设为 " + TIER_TEXT[tier] + "（共 " + ok.length + " 个服务）。");
      refresh(true);
    }

    async function onDelete(entryName) {
      try {
        await postJson("/mcp-panel/save", { action: "delete", name: entryName });
        showMessage("ok", "已删除「" + entryName + "」（已连接的会立即断开）。");
        refresh(true);
      } catch (err) {
        showMessage("err", "删除失败: " + errText(err));
      }
    }

    async function onLoad(entryName) {
      setBusyNames((prev) => ({ ...prev, [entryName]: true }));
      setMessage(null);
      try {
        const res = await postJson("/mcp-panel/load", { name: entryName });
        showMessage("ok", "「" + entryName + "」已连接，注册 " + res.tools + " 个工具。新会话/子代理可直接调用 mcp__" + entryName + "__*；已开始的会话从新 step 起可见。");
        refresh(true);
      } catch (err) {
        showMessage("err", "「" + entryName + "」连接失败: " + errText(err));
        refresh(true);
      } finally {
        setBusyNames((prev) => { const next = { ...prev }; delete next[entryName]; return next; });
      }
    }

    async function onUnload(entryName) {
      setBusyNames((prev) => ({ ...prev, [entryName]: true }));
      try {
        await postJson("/mcp-panel/unload", { name: entryName });
        showMessage("ok", "「" + entryName + "」已断开，工具已注销。");
        refresh(true);
      } catch (err) {
        showMessage("err", "断开失败: " + errText(err));
      } finally {
        setBusyNames((prev) => { const next = { ...prev }; delete next[entryName]; return next; });
      }
    }

    async function onGroupLoad(prefix, members) {
      setApplyingGroup(prefix);
      setMessage(null);
      const ok = [];
      const bad = [];
      for (const member of members) {
        try {
          await postJson("/mcp-panel/load", { name: member.name });
          ok.push(member.name);
        } catch (err) {
          bad.push(member.name + ": " + errText(err));
        }
      }
      setApplyingGroup("");
      const label = groupLabel(prefix);
      if (bad.length > 0) showMessage("err", "「" + label + "」部分连接失败：\n" + bad.join("\n"));
      else showMessage("ok", "「" + label + "」全部连接成功（" + ok.length + " 个服务）。");
      refresh(true);
    }

    async function onGroupUnload(prefix, members) {
      setApplyingGroup(prefix);
      setMessage(null);
      for (const member of members) {
        try {
          await postJson("/mcp-panel/unload", { name: member.name });
        } catch { /* 忽略单条断开失败 */ }
      }
      setApplyingGroup("");
      showMessage("ok", "「" + groupLabel(prefix) + "」已全部断开。");
      refresh(true);
    }

    async function onGroupDelete(prefix, members) {
      setMessage(null);
      const ok = [];
      const bad = [];
      for (const member of members) {
        try {
          await postJson("/mcp-panel/save", { action: "delete", name: member.name });
          ok.push(member.name);
        } catch (err) {
          bad.push(member.name + ": " + errText(err));
        }
      }
      const label = groupLabel(prefix);
      if (bad.length > 0) showMessage("err", "「" + label + "」删除部分失败：\n" + bad.join("\n"));
      else showMessage("ok", "已删除「" + label + "」整组（" + ok.length + " 个服务，已连接的已立即断开）。");
      // 顺带清理自定义组名元数据（失败不影响删除结果）。
      try {
        await postJson("/mcp-panel/save", { action: "setGroupTitle", prefix, title: "" });
      } catch {
        /* 忽略元数据清理失败 */
      }
      refresh(true);
    }

    return h(ManagerView, {
      entries, path, loading, error,
      importing,
      refreshing: loading,
      busyNames, applyingGroup, message,
      onDismissMessage: () => setMessage(null),
      onRefresh: () => refresh(),
      onImport,
      onTier, onDelete, onLoad, onUnload,
      onGroupTier, onGroupLoad, onGroupUnload, onGroupDelete,
      onShowMessage: showMessage,
      groupMeta: groupsMeta,
      onSetGroupTitle,
    });
  }

  // ── CSS（主题变量随产品明暗主题自动适配）────────────────────────────────
  const CSS = [
    ".mpm-wrap{display:flex;flex-direction:column;gap:12px;padding:6px 2px 28px;max-width:1020px;min-width:0;}",
    // 顶栏
    ".mpm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;}",
    ".mpm-title{font-size:18px;font-weight:700;line-height:1.35;color:var(--dsw-alias-label-primary);margin:0;}",
    ".mpm-sub{font-size:12px;line-height:1.65;color:var(--dsw-alias-label-secondary);margin:3px 0 0;max-width:640px;}",
    ".mpm-head-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}",
    // 统计条
    ".mpm-stats{display:flex;flex-wrap:wrap;gap:8px;}",
    ".mpm-stat{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:4px 10px;}",
    ".mpm-stat b{color:var(--dsw-alias-label-primary);font-weight:700;font-variant-numeric:tabular-nums;font-size:13px;}",
    ".mpm-stat.ok b{color:var(--dsw-alias-state-success-primary);}",
    ".mpm-stat.brand b{color:var(--dsw-alias-brand-primary);}",
    ".mpm-stat.eager b{color:var(--dsw-alias-state-warn-primary);}",
    ".mpm-stat.off b{color:var(--dsw-alias-label-tertiary);}",
    // 工具条
    ".mpm-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}",
    ".mpm-search{flex:1 1 220px;min-width:180px;display:flex;align-items:center;gap:6px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:0 8px;color:var(--dsw-alias-label-secondary);transition:border-color .12s;}",
    ".mpm-search:focus-within{border-color:var(--dsw-alias-brand-primary);}",
    ".mpm-search input{flex:1 1 auto;min-width:0;border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 0;}",
    ".mpm-search input::placeholder{color:var(--dsw-alias-label-tertiary);}",
    ".mpm-search-ic{font-size:13px;line-height:1;}",
    ".mpm-icbtn{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px;padding:2px 4px;border-radius:5px;}",
    ".mpm-icbtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);}",
    // 按钮
    ".mpm-btn{font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:4px 10px;cursor:pointer;white-space:nowrap;transition:border-color .12s,color .12s,background .12s;}",
    ".mpm-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}",
    ".mpm-btn.primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}",
    ".mpm-btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);}",
    ".mpm-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}",
    ".mpm-btn.danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);border-color:var(--dsw-alias-state-error-primary);}",
    ".mpm-btn.tiny{padding:1px 7px;font-size:11px;border-radius:6px;}",
    ".mpm-btn:disabled{opacity:.45;cursor:default;}",
    ".mpm-link{border:none;background:transparent;color:var(--dsw-alias-brand-primary);cursor:pointer;font:inherit;font-size:12px;padding:2px 6px;border-radius:6px;}",
    ".mpm-link:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);}",
    // 段式档位
    ".mpm-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);}",
    ".mpm-seg-btn{font:inherit;font-size:11px;padding:3px 9px;color:var(--dsw-alias-label-secondary);background:transparent;border:none;border-right:1px solid var(--dsw-alias-border-l1);cursor:pointer;transition:background .12s,color .12s;}",
    ".mpm-seg-btn:last-child{border-right:none;}",
    ".mpm-seg-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}",
    ".mpm-seg-btn.on{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted,#fff);font-weight:600;}",
    ".mpm-seg-btn:disabled{opacity:.45;cursor:default;}",
    // 状态徽章
    ".mpm-badge{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;border-radius:999px;padding:2px 9px;border:1px solid transparent;white-space:nowrap;max-width:132px;}",
    ".mpm-btxt{overflow:hidden;text-overflow:ellipsis;}",
    ".mpm-badge.connected{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);}",
    ".mpm-badge.connecting{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);}",
    ".mpm-badge.error{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);}",
    ".mpm-badge.off{color:var(--dsw-alias-label-tertiary);border-color:var(--dsw-alias-border-l2);}",
    ".mpm-bdot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none;}",
    ".mpm-bdot.connected{background:var(--dsw-alias-state-success-primary);}",
    ".mpm-bdot.connecting{background:var(--dsw-alias-state-warn-primary);animation:mpm-pulse 1s ease-in-out infinite;}",
    ".mpm-bdot.error{background:var(--dsw-alias-state-error-primary);}",
    ".mpm-bdot.off{background:var(--dsw-alias-label-tertiary);}",
    ".mpm-blink{border:none;background:transparent;color:inherit;cursor:pointer;font-size:10px;padding:0 2px;}",
    // 卡片 / 分区
    ".mpm-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-1);}",
    ".mpm-sec-line{display:flex;align-items:center;gap:8px;padding:2px 0;}",
    ".mpm-sec{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}",
    ".mpm-count{font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border-radius:999px;padding:1px 8px;font-variant-numeric:tabular-nums;}",
    ".mpm-cap{font-size:12px;color:var(--dsw-alias-label-secondary);padding:0 2px 6px;}",
    ".mpm-cap.muted{color:var(--dsw-alias-label-tertiary);}",
    ".mpm-cardhead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;}",
    ".mpm-import-closed{display:flex;flex-direction:column;align-items:flex-start;gap:4px;}",
    ".mpm-sec-btn{border:none;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:13px;font-weight:600;cursor:pointer;padding:0;text-align:left;}",
    ".mpm-sec-btn:hover{text-decoration:underline;}",
    ".mpm-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}",
    // 导入 textarea / 示例
    ".mpm-import{font:inherit;font-size:12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px;}",
    ".mpm-import{font-family:ui-monospace,Consolas,'Courier New',monospace;resize:vertical;box-sizing:border-box;width:100%;}",
    ".mpm-import:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}",
    ".mpm-sample{font-family:ui-monospace,Consolas,'Courier New',monospace;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-bg-layer-1));border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:8px 10px;white-space:pre-wrap;max-height:200px;overflow:auto;margin:0 0 8px;}",
    // 组卡
    ".mpm-group{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);}",
    ".mpm-ghead{display:flex;flex-wrap:wrap;gap:10px 12px;align-items:center;padding:12px 14px;}",
    ".mpm-gdot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-label-tertiary) 16%,transparent);transition:background .15s;}",
    ".mpm-gdot.connected{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary) 20%,transparent);}",
    ".mpm-gdot.connecting{background:var(--dsw-alias-state-warn-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 20%,transparent);animation:mpm-pulse 1s ease-in-out infinite;}",
    ".mpm-gdot.error{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary) 20%,transparent);}",
    ".mpm-ginfo{display:flex;flex-direction:column;gap:2px;min-width:190px;flex:1 1 240px;}",
    ".mpm-gtitle-row{display:flex;align-items:center;gap:5px;min-width:0;}",
    ".mpm-gtitle{font-size:14px;font-weight:700;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".mpm-gedit-btn{border:none;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px;line-height:1;padding:2px 4px;border-radius:5px;flex:none;}",
    ".mpm-gedit-btn:hover{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-interactive-bg-hover);}",
    ".mpm-gtitle-input{font:inherit;font-size:13px;font-weight:700;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-brand-primary);border-radius:6px;padding:2px 7px;width:min(260px,38vw);min-width:120px;outline:none;}",
    ".mpm-gtitle-tip{font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;}",
    ".mpm-gsub{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;}",
    ".mpm-grow{flex:0 0 auto;}",
    ".mpm-gactions{display:flex;flex-wrap:wrap;gap:6px;align-items:center;}",
    ".mpm-members{border-top:1px solid var(--dsw-alias-border-l1);padding:2px 14px 10px;}",
    ".mpm-scroll{overflow-x:auto;}",
    // 行网格
    ".mpm-grid{display:grid;grid-template-columns:minmax(150px,1.4fr) minmax(148px,190px) 128px 92px minmax(56px,auto);gap:10px;align-items:center;}",
    ".mpm-thead{font-size:11px;color:var(--dsw-alias-label-secondary);padding:8px 2px 4px;}",
    ".mpm-trow{padding:8px 2px;border-top:1px dashed var(--dsw-alias-border-l1);}",
    ".mpm-trow:hover{background:var(--dsw-alias-interactive-bg-hover);}",
    ".mpm-single{padding:8px 14px;}",
    ".mpm-tname{display:flex;flex-direction:column;gap:2px;min-width:0;}",
    ".mpm-tnameline{display:flex;align-items:center;gap:6px;min-width:0;flex-wrap:wrap;}",
    ".mpm-tfull{font-weight:600;font-size:12.5px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
    ".mpm-tbadge{font-size:10px;line-height:1;border-radius:5px;padding:2px 5px;flex:none;}",
    ".mpm-tbadge.cli{color:var(--dsw-alias-state-business-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-business-primary) 40%,transparent);}",
    ".mpm-tbadge.http{color:var(--dsw-alias-brand-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);}",
    ".mpm-tbadge.auth{color:var(--dsw-alias-state-warn-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);}",
    ".mpm-tep{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Consolas,'Courier New',monospace;}",
    ".mpm-terr{font-size:11px;color:var(--dsw-alias-state-error-primary);line-height:1.5;padding:6px 8px;margin-top:4px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);border-radius:7px;white-space:pre-wrap;word-break:break-all;max-height:120px;overflow:auto;}",
    ".mpm-tconnwrap{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}",
    ".mpm-ttools{min-width:0;}",
    ".mpm-muted{color:var(--dsw-alias-label-tertiary);font-size:12px;}",
    ".mpm-chip{display:inline-flex;align-items:center;gap:5px;font:inherit;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid var(--dsw-alias-border-l1);border-radius:999px;padding:2px 9px;cursor:pointer;white-space:nowrap;}",
    ".mpm-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}",
    ".mpm-chip-ic{font-size:11px;}",
    ".mpm-tdel{display:flex;align-items:center;gap:5px;flex-wrap:wrap;justify-content:flex-end;min-width:0;}",
    ".mpm-tdel.confirm{flex-direction:column;align-items:flex-end;gap:4px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent);border-radius:8px;padding:5px 8px;}",
    ".mpm-tdel-btns{display:flex;gap:5px;align-items:center;}",
    ".mpm-confirm{font-size:11px;color:var(--dsw-alias-state-error-primary);white-space:nowrap;}",
    ".mpm-gdel.confirm{display:flex;flex-direction:column;align-items:flex-end;gap:4px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent);border-radius:8px;padding:5px 8px;}",
    ".mpm-gdel-btns{display:flex;gap:5px;align-items:center;}",
    // 工具展开条
    ".mpm-toolstrip{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;margin:6px 2px 10px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;min-width:0;}",
    ".mpm-toolstrip-head{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0;}",
    ".mpm-tp-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);}",
    ".mpm-tp-server{font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px;min-width:0;}",
    ".mpm-toolstrip-grow{flex:1 1 auto;}",
    ".mpm-tp-grid{list-style:none;margin:0;padding:6px 8px;max-height:230px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 12px;}",
    ".mpm-tp-grid li{display:flex;align-items:center;gap:8px;justify-content:space-between;padding:3px 2px;min-width:0;}",
    ".mpm-tp-name{font-family:ui-monospace,Consolas,'Courier New',monospace;font-size:11px;color:var(--dsw-alias-label-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".mpm-tp-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:10px 12px;}",
    // 细滚动条（二级横向 / 三级工具列表 / 错误详情共用）
    ".mpm-scroll::-webkit-scrollbar,.mpm-tp-grid::-webkit-scrollbar,.mpm-terr::-webkit-scrollbar{width:8px;height:8px;}",
    ".mpm-scroll::-webkit-scrollbar-thumb,.mpm-tp-grid::-webkit-scrollbar-thumb,.mpm-terr::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:999px;}",
    ".mpm-scroll::-webkit-scrollbar-thumb:hover,.mpm-tp-grid::-webkit-scrollbar-thumb:hover,.mpm-terr::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-brand-primary);}",
    ".mpm-scroll::-webkit-scrollbar-corner,.mpm-tp-grid::-webkit-scrollbar-corner,.mpm-terr::-webkit-scrollbar-corner{background:transparent;}",
    // 消息
    ".mpm-msg{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.6;padding:7px 10px;border-radius:9px;white-space:pre-wrap;word-break:break-word;}",
    ".mpm-msg.ok{color:var(--dsw-alias-state-success-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,transparent);}",
    ".mpm-msg.err{color:var(--dsw-alias-state-error-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);}",
    ".mpm-msg-icon{flex:none;line-height:1.4;}",
    ".mpm-msg-text{flex:1 1 auto;min-width:0;}",
    ".mpm-msg-x{border:none;background:transparent;color:inherit;cursor:pointer;font-size:11px;padding:2px;opacity:.7;}",
    ".mpm-msg-x:hover{opacity:1;}",
    // 空态 / 骨架
    ".mpm-empty{display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;padding:26px 16px;}",
    ".mpm-empty.small{padding:18px 16px;}",
    ".mpm-empty-ic{font-size:24px;line-height:1;margin-bottom:2px;}",
    ".mpm-empty-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}",
    ".mpm-empty-sub{font-size:12px;color:var(--dsw-alias-label-secondary);max-width:380px;}",
    ".mpm-skels{display:flex;flex-direction:column;gap:8px;}",
    ".mpm-skel{height:58px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);animation:mpm-pulse 1.2s ease-in-out infinite;}",
    ".mpm-foot{font-size:11px;color:var(--dsw-alias-label-tertiary);}",
    ".mpm-foot code{font-family:ui-monospace,Consolas,'Courier New',monospace;}",
    "@keyframes mpm-pulse{0%,100%{opacity:1}50%{opacity:.45}}",
  ].join("");

  // ── CSS 注入（幂等；带版本号便于热更新时覆盖旧样式）────────────────────
  const CSS_TAG = "dsh-mcp-manager-panel-v5";
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
    __test: {
      hueFor, vendorLabel, endpointText, groupEntries, exportPayload,
      components: { ManagerView, ManagerSection, ImportCard, TierSeg, StatusBadge, MessageBanner, toolStrip, serviceRow, groupCard },
    },
  };
}});