import { StepRefusal } from "./control-check.ts";

/** A `{submit}` step whose form held the submit back. */
export class SubmitRefusal extends StepRefusal {
  /**
   * The slots whose fields held it back, in the order the form binds them.
   */
  readonly fields: readonly [string, ...string[]];

  constructor(headline: string, suggestion: string, fields: readonly [string, ...string[]]) {
    super(headline, ", so no `ui.submit` reducer ran", suggestion);
    this.name = "SubmitRefusal";
    this.fields = Object.freeze([...fields]) as readonly [string, ...string[]];
  }
}

const nonEmpty = <T>(xs: readonly T[] | null | undefined): xs is readonly [T, ...T[]] =>
  xs != null && xs.length > 0;

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

export type InvalidControl = {
  tag: string;
  /** The control's `type` (`"text"`, `"email"`, `"select-one"`, …). */
  type: string;
  id: string;
  name: string;
  /** The `ValidityState` flags that are set — `valueMissing`, `badInput`, … */
  failing: readonly string[];
};

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
