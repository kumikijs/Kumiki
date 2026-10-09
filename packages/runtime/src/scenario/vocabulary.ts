/** The actions both tiers perform. Exactly one field names the action. */
type CommonAction =
  | { dispatch: string; payload?: Record<string, unknown> }
  | { clickText: string }
  | { click: string }
  | { focus: string }
  | { blur: string }
  | { fill: string; value: string }
  | { choose: string; value: string }
  | { navigate: string }
  /** Submit the form at, or above, the element the selector matches. */
  | { submit: string }
  /** Settle this many milliseconds longer than the step's own settle. */
  | { wait: number };

/** One thing a headless scenario step does to the app. */
export type Action =
  | CommonAction
  /** Press a key on the element the selector matches — what a `ui.key` reducer listens for. */
  | { key: string; value: string }
  /** Enter the element the selector matches — what a `ui.hover` reducer listens for. */
  | { hover: string };

/** One thing a browser-tier step does to the page. */
export type BrowserAction =
  | CommonAction
  | { setProperty: string; property: string; value: unknown };

type CommonExpect = {
  /** No runtime errors since the previous step. */
  noErrors?: boolean;
  actionErrorIncludes?: string[];
  /** Partial match against the slot state (slot name or dotted path → expected value). */
  state?: Record<string, unknown>;
  /** Substrings that must appear in the rendered text. */
  domIncludes?: string[];
  /** Substrings that must NOT appear in the rendered text. */
  domExcludes?: string[];
};

/** Assertions a headless step evaluates against the snapshot taken after it. */
export type Expect = CommonExpect & { errorIncludes?: string[] };

/** Assertions a browser-tier step evaluates against the live page. */
export type BrowserExpect = CommonExpect & {
  /** A CSS selector that must be the focused element. */
  focused?: string;
  /** Text that must be actually visible (computed style, not just present). */
  visible?: string[];
  /** Text that must NOT be visible. */
  hidden?: string[];
  /** Selectors whose element must carry a running animation. */
  animating?: string[];
  /** Selector → DOM property → expected value. */
  elementState?: Record<string, Record<string, unknown>>;
};

export type ScenarioStep<A = Action, E = Expect> = { label?: string; do?: A; expect?: E };

type ActionKind<A> = A extends unknown ? keyof A : never;

/** Fields that accompany an action kind rather than naming one. */
const ACTION_MODIFIERS = ["payload", "value", "property"] as const;

type Modifier = (typeof ACTION_MODIFIERS)[number];

export const HEADLESS_ACTION_KEYS = [
  "dispatch",
  "clickText",
  "click",
  "focus",
  "blur",
  "key",
  "hover",
  "fill",
  "choose",
  "navigate",
  "submit",
  "wait",
] as const satisfies readonly Exclude<ActionKind<Action>, Modifier>[];

export const BROWSER_ACTION_KEYS = [
  "dispatch",
  "clickText",
  "click",
  "focus",
  "blur",
  "fill",
  "choose",
  "navigate",
  "submit",
  "wait",
  "setProperty",
] as const satisfies readonly Exclude<ActionKind<BrowserAction>, Modifier>[];

export const HEADLESS_EXPECT_KEYS = [
  "noErrors",
  "errorIncludes",
  "actionErrorIncludes",
  "state",
  "domIncludes",
  "domExcludes",
] as const satisfies readonly (keyof Expect)[];

export const BROWSER_EXPECT_KEYS = [
  "noErrors",
  "actionErrorIncludes",
  "state",
  "domIncludes",
  "domExcludes",
  "focused",
  "visible",
  "hidden",
  "animating",
  "elementState",
] as const satisfies readonly (keyof BrowserExpect)[];

export type ScenarioTier = "headless" | "browser";

type TierRules = {
  noun: string;
  documentKeys: readonly string[];
  refusedDocumentKeys: Readonly<Record<string, string>>;
  actions: readonly string[];
  expects: readonly string[];
  /** Why a key the other tier owns is refused here: completes `"<key>" is …`. */
  foreignAction: string;
  foreignExpect: string;
};

const TO_E2E = "a browser-tier assertion; run this fixture with @kumikijs/e2e";

const TIERS: Record<ScenarioTier, TierRules> = {
  headless: {
    noun: "scenario",
    documentKeys: ["steps", "effects", "defaultEffect"],
    refusedDocumentKeys: {},
    actions: HEADLESS_ACTION_KEYS,
    expects: HEADLESS_EXPECT_KEYS,
    foreignAction: TO_E2E,
    foreignExpect: TO_E2E,
  },
  browser: {
    noun: "fixture",
    documentKeys: ["steps"],
    refusedDocumentKeys: {
      effects: '"effects" is not supported by the browser tier: it drives a real browser',
    },
    actions: BROWSER_ACTION_KEYS,
    expects: BROWSER_EXPECT_KEYS,
    foreignAction: "a scenario-tier action; run this fixture with kumiki run",
    foreignExpect: "a scenario-tier assertion; this tier treats every reported error as fatal",
  },
};

const OTHER_TIER: Record<ScenarioTier, ScenarioTier> = { headless: "browser", browser: "headless" };

const MAX_WAIT_MS = 60_000;

const isWaitable = (ms: unknown): boolean =>
  typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= MAX_WAIT_MS;

/** Every problem with a scenario document as `tier` would run it; empty when it is runnable. */
export function validateScenario(scenario: object, tier: ScenarioTier = "headless"): string[] {
  const rules = TIERS[tier];
  const other = TIERS[OTHER_TIER[tier]];
  const problems: string[] = [];
  for (const key of Object.keys(scenario)) {
    const refused = rules.refusedDocumentKeys[key];
    if (refused !== undefined) problems.push(refused);
    else if (!rules.documentKeys.includes(key)) {
      problems.push(`unknown scenario key "${key}" (${rules.documentKeys.join(", ")})`);
    }
  }
  const steps = (scenario as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) {
    problems.push(`a ${rules.noun} needs a "steps" array`);
    return problems;
  }
  if (steps.length === 0) problems.push(`a ${rules.noun} with no steps asserts nothing`);
  for (const [i, step] of (steps as (ScenarioStep<object, object> | undefined)[]).entries()) {
    if (!step) continue;
    const where = `steps[${i}]${step.label ? ` (${step.label})` : ""}`;
    if (step.do !== undefined) problems.push(...validateAction(step.do, where, rules, other));
    if (step.expect !== undefined) {
      problems.push(...validateExpect(step.expect, where, rules, other));
    }
  }
  return problems;
}

function foreignTo(rules: TierRules, other: TierRules, key: "actions" | "expects") {
  return (k: string): boolean => other[key].includes(k) && !rules[key].includes(k);
}

function validateAction(
  action: object,
  where: string,
  rules: TierRules,
  other: TierRules,
): string[] {
  const kinds = Object.keys(action).filter(
    (k) => !(ACTION_MODIFIERS as readonly string[]).includes(k),
  );
  const foreign = kinds.find(foreignTo(rules, other, "actions"));
  if (foreign !== undefined) return [`${where}: "${foreign}" is ${rules.foreignAction}`];
  const all = rules.actions.join(", ");
  const unknown = kinds.find((k) => !rules.actions.includes(k));
  if (unknown !== undefined) return [`${where}: unknown action "${unknown}" (${all})`];
  if (kinds.length === 0) return [`${where}: "do" names no action (${all})`];
  if (kinds.length > 1) {
    return [`${where}: "do" names ${kinds.join(" and ")}; a step does exactly one thing`];
  }
  const kind = kinds[0];
  const a = action as Record<string, unknown>;
  if ((kind === "fill" || kind === "choose") && typeof a.value !== "string") {
    return [`${where}: "${kind}" needs a string "value"`];
  }
  if (kind === "key" && (typeof a.value !== "string" || a.value.length === 0)) {
    return [`${where}: "key" needs a non-empty string "value" (the key to press)`];
  }
  if (kind === "setProperty" && typeof a.property !== "string") {
    return [`${where}: "setProperty" needs a "property" name`];
  }
  if (kind === "wait" && !isWaitable(a.wait)) {
    return [`${where}: "wait" needs a duration in milliseconds, 0 to ${MAX_WAIT_MS}`];
  }
  return [];
}

function validateExpect(
  expect: object,
  where: string,
  rules: TierRules,
  other: TierRules,
): string[] {
  const isForeign = foreignTo(rules, other, "expects");
  const problems: string[] = [];
  for (const key of Object.keys(expect)) {
    if (rules.expects.includes(key)) continue;
    problems.push(
      isForeign(key)
        ? `${where}: "${key}" is ${rules.foreignExpect}`
        : `${where}: unknown expect key "${key}" (${rules.expects.join(", ")})`,
    );
  }
  return problems;
}

export function describeAction(a: Action | BrowserAction): string {
  if ("dispatch" in a) return `dispatch ${a.dispatch}`;
  if ("clickText" in a) return `clickText "${a.clickText}"`;
  if ("click" in a) return `click ${a.click}`;
  if ("focus" in a) return `focus ${a.focus}`;
  if ("blur" in a) return `blur ${a.blur}`;
  if ("key" in a) return `key ${a.key} "${a.value}"`;
  if ("hover" in a) return `hover ${a.hover}`;
  if ("fill" in a) return `fill ${a.fill}="${a.value}"`;
  if ("choose" in a) return `choose ${a.choose}="${a.value}"`;
  if ("submit" in a) return `submit ${a.submit}`;
  if ("wait" in a) return `wait ${a.wait}ms`;
  if ("setProperty" in a) {
    return `setProperty ${a.setProperty}.${a.property}=${JSON.stringify(a.value)}`;
  }
  if ("navigate" in a) return `navigate ${a.navigate}`;
  return unhandledAction(a);
}

export function unhandledAction(a: never): never {
  throw new Error(`unhandled action: ${JSON.stringify(a)}`);
}

/** What every tier reports for one step. */
export type StepOutcome = {
  label?: string;
  action?: string;
  ok: boolean;
  /** Errors reported during the step that no expectation claimed. */
  errors: string[];
  actionError?: string;
  expectedActionError?: string;
  state: Record<string, unknown>;
  failures: string[];
};
