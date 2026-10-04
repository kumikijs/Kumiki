// What both verification tiers say about a `{submit}` step whose submit drove
// no reducer.
//
// A `form` calls its `ui.submit` reducer only while every field it binds passes
// validation (forms.md §5.2.2). A held-back submit leaves nothing behind — no
// error, no state change — so a step that dispatched it used to pass whether
// the reducer ran or not, and a fixture expecting a submit read green while
// the gate held it back. The form tile writes which slots held the event back
// (`noteHeldSubmit`, in `core.ts`); each tier reads that record for the submit
// it caused through the mount's `_submitHeldBy` seam and hands it here, so the
// two report the same refusal in the same words — the shape `dispatchFault`
// has beside it.
//
// The browser tier has one more way to drive no reducer: `requestSubmit()`
// runs the browser's constraint validation first (`required`, `type="email"`,
// …), and a control that fails it stops the submit before any event fires, so
// the form tile never sees it and there is no record to read. That tier reads
// the controls instead (`readInvalidControls`) and asks `constraintFault`. The
// scenario tier dispatches the event itself, which skips constraint validation,
// so it never asks.
//
// The rules are pure: no DOM. The browser tier reads the record and the
// controls inside the page and passes plain data across `page.evaluate`.

import { StepRefusal } from "./control-check.ts";

/** A `{submit}` step whose form held the submit back. */
export class SubmitRefusal extends StepRefusal {
  /**
   * The slots whose fields held it back, in the order the form binds them — a
   * frozen copy, so the record it was read from cannot change it.
   */
  readonly fields: readonly [string, ...string[]];

  constructor(headline: string, suggestion: string, fields: readonly [string, ...string[]]) {
    super(headline, ", so no `ui.submit` reducer ran (forms.md §5.2.2)", suggestion);
    this.name = "SubmitRefusal";
    this.fields = Object.freeze([...fields]) as readonly [string, ...string[]];
  }
}

const nonEmpty = <T>(xs: readonly T[] | null | undefined): xs is readonly [T, ...T[]] =>
  xs != null && xs.length > 0;

/**
 * Why this `{submit}` step drove no reducer, or `undefined` when the form did
 * not hold it back. `heldBy` is what the mount's `_submitHeldBy` seam answered
 * for the step's own submit event: the slots whose fields failed, or nothing.
 * The caller throws the refusal, which lands on `StepResult.actionError`, where
 * `actionErrorIncludes` can claim it.
 *
 * The message names the fields and the rule, not a cause: the gate judges what
 * a field shows (a refused value, unreadable text, or the slot's own value),
 * and which of those it was is the field's own `error(field=…)` to say. Two or
 * more fields read in the plural, comma-separated in the order given:
 * `the fields bound to email, code fail their validation`.
 */
export function submitFault(
  where: string,
  heldBy: readonly string[] | null | undefined,
): SubmitRefusal | undefined {
  if (!nonEmpty(heldBy)) return undefined;
  const names = heldBy.join(", ");
  const suggestion =
    heldBy.length === 1
      ? `the field bound to ${names} fails its validation`
      : `the fields bound to ${names} fail their validation`;
  return new SubmitRefusal(
    `${where}: the form held the submit back — ${suggestion}`,
    suggestion,
    heldBy,
  );
}

/**
 * A control the browser's constraint validation finds invalid, as
 * `readInvalidControls` reads it: enough to name it, and the `ValidityState`
 * flags it fails.
 */
export type InvalidControl = {
  tag: string;
  /** The control's `type` (`"text"`, `"email"`, `"select-one"`, …). */
  type: string;
  id: string;
  name: string;
  /** The `ValidityState` flags that are set — `valueMissing`, `badInput`, … */
  failing: readonly string[];
};

/**
 * Every control in the form at or above `el` that fails a constraint, in
 * document order — empty when they all pass, or when there is no form.
 *
 * Read off `validity` rather than through `checkValidity()`, which fires
 * `invalid` events at the app. Closes over nothing, so the browser tier can
 * hand it to `page.evaluate` as it is, the way it hands over `readControl`.
 */
export function readInvalidControls(el: Element): InvalidControl[] {
  const form = el instanceof HTMLFormElement ? el : el.closest("form");
  if (!form) return [];
  const flags = [
    "valueMissing",
    "typeMismatch",
    "patternMismatch",
    "tooLong",
    "tooShort",
    "rangeUnderflow",
    "rangeOverflow",
    "stepMismatch",
    "badInput",
    "customError",
  ] as const;
  const out: InvalidControl[] = [];
  for (const c of Array.from(form.elements)) {
    if (
      !(c instanceof HTMLInputElement) &&
      !(c instanceof HTMLSelectElement) &&
      !(c instanceof HTMLTextAreaElement)
    ) {
      continue;
    }
    if (!c.willValidate || c.validity.valid) continue;
    out.push({
      tag: c.tagName.toLowerCase(),
      type: c.type,
      id: c.id,
      name: c.name,
      failing: flags.filter((f) => c.validity[f]),
    });
  }
  return out;
}

/** A `{submit}` step the browser's constraint validation stopped before the form saw it. */
export class ConstraintRefusal extends StepRefusal {
  constructor(headline: string, suggestion: string) {
    super(headline, ", so no submit event fired and no `ui.submit` reducer ran", suggestion);
    this.name = "ConstraintRefusal";
  }
}

/** `<input type=email id=who>`: the tag, an input's type, and its id or else its name. */
function describeControl(c: InvalidControl): string {
  const type = c.tag === "input" ? ` type=${c.type}` : "";
  const handle = c.id ? ` id=${c.id}` : c.name ? ` name=${c.name}` : "";
  return `<${c.tag}${type}${handle}>`;
}

/**
 * Why a `{submit}` step whose `requestSubmit()` fired no submit event drove no
 * reducer, or `undefined` when no control reports a failed constraint — in
 * which case the browser stopped the submit for some other reason, and this
 * rule does not claim to know it.
 *
 * Only the browser tier asks: the scenario tier dispatches the submit event
 * itself, which skips constraint validation, so the same form can submit there
 * and be stopped here. The message names each control and the flags it fails
 * (`<input type=email id=who> reports valueMissing`), which are the browser's
 * own `ValidityState` names rather than its localized `validationMessage`.
 */
export function constraintFault(
  where: string,
  invalid: readonly InvalidControl[],
): ConstraintRefusal | undefined {
  if (invalid.length === 0) return undefined;
  const suggestion = invalid
    .map((c) => `${describeControl(c)} reports ${c.failing.join(" and ")}`)
    .join(", ");
  return new ConstraintRefusal(
    `${where}: the browser's constraint validation stopped the submit before the form saw it — ${suggestion}`,
    suggestion,
  );
}
