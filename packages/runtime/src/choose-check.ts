// Closes over nothing, so the browser tier can hand it to `page.evaluate`: both tiers then find
// the option a `{choose}` step takes by this one rule.

/** What a `{choose}` step found: the option it takes, by its index in `options`, or why none. */
export type Choice = { index: number } | { fault: string };

/**
 * The option `step.value` names in the <select> `el` leads to — `el` itself, or the control of
 * the <label> it sits in, as Playwright's `selectOption` follows one. With `step.take`, the option
 * is also selected and `change` dispatched.
 */
export function chooseOption(
  el: Element,
  step: { selector: string; value: string; take?: boolean },
): Choice {
  const select = el instanceof HTMLSelectElement ? el : el.closest("label")?.control;
  if (!(select instanceof HTMLSelectElement)) {
    return {
      fault:
        `${step.selector} matched <${el.tagName.toLowerCase()}>, which holds no options to choose — ` +
        "choose targets a select",
    };
  }
  // `option.label`, spelled out because happy-dom does not implement it.
  const norm = (s: string): string => s.trim().replace(/\s+/g, " ");
  const wanted = norm(step.value);
  const options = Array.from(select.options);
  const byLabel = options.findIndex(
    (o) => norm(o.getAttribute("label") || o.textContent || "") === wanted,
  );
  const index = byLabel !== -1 ? byLabel : options.findIndex((o) => o.value === step.value);
  if (index === -1) return { fault: `no option "${step.value}" in select ${step.selector}` };
  if (step.take) {
    select.selectedIndex = index;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return { index };
}
