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

const FROZEN: ControlState = { ...ACTIVE, tag: "div", contentEditable: "false" };

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

  it("the suggestion names the control, not the bare reason", () => {
    expect(
      controlFault("click", "click #off", { ...ACTIVE, tag: "button", disabled: true })?.suggestion,
    ).toBe("<button> is disabled");
  });
});

describe("the message a refusal carries", () => {
  it("opens with the headline and ends with the assertion to write", () => {
    const fault = controlFault("click", "click #off", { ...ACTIVE, tag: "button", disabled: true });
    expect(fault?.message).toBe(
      "click #off: <button> is disabled, so no user gesture reaches it — a step that means to" +
        ' assert the refusal says {"expect": {"actionErrorIncludes": ["<button> is disabled"]}}',
    );
    expect(fault?.name).toBe("ControlRefusal");
  });

  it("puts the explanation between the two, outside the headline", () => {
    const fault = controlFault("fill", "fill #e", FROZEN);
    expect(fault?.reason).toBe("not editable");
    expect(fault?.headline).toBe("fill #e: <div> is not editable, so it takes no typing");
    expect(fault?.message).toBe(
      "fill #e: <div> is not editable, so it takes no typing" +
        ' (`contenteditable="false"` is what an `editable` renders when it is disabled or' +
        " read-only) — a step that means to assert the refusal says" +
        ' {"expect": {"actionErrorIncludes": ["<div> is not editable"]}}',
    );
  });
});

describe("readonly and contenteditable=false refuse the typing alone", () => {
  it("fill is refused on a readonly control", () => {
    const fault = controlFault("fill", "fill #note", { ...ACTIVE, readonly: true });
    expect(fault?.reason).toBe("readonly");
    expect(fault?.headline).toContain("<input> is readonly, so it takes no typing");
  });

  it("the explanation of not-editable is not matchable as disabled or readonly", () => {
    const fault = controlFault("fill", "fill #frozen", FROZEN);
    expect(fault?.headline).not.toContain("disabled");
    expect(fault?.headline).not.toContain("read");
    expect(fault?.message).toContain("disabled");
  });

  it.each(DRIVES.filter((v) => v !== "fill"))("%s is allowed on a readonly control", (verb) => {
    expect(controlFault(verb, `${verb} #note`, { ...ACTIVE, readonly: true })).toBeUndefined();
  });

  it("click is allowed on contenteditable=false", () => {
    expect(controlFault("click", "click #frozen", FROZEN)).toBeUndefined();
  });
});

describe("the rule says nothing where the platform says nothing", () => {
  it.each(ASKS_NOTHING)("%s is not a control verb", (verb) => {
    expect(controlFault(verb, `${verb} #x`, { ...ACTIVE, disabled: true })).toBeUndefined();
    expect(CONTROL_DEMANDS[verb]).toBe("none");
  });

  it.each(DRIVES)("%s drives a control in neither state", (verb) => {
    expect(controlFault(verb, `${verb} #x`, ACTIVE)).toBeUndefined();
  });

  it("a selector that resolved to no control at all", () => {
    expect(controlFault("fill", "fill #wrapper", null)).toBeUndefined();
  });
});

describe("refusesControl answers the same question as controlFault", () => {
  const cases: ControlState[] = [
    ACTIVE,
    { ...ACTIVE, disabled: true },
    { ...ACTIVE, readonly: true },
    FROZEN,
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

  it("looks through the <label> wrapper check / radio / switch render", () => {
    const state = readControl(el('<label id="a"><input type="checkbox" disabled></label>'));
    expect(state).toMatchObject({ tag: "input", via: "label", disabled: true });
    expect(controlFault("click", "click #a", state)?.headline).toContain(
      "the <input> inside the <label> it matched is disabled",
    );
  });

  it.each([
    ["a container that merely holds a control", '<div id="a"><input disabled></div>'],
    ["a container with no control in it", '<div id="a">text</div>'],
    ["an empty <label>", '<label id="a">just text</label>'],
  ])("finds nothing in %s", (_what, html) => {
    expect(readControl(el(html))).toBeNull();
  });

  it("ascends to a disabled control the selector landed inside", () => {
    const state = readControl(
      el('<button id="b" disabled><span id="a">go</span></button>').querySelector("#a") as Element,
    );
    expect(state).toMatchObject({ tag: "button", via: "ancestor", disabled: true });
    expect(controlFault("click", "click #a", state)?.headline).toContain(
      "the <button> it matched inside is disabled",
    );
  });

  it("does not ascend to a control that is not disabled", () => {
    expect(
      readControl(
        el('<button id="b"><span id="a">go</span></button>').querySelector("#a") as Element,
      ),
    ).toBeNull();
  });
});

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

  it("refuses to let a non-refusal be claimed, and names what did happen", () => {
    const verdict = judgeRefusal(["disabled"], {
      message: "no element matching selector #save-disabled",
    });
    expect(verdict.claimed).toBeUndefined();
    expect(verdict.failures[0]).toContain("but it failed to resolve");
    expect(verdict.failures[0]).toContain("#save-disabled");
  });

  it("matches the headline, so one reason's prose cannot satisfy another", () => {
    const fault = controlFault("fill", "fill #frozen", FROZEN);
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
