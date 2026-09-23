// What every driver asks before driving a control.
//
// Every action verb but `{dispatch}` lands on an element, and the platform may
// refuse to drive that element: a `disabled` button takes no click, a
// `readonly` input takes no typing, and an `editable` that is either carries
// `contenteditable="false"` and takes none either. The scenario tier wrote the
// value and dispatched the event itself, so none of that entered the picture —
// the step moved the slot, ran the reducer, and passed, asserting behaviour the
// product cannot produce. That is the expensive direction: an app disables a
// field for a reason, the scenario types into it anyway, and the tier reports
// that the guard holds when nothing was tested.
//
// One rule rather than a branch per verb. What a verb asks of a control is
// `CONTROL_DEMANDS`; what a control refuses is `controlFault`; adding a verb is
// an entry in the first, not a new special case in the second. The table is
// total — a verb that asks nothing of a control says so as `"none"` rather than
// by being absent — so a new verb cannot inherit "asks nothing" by omission,
// which is the same silent default this module exists to remove.
//
// Pure, like `dispatch-check.ts` beside it. `readControl` is the single
// DOM-touching export, and it deliberately closes over nothing so the browser
// tier can hand it straight to `page.evaluate`. The *reading* is shared too,
// not just the rule, and so is `judgeRefusal` — which is what keeps the two
// step loops from drifting into different answers about the same fault.
//
// The claims below about what a browser does are measured in Chromium, or are
// a direct consequence of something measured. `packages/e2e/tests/disabled-
// controls.spec.ts` is that measurement kept as a test, and says of each case
// which of the two it is: `mouseenter` reaching a disabled control, `keydown`
// reaching a readonly one, `click` reaching a `contenteditable="false"` div and
// `focus()` doing nothing on a disabled input are observed directly; that a
// disabled control receives no keystroke is a consequence of its not being
// focusable, which is.
//
// One of those measurements is why this module cannot be replaced by trusting
// the browser. Chromium's own refusal sits in the user-input path: a real click
// at a disabled button's coordinates is dropped, but `dispatchEvent` at the
// same button is delivered to its listeners. Both drivers dispatch, so neither
// is on the path that refuses — which is why a `ui.click` reducer on a disabled
// button ran, and why the rule has to be asked here rather than waited for.

/**
 * What a verb asks of the control it targets. `"none"` is a verb that drives no
 * control — it is never refused, and saying so is an entry rather than an
 * absence.
 */
export type ControlDemand = "activation" | "typing" | "none";

/**
 * Every action verb, and what each asks of a control. Total on purpose: a verb
 * missing from it is a compile error at each tier (`_ControlVerbsTotal`), not a
 * verb that quietly asks nothing.
 *
 * `fill` is the only one that asks to type. `key` asks for activation alone: a
 * `readonly` <input> is focusable and does receive `keydown`, so a `ui.key`
 * reducer on one fires in a browser and refusing the step would report a
 * program broken that works.
 *
 * The `"none"` rows each have their own reason, and `hover` is the one worth
 * measuring rather than reasoning about: Chromium fires `mouseenter` on a
 * `disabled` <input> and on a `disabled` <button>, so a `ui.hover` reducer on a
 * disabled control runs and this rule must not invent a refusal the platform
 * does not have. `submit` targets a form rather than a control — its selector
 * may name any field inside one — and a form is not something `disabled`
 * applies to. `dispatch` and `navigate` drive a seam, `wait` drives nothing,
 * and `setProperty` (browser tier) seeds a DOM property rather than acting as a
 * user.
 */
export const CONTROL_DEMANDS = {
  click: "activation",
  clickText: "activation",
  choose: "activation",
  focus: "activation",
  blur: "activation",
  key: "activation",
  fill: "typing",
  hover: "none",
  submit: "none",
  dispatch: "none",
  navigate: "none",
  wait: "none",
  setProperty: "none",
} as const satisfies Record<string, ControlDemand>;

/** A verb the table answers for — every action kind, at either tier. */
export type ControlVerb = keyof typeof CONTROL_DEMANDS;

/**
 * Why a control was refused. A closed set, and the one a fixture names through
 * `expect.actionErrorIncludes`.
 */
export type ControlRefusalReason = "disabled" | "readonly" | "not editable";

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
 * A step turned away because the platform would not deliver the gesture — as
 * opposed to a step that could not resolve its target at all. Its own class,
 * not a plain `Error`, because that difference is the whole of what
 * `actionErrorIncludes` may claim: both land on `actionError`, and a substring
 * match alone cannot tell "the button is disabled" from "no element matching
 * selector #save-disabled", which also contains `disabled`.
 */
export class ControlRefusal extends Error {
  /** Which state refused, out of a closed set. */
  readonly reason: ControlRefusalReason;
  /**
   * The part a fixture matches on: `click #off: <button> is disabled, so no
   * user gesture reaches it`. The explanation and the hint that follow it in
   * `message` are prose, and keeping them out of the matched surface is what
   * stops `["disabled"]` and `["readonly"]` from both matching the one message
   * an `editable` produces — which names them to explain what renders
   * `contenteditable="false"`.
   */
  readonly headline: string;
  /** What the fixture should write to assert this refusal, quoted in `message`. */
  readonly suggestion: string;

  constructor(headline: string, message: string, reason: ControlRefusalReason, suggestion: string) {
    super(message);
    this.name = "ControlRefusal";
    this.headline = headline;
    this.reason = reason;
    this.suggestion = suggestion;
  }
}

/** The refusal, without its prose — the rule a driver that skips rather than reports asks. */
function refusalOf(
  verb: ControlVerb,
  control: ControlState | null,
): { reason: ControlRefusalReason; demand: ControlDemand } | undefined {
  const demand = CONTROL_DEMANDS[verb];
  if (demand === "none" || control === null) return undefined;
  // `disabled` refuses both demands, so it is asked first and for every verb
  // that asks anything. Measured: Chromium delivers no click to a disabled
  // <button> even when one is dispatched at it, none to the <label> of a
  // disabled checkbox, and `focus()` on a disabled <input> moves nothing and
  // reports nothing — the silent pass this rule ends exists at that tier too.
  if (control.disabled) return { reason: "disabled", demand };
  // Everything below takes a gesture and refuses only the typing.
  if (demand !== "typing") return undefined;
  if (control.readonly) return { reason: "readonly", demand };
  if (control.contentEditable === "false") return { reason: "not editable", demand };
  return undefined;
}

/**
 * Whether the platform would refuse `verb` on this control. The rule without
 * its message, for `kumiki smoke` — which exercises every control it finds and
 * wants to skip the ones a user could not reach, rather than report them.
 */
export function refusesControl(verb: ControlVerb, control: ControlState | null): boolean {
  return refusalOf(verb, control) !== undefined;
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
  verb: ControlVerb,
  where: string,
  control: ControlState | null,
): ControlRefusal | undefined {
  const found = refusalOf(verb, control);
  if (!found || control === null) return undefined;
  const { reason, demand } = found;

  const what = control.wrapped
    ? `the <${control.tag}> inside the <label> it matched`
    : `<${control.tag}>`;
  const headline = `${where}: ${what} is ${reason}, ${CONSEQUENCE[demand]}`;
  // The suggestion is part of the contract, not decoration: a refusal is often
  // the behaviour a fixture means to assert, and the message is where an agent
  // reads how to write it. It names the control, not the bare reason — the
  // bare word is the spelling most likely to also match "no element matching
  // selector #save-disabled", and a hint that teaches a fragile assertion is
  // worse than none.
  const suggestion = `${what} is ${reason}`;
  const explanation = EXPLANATION[reason];
  return new ControlRefusal(
    headline,
    `${headline}${explanation ? ` (${explanation})` : ""} — a step that means to` +
      ` assert the refusal says {"expect": {"actionErrorIncludes": ["${suggestion}"]}}`,
    reason,
    suggestion,
  );
}

/**
 * A `Record` rather than a ternary, so a demand added to `ControlDemand` cannot
 * silently inherit the activation wording.
 */
const CONSEQUENCE: Record<ControlDemand, string> = {
  typing: "so it takes no typing",
  activation: "so no user gesture reaches it",
  // Unreachable: `refusalOf` returns nothing for a verb that asks nothing.
  none: "so nothing is asked of it",
};

/** Prose kept out of `headline`, for the reason `ControlRefusal.headline` gives. */
const EXPLANATION: Record<ControlRefusalReason, string> = {
  disabled: "",
  readonly: "",
  "not editable":
    '`contenteditable="false"` is what an `editable` renders when it is disabled or read-only',
};

/** What a step's action raised, as the claim below needs to see it. */
export type StepFault = {
  /** The message that lands on `actionError`. */
  message: string;
  /**
   * The refusal, when the platform turned the step away — absent when the step
   * could not resolve its target at all, which is a different thing and must
   * not be claimable as a refusal.
   */
  refusal?: ControlRefusal | undefined;
};

/** What a step's `actionErrorIncludes` did with the fault its action raised. */
export type RefusalVerdict = {
  /**
   * The action error the step claimed. Present only when every substring it
   * asked for appears in a real refusal; the caller moves it to
   * `expectedActionError`, off the channel that fails the step.
   */
  claimed?: string;
  /** One per substring the fault did not satisfy. Empty when it did, or when none was asked. */
  failures: string[];
};

/**
 * Whether this step's `actionErrorIncludes` is met, and by what.
 *
 * Lifted here rather than written at each tier because both step loops need the
 * same answer and had drifted into two shapes of it. `StepResult.ok`'s own doc
 * records that every copy of a verdict is a place a new channel can be
 * forgotten, and that it already happened once when `actionError` was added.
 *
 * Three answers, and the middle one is the point:
 *
 * - the action ran → every substring fails, since the assertion is that the
 *   platform turned the step away;
 * - the action failed for some *other* reason → every substring fails, loudly
 *   and naming that reason. A bare substring match would have let
 *   `{"click": "#save-disabled"}` with `["disabled"]` pass on `no element
 *   matching selector #save-disabled`, reporting a refusal that never
 *   happened — the same "passed having tested nothing" this module exists to
 *   kill, re-entered through the assertion instead of the action;
 *   a refusal → matched against its `headline`, so the prose explaining one
 *   reason cannot satisfy an assertion naming another.
 */
export function judgeRefusal(
  wanted: readonly string[],
  fault: StepFault | undefined,
): RefusalVerdict {
  if (wanted.length === 0) return { failures: [] };
  if (fault === undefined) {
    return {
      failures: wanted.map((w) => `expected the action to be refused for "${w}", but it ran`),
    };
  }
  if (fault.refusal === undefined) {
    return {
      failures: wanted.map(
        (w) =>
          `expected the action to be refused for "${w}", but it failed to resolve: ${fault.message}`,
      ),
    };
  }
  const headline = fault.refusal.headline;
  const missed = wanted.filter((w) => !headline.includes(w));
  if (missed.length > 0) {
    return {
      failures: missed.map((w) => `expected the refusal to include "${w}" but got: ${headline}`),
    };
  }
  return { claimed: fault.message, failures: [] };
}
