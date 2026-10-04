// runtime.md §10.3.8 / §10.6.1: a `select` matches its options by the
// structural key of their values, and the page `renderToString` serves answers
// with the same key the mounted `<select>` does. Each served `<option>` carries
// the key as its `value`, and the one whose key is the bound slot's carries
// `selected`, which is all a page with no script yet has to show the slot's
// value by. The corpus example (`189-served-select-structural-value`) drives
// the mounted selects through its scenario; this suite parses the served HTML
// and reads which option it selects.

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type AppShape, mount, renderToString } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadApp, loadSource } from "./helpers/load.ts";

const here = dirname(fileURLToPath(import.meta.url));
const features = join(here, "..", "examples", "features");
const example = join(features, "189-served-select-structural-value.kumiki");
const shippedSelect = join(features, "14-select.kumiki");

afterEach(() => {
  document.body.replaceChildren();
});

/** The page `renderToString` serves, parsed back into elements. */
async function served(app: AppShape): Promise<HTMLElement> {
  const { html } = await renderToString(app);
  const page = document.createElement("div");
  page.innerHTML = html;
  return page;
}

/** The same app mounted on the client. */
function mounted(app: AppShape): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(app, root);
  return root;
}

function selectIn(root: ParentNode, selector: string): HTMLSelectElement {
  const sel = root.querySelector<HTMLSelectElement>(selector);
  if (!sel) throw new Error(`no select matching ${selector}`);
  return sel;
}

/**
 * The labels of the options the served markup marks `selected`. Read off the
 * attribute rather than `selectedIndex`: happy-dom does not apply the HTML
 * selectedness rule to parsed options (a placeholder marked `selected` reads
 * as -1), while a browser shows the option the markup marks, and with none
 * marked, the first one that is not disabled.
 */
function selectedInMarkup(sel: HTMLSelectElement): string[] {
  return Array.from(sel.options)
    .filter((o) => o.hasAttribute("selected"))
    .map((o) => o.textContent ?? "");
}

const values = (sel: HTMLSelectElement): string[] => Array.from(sel.options).map((o) => o.value);

describe("a served select whose option values are structural", () => {
  it("selects the slot's option for a variant, a variant with a payload and a record", async () => {
    const page = await served(await loadApp(example));
    expect(selectedInMarkup(selectIn(page, "#size"))).toEqual(["Medium"]);
    expect(selectedInMarkup(selectIn(page, "#status"))).toEqual(["In progress"]);
    expect(selectedInMarkup(selectIn(page, "#dims"))).toEqual(["2 x 3"]);
  });

  it("carries each option under the value the mounted select gives it", async () => {
    const app = await loadApp(example);
    const page = await served(app);
    const root = mounted(app);
    for (const id of ["#size", "#status", "#dims"]) {
      expect(values(selectIn(page, id)), id).toEqual(values(selectIn(root, id)));
    }
  });

  it("selects the slot's value in the shipped select example", async () => {
    const page = await served(await loadApp(shippedSelect));
    expect(selectedInMarkup(selectIn(page, "select"))).toEqual(["Medium"]);
  });

  it("selects the placeholder only when the select has no value", async () => {
    const src = (value: string) => `
type Size = S | M | L
fn sizeOptions() -> List({label: Text, value: Size})
   = [{label: "Small", value: S}, {label: "Medium", value: M}]
tile App = column(select(${value}options=sizeOptions(), placeholder="Pick a size"))
app P
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;
    const valued = await served(await loadSource(src("value=M, ")));
    expect(selectedInMarkup(selectIn(valued, "select"))).toEqual(["Medium"]);
    const empty = await served(await loadSource(src("")));
    expect(selectedInMarkup(selectIn(empty, "select"))).toEqual(["Pick a size"]);
  });

  it("keys a Text-valued select the way the mounted one does", async () => {
    const app = await loadSource(`
slot pick : Text = "m"
fn opts() -> List({label: Text, value: Text})
   = [{label: "Small", value: "s"}, {label: "Medium", value: "m"}]
tile App = column(select(bind=pick, options=opts()))
app P
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`);
    const server = selectIn(await served(app), "select");
    expect(selectedInMarkup(server)).toEqual(["Medium"]);
    expect(values(server)).toEqual(values(selectIn(mounted(app), "select")));
  });
});
