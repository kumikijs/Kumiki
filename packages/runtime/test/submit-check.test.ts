// The two rules a `{submit}` step is judged by once it has run, and the DOM
// reading the second is asked about. Each tier wires them in on its own —
// `packages/tests/form-submit-gate.test.ts` drives the scenario tier, and the
// e2e suite the browser tier — so what is pinned here is the wording a fixture
// matches and the shape of the refusal, at the granularity of
// `control-check.test.ts`.

import { beforeEach, describe, expect, it } from "vitest";
import { StepRefusal } from "../src/control-check.ts";
import {
  ConstraintRefusal,
  constraintFault,
  type InvalidControl,
  readInvalidControls,
  SubmitRefusal,
  submitFault,
} from "../src/submit-check.ts";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("submitFault", () => {
  it("says nothing when no form held the submit back", () => {
    expect(submitFault("submit #e", null)).toBeUndefined();
    expect(submitFault("submit #e", undefined)).toBeUndefined();
  });

  it("says nothing for an empty record, which holds nothing back", () => {
    expect(submitFault("submit #e", [])).toBeUndefined();
  });

  it("names the one field that held it back", () => {
    const fault = submitFault("submit #e", ["email"]);
    expect(fault).toBeInstanceOf(SubmitRefusal);
    expect(fault).toBeInstanceOf(StepRefusal);
    expect(fault?.name).toBe("SubmitRefusal");
    expect(fault?.suggestion).toBe("the field bound to email fails its validation");
    expect(fault?.headline).toBe(
      "submit #e: the form held the submit back — the field bound to email fails its validation",
    );
    expect(fault?.message).toBe(
      "submit #e: the form held the submit back — the field bound to email fails its validation," +
        " so no `ui.submit` reducer ran (forms.md §5.2.2) — a step that means to assert the" +
        ' refusal says {"expect": {"actionErrorIncludes": ["the field bound to email fails its' +
        ' validation"]}}',
    );
    expect(fault?.fields).toEqual(["email"]);
  });

  it("names every field, comma-separated in the order given, in the plural", () => {
    const fault = submitFault("submit #e", ["email", "code", "age"]);
    expect(fault?.suggestion).toBe("the fields bound to email, code, age fail their validation");
    expect(fault?.headline).toContain(fault?.suggestion ?? "");
    expect(fault?.message.startsWith(fault?.headline ?? "")).toBe(true);
    expect(fault?.fields).toEqual(["email", "code", "age"]);
  });

  // The record the form kept is handed in, so the refusal must not alias it.
  it("keeps its own frozen copy of the fields", () => {
    const record = ["email"];
    const fault = submitFault("submit #e", record);
    record.push("code");
    expect(fault?.fields).toEqual(["email"]);
    expect(Object.isFrozen(fault?.fields)).toBe(true);
  });
});

const control = (over: Partial<InvalidControl>): InvalidControl => ({
  tag: "input",
  type: "text",
  id: "",
  name: "",
  failing: ["valueMissing"],
  ...over,
});

describe("constraintFault", () => {
  it("says nothing when no control reports a failed constraint", () => {
    expect(constraintFault("submit #e", [])).toBeUndefined();
  });

  it("names the control and the constraint it fails", () => {
    const fault = constraintFault("submit #age", [
      control({ type: "number", id: "age", failing: ["badInput"] }),
    ]);
    expect(fault).toBeInstanceOf(ConstraintRefusal);
    expect(fault).toBeInstanceOf(StepRefusal);
    expect(fault?.name).toBe("ConstraintRefusal");
    expect(fault?.suggestion).toBe("<input type=number id=age> reports badInput");
    expect(fault?.headline).toBe(
      "submit #age: the browser's constraint validation stopped the submit before the form saw" +
        " it — <input type=number id=age> reports badInput",
    );
    expect(fault?.message).toBe(
      `${fault?.headline}, so no submit event fired and no \`ui.submit\` reducer ran — a step` +
        ' that means to assert the refusal says {"expect": {"actionErrorIncludes":' +
        ' ["<input type=number id=age> reports badInput"]}}',
    );
  });

  it("names every control, falling back to its name, and every constraint each fails", () => {
    const fault = constraintFault("submit form", [
      control({ id: "who" }),
      control({ type: "email", name: "mail", failing: ["typeMismatch", "tooShort"] }),
      control({ tag: "select", type: "select-one", id: "plan" }),
    ]);
    expect(fault?.suggestion).toBe(
      "<input type=text id=who> reports valueMissing," +
        " <input type=email name=mail> reports typeMismatch and tooShort," +
        " <select id=plan> reports valueMissing",
    );
    expect(fault?.message.startsWith(fault?.headline ?? "")).toBe(true);
  });
});

describe("readInvalidControls", () => {
  const formAt = (html: string): HTMLFormElement => {
    document.body.innerHTML = html;
    const form = document.querySelector("form");
    if (!form) throw new Error("fixture has no form");
    return form;
  };

  it("reads each control that fails a constraint, in document order", () => {
    formAt(
      `<form><input id="who" required><input id="ok" value="x" required>` +
        `<input type="email" name="mail" value="ada"><button>Send</button></form>`,
    );
    expect(readInvalidControls(document.querySelector("#who") as Element)).toEqual([
      { tag: "input", type: "text", id: "who", name: "", failing: ["valueMissing"] },
      { tag: "input", type: "email", id: "", name: "mail", failing: ["typeMismatch"] },
    ]);
  });

  it("is asked of the form or anything inside it, as the step's selector is", () => {
    const form = formAt(`<form><input id="who" required></form>`);
    expect(readInvalidControls(form)).toHaveLength(1);
  });

  it("reads nothing off a form whose controls all pass", () => {
    const form = formAt(`<form><input id="who" value="ada" required></form>`);
    expect(readInvalidControls(form)).toEqual([]);
  });

  it("reads nothing where there is no form", () => {
    expect(readInvalidControls(formAt(`<form></form>`).ownerDocument.body)).toEqual([]);
  });
});
