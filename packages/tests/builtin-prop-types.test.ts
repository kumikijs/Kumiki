// `check` and the mounted app agree on the type of a builtin tile's prop.
//
// The renderers read `options`, `open` and `disabled` with one type each and
// convert nothing: a list of `Text` as a `select`'s options renders an option
// per entry with no label and no value
// (`<option value="undefined">undefined</option>`), `open="false"` is a
// non-empty text and renders the modal open, and `disabled="true"` is not
// `true` and leaves the button enabled. stdlib.md §2.3.11 gives each prop its
// type, and a value that cannot have it is E0201 at the value, written as a
// named argument or in the `{…}` block alike. The same props written with
// values of their types render what they say.
//
// The checker's cases for every prop of the table are in
// `packages/compiler/test/builtin-prop-types.test.ts`.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const example = join(here, "..", "examples", "features", "222-builtin-prop-types.kumiki");

afterEach(() => {
  document.body.replaceChildren();
});

const program = (select: string, modal: string, button: string) => `slot fruit : Text = "apple"
slot n : Int = 0
reducer close on=ui.click(_) do= n := n + 1
tile P = column(
  ${select},
  ${modal},
  ${button},
  text("fruit=" + fruit))
app M
    caps   = []
    routes = {"/" -> P, "/404" -> P}
    init   = []
`;

/** `line:col` of the first `needle` in `src` at or after `from`. */
function at(src: string, needle: string, from: string): string {
  const i = src.indexOf(needle, src.indexOf(from));
  const before = src.slice(0, i);
  return `${before.split("\n").length}:${i - before.lastIndexOf("\n")}`;
}

const diagnostics = (src: string) =>
  check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

describe("a builtin prop of another type is E0201 at the value", () => {
  it.each([
    [
      "named arguments",
      program(
        `select(bind=fruit, options=["apple", "pear"])`,
        `modal(text("MODAL BODY"), open="false", title="Confirm", onClose=close)`,
        `button(text="dis", disabled="true")`,
      ),
    ],
    [
      "the {…} block",
      program(
        `select(bind=fruit) {options: ["apple", "pear"]}`,
        `modal(text("MODAL BODY"), title="Confirm", onClose=close) {open: "false"}`,
        `button(text="dis") {disabled: "true"}`,
      ),
    ],
  ])("written as %s", async (_, src) => {
    expect(diagnostics(src)).toEqual([
      `E0201 ${at(src, `"apple"`, "options")} Expected {label, value} but got Text`,
      `E0201 ${at(src, `"pear"`, "options")} Expected {label, value} but got Text`,
      `E0201 ${at(src, `"false"`, "open")} Expected Bool but got Text`,
      `E0201 ${at(src, `"true"`, "disabled")} Expected Bool but got Text`,
    ]);
    await expect(loadSource(src)).rejects.toThrow("E0201");
  });
});

describe("written with values of their types, the props render what they say", () => {
  it("checks clean", () => {
    const src = program(
      `select(bind=fruit, options=[{label: "Apple", value: "apple"}, {label: "Pear", value: "pear"}])`,
      `modal(text("MODAL BODY"), open=false, title="Confirm", onClose=close)`,
      `button(text="dis", disabled=true)`,
    );
    expect(diagnostics(src)).toEqual([]);
  });

  it("shows the options' labels, keeps the modal closed until opened, and disables the button", async () => {
    const app = await loadApp(example);
    const root = document.createElement("div");
    document.body.appendChild(root);
    mount(app, root);

    const select = root.querySelector<HTMLSelectElement>("#fruit");
    expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual(["Apple", "Pear"]);
    const modal = root.querySelector<HTMLElement>('[data-kumiki-tile="modal"]');
    expect(modal?.style.display).toBe("none");
    expect(root.querySelector<HTMLButtonElement>("#save")?.disabled).toBe(true);

    root.querySelector<HTMLButtonElement>("#open")?.click();
    await Promise.resolve();
    expect(root.querySelector<HTMLElement>('[data-kumiki-tile="modal"]')?.style.display).toBe(
      "flex",
    );
  });
});
