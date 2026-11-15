import { StepRefusal } from "./control-check.ts";

// `chooseOption` closes over nothing, so the browser tier can hand it to `Locator.evaluate`: both
// tiers then find the option a `{choose}` step takes by this one rule.

/** The option a `{choose}` step found: its index in the select's `options`, and its value. */
export type ChosenOption = { index: number; value: string; disabled: boolean };

/** What a `{choose}` step found: an option, or why there is none. */
export type Choice = ChosenOption | { fault: string };

/**
 * The option `step.value` names in the <select> `el` leads to: `el` itself, or the control of
 * the <label> `el` is. It reads the DOM and changes nothing; each tier takes the option itself.
 */
export function chooseOption(el: Element, step: { selector: string; value: string }): Choice {
  const select = el instanceof HTMLLabelElement ? el.control : el;
  if (!(select instanceof HTMLSelectElement)) {
    return {
      fault:
        `${step.selector} matched <${el.tagName.toLowerCase()}>, which holds no options to choose — ` +
        "choose targets a select",
    };
  }
  const options = Array.from(select.options);
  // An option's label is a non-empty `label` attribute, else its text, read by hand since
  // happy-dom has no `option.label`. The arrows stay anonymous: a named one is wrapped in a
  // helper the page does not have once this function is serialized into it.
  const wanted = step.value.trim().replace(/\s+/g, " ");
  const byLabel = options.findIndex(
    (o) => (o.getAttribute("label") || o.textContent || "").trim().replace(/\s+/g, " ") === wanted,
  );
  const index = byLabel !== -1 ? byLabel : options.findIndex((o) => o.value === step.value);
  const option = options[index];
  if (option === undefined) {
    return { fault: `no option "${step.value}" in select ${step.selector}` };
  }
  // happy-dom's `:disabled` misses an option inside a disabled <optgroup>; Chromium's does not.
  const disabled = option.disabled || option.closest("optgroup[disabled]") !== null;
  return { index, value: option.value, disabled };
}

/** A `{choose}` step turned away because the option it names is disabled. */
export class OptionRefusal extends StepRefusal {
  constructor(where: string, value: string) {
    const suggestion = `option "${value}" is disabled`;
    super(`${where}: ${suggestion}, so no user gesture reaches it`, "", suggestion);
    this.name = "OptionRefusal";
  }
}

/**
 * Throws what a `{choose}` step fails with, the same at both tiers: its fault, or an
 * {@link OptionRefusal} for a disabled option.
 */
export function refuseChoice(
  choice: Choice,
  where: string,
  value: string,
): asserts choice is ChosenOption {
  if ("fault" in choice) throw new Error(choice.fault);
  if (choice.disabled) throw new OptionRefusal(where, value);
}
