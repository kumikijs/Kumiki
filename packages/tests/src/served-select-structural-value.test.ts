import { feature } from "@kumikijs/examples";
import { describe, expect, it } from "vitest";
import { find, served, withMounted } from "./helpers/dom.ts";
import { loadApp } from "./helpers/load.ts";

const STRUCTURAL = feature("189-served-select-structural-value");
const FIELD_ORDER = feature("259-select-record-field-order");

const select = (root: ParentNode, selector: string): HTMLSelectElement =>
  find<HTMLSelectElement>(root, selector);

const labels = (options: HTMLOptionElement[]): string[] => options.map((o) => o.textContent ?? "");

// Read off the attribute rather than `selectedIndex`: happy-dom does not apply the
// HTML selectedness rule to parsed options, while a browser shows the marked one.
const markedOnServer = (sel: HTMLSelectElement): string[] =>
  labels(Array.from(sel.options).filter((o) => o.hasAttribute("selected")));

const heldOnClient = (sel: HTMLSelectElement): string[] =>
  labels(Array.from(sel.options).filter((o) => o.selected));

const values = (sel: HTMLSelectElement): string[] => Array.from(sel.options).map((o) => o.value);

describe("a served select whose option values are structural", () => {
  it("selects the slot's option for a variant, a variant with a payload and a record", async () => {
    const page = await served(await loadApp(STRUCTURAL));
    expect(markedOnServer(select(page, "#size"))).toEqual(["Medium"]);
    expect(markedOnServer(select(page, "#status"))).toEqual(["In progress"]);
    expect(markedOnServer(select(page, "#dims"))).toEqual(["2 x 3"]);
  });

  it("carries each option under the value the mounted select gives it", async () => {
    const app = await loadApp(STRUCTURAL);
    const page = await served(app);
    await withMounted(app, async (root) => {
      for (const id of ["#size", "#status", "#dims"]) {
        expect(values(select(page, id)), id).toEqual(values(select(root, id)));
      }
    });
  });
});

describe("a select holds a record option whatever order its fields are written in", () => {
  // The slots are written `{h=3, w=2}` and `Some({h=4, w=4})`, their options `{w=2, h=3}`
  // and `Some({w=4, h=4})`: compiled, each record keeps the field order it was written in.
  const HELD = { dims: ["2 x 3"], crop: ["Crop 4 x 4"] };
  const held = (root: ParentNode, holds: (sel: HTMLSelectElement) => string[]) => ({
    dims: holds(select(root, "#dims")),
    crop: holds(select(root, "#crop")),
  });

  it("on the served page", async () => {
    const page = await served(await loadApp(FIELD_ORDER));
    expect(held(page, markedOnServer)).toEqual(HELD);
  });

  it("on the mounted page", async () => {
    await withMounted(await loadApp(FIELD_ORDER), async (root) => {
      expect(held(root, heldOnClient)).toEqual(HELD);
    });
  });
});
