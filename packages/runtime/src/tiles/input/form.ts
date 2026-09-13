// The `form` tile (#71): its own shipping unit, so an app that renders one
// does not download the nine other input controls.

import type {
  BindSegment,
  TileCtx,
  TileNode,
  TilePatcher,
  TileProps,
  TileRenderer,
} from "../../core.ts";
import type { InputHandlers } from "./_shared.ts";
import { INPUT_STATE, inputHandlers, reconcileId, setHandlers, tileId } from "./_shared.ts";

// form.onSubmit lives directly on props (not through a change-shaped event),
// so store it in the handler slot alongside the shared fields. Both `create`
// and `patch` route through this so the mounted `<form>`'s submit listener
// dispatches to the *current* render's onSubmit closure.
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
    if (state?.onSubmit) state.onSubmit(state.el ?? {});
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
