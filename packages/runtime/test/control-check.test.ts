// The rule every driver asks before driving a control (#369), the DOM reading
// it is asked about, and the verdict a fixture's `actionErrorIncludes` gets.
//
// The lists below are written out by hand rather than derived from
// `CONTROL_DEMANDS`, which is the only way they guard anything: a loop over
// `Object.keys(CONTROL_DEMANDS)` asking `controlFault` reads the same table it
// is checking, so an entry added there generates a case that is green by
// construction and an entry *removed* takes its own case with it. Spelled out,
// deleting `blur: "activation"` fails here, and `COVERED` fails if a new verb
// is classified in neither list.
//
// What this file cannot guard is that `performAction` asks the rule at all —
// it never touches either tier. `_ControlVerbsTotal` in `scenario.ts` and
// `browser.ts` is what makes a new verb impossible to forget in the table, and
// the corpus fixture is what shows the table is consulted.

import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTROL_DEMANDS,
  ControlRefusal,
  type ControlState,
  type ControlVerb,
  controlFault,
  judgeRefusal,
  readControl,
  refusesControl,
} from "../src/control-check.ts";

/** Every verb that drives a control, and must be refused on a disabled one. */
const DRIVES: ControlVerb[] = ["click", "clickText", "choose", "focus", "blur", "key", "fill"];

/** Every verb that asks nothing of one, each for a reason of its own. */
const ASKS_NOTHING: ControlVerb[] = [
  // Measured: Chromium fires `mouseenter` on a disabled <input> and a disabled
  // <button>, so a `ui.hover` reducer on one runs.
  "hover",
  // Targets a form, not a control.
  "submit",
  // Drive a seam, or nothing at all.
  "dispatch",
  "navigate",
  "wait",
  // Browser tier: seeds a DOM property rather than acting as a user.
  "setProperty",
];

const ACTIVE: ControlState = {
  tag: "input",
  via: "self",
  disabled: false,
  readonly: false,
  contentEditable: null,
};

const el = (html: string): Element => {
  document.body.innerHTML = html;
  const found = document.body.firstElementChild;
  if (!found) throw new Error("fixture rendered nothing");
  return found;
};

beforeEach(() => {
  document.body.innerHTML = "";
});

it("the two lists above account for every verb in the table", () => {
  expect([...DRIVES, ...ASKS_NOTHING].sort()).toEqual(Object.keys(CONTROL_DEMANDS).sort());
});

describe("a disabled control refuses every verb that drives one", () => {
  for (const verb of DRIVES) {
    it(verb, () => {
      const fault = controlFault(verb, `${verb} #x`, { ...ACTIVE, disabled: true });
      expect(fault).toBeInstanceOf(ControlRefusal);
      expect(fault?.reason).toBe("disabled");
      expect(fault?.headline).toContain("<input> is disabled");
      // The message must carry the substring it tells the reader to assert on,
      // or the hint sends them to a step that cannot pass — and the substring
      // must be one the headline holds, since that is what is matched.
      expect(fault?.message).toContain(
        `{"expect": {"actionErrorIncludes": ["${fault?.suggestion}"]}}`,
      );
      expect(fault?.headline).toContain(fault?.suggestion ?? "");
    });
  }

  it("and says which demand it refused", () => {
    expect(controlFault("fill", "fill #x", { ...ACTIVE, disabled: true })?.headline).toContain(
      "so it takes no typing",
    );
    expect(controlFault("click", "click #x", { ...ACTIVE, disabled: true })?.headline).toContain(
      "so no user gesture reaches it",
    );
  });

  // The bare reason is the spelling most likely to also match "no element
  // matching selector #save-disabled", so the hint must not teach it.
  it("the suggestion names the control, not the bare reason", () => {
    expect(
      controlFault("click", "click #off", { ...ACTIVE, tag: "button", disabled: true })?.suggestion,
    ).toBe("<button> is disabled");
  });
});

describe("readonly and contenteditable=false refuse the typing alone", () => {
  it("fill is refused on a readonly control", () => {
    const fault = controlFault("fill", "fill #note", { ...ACTIVE, readonly: true });
    expect(fault?.reason).toBe("readonly");
    expect(fault?.headline).toContain("<input> is readonly, so it takes no typing");
  });

  it("fill is refused on contenteditable=false, and says what renders it", () => {
    const fault = controlFault("fill", "fill #frozen", {
      ...ACTIVE,
      tag: "div",
      contentEditable: "false",
    });
    expect(fault?.reason).toBe("not editable");
    expect(fault?.headline).toContain("<div> is not editable");
    expect(fault?.message).toContain(
      "is what an `editable` renders when it is disabled or read-only",
    );
  });

  // The explanation names the other two reasons, so it must stay out of the
  // surface a fixture matches — otherwise a fixture asserting the wrong reason
  // on an `editable` passes.
  it("the explanation of not-editable is not matchable as disabled or readonly", () => {
    const fault = controlFault("fill", "fill #frozen", {
      ...ACTIVE,
      tag: "div",
      contentEditable: "false",
    });
    expect(fault?.headline).not.toContain("disabled");
    expect(fault?.headline).not.toContain("read");
    expect(fault?.message).toContain("disabled");
  });

  // Measured in Chromium: a readonly <input> is focusable and receives
  // `keydown`; a `contenteditable="false"` <div> receives `click`. Refusing
  // these would report a program broken that a browser runs.
  it.each(DRIVES.filter((v) => v !== "fill"))("%s is allowed on a readonly control", (verb) => {
    expect(controlFault(verb, `${verb} #note`, { ...ACTIVE, readonly: true })).toBeUndefined();
  });

  it("click is allowed on contenteditable=false", () => {
    expect(
      controlFault("click", "click #frozen", {
        ...ACTIVE,
        tag: "div",
        contentEditable: "false",
      }),
    ).toBeUndefined();
  });
});

describe("the rule says nothing where the platform says nothing", () => {
  it.each(ASKS_NOTHING)("%s is not a control verb", (verb) => {
    expect(controlFault(verb, `${verb} #x`, { ...ACTIVE, disabled: true })).toBeUndefined();
    expect(CONTROL_DEMANDS[verb]).toBe("none");
  });

  it("a control in neither state is driven", () => {
    for (const verb of DRIVES) {
      expect(controlFault(verb, `${verb} #x`, ACTIVE)).toBeUndefined();
    }
  });

  it("a selector that resolved to no control at all", () => {
    expect(controlFault("fill", "fill #wrapper", null)).toBeUndefined();
  });
});

// `kumiki smoke` skips rather than reports, so it asks the rule without its
// prose. The two must agree, or one driver would fire at a control the other
// turns away.
describe("refusesControl answers the same question as controlFault", () => {
  const cases: ControlState[] = [
    ACTIVE,
    { ...ACTIVE, disabled: true },
    { ...ACTIVE, readonly: true },
    { ...ACTIVE, tag: "div", contentEditable: "false" },
  ];
  for (const verb of Object.keys(CONTROL_DEMANDS) as ControlVerb[]) {
    it(verb, () => {
      for (const control of cases) {
        expect(refusesControl(verb, control)).toBe(
          controlFault(verb, `${verb} #x`, control) !== undefined,
        );
      }
      expect(refusesControl(verb, null)).toBe(false);
    });
  }
});

describe("readControl finds the control a verb would drive", () => {
  it("reads the state off a control the selector matched itself", () => {
    expect(readControl(el('<input id="a" disabled>'))).toEqual({
      tag: "input",
      via: "self",
      disabled: true,
      readonly: false,
      contentEditable: null,
    });
    expect(readControl(el('<textarea id="a" readonly></textarea>'))).toMatchObject({
      tag: "textarea",
      disabled: false,
      readonly: true,
    });
    expect(readControl(el('<div id="a" contenteditable="false">x</div>'))).toMatchObject({
      tag: "div",
      contentEditable: "false",
    });
  });

  // `check` / `radio` / `switch` put the tile's id on a <label> and the state on
  // the <input> under it, so a step aimed at the tile lands on the wrapper.
  // Measured: Chromium refuses a click on the label of a disabled checkbox.
  it("looks through the <label> wrapper check / radio / switch render", () => {
    const state = readControl(el('<label id="a"><input type="checkbox" disabled></label>'));
    expect(state).toMatchObject({ tag: "input", via: "label", disabled: true });
    expect(controlFault("click", "click #a", state)?.headline).toContain(
      "the <input> inside the <label> it matched is disabled",
    );
  });

  // The narrow reading is the point: widening it to any ancestor would refuse a
  // click on a region because something disabled sits somewhere inside it.
  it("does not reach into a container that merely holds a control", () => {
    expect(readControl(el('<div id="a"><input disabled></div>'))).toBeNull();
  });

  // The other direction, and the one that is not symmetric with it. Measured:
  // a click dispatched at a <span> inside a disabled <button> reaches the
  // <button>'s listener, so `ui.click` on that button runs — the bug, one
  // element down from where the rule was looking.
  it("ascends to a disabled control the selector landed inside", () => {
    const state = readControl(
      el('<button id="b" disabled><span id="a">go</span></button>').querySelector("#a") as Element,
    );
    expect(state).toMatchObject({ tag: "button", via: "ancestor", disabled: true });
    expect(controlFault("click", "click #a", state)?.headline).toContain(
      "the <button> it matched inside is disabled",
    );
  });

  // The ascent stops at `:disabled` rather than at any control, so a selector
  // inside a live control is still nothing this rule speaks about.
  it("does not ascend to a control that is not disabled", () => {
    expect(
      readControl(
        el('<button id="b"><span id="a">go</span></button>').querySelector("#a") as Element,
      ),
    ).toBeNull();
  });

  it("a container with no control in it", () => {
    expect(readControl(el('<div id="a">text</div>'))).toBeNull();
  });

  it("an empty <label>", () => {
    expect(readControl(el('<label id="a">just text</label>'))).toBeNull();
  });
});

// The half that decides whether a fixture asserting a refusal is worth
// anything. `actionError` is a shared channel — a selector matching nothing, an
// unknown reducer, a `fill` on an element that holds no text, and now a
// refusal — so a bare substring match over it would let a step claim a refusal
// that never happened.
describe("judgeRefusal", () => {
  const refusal = (): ControlRefusal => {
    const fault = controlFault("click", "click #off", {
      ...ACTIVE,
      tag: "button",
      disabled: true,
    });
    if (!fault) throw new Error("expected a refusal");
    return fault;
  };

  it("claims a refusal every substring matches", () => {
    const r = refusal();
    const verdict = judgeRefusal(["<button> is disabled"], { message: r.message, refusal: r });
    expect(verdict.failures).toEqual([]);
    expect(verdict.claimed).toBe(r.message);
  });

  it("says nothing when the step asked for nothing", () => {
    const r = refusal();
    expect(judgeRefusal([], { message: r.message, refusal: r })).toEqual({ failures: [] });
    expect(judgeRefusal([], undefined)).toEqual({ failures: [] });
  });

  it("fails a step that asked to be refused and ran", () => {
    const verdict = judgeRefusal(["<button> is disabled"], undefined);
    expect(verdict.claimed).toBeUndefined();
    expect(verdict.failures[0]).toContain("but it ran");
  });

  // The blocking case: `no element matching selector #save-disabled` contains
  // `disabled`, and used to be claimed as a refusal — a step reporting that the
  // platform turned it away when nothing of the sort happened.
  it("refuses to let a non-refusal be claimed, and names what did happen", () => {
    const verdict = judgeRefusal(["disabled"], {
      message: "no element matching selector #save-disabled",
    });
    expect(verdict.claimed).toBeUndefined();
    expect(verdict.failures[0]).toContain("but it failed to resolve");
    expect(verdict.failures[0]).toContain("#save-disabled");
  });

  it("matches the headline, so one reason's prose cannot satisfy another", () => {
    const fault = controlFault("fill", "fill #frozen", {
      ...ACTIVE,
      tag: "div",
      contentEditable: "false",
    });
    if (!fault) throw new Error("expected a refusal");
    const arg = { message: fault.message, refusal: fault };
    expect(judgeRefusal(["<div> is not editable"], arg).claimed).toBe(fault.message);
    for (const wrong of ["disabled", "readonly"]) {
      const verdict = judgeRefusal([wrong], arg);
      expect(verdict.claimed).toBeUndefined();
      expect(verdict.failures[0]).toContain("expected the refusal to include");
    }
  });

  it("every substring must match, not just one", () => {
    const r = refusal();
    const verdict = judgeRefusal(["<button> is disabled", "no user gesture"], {
      message: r.message,
      refusal: r,
    });
    expect(verdict.claimed).toBe(r.message);
    expect(
      judgeRefusal(["<button> is disabled", "typing"], { message: r.message, refusal: r }).claimed,
    ).toBeUndefined();
  });
});
