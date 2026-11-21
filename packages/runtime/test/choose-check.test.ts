import { beforeEach, describe, expect, it } from "vitest";
import { type Choice, chooseOption, OptionRefusal, refuseChoice } from "../src/choose-check.ts";
import { judgeRefusal } from "../src/control-check.ts";

/** Renders `html` and answers the element `#target` in it. */
const target = (html: string): Element => {
  document.body.innerHTML = html;
  const found = document.querySelector("#target");
  if (!found) throw new Error("fixture has no #target");
  return found;
};

const choose = (html: string, value: string): Choice =>
  chooseOption(target(html), { selector: "#target", value });

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("chooseOption names an option by its label first, then by its exact value", () => {
  it.each([
    [
      "a label, trimmed and with its whitespace collapsed on both sides",
      `<select id="target"><option value="1">x</option><option value="2">  Two
         words </option></select>`,
      " Two   words",
      { index: 1, value: "2", disabled: false },
    ],
    [
      "a `label` attribute over the option's text",
      `<select id="target"><option value="1" label="Short">Long text</option></select>`,
      "Short",
      { index: 0, value: "1", disabled: false },
    ],
    [
      "the text, when the `label` attribute is empty",
      `<select id="target"><option value="1" label="">Text</option></select>`,
      "Text",
      { index: 0, value: "1", disabled: false },
    ],
    [
      "a label ahead of another option's value",
      `<select id="target"><option value="b">Bee</option><option value="c">b</option></select>`,
      "b",
      { index: 1, value: "c", disabled: false },
    ],
    [
      "the exact value, when no option carries the label",
      `<select id="target"><option value="a">Ay</option><option value=" b">Bee</option></select>`,
      " b",
      { index: 1, value: " b", disabled: false },
    ],
    [
      "an option inside an <optgroup>, by its index among the select's options",
      `<select id="target"><option value="a">Ay</option>
         <optgroup label="G"><option value="b">Bee</option></optgroup></select>`,
      "Bee",
      { index: 1, value: "b", disabled: false },
    ],
    [
      "a disabled option, marked so",
      `<select id="target"><option value="" disabled>Pick one</option></select>`,
      "Pick one",
      { index: 0, value: "", disabled: true },
    ],
    [
      "an option inside a disabled <optgroup>, marked so",
      `<select id="target"><optgroup label="G" disabled><option value="b">Bee</option></optgroup>
         </select>`,
      "Bee",
      { index: 0, value: "b", disabled: true },
    ],
    [
      "an option of the select a matched <label> is for",
      `<label id="target" for="s">pick</label><select id="s"><option value="a">Ay</option></select>`,
      "Ay",
      { index: 0, value: "a", disabled: false },
    ],
  ])("takes %s", (_, html, value, choice) => {
    expect(choose(html, value)).toEqual(choice);
  });

  it.each([
    [
      "a value no option carries either way",
      `<select id="target"><option value="a">Ay</option></select>`,
      "Zed",
      'no option "Zed" in select #target',
    ],
    [
      "an element that is no select",
      `<div id="target">not a select</div>`,
      "Ay",
      "#target matched <div>, which holds no options to choose — choose targets a select",
    ],
    [
      "an element inside a <label>, which only a matched <label> itself is followed from",
      `<label for="s"><span id="target">pick</span></label>
         <select id="s"><option value="a">Ay</option></select>`,
      "Ay",
      "#target matched <span>, which holds no options to choose — choose targets a select",
    ],
    [
      "a <label> for a control that is no select",
      `<label id="target" for="i">name</label><input id="i">`,
      "Ay",
      "#target matched <label>, which holds no options to choose — choose targets a select",
    ],
  ])("answers a fault for %s", (_, html, value, fault) => {
    expect(choose(html, value)).toEqual({ fault });
  });

  it("reads the select and changes nothing", () => {
    const select = target(
      `<select id="target"><option value="a">Ay</option><option value="b">Bee</option></select>`,
    ) as HTMLSelectElement;
    const events: string[] = [];
    for (const kind of ["change", "input"]) select.addEventListener(kind, () => events.push(kind));
    expect(chooseOption(select, { selector: "#target", value: "Bee" })).toMatchObject({ index: 1 });
    expect(select.selectedIndex).toBe(0);
    expect(events).toEqual([]);
  });
});

describe("refuseChoice throws what the step fails with, the same at both tiers", () => {
  it("passes an option that is not disabled", () => {
    expect(() =>
      refuseChoice({ index: 0, value: "a", disabled: false }, "choose #pick", "Ay"),
    ).not.toThrow();
  });

  it("throws a fault as the step's error, in its own words", () => {
    const fault = 'no option "Zed" in select #pick';
    expect(() => refuseChoice({ fault }, "choose #pick", "Zed")).toThrow(new Error(fault));
  });

  it("refuses a disabled option, so actionErrorIncludes can claim it", () => {
    let thrown: unknown;
    try {
      refuseChoice({ index: 0, value: "", disabled: true }, 'choose #pick="Pick one"', "Pick one");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(OptionRefusal);
    const refusal = thrown as OptionRefusal;
    expect(refusal.headline).toBe(
      'choose #pick="Pick one": option "Pick one" is disabled, so no user gesture reaches it',
    );
    expect(refusal.suggestion).toBe('option "Pick one" is disabled');
    const verdict = judgeRefusal(["disabled"], { message: refusal.message, refusal });
    expect(verdict).toEqual({ claimed: refusal.message, failures: [] });
  });
});
