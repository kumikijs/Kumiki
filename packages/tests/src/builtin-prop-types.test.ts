import { check, lex, parse } from "@kumikijs/compiler";
import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { withMounted } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const EXAMPLE = feature("222-builtin-prop-types");

const program = (select: string, modal: string, button: string) =>
  withApp(`slot fruit : Text = "apple"
slot n : Int = 0
reducer close on=ui.click(_) do= n := n + 1
tile App = column(
  ${select},
  ${modal},
  ${button},
  text("fruit=" + fruit))`);

describe("a builtin prop of another type is not built", () => {
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
    expect(check(parse(lex(src)))).toEqual([]);
  });

  it("shows the options' labels, keeps the modal closed until opened, and disables the button", async () => {
    await withMounted(await loadApp(EXAMPLE), async (root) => {
      const select = root.querySelector<HTMLSelectElement>("#fruit");
      expect([...(select?.options ?? [])].map((o) => o.textContent)).toEqual(["Apple", "Pear"]);
      const modal = () => root.querySelector<HTMLElement>('[data-kumiki-tile="modal"]');
      expect(modal()?.style.display).toBe("none");
      expect(root.querySelector<HTMLButtonElement>("#save")?.disabled).toBe(true);

      root.querySelector<HTMLButtonElement>("#open")?.click();
      expect(modal()?.style.display).toBe("flex");
    });
  });
});
