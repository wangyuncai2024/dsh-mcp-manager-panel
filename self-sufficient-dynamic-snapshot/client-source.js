// dsh-mcp-manager-panel — 动态预览版 Client 半区（自足版 UI；与 pkg-5 相同）。

const h = React.createElement;
const { useState, useEffect, useCallback } = React;

const name = 'dsh-mcp-manager-panel-preview';
const inject = ['slots'];

async function rpc(method, args) {
  return host.call(method, args === undefined ? {} : args);
}

function errText(error) {
  return String(error && error.message ? error.message : error);
}

function Opt(value, text, keyHint, disabled) {
  return h('option', { value, key: keyHint || value, disabled: disabled === true }, text);
}

function Dot(tier) {
  return h('span', { className: 'mpm-dot ' + (tier || 'mixed') });
}

const TIER_TEXT = {
  eager: 'eager · 常驻（会话自动可用）',
  'on-demand': 'on-demand · AI 按需加载',
  disabled: 'disabled · 停用',
};
const VENDOR_LABEL = { pkulaw: '北大法宝', yuandian: '原点法律数据' };

const CONN_TEXT = {
  off: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  error: '失败',
};

// ── 页面 ───────────────────────────────────────────────────────────────
function ManagerSection() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [applyingGroup, setApplyingGroup] = useState('');
  const [busyNames, setBusyNames] = useState({});
  const [openGroups, setOpenGroups] = useState({});
  const [message, setMessage] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await rpc('mcp-panel/list');
      setPath(String(data.path || ''));
      setEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (err) {
      setError('读取注册表失败: ' + errText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  function showMessage(kind, text) {
    setMessage({ kind, text });
  }

  async function onImport() {
    if (!importText || !importText.trim()) {
      showMessage('err', '请先粘贴 MCP 配置 JSON。');
      return;
    }
    setImporting(true);
    setMessage(null);
    try {
      const res = await rpc('mcp-panel/import', { text: importText });
      const lines = (res.rows || []).map((row) => {
        if (row.status === 'error') return '✗ ' + row.name + '：' + row.error;
        return '✓ ' + row.name + '（' + (row.status === 'added' ? '新增' : '更新') + '）';
      });
      showMessage('ok', '导入完成：' + res.entryCount + ' 个服务。\n' + lines.join('\n') + '\n（预览版只写沙箱注册表；本插件自带加载/调用，无需能力库。）');
      refresh();
    } catch (err) {
      showMessage('err', '导入失败: ' + errText(err));
    } finally {
      setImporting(false);
    }
  }

  async function applyTier(entryName, tier) {
    await rpc('mcp-panel/save', { action: 'upsert', entry: { name: entryName, tier } });
  }

  async function onGroupTierChange(prefix, members, tier) {
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
          bad.push(member.name + ': ' + errText(err));
        }
      }
    } finally {
      setApplyingGroup('');
    }
    const label = VENDOR_LABEL[prefix] ? VENDOR_LABEL[prefix] + ' MCP' : prefix + ' 系列';
    if (bad.length > 0) showMessage('err', '部分失败：\n' + bad.join('\n'));
    else showMessage('ok', '「' + label + '」整体档位已设为 ' + TIER_TEXT[tier] + '（共 ' + ok.length + ' 个服务）。');
    refresh();
  }

  async function onTierChange(entryName, tier) {
    try {
      await applyTier(entryName, tier);
      showMessage('ok', '「' + entryName + '」档位已设为 ' + tier + '（eager 会自动加载）。');
      refresh();
    } catch (err) {
      showMessage('err', '修改出错: ' + errText(err));
    }
  }

  async function onDelete(entryName) {
    try {
      await rpc('mcp-panel/save', { action: 'delete', name: entryName });
      setConfirmDelete('');
      showMessage('ok', '已删除「' + entryName + '」。');
      refresh();
    } catch (err) {
      showMessage('err', '删除失败: ' + errText(err));
    }
  }

  async function onLoad(entryName) {
    setBusyNames((prev) => ({ ...prev, [entryName]: true }));
    setMessage(null);
    try {
      const res = await rpc('mcp-panel/load', { name: entryName });
      showMessage('ok', '「' + entryName + '」已连接，注册 ' + res.tools + ' 个工具（AI 现在可直接调用 mcp__' + entryName + '__* ）。');
      refresh();
    } catch (err) {
      showMessage('err', '「' + entryName + '」连接失败: ' + errText(err));
      refresh();
    } finally {
      setBusyNames((prev) => { const next = { ...prev }; delete next[entryName]; return next; });
    }
  }

  async function onUnload(entryName) {
    setBusyNames((prev) => ({ ...prev, [entryName]: true }));
    try {
      await rpc('mcp-panel/unload', { name: entryName });
      showMessage('ok', '「' + entryName + '」已断开，工具已注销。');
      refresh();
    } catch (err) {
      showMessage('err', '断开失败: ' + errText(err));
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
        await rpc('mcp-panel/load', { name: member.name });
        ok.push(member.name);
      } catch (err) {
        bad.push(member.name + ': ' + errText(err));
      }
    }
    setApplyingGroup('');
    const label = VENDOR_LABEL[prefix] ? VENDOR_LABEL[prefix] + ' MCP' : prefix + ' 系列';
    if (bad.length > 0) showMessage('err', '「' + label + '」部分连接失败：\n' + bad.join('\n'));
    else showMessage('ok', '「' + label + '」全部连接成功（' + ok.length + ' 个服务）。');
    refresh();
  }

  async function onGroupUnload(prefix, members) {
    setApplyingGroup(prefix);
    setMessage(null);
    for (const member of members) {
      try {
        await rpc('mcp-panel/unload', { name: member.name });
      } catch (err) { /* 忽略单条断开失败 */ }
    }
    setApplyingGroup('');
    showMessage('ok', '「' + (VENDOR_LABEL[prefix] ? VENDOR_LABEL[prefix] + ' MCP' : prefix + ' 系列') + '」已全部断开。');
    refresh();
  }

  function tierSelect(value, onchange, extra) {
    const props = { className: 'mpm-sel', value, onChange: onchange, title: '档位：eager=常驻｜on-demand=AI 按需｜disabled=停用' };
    if (extra) for (const k of Object.keys(extra)) props[k] = extra[k];
    return h('select', props, [Opt('eager', 'eager'), Opt('on-demand', 'on-demand'), Opt('disabled', 'disabled')]);
  }

  function deleteControl(entryName) {
    if (confirmDelete === entryName) {
      return h('span', { className: 'mpm-toolbar' }, [
        h('span', { style: { fontSize: 11, opacity: 0.8 } }, '确认？'),
        h('button', { type: 'button', className: 'mpm-btn small danger', key: 'y', onClick: () => onDelete(entryName) }, '删除'),
        h('button', { type: 'button', className: 'mpm-btn small', key: 'n', onClick: () => setConfirmDelete('') }, '取消'),
      ]);
    }
    return h('button', { type: 'button', className: 'mpm-btn small danger', onClick: () => setConfirmDelete(entryName) }, '删除');
  }

  function connControl(entry, onLoad_, onUnload_) {
    const st = entry.conn ? entry.conn.status : 'off';
    const err = entry.conn && entry.conn.status === 'error' ? (entry.conn.error || '').slice(0, 40) : '';
    const busy = busyNames[entry.name] === true;
    const kids = [
      h('div', { className: 'mpm-conn ' + st, key: 'st', title: err }, (CONN_TEXT[st] || st) + (st === 'connected' && entry.conn.tools ? ' · ' + entry.conn.tools + ' 工具' : '')),
    ];
    if (st === 'connected') {
      kids.push(h('button', { type: 'button', className: 'mpm-btn small', key: 'u', onClick: () => onUnload_(entry.name), disabled: busy }, '断开'));
    } else {
      kids.push(h('button', { type: 'button', className: 'mpm-btn small primary', key: 'l', onClick: () => onLoad_(entry.name), disabled: busy }, busy ? '连接中…' : '连接'));
    }
    return h('div', { className: 'mpm-tconn', key: 'co' }, kids);
  }

  function serviceRow(entry, shortName) {
    const kids = [
      h('div', { className: 'mpm-tname', key: 'nm' }, [
        h('div', { className: 'mpm-tfull', title: entry.name }, shortName || entry.name),
        h('div', { className: 'mpm-turl' }, entry.transport === 'streamable-http' ? entry.url || '' : (entry.command || '') + (entry.args && entry.args.length ? ' ' + entry.args.join(' ') : '')),
      ]),
      connControl(entry, onLoad, onUnload),
      tierSelect(entry.tier, (event) => onTierChange(entry.name, event.target.value)),
      h('div', { className: 'mpm-ttools', key: 'tc' }, entry.toolCount > 0 ? entry.toolCount + ' 个工具' : '—'),
      deleteControl(entry.name),
    ];
    return h('div', { className: 'mpm-trow', key: entry.name }, kids);
  }

  function groupCard(prefix, members) {
    const label = VENDOR_LABEL[prefix] ? VENDOR_LABEL[prefix] + ' MCP' : prefix + ' 系列';
    const sorted = members.slice().sort((a, b) => (a.name < b.name ? -1 : 1));
    const tierSet = {};
    let toolTotal = 0;
    let connectedCount = 0;
    for (const m of sorted) {
      tierSet[m.tier] = true;
      toolTotal += m.toolCount || 0;
      if (m.conn && m.conn.status === 'connected') connectedCount += 1;
    }
    const allSame = Object.keys(tierSet).length === 1;
    const effective = allSame ? sorted[0].tier : 'mixed';
    const open = openGroups[prefix] === true;
    const allConnected = connectedCount === sorted.length;
    const headKids = [
      Dot(effective),
      h('div', { key: 'tt' }, [
        h('div', { className: 'mpm-gtitle' }, label),
        h('div', { className: 'mpm-gsub' }, prefix + ' · ' + sorted.length + ' 个服务 · ' + (allSame ? TIER_TEXT[sorted[0].tier] : '档位不一致，可整体拉齐') + (toolTotal > 0 ? ' · 共 ' + toolTotal + ' 个工具' : '') + ' · 连接 ' + connectedCount + '/' + sorted.length),
      ]),
      h('div', { className: 'mpm-grow', key: 'gr' }),
      h('button', { type: 'button', className: 'mpm-btn small', key: 'gl', onClick: () => onGroupLoad(prefix, sorted), disabled: applyingGroup === prefix || allConnected }, allConnected ? '已全部连接' : '全部连接'),
      h('button', { type: 'button', className: 'mpm-btn small', key: 'gu', onClick: () => onGroupUnload(prefix, sorted), disabled: applyingGroup === prefix || connectedCount === 0 }, '全部断开'),
      h('select', {
        className: 'mpm-sel',
        key: 'sel',
        value: effective === 'mixed' ? '__mixed__' : effective,
        disabled: applyingGroup === prefix,
        onChange: (event) => onGroupTierChange(prefix, sorted, event.target.value),
        title: '整体档位：一键应用到该组全部服务；再单独微调请展开下面列表',
      }, [
        Opt('__mixed__', '（成员不一致）', '__mixed__', true),
        Opt('eager', '整体 · 常驻'),
        Opt('on-demand', '整体 · AI 按需'),
        Opt('disabled', '整体 · 停用'),
      ]),
      h('button', { type: 'button', className: 'mpm-btn', key: 'tg', onClick: () => setOpenGroups((prev) => ({ ...prev, [prefix]: !open })) }, open ? '收起成员 ▲' : '展开成员 ▼ (' + sorted.length + ')'),
    ];
    const children = [h('div', { className: 'mpm-ghead', key: 'h' }, headKids)];
    if (open) {
      const rows = [h('div', { className: 'mpm-thead', key: 'th' }, [
        h('span', { key: 'c1' }, '小服务 / 端点'),
        h('span', { key: 'c2' }, '连接'),
        h('span', { key: 'c3' }, '档位（单条调整）'),
        h('span', { key: 'c4' }, '工具'),
        h('span', { key: 'c5' }, '操作'),
      ])];
      for (const entry of sorted) {
        rows.push(serviceRow(entry, entry.name.slice(prefix.length + 1)));
      }
      children.push(h('div', { className: 'mpm-members', key: 'm' }, rows));
    }
    return h('div', { className: 'mpm-group', key: 'g-' + prefix }, children);
  }

  const parts = [];

  parts.push(h('div', { className: 'mpm-hint', key: 'h' }, [
    '【动态预览版 · 自足】粘贴 MCP 配置 JSON 一键添加；本插件自带 连接→注册工具→调用 全链路，无需能力库。',
    h('strong', { key: 's' }, '数据写入会话沙箱注册表'),
    '。注册表：' + (path || '…') + '。',
  ]));

  if (error) parts.push(h('div', { className: 'mpm-msg err', key: 'e' }, error));
  if (message) parts.push(h('div', { className: 'mpm-msg ' + message.kind, key: 'm' }, message.text));

  parts.push(h('div', { className: 'mpm-card', key: 'imp' }, [
    h('div', { className: 'mpm-sec', key: 't' }, '添加新的 MCP 服务'),
    h('div', { className: 'mpm-cap', key: 'c' }, '把服务商给的整段配置（可以是一整个 mcpServers JSON）粘贴进来；重复名称会更新，同前缀自动归组。也可以让 AI 直接用 mcp_load / mcp_register。'),
    h('textarea', {
      className: 'mpm-import',
      key: 'ta',
      rows: 7,
      spellCheck: false,
      value: importText,
      onChange: (event) => setImportText(event.target.value),
      placeholder: '{\n  "mcpServers": {\n    "pkulaw-law-search": {\n      "url": "https://…/mcp",\n      "headers": { "Authorization": "Bearer …" }\n    }\n  }\n}',
    }),
    h('div', { className: 'mpm-toolbar', key: 'b' }, [
      h('button', { type: 'button', className: 'mpm-btn primary', key: 'go', onClick: onImport, disabled: importing }, importing ? '导入中…' : '一键导入'),
      h('button', { type: 'button', className: 'mpm-btn', key: 'cl', onClick: () => setImportText('') }, '清空'),
      h('button', { type: 'button', className: 'mpm-btn', key: 'rf', onClick: refresh, disabled: loading }, '刷新'),
    ]),
  ]));

  parts.push(h('div', { className: 'mpm-sec', key: 'ls' }, '已注册的 MCP 服务'));

  if (loading) {
    parts.push(h('div', { className: 'mpm-empty', key: 'ld' }, '加载中…'));
  } else if (entries.length === 0) {
    parts.push(h('div', { className: 'mpm-empty', key: 'em' }, '暂无服务。把服务商给的配置粘贴到上面并点“一键导入”。'));
  } else {
    const byPrefix = {};
    for (const entry of entries) {
      const prefix = String(entry.name || '').split('-')[0] || 'other';
      if (!byPrefix[prefix]) byPrefix[prefix] = [];
      byPrefix[prefix].push(entry);
    }
    const prefixes = Object.keys(byPrefix).sort();
    for (const prefix of prefixes) {
      const members = byPrefix[prefix];
      if (members.length >= 2 && prefix !== 'other') parts.push(groupCard(prefix, members));
      else for (const single of members) parts.push(h('div', { className: 'mpm-card', key: 's-' + single.name }, serviceRow(single)));
    }
  }

  return h('div', { className: 'mpm-wrap' }, parts);
}

// ── CSS ────────────────────────────────────────────────────────────────
const CSS = [
  '.mpm-wrap { display:flex; flex-direction:column; gap:12px; padding:4px 2px 24px; max-width:880px; }',
  '.mpm-hint { font-size:12px; line-height:1.7; color:var(--dsw-alias-label-secondary); padding:8px 12px; border-radius:8px; border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-1); }',
  '.mpm-msg { font-size:12px; padding:6px 12px; border-radius:8px; white-space:pre-wrap; }',
  '.mpm-msg.ok { color:var(--dsw-alias-state-success-primary); border:1px solid var(--dsw-alias-state-success-primary); }',
  '.mpm-msg.err { color:var(--dsw-alias-state-error-primary); border:1px solid var(--dsw-alias-state-error-primary); }',
  '.mpm-card { border:1px solid var(--dsw-alias-border-l1); border-radius:12px; padding:12px 14px; background:var(--dsw-alias-bg-layer-1); }',
  '.mpm-sec { font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); padding:2px 0; }',
  '.mpm-cap { font-size:12px; color:var(--dsw-alias-label-secondary); padding:0 2px 6px; }',
  '.mpm-group { border:1px solid var(--dsw-alias-border-l1); border-radius:12px; overflow:hidden; background:var(--dsw-alias-bg-layer-1); }',
  '.mpm-ghead { display:flex; flex-wrap:wrap; align-items:center; gap:10px; padding:12px 14px; }',
  '.mpm-gtitle { font-size:14px; font-weight:700; color:var(--dsw-alias-label-primary); }',
  '.mpm-gsub { font-size:11px; color:var(--dsw-alias-label-secondary); }',
  '.mpm-grow { flex:1 1 80px; }',
  '.mpm-dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; vertical-align:1px; }',
  '.mpm-dot.eager { background:var(--dsw-alias-brand-primary); }',
  '.mpm-dot.on-demand { background:var(--dsw-alias-state-success-primary); }',
  '.mpm-dot.disabled { background:var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary)); }',
  '.mpm-dot.mixed { background:var(--dsw-alias-state-warning-primary, #f59e0b); }',
  '.mpm-sel, .mpm-import { font:inherit; font-size:12px; color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l2); border-radius:7px; padding:4px 8px; }',
  '.mpm-import { font-family:ui-monospace,Consolas,\'Courier New\',monospace; resize:vertical; box-sizing:border-box; width:100%; }',
  '.mpm-btn { font:inherit; font-size:12px; color:var(--dsw-alias-label-primary); cursor:pointer; background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l2); border-radius:7px; padding:4px 10px; }',
  '.mpm-btn:hover { border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); }',
  '.mpm-btn.primary { background:transparent; border-color:var(--dsw-alias-brand-primary); color:var(--dsw-alias-brand-primary); }',
  '.mpm-btn.danger { color:var(--dsw-alias-state-error-primary); border-color:var(--dsw-alias-state-error-primary); }',
  '.mpm-btn.small { padding:2px 8px; font-size:11px; }',
  '.mpm-btn:disabled { opacity:.5; cursor:default; }',
  '.mpm-toolbar { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }',
  '.mpm-members { border-top:1px solid var(--dsw-alias-border-l1); padding:2px 14px 10px; }',
  '.mpm-thead, .mpm-trow { display:grid; grid-template-columns:minmax(150px,1fr) 120px 110px 74px 76px; gap:10px; align-items:center; }',
  '.mpm-thead { font-size:11px; color:var(--dsw-alias-label-secondary); padding:8px 2px 2px; }',
  '.mpm-trow { padding:6px 2px; border-top:1px dashed var(--dsw-alias-border-l1); }',
  '.mpm-tname { display:flex; flex-direction:column; gap:1px; min-width:0; }',
  '.mpm-tfull { font-weight:600; font-size:12.5px; color:var(--dsw-alias-label-primary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
  '.mpm-turl { font-size:11px; color:var(--dsw-alias-label-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
  '.mpm-ttools { font-size:12px; color:var(--dsw-alias-label-secondary); }',
  '.mpm-tconn { display:flex; align-items:center; gap:6px; }',
  '.mpm-conn { font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }',
  '.mpm-conn.connected { color:var(--dsw-alias-state-success-primary); }',
  '.mpm-conn.error { color:var(--dsw-alias-state-error-primary); }',
  '.mpm-conn.connecting { color:var(--dsw-alias-state-warning-primary, #f59e0b); }',
  '.mpm-conn.off { color:var(--dsw-alias-label-secondary); }',
  '.mpm-empty { font-size:13px; color:var(--dsw-alias-label-secondary); padding:12px 2px; }',
].join('\n');

function apply(ctx) {
  styles.insert(CSS);
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp-servers-preview',
    order: 34,
    label: 'MCP 服务（预览）',
  }, ManagerSection));
}

return { name, inject, apply };