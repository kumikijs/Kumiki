import type {
  BindSegment,
  TileCtx,
  TileNode,
  TilePatcher,
  TileProps,
  TileRenderer,
} from "../../core.ts";
import { judgeShownField, noteHeldSubmit, resolveApp } from "../../core.ts";
import type { InputHandlers } from "./_shared.ts";
import { INPUT_STATE, inputHandlers, reconcileId, setHandlers, tileId } from "./_shared.ts";

function failingBoundSlots(form: HTMLFormElement): string[] {
  const app = resolveApp(form);
  if (!app) return [];
  const controls = new Set<Node>();
  const slots = new Set<string>();
  for (const el of form.querySelectorAll<HTMLElement>("[data-kumiki-bind]")) {
    const slot = INPUT_STATE.get(el)?.bind;
    if (!slot) continue;
    controls.add(el);
    slots.add(slot);
  }
  const inForm = { contains: (el: Node | null) => el !== null && controls.has(el) };
  return [...slots].filter((slot) => !judgeShownField(app, slot, inForm).valid);
}

function formHandlers(node: {
  bind?: string;
  bindPath?: BindSegment[];
  props?: TileProps;
}): InputHandlers {
  const h: InputHandlers = inputHandlers(node);
  if (node.props?.onSubmit) h.onSubmit = node.props.onSubmit;
  return h;
}

export const formTile: TileRenderer<"form"> = (node, ctx: TileCtx) => {
  const form = document.createElement("form");
  form.dataset.kumikiTile = "form";
  const id = tileId(node);
  if (id) form.id = id;
  setHandlers(form, formHandlers(node));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const state = INPUT_STATE.get(form);
    if (!state?.onSubmit) return;
    const failing = failingBoundSlots(form);
    if (failing.length > 0) noteHeldSubmit(e, failing);
    else state.onSubmit(state.el ?? {});
  });
  for (const child of node.children as TileNode[]) {
    if (child != null) form.appendChild(ctx.render(child));
  }
  return form;
};

export const formPatcher: TilePatcher<"form"> = (el, _oldNode, newNode) => {
  const form = el as HTMLFormElement;
  reconcileId(form, newNode);
  setHandlers(form, formHandlers(newNode));
};
