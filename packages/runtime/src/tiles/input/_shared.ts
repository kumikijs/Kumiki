import type {
  BindReader,
  BindSegment,
  EventHandler,
  MountedApp,
  TilePatcher,
  TileProps,
  TileRenderer,
} from "../../core.ts";
import {
  _setPathHelper,
  attrValue,
  bindLabel,
  noteBindWrite,
  resolveApp,
  warnUnresolvedEvent,
} from "../../core.ts";

/** The app owning the mount tree `el` sits in; warns once when there is none. */
export function liveApp(el: Element): MountedApp | undefined {
  const app = resolveApp(el);
  if (!app) warnUnresolvedEvent(el, "bind write-back");
  return app;
}

export function writeBind(
  app: MountedApp,
  el: HTMLElement,
  slotName: string,
  bindPath: BindSegment[] | undefined,
  value: unknown,
  parse?: BindReader,
): void {
  const read = parse?.read(String(value));
  const unread = read !== undefined && read._tag !== "Some" ? parse?.as : undefined;
  const written = read?._tag === "Some" ? read._0 : value;
  const next =
    bindPath && bindPath.length > 0
      ? _setPathHelper(app.live[slotName] ?? {}, bindPath, written)
      : written;
  const accepted = unread === undefined && app._setSlot(slotName, next, bindPath);
  if (!accepted && IME_COMPOSING.has(el)) {
    PENDING_REFUSAL.set(el, () => settleRefusal(app, el, slotName, written, bindPath, unread));
    return;
  }
  PENDING_REFUSAL.delete(el);
  if (accepted) noteBindWrite(app, el, slotName, written, true);
  else settleRefusal(app, el, slotName, written, bindPath, unread);
}

/** Remember a refused write against `el` and re-render so its message shows. */
function settleRefusal(
  app: MountedApp,
  el: HTMLElement,
  slotName: string,
  value: unknown,
  bindPath: BindSegment[] | undefined,
  unread: BindReader["as"] | undefined,
): void {
  noteBindWrite(app, el, slotName, value, false, bindPath, unread);
  app._rerender();
}

/** A refused write made mid-composition, settled on `compositionend`. */
const PENDING_REFUSAL = new WeakMap<HTMLElement, () => void>();

export function bindDataset(
  el: HTMLElement,
  bind: string,
  bindPath: BindSegment[] | undefined,
): void {
  el.dataset.kumikiBind = bindLabel(bind, bindPath);
}

/** Clear a bind marker set by a previous render whose new node dropped `bind`. */
export function clearBindDataset(el: HTMLElement): void {
  if (el.dataset.kumikiBind !== undefined) delete el.dataset.kumikiBind;
}

export function tileId(node: { id?: unknown; props?: unknown }): string | undefined {
  const fromProps = (node.props as { id?: unknown } | undefined)?.id;
  const raw = node.id ?? fromProps;
  return raw == null ? undefined : String(raw);
}

export function valueKey(v: unknown): string {
  if (v && typeof v === "object" && "_tag" in (v as Record<string, unknown>)) {
    const t = v as Record<string, unknown>;
    const parts: string[] = [String(t._tag)];
    for (let i = 0; `_${i}` in t; i++) parts.push(valueKey(t[`_${i}`]));
    return parts.join("|");
  }
  return JSON.stringify(v);
}

export type InputHandlers = {
  bind?: string;
  bindPath?: BindSegment[];
  onInput?: EventHandler;
  onChange?: EventHandler;
  onClick?: EventHandler;
  /** form-specific — the shared slot type so `form` does not need its own local intersection. */
  onSubmit?: EventHandler;
  el?: Record<string, unknown>;
  // Select-specific — decoded via valueKey lookup on `change`.
  selectOptions?: Array<{ label: unknown; value: unknown }>;
  parse?: BindReader;
};

export const INPUT_STATE = new WeakMap<HTMLElement, InputHandlers>();

export const IME_COMPOSING = new WeakSet<HTMLElement>();

export function installCompositionGuard(el: HTMLElement): void {
  el.addEventListener("compositionstart", () => {
    IME_COMPOSING.add(el);
  });
  el.addEventListener("compositionend", () => {
    IME_COMPOSING.delete(el);
    const settle = PENDING_REFUSAL.get(el);
    PENDING_REFUSAL.delete(el);
    settle?.();
  });
}

export function setHandlers(el: HTMLElement, next: InputHandlers): void {
  INPUT_STATE.set(el, next);
}

export function inputHandlers(node: {
  bind?: string;
  bindPath?: BindSegment[];
  props?: TileProps;
}): InputHandlers {
  const h: InputHandlers = {};
  if (node.bind !== undefined) h.bind = node.bind;
  if (node.bindPath !== undefined) h.bindPath = node.bindPath;
  if (node.props?.onInput) h.onInput = node.props.onInput;
  if (node.props?.onChange) h.onChange = node.props.onChange;
  if (node.props?.onClick) h.onClick = node.props.onClick;
  if (node.props?.el !== undefined) h.el = node.props.el;
  return h;
}

export function reconcileId(el: HTMLElement, node: { id?: unknown; props?: unknown }): void {
  const id = tileId(node);
  if (id) {
    if (el.id !== id) el.id = id;
  } else if (el.id) {
    el.removeAttribute("id");
  }
}

/** Update an input attribute only when it actually changed (avoids caret churn on happy-dom). */
export function setStringAttr(inp: HTMLElement, name: string, value: string | undefined): void {
  const current = inp.getAttribute(name);
  const next = value == null ? null : value;
  if (current === next) return;
  if (next === null) inp.removeAttribute(name);
  else inp.setAttribute(name, next);
}

export function applyControlState(el: HTMLElement, props?: TileProps): void {
  if (el.isContentEditable || el.getAttribute("contenteditable") !== null) {
    el.setAttribute(
      "contenteditable",
      props?.disabled === true || props?.readonly === true ? "false" : "true",
    );
  }
  if ("disabled" in el) {
    (el as HTMLElement & { disabled: boolean }).disabled = props?.disabled === true;
  }
  if ("readOnly" in el) {
    (el as HTMLElement & { readOnly: boolean }).readOnly = props?.readonly === true;
  }
  const auto = attrValue(props?.auto_complete);
  if (auto !== undefined) el.setAttribute("autocomplete", String(auto));
  else el.removeAttribute("autocomplete");
}

type ToggleKind = "check" | "switch";

/** A checkbox wrapped in a label: the `check` and `switch` tiles differ only in kind and role. */
export function toggleTile<K extends ToggleKind>(kind: K, role?: string): TileRenderer<K> {
  return (node) => {
    const wrap = document.createElement("label");
    wrap.dataset.kumikiTile = kind;
    if (role) wrap.setAttribute("role", role);
    const id = tileId(node);
    if (id) wrap.id = id;
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = node.checked;
    if (node.bind) bindDataset(inp, node.bind, node.bindPath);
    setHandlers(inp, inputHandlers(node));
    inp.addEventListener("change", () => {
      const state = INPUT_STATE.get(inp);
      if (state?.bind) {
        const app = liveApp(inp);
        if (app) writeBind(app, inp, state.bind, state.bindPath, inp.checked);
      }
      if (state?.onClick) state.onClick(state.el ?? {});
      if (state?.onChange) state.onChange({ ...(state.el ?? {}), checked: inp.checked });
    });
    wrap.appendChild(inp);
    applyControlState(inp, node.props);
    return wrap;
  };
}

export const patchToggle: TilePatcher<ToggleKind> = (el, _oldNode, newNode) => {
  reconcileId(el, newNode);
  const inp = el.firstElementChild as HTMLInputElement | null;
  if (inp) {
    if (inp.checked !== newNode.checked) inp.checked = newNode.checked;
    if (newNode.bind) bindDataset(inp, newNode.bind, newNode.bindPath);
    else clearBindDataset(inp);
    setHandlers(inp, inputHandlers(newNode));
  }
  applyControlState(el.querySelector("input") ?? el, newNode.props);
};
