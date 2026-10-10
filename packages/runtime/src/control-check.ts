export type ControlDemand = "activation" | "typing" | "none";

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

/** A verb the table answers for: every action kind at either tier, which `scenario/vocabulary.ts` enforces. */
export type ControlVerb = keyof typeof CONTROL_DEMANDS;

export type ControlRefusalReason = "disabled" | "readonly" | "not editable";

export type ControlState = {
  /** The lowercased tag of the control being judged. */
  tag: string;
  via: "self" | "label" | "ancestor";
  disabled: boolean;
  readonly: boolean;
  /** The `contenteditable` attribute, verbatim, or `null` when it carries none. */
  contentEditable: string | null;
};

export function readControl(el: Element): ControlState | null {
  const CONTROLS = "input, textarea, select, button";
  const isControl = (e: Element): boolean =>
    e.matches(CONTROLS) || e.getAttribute("contenteditable") !== null;

  let target = el;
  let via: "self" | "label" | "ancestor" = "self";
  if (!isControl(el)) {
    const inner =
      el.tagName.toLowerCase() === "label"
        ? ((el as HTMLLabelElement).control ?? el.querySelector(CONTROLS))
        : null;
    if (inner) {
      target = inner;
      via = "label";
    } else {
      const owner = el.closest(":disabled");
      if (!owner) return null;
      target = owner;
      via = "ancestor";
    }
  }

  const c = target as Element & { disabled?: unknown; readOnly?: unknown };
  return {
    tag: target.tagName.toLowerCase(),
    via,
    disabled: c.disabled === true || target.matches(":disabled"),
    readonly: c.readOnly === true,
    contentEditable: target.getAttribute("contenteditable"),
  };
}

export abstract class StepRefusal extends Error {
  /** The part `actionErrorIncludes` matches; prose stays out so `["disabled"]` cannot match a message that only explains it. */
  readonly headline: string;
  /** What the fixture should write to assert this refusal, quoted in `message`. */
  readonly suggestion: string;

  protected constructor(headline: string, detail: string, suggestion: string) {
    super(
      `${headline}${detail} — a step that means to assert the refusal says` +
        ` {"expect": {"actionErrorIncludes": [${JSON.stringify(suggestion)}]}}`,
    );
    this.headline = headline;
    this.suggestion = suggestion;
  }
}

/** A step turned away because the platform would not deliver the gesture. */
export class ControlRefusal extends StepRefusal {
  /** Which state refused, out of a closed set. */
  readonly reason: ControlRefusalReason;

  constructor(headline: string, reason: ControlRefusalReason, suggestion: string) {
    const explanation = EXPLANATION[reason];
    super(headline, explanation ? ` (${explanation})` : "", suggestion);
    this.name = "ControlRefusal";
    this.reason = reason;
  }
}

/** The refusal, without its prose — the rule a driver that skips rather than reports asks. */
function refusalOf(
  verb: ControlVerb,
  control: ControlState | null,
): { reason: ControlRefusalReason; demand: ControlDemand } | undefined {
  const demand = CONTROL_DEMANDS[verb];
  if (demand === "none" || control === null) return undefined;
  if (control.disabled) return { reason: "disabled", demand };
  // Everything below takes a gesture and refuses only the typing.
  if (demand !== "typing") return undefined;
  if (control.readonly) return { reason: "readonly", demand };
  if (control.contentEditable === "false") return { reason: "not editable", demand };
  return undefined;
}

export function refusesControl(verb: ControlVerb, control: ControlState | null): boolean {
  return refusalOf(verb, control) !== undefined;
}

export function controlFault(
  verb: ControlVerb,
  where: string,
  control: ControlState | null,
): ControlRefusal | undefined {
  const found = refusalOf(verb, control);
  if (!found || control === null) return undefined;
  const { reason, demand } = found;

  const WHAT: Record<ControlState["via"], string> = {
    self: `<${control.tag}>`,
    label: `the <${control.tag}> inside the <label> it matched`,
    ancestor: `the <${control.tag}> it matched inside`,
  };
  const what = WHAT[control.via];
  const headline = `${where}: ${what} is ${reason}, ${CONSEQUENCE[demand]}`;
  const suggestion = `${what} is ${reason}`;
  return new ControlRefusal(headline, reason, suggestion);
}

const CONSEQUENCE: Record<ControlDemand, string> = {
  typing: "so it takes no typing",
  activation: "so no user gesture reaches it",
  // Unreachable: `refusalOf` returns nothing for a verb that asks nothing.
  none: "so nothing is asked of it",
};

/** Explanations appended after `headline`, outside the text a fixture matches on. */
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
  refusal?: StepRefusal | undefined;
};

/** What a step's `actionErrorIncludes` did with the fault its action raised. */
export type RefusalVerdict = {
  claimed?: string;
  /** One per substring the fault did not satisfy. Empty when it did, or when none was asked. */
  failures: string[];
};

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
