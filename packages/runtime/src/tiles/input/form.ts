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
import { refusedBindShown, resolveApp, shownSlotValue, slotAccepts } from "../../core.ts";
import type { InputHandlers } from "./_shared.ts";
import { INPUT_STATE, inputHandlers, reconcileId, setHandlers, tileId } from "./_shared.ts";

/**
 * Does every slot a control inside `form` binds pass its validation, judged on
 * what the controls show (forms.md §5.2.2)? The same judgement `error(field=…)`
 * makes — the slot's value, or a refused value a control in the form still
 * shows — so a form whose fields show a message does not submit, and one whose
 * fields show none does.
 *
 * "Inside the form" is the set of controls the form's own query finds, handed
 * over as the view rather than the form itself: happy-dom's `<form>` answers
 * `contains` false for its own descendants, which would quietly let every
 * refused value through the scenario and smoke tiers.
 */
function boundSlotsValid(form: HTMLFormElement): boolean {
  const app = resolveApp(form);
  if (!app) return true;
  const controls = new Set<Node>();
  const slots = new Set<string>();
  for (const el of form.querySelectorAll<HTMLElement>("[data-kumiki-bind]")) {
    const slot = INPUT_STATE.get(el)?.bind;
    if (!slot) continue;
    controls.add(el);
    slots.add(slot);
  }
  const inForm = { contains: (el: Node | null) => el !== null && controls.has(el) };
  for (const slot of slots) {
    // Text that reads as no value of the bound base shows its own message
    // (forms.md §5.1.2), whatever the slot still holds.
    if (refusedBindShown(app, slot, inForm)?.unread) return false;
    if (!slotAccepts(app.slots[slot], shownSlotValue(app, slot, inForm))) return false;
  }
  return true;
}

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
    if (state?.onSubmit && boundSlotsValid(form)) state.onSubmit(state.el ?? {});
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
