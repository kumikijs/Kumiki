// What both verification tiers ask before driving a control.
//
// Every action verb but `{dispatch}` lands on an element, and the platform may
// refuse to drive that element: a `disabled` button takes no click, a
// `readonly` input takes no typing, and an `editable` that is either carries
// `contenteditable="false"` and takes none either. The scenario tier writes the
// value and dispatches the event itself, so none of that entered the picture —
// the step moved the slot, ran the reducer, and passed, asserting behaviour the
// product cannot produce. That is the expensive direction: an app disables a
// field for a reason, the scenario types into it anyway, and the tier reports
// that the guard holds when nothing was tested.
//
// One rule rather than a branch per verb. What a verb asks of a control is
// `CONTROL_DEMANDS`; what a control refuses is `controlFault`; adding a verb is
// an entry in the first, not a new special case in the second.
//
// Pure, like `dispatch-check.ts` beside it — `readControl` is the single
// DOM-touching export, and it deliberately closes over nothing so the browser
// tier can hand it straight to `page.evaluate`. The *reading* is shared too,
// not just the rule, which is one drift less than `dispatchFault` has: there
// each tier reads the two fields itself.
//
// Every claim below about what a browser does was measured in Chromium against
// a page carrying each state, not reasoned from the HTML spec — see
// `packages/e2e/tests/disabled-controls.spec.ts`, which is that measurement
// kept as a test.

/** What a verb asks of the control it targets. */
export type ControlDemand = "activation" | "typing";

/**
 * The verbs that drive a control, and what each asks of it. A verb absent from
 * this table asks nothing of one, and is never refused here.
 *
 * `fill` is the only one that asks to type. `key` asks for activation alone: a
 * `readonly` <input> is focusable and does receive `keydown`, so a `ui.key`
 * reducer on one fires in a browser and refusing the step would report a
 * program broken that works.
 *
 * `hover` is absent for the same reason, and it is the entry worth measuring
 * rather than reasoning about: Chromium fires `mouseenter` on a `disabled`
 * <input> and on a `disabled` <button>. A `ui.hover` reducer on a disabled
 * control runs, so this rule must not invent a refusal the platform does not
 * have.
 *
 * `submit` is absent because it targets a form rather than a control — the
 * selector may name any field inside one — and a form is not something
 * `disabled` applies to. `dispatch` and `navigate` drive a seam, not the DOM.
 */
export const CONTROL_DEMANDS = {
  click: "activation",
  clickText: "activation",
  choose: "activation",
  focus: "activation",
  blur: "activation",
  key: "activation",
  fill: "typing",
} as const satisfies Record<string, ControlDemand>;

/**
 * The control a step's selector resolved to, read off the DOM. Plain fields, so
 * the rule can be asked on either side of `page.evaluate` — the same reason
 * `DispatchTarget` carries two strings rather than a `ReducerSpec`.
 */
export type ControlState = {
  /** The lowercased tag of the control being judged. */
  tag: string;
  /**
   * True when the selector matched a wrapper and the control judged is the one
   * inside it. `check` / `radio` / `switch` put the tile's id on a <label> and
   * the state on the <input> under it, so a step aimed at the tile lands on the
   * wrapper — and a browser judges the control, not the label.
   */
  wrapped: boolean;
  disabled: boolean;
  readonly: boolean;
  /** The `contenteditable` attribute, verbatim, or `null` when it carries none. */
  contentEditable: string | null;
};

/**
 * The control `el` would drive, or `null` when it drives none — a container, a
 * text node's parent, a plain <div>. `null` is not a pass or a fail: it means
 * this rule has nothing to say, and whatever check the verb already had still
 * runs (a `fill` aimed at a <div> still reports that it holds no text).
 *
 * Closes over nothing on purpose: the browser tier passes this function itself
 * into `page.evaluate`, which serialises its source, so a module-level constant
 * referenced here would be `undefined` in the page.
 */
export function readControl(el: Element): ControlState | null {
  const CONTROLS = "input, textarea, select, button";
  const isControl = (e: Element): boolean =>
    e.matches(CONTROLS) || e.getAttribute("contenteditable") !== null;

  let target = el;
  let wrapped = false;
  if (!isControl(el)) {
    // Only a <label>, never any container that happens to hold a control.
    // `root.querySelector("input")` from an arbitrary ancestor would let a
    // `click` on a region be refused because something disabled sits inside it,
    // which is a refusal the platform does not make.
    if (el.tagName.toLowerCase() !== "label") return null;
    const inner = (el as HTMLLabelElement).control ?? el.querySelector(CONTROLS);
    if (!inner) return null;
    target = inner;
    wrapped = true;
  }

  const c = target as Element & { disabled?: unknown; readOnly?: unknown };
  return {
    tag: target.tagName.toLowerCase(),
    wrapped,
    // Both readings, because they answer slightly different questions and
    // Kumiki may one day ask the second: the IDL property reflects the content
    // attribute, while `:disabled` also matches a control inside a disabled
    // <fieldset>. No tile renders a real <fieldset> today — the `fieldset` tile
    // is a <div> — so the property alone would do; the selector costs nothing
    // and both DOMs answer it.
    disabled: c.disabled === true || target.matches(":disabled"),
    readonly: c.readOnly === true,
    contentEditable: target.getAttribute("contenteditable"),
  };
}

/**
 * Why this step would drive a control the platform refuses, or `undefined` when
 * it will run. The caller throws it, which lands on `StepResult.actionError` —
 * the same channel a selector matching nothing uses, and out of `errorIncludes`'
 * reach, because nothing was observed about the app.
 *
 * `where` is the step as the trace describes it (`click #save`), so the message
 * reads the same whether the verb took a selector or, as `clickText` does, a
 * piece of text.
 */
export function controlFault(
  verb: string,
  where: string,
  control: ControlState | null,
): string | undefined {
  const demand = (CONTROL_DEMANDS as Record<string, ControlDemand | undefined>)[verb];
  if (demand === undefined || control === null) return undefined;

  const what = control.wrapped
    ? `the <${control.tag}> inside the <label> it matched`
    : `<${control.tag}>`;

  // `disabled` refuses both demands, so it is asked first and for every verb in
  // the table. Measured: Chromium delivers no click to a disabled <button>, no
  // click to the <label> of a disabled checkbox, and `focus()` on a disabled
  // <input> moves nothing and reports nothing — the silent pass this rule is
  // here to end exists at that tier too.
  if (control.disabled) {
    return refusal(where, what, "disabled", consequence(demand));
  }
  // Everything below takes a gesture and refuses only the typing.
  if (demand !== "typing") return undefined;
  if (control.readonly) return refusal(where, what, "readonly", consequence(demand));
  if (control.contentEditable === "false") {
    return refusal(
      where,
      what,
      "not editable",
      'so it takes no typing (`contenteditable="false"` is what an `editable`' +
        " renders when it is `disabled` or `readonly`)",
    );
  }
  return undefined;
}

const consequence = (demand: ControlDemand): string =>
  demand === "typing" ? "so it takes no typing" : "so no user gesture reaches it";

/**
 * The hint is part of the contract, not decoration: a refusal is often the
 * behaviour a fixture means to assert ("this button is disabled while the save
 * is in flight, and clicking it does nothing"), and before
 * `expect.actionErrorIncludes` existed the only way to write that was a step
 * that passed for no reason. The message names the key, and the substring that
 * matches it, so an agent reading the trace can write the assertion without
 * looking anything up.
 */
function refusal(where: string, what: string, reason: string, tail: string): string {
  return (
    `${where}: ${what} is ${reason}, ${tail} — a step that means to assert the` +
    ` refusal says {"expect": {"actionErrorIncludes": ["${reason}"]}}`
  );
}
