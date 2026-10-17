import { feature } from "@kumikijs/examples";
import { type AppShape, renderToString } from "@kumikijs/runtime";
import { describe, expect, it, onTestFinished } from "vitest";
import { find, mountApp } from "./helpers/dom.ts";
import { loadApp, loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const EXAMPLE = feature("189-served-select-structural-value");
const SHIPPED_SELECT = feature("14-select");

async function served(app: AppShape): Promise<HTMLElement> {
  const { html } = await renderToString(app);
  const page = document.createElement("div");
  page.innerHTML = html;
  return page;
}

function mounted(app: AppShape): HTMLElement {
  const { root, handle } = mountApp(app);
  onTestFinished(() => {
    handle.dispose();
    root.remove();
  });
  return root;
}

// Read off the attribute rather than `selectedIndex`: happy-dom does not apply the
// HTML selectedness rule to parsed options, while a browser shows the marked one.
function selectedInMarkup(sel: HTMLSelectElement): string[] {
  return Array.from(sel.options)
    .filter((o) => o.hasAttribute("selected"))
    .map((o) => o.textContent ?? "");
}

const values = (sel: HTMLSelectElement): string[] => Array.from(sel.options).map((o) => o.value);

const select = (root: ParentNode, selector: string): HTMLSelectElement =>
  find<HTMLSelectElement>(root, selector);

describe("a served select whose option values are structural", () => {
  it("selects the slot's option for a variant, a variant with a payload and a record", async () => {
    const page = await served(await loadApp(EXAMPLE));
    expect(selectedInMarkup(select(page, "#size"))).toEqual(["Medium"]);
    expect(selectedInMarkup(select(page, "#status"))).toEqual(["In progress"]);
    expect(selectedInMarkup(select(page, "#dims"))).toEqual(["2 x 3"]);
  });

  it("carries each option under the value the mounted select gives it", async () => {
    const app = await loadApp(EXAMPLE);
    const page = await served(app);
    const root = mounted(app);
    for (const id of ["#size", "#status", "#dims"]) {
      expect(values(select(page, id)), id).toEqual(values(select(root, id)));
    }
  });

  it("selects the slot's value in the shipped select example", async () => {
    const page = await served(await loadApp(SHIPPED_SELECT));
    expect(selectedInMarkup(select(page, "select"))).toEqual(["Medium"]);
  });

  it.each([
    ["value=M, ", ["Medium"]],
    ["", ["Pick a size"]],
  ])("selects the placeholder only when the select has no value (%j)", async (value, want) => {
    const src = withApp(`type Size = S | M | L
fn sizeOptions() -> List({label: Text, value: Size})
   = [{label: "Small", value: S}, {label: "Medium", value: M}]
tile App = column(select(${value}options=sizeOptions(), placeholder="Pick a size"))`);
    const page = await served(await loadSource(src));
    expect(selectedInMarkup(select(page, "select"))).toEqual(want);
  });

  it("keys a Text-valued select the way the mounted one does", async () => {
    const app = await loadSource(
      withApp(`slot pick : Text = "m"
fn opts() -> List({label: Text, value: Text})
   = [{label: "Small", value: "s"}, {label: "Medium", value: "m"}]
tile App = column(select(bind=pick, options=opts()))`),
    );
    const server = select(await served(app), "select");
    expect(selectedInMarkup(server)).toEqual(["Medium"]);
    expect(values(server)).toEqual(values(select(mounted(app), "select")));
  });
});
