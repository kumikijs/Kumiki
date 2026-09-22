// The rule both verification tiers ask before driving a control (#369), and the
// DOM reading it is asked about.
//
// The table is the point: a verb that drives a control must be refused on a
// disabled one, and the loop below is parameterised over `CONTROL_DEMANDS` so a
// verb added to it without a branch that asks the rule cannot pass this file.
// The verbs deliberately *outside* the table get their own cases — measured
// behaviour (Chromium fires `mouseenter` on a disabled control) is the reason
// they are outside, so an entry quietly added for one of them is a regression.

import { beforeEach, describe, expect, it } from "vitest";
import {
  CONTROL_DEMANDS,
  type ControlState,
  controlFault,
  readControl,
} from "../src/control-check.ts";

const ACTIVE: ControlState = {
  tag: "input",
  wrapped: false,
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

describe("a disabled control refuses every verb that drives one", () => {
  for (const verb of Object.keys(CONTROL_DEMANDS)) {
    it(verb, () => {
      const fault = controlFault(verb, `${verb} #x`, { ...ACTIVE, disabled: true });
      expect(fault).toBeDefined();
      expect(fault).toContain("<input> is disabled");
      // The message must carry the substring it tells the reader to assert on,
      // or the hint sends them to a step that cannot pass.
      expect(fault).toContain('{"expect": {"actionErrorIncludes": ["disabled"]}}');
    });
  }

  it("and says which demand it refused", () => {
    expect(controlFault("fill", "fill #x", { ...ACTIVE, disabled: true })).toContain(
      "so it takes no typing",
    );
    expect(controlFault("click", "click #x", { ...ACTIVE, disabled: true })).toContain(
      "so no user gesture reaches it",
    );
  });
});

describe("readonly and contenteditable=false refuse the typing alone", () => {
  it("fill is refused on a readonly control", () => {
    const fault = controlFault("fill", "fill #note", { ...ACTIVE, readonly: true });
    expect(fault).toContain("<input> is readonly, so it takes no typing");
    expect(fault).toContain('["readonly"]');
  });

  it("fill is refused on contenteditable=false, and says what renders it", () => {
    const fault = controlFault("fill", "fill #frozen", {
      ...ACTIVE,
      tag: "div",
      contentEditable: "false",
    });
    expect(fault).toContain("<div> is not editable");
    expect(fault).toContain("is what an `editable` renders when it is `disabled` or `readonly`");
    expect(fault).toContain('["not editable"]');
  });

  // Measured in Chromium: a readonly <input> is focusable and receives
  // `keydown`; a `contenteditable="false"` <div> receives `click`. Refusing
  // these would report a program broken that a browser runs.
  it.each([
    "click",
    "clickText",
    "choose",
    "focus",
    "blur",
    "key",
  ])("%s is allowed on a readonly control", (verb) => {
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
  // Chromium fires `mouseenter` on a disabled <input> and a disabled <button>,
  // so a `ui.hover` reducer on one runs. `submit` targets a form, and `dispatch`
  // and `navigate` drive a seam rather than the DOM.
  it.each([
    "hover",
    "submit",
    "dispatch",
    "navigate",
    "wait",
    "setProperty",
  ])("%s is not a control verb", (verb) => {
    expect(controlFault(verb, `${verb} #x`, { ...ACTIVE, disabled: true })).toBeUndefined();
  });

  it("a control in neither state is driven", () => {
    for (const verb of Object.keys(CONTROL_DEMANDS)) {
      expect(controlFault(verb, `${verb} #x`, ACTIVE)).toBeUndefined();
    }
  });

  it("a selector that resolved to no control at all", () => {
    expect(controlFault("fill", "fill #wrapper", null)).toBeUndefined();
  });
});

describe("readControl finds the control a verb would drive", () => {
  it("reads the state off a control the selector matched itself", () => {
    expect(readControl(el('<input id="a" disabled>'))).toEqual({
      tag: "input",
      wrapped: false,
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
    expect(state).toMatchObject({ tag: "input", wrapped: true, disabled: true });
    expect(controlFault("click", "click #a", state)).toContain(
      "the <input> inside the <label> it matched is disabled",
    );
  });

  // The narrow reading is the point: widening it to any ancestor would refuse a
  // click on a region because something disabled sits somewhere inside it.
  it("does not reach into a container that merely holds a control", () => {
    expect(readControl(el('<div id="a"><input disabled></div>'))).toBeNull();
  });

  it("a container with no control in it", () => {
    expect(readControl(el('<div id="a">text</div>'))).toBeNull();
  });

  it("an empty <label>", () => {
    expect(readControl(el('<label id="a">just text</label>'))).toBeNull();
  });
});
