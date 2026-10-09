// Which option a `{choose}` step takes — one rule for both scenario tiers.
//
// An option carries two strings a step could mean: the label a user reads and
// the value the form holds. The label is asked first, across every option, and
// the value only when no option carries that label. The label is what a
// fixture usually names: the `select` tile writes each value into its <option>
// as JSON, so a value is matched in that form (`"b"`, quotes included, for the
// Text `b`), and one spelled like another option's label must not take the
// step somewhere a user reading the list would not go.
//
// `chooseOption` closes over nothing, as `readControl` does: the browser tier
// hands it to `page.evaluate` and gives Playwright's `selectOption` the index it
// returns, and the scenario tier, which drives the select itself, asks it to
// take the option as well. One function rather than a reader and a driver, so
// the <select> a step lands on is found by one rule at both tiers.

/** What a `{choose}` step found: the option it takes, or why it takes none. */
export type Choice =
  /** The option, by its index in the select's `options`. */
  | { index: number }
  /** The caller throws it, which lands on `actionError`. */
  | { fault: string };

/**
 * The option `step.value` names in the <select> `el` leads to — `el` itself,
 * or the control of the <label> it sits in, as Playwright's `selectOption`
 * follows one. With `step.take`, the option is also selected and `change`
 * dispatched, which is how the scenario tier drives a select.
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
  // An option's label is its `label` attribute, or else its text: what
  // `option.label` reads, spelled out because happy-dom does not implement it.
  // Whitespace is collapsed on both sides, so a label copied from source with a
  // run of spaces in it still finds the text a browser collapsed.
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
