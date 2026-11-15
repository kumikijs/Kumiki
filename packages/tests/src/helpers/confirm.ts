import { RUNTIME_OVERLAY_SELECTORS } from "@kumikijs/runtime";

/** Every `confirm` dialog open in the document, oldest first. */
export const dialogs = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-kumiki-confirm]"));

/** Click the Yes or No button of `dialog`. */
export function answer(dialog: HTMLElement | undefined, outcome: "yes" | "no"): void {
  const btn = dialog?.querySelector<HTMLButtonElement>(
    `button[data-kumiki-confirm-action='${outcome}']`,
  );
  if (!btn) throw new Error(`no ${outcome} button on the confirm dialog`);
  btn.click();
}

/** Every runtime overlay in the document: the toasts, and any dialog no app has closed. */
export const overlays = (): Element[] =>
  Array.from(document.querySelectorAll(RUNTIME_OVERLAY_SELECTORS.join(", ")));

/** Take every runtime overlay out of the document, so the next test starts without one. */
export function removeOverlays(): void {
  for (const el of overlays()) el.remove();
}
