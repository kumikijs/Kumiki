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
