import type { EventHandler, TileProps } from "./types.ts";

type UiHandlerSlot = {
  onKeyDown?: EventHandler;
  onMouseEnter?: EventHandler;
  onFocus?: EventHandler;
  onBlur?: EventHandler;
  el?: Record<string, unknown>;
};

const UI_HANDLER_STATE = new WeakMap<HTMLElement, UiHandlerSlot>();

const UI_HANDLER_LISTENING = new WeakSet<HTMLElement>();

const slotHasHandler = (slot: UiHandlerSlot): boolean =>
  Boolean(slot.onKeyDown ?? slot.onMouseEnter ?? slot.onFocus ?? slot.onBlur);

function toUiHandlerSlot(props?: TileProps): UiHandlerSlot {
  const slot: UiHandlerSlot = {};
  if (!props) return slot;
  if (props.onKeyDown) slot.onKeyDown = props.onKeyDown;
  if (props.onMouseEnter) slot.onMouseEnter = props.onMouseEnter;
  if (props.onFocus) slot.onFocus = props.onFocus;
  if (props.onBlur) slot.onBlur = props.onBlur;
  if (props.el !== undefined) slot.el = props.el;
  return slot;
}

export function refreshUiHandlerSlot(el: HTMLElement, props?: TileProps): void {
  const slot = toUiHandlerSlot(props);
  UI_HANDLER_STATE.set(el, slot);
  if (slotHasHandler(slot)) installUiEventListeners(el);
}

export function applyUiEventHandlers(el: HTMLElement, props?: TileProps): void {
  if (!props) return;
  const slot = toUiHandlerSlot(props);
  if (!slotHasHandler(slot)) return;
  UI_HANDLER_STATE.set(el, slot);
  installUiEventListeners(el);
}

/** Register the four native listeners, once per element. */
function installUiEventListeners(el: HTMLElement): void {
  if (UI_HANDLER_LISTENING.has(el)) return;
  UI_HANDLER_LISTENING.add(el);
  el.addEventListener("keydown", (e) => {
    const state = UI_HANDLER_STATE.get(el);
    if (!state?.onKeyDown) return;
    const ke = e as KeyboardEvent;
    state.onKeyDown({ ...(state.el ?? {}), key: ke.key, code: ke.code });
  });
  el.addEventListener("mouseenter", () => {
    const state = UI_HANDLER_STATE.get(el);
    if (state?.onMouseEnter) state.onMouseEnter(state.el ?? {});
  });
  el.addEventListener("focus", () => {
    const state = UI_HANDLER_STATE.get(el);
    if (state?.onFocus) state.onFocus(state.el ?? {});
  });
  el.addEventListener("blur", () => {
    const state = UI_HANDLER_STATE.get(el);
    if (state?.onBlur) state.onBlur(state.el ?? {});
  });
}
