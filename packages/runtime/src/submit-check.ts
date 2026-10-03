// What both verification tiers say about a `{submit}` step the form held back.
//
// A `form` calls its `ui.submit` reducer only while every field it binds passes
// validation (forms.md §5.2.2). A held-back submit leaves nothing behind — no
// error, no state change — so a step that dispatched it used to pass whether
// the reducer ran or not, and a fixture expecting a submit read green while
// the gate held it back. The form tile records which slots held the event back
// (`_submitHeldBy`, a mount seam); each tier reads that record for the submit
// it caused and hands it here, so the two report the same refusal in the same
// words — the shape `dispatchFault` has beside it.
//
// Pure: no DOM. The browser tier reads the record inside the page and passes
// the slot names across `page.evaluate`.

import { StepRefusal } from "./control-check.ts";

/** A `{submit}` step whose form held the submit back. */
export class SubmitRefusal extends StepRefusal {
  /** The slots whose fields held it back, in the order the form binds them. */
  readonly fields: readonly string[];

  constructor(headline: string, message: string, suggestion: string, fields: readonly string[]) {
    super(headline, message, suggestion);
    this.name = "SubmitRefusal";
    this.fields = fields;
  }
}

/**
 * Why this `{submit}` step drove no reducer, or `undefined` when the form did
 * not hold it back. `heldBy` is what the mount's `_submitHeldBy` seam answered
 * for the step's own submit event: the slots whose fields failed, or nothing.
 * The caller throws the refusal, which lands on `StepResult.actionError`, where
 * `actionErrorIncludes` can claim it.
 *
 * The message names the fields and the rule, not a cause: the gate judges what
 * a field shows (a refused value, unreadable text, or the slot's own value),
 * and which of those it was is the field's own `error(field=…)` to say.
 */
export function submitFault(
  where: string,
  heldBy: readonly string[] | null | undefined,
): SubmitRefusal | undefined {
  if (!heldBy || heldBy.length === 0) return undefined;
  const names = heldBy.join(", ");
  const suggestion =
    heldBy.length === 1
      ? `the field bound to ${names} fails its validation`
      : `the fields bound to ${names} fail their validation`;
  const headline = `${where}: the form held the submit back — ${suggestion}`;
  return new SubmitRefusal(
    headline,
    `${headline}, so no \`ui.submit\` reducer ran (forms.md §5.2.2) — a step that means to` +
      ` assert the refusal says {"expect": {"actionErrorIncludes": ["${suggestion}"]}}`,
    suggestion,
    heldBy,
  );
}
