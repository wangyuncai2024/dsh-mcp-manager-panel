// 开发用：@deepseek-ai/dsh-client-ui-primitives 的最小替身（不进包）。
//
// 真机上客户端 require 的是平台 seed 模块（DSH web 壳自带、样式已由 Vite 打包），
// Node 里无法直接 import（其 lib 产物带 .module.css import），所以冒烟测试用这份
// 替身渲染组件树：结构语义与真件一致（Button/Pill/Tag/StateDot/Modal/Toast/Menu/
// 图标），只保留能被断言的部分（data-* 属性、role、文案），不带样式。
//
// Proxy 会记录“客户端读过的原子名”，冒烟测试据此校验：
//  - 读到的名字都真实存在（拼错即失败）；
//  - 与 DSH 检出里 ui-primitives 的导出清单对得上（存在检出时）。

/** 真件导出的原子名（本文件实现）。 */
export const ATOM_NAMES = ["Button", "Pill", "Tag", "StateDot", "Input", "Menu", "Modal", "Toast", "writeClipboard"];

/**
 * 真件导出的图标名（本文件实现为 data-icon 占位）。
 * 客户端同时兼容两代命名：`...16/14`（旧）与 `...Regular`（DSH 4937343a5e 起）。
 * 这份清单给的是新名字——替身只用新名字注册，从而验证客户端确实会回退到新名字。
 */
export const ICON_NAMES = [
  "IconCheckOutlineRegular", "IconChevronDownOutlineRegular", "IconChevronUpOutlineRegular",
  "IconCloseOutlineRegular", "IconCopyOutlineRegular", "IconDownloadOutlineRegular",
  "IconEditOutlineRegular", "IconEllipsisOutlineRegular", "IconLinkOutlineRegular",
  "IconPlusOutlineRegular", "IconRefreshOutlineRegular", "IconSearchOutlineRegular",
  "IconTrashOutlineRegular", "IconWarningOutlineRegular",
];

/** 旧一代图标名：仅用于断言"两代名字客户端都能接"。 */
export const ICON_NAMES_LEGACY = [
  "IconCheckOutline16", "IconChevronDownOutline14", "IconChevronUpOutline14", "IconCloseOutline16",
  "IconCopyOutline16", "IconDownloadOutline16", "IconEditOutline16", "IconEllipsisOutline16",
  "IconLinkOutline14", "IconPlusOutline16", "IconRefreshOutline16", "IconSearchOutline16",
  "IconTrashOutline16", "IconWarningOutline16",
];

/**
 * 造一份替身。
 * @param React react 模块（与客户端共用同一实例）。
 * @param {{ legacyIcons?: boolean }} [options] legacyIcons=true 时只导出旧一代图标名
 *   （`Icon*Outline16/14`），用来模拟改名前的 DSH 壳；默认只导出新一代
 *   （`Icon*OutlineRegular`），模拟当前壳。
 * @returns {{ primitives: object, misses: string[], reads: string[] }} 替身模块、未实现读取记录、读取过的原子名。
 */
export function createPrimitives(React, options = {}) {
  const h = React.createElement;
  const misses = [];
  const reads = [];
  const icons = options.legacyIcons === true ? ICON_NAMES_LEGACY : ICON_NAMES;

  function Button(props) {
    const { variant = "ghost", size = "md", icon, children, ...rest } = props;
    return h("button", { type: "button", ...rest, "data-variant": variant, "data-size": size },
      icon === undefined || icon === null ? null : h("span", { className: "stub-icon", key: "i" }, icon),
      children);
  }

  function Pill(props) {
    const { active, children, onClick, ...rest } = props;
    const klass = "stub-pill" + (active ? " is-active" : "");
    if (!onClick) return h("span", { ...rest, className: klass, "data-active": active === true ? "true" : undefined }, children);
    return h("button", { type: "button", ...rest, className: klass, "data-active": active === true ? "true" : undefined, onClick }, children);
  }

  function Tag(props) {
    const { tone = "outline", children, ...rest } = props;
    return h("span", { ...rest, className: "stub-tag", "data-tone": tone }, children);
  }

  function StateDot(props) {
    const { state, size = 10, className } = props;
    return h("span", { className: "stub-dot " + (className || ""), "data-state": state, "aria-hidden": "true", style: { width: size, height: size } });
  }

  function Input(props) {
    const { icon, className, ...rest } = props;
    return h("span", { className: "stub-input " + (className || "") },
      icon === undefined || icon === null ? null : h("span", { className: "stub-icon", key: "i" }, icon),
      h("input", { ...rest, key: "in" }));
  }

  function Menu(props) {
    const { open, anchor, items = [], onSelect, onClose } = props;
    const rows = [];
    for (const item of items) {
      if (item.type === "separator") { rows.push(h("div", { className: "stub-menu-sep", key: item.id })); continue; }
      if (item.type === "label") { rows.push(h("div", { className: "stub-menu-label", key: item.id }, item.text)); continue; }
      rows.push(h("button", {
        type: "button", key: item.id, className: "stub-menu-item", disabled: item.disabled === true,
        "data-danger": item.danger === true ? "true" : undefined,
        onClick: () => { onSelect(item.id); },
      }, h("span", { key: "i" }, item.icon || null), h("span", { key: "l" }, item.label)));
    }
    return h("span", { className: "stub-menu" }, [
      h("span", { className: "stub-menu-anchor", key: "anchor" }, anchor),
      open ? h("div", { className: "stub-menu-list", key: "list", role: "menu", onDoubleClick: onClose }, rows) : null,
    ]);
  }

  function Modal(props) {
    const { open, onClose, title, closeLabel, description, children, footer, className, contentClassName } = props;
    if (!open) return null;
    return h("div", { className: "stub-mask " + (className || ""), role: "presentation" }, [
      h("div", { className: "stub-masklayer", key: "m", "aria-hidden": "true", onClick: onClose }),
      h("div", { className: "stub-dialog", key: "d", role: "dialog", "aria-modal": "true", "aria-label": title }, [
        h("div", { className: "stub-dialog-body " + (contentClassName || ""), key: "b" }, [
          h("div", { className: "stub-dialog-head", key: "h" }, [
            h("h2", { key: "t" }, title),
            h("button", { type: "button", key: "c", "aria-label": closeLabel, onClick: onClose }, "✕"),
          ]),
          description === undefined || description === "" ? null : h("p", { key: "p" }, description),
          children === undefined ? null : h("div", { className: "stub-dialog-content", key: "ct" }, children),
        ]),
        footer === undefined ? null : h("div", { className: "stub-dialog-foot", key: "f" }, footer),
      ]),
    ]);
  }

  function Toast(props) {
    const { text, icon } = props;
    return h("div", { className: "stub-toast", role: "alert" }, [
      h("span", { className: "stub-toast-icon", key: "i" }, icon || null),
      h("span", { key: "t" }, text),
    ]);
  }

  /** 真件 @deepseek-ai/dsh-client-ui-primitives 的剪贴板助手替身。 */
  async function writeClipboard(text) {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    globalThis.__stubClipboard = text;
    return true;
  }

  const known = { Button, Pill, Tag, StateDot, Input, Menu, Modal, Toast, writeClipboard };
  for (const name of icons) {
    known[name] = function Icon(props) {
      return h("svg", {
        "data-icon": name, className: props.className,
        width: props.size || 16, height: props.size || 16, "aria-hidden": "true",
      });
    };
  }

  const primitives = new Proxy(known, {
    has: (target, prop) => typeof prop === "string" && prop in target,
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in target) {
        reads.push(prop);
        return target[prop];
      }
      // 真件缺键就是 undefined（不是"会渲染出东西的函数"）。这里如实返回 undefined，
      // 否则客户端的"试一个名字、没有再试另一个"回退链永远命中第一个，测不出真实行为。
      misses.push(prop);
      return undefined;
    },
  });

  return { primitives, misses, reads };
}
