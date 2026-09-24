// A builtin's content is its first POSITIONAL argument (#393).
//
// `heading(level=2, title)` is an ordinary program: the level is a prop, the
// title is what the heading says. Lowering read `t.args[0]` whatever its name,
// so the level was rendered as the text and the title was dropped, with
// `check` saying nothing. The user-tile half of the same disagreement was
// closed by #330; this is the builtin half.
//
// Each row writes a named argument FIRST and the content after it, then
// mounts and reads the DOM: the content must be the positional value, and the
// named argument must still have reached the element as a prop. `code` and
// `editable` already read the positional argument; their rows hold all five
// kinds to the one rule the lowering now shares.

import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.js";

function sourceOf(tile: string): string {
  return [
    "slot n : Int = 7",
    'slot title : Text = "Title"',
    "",
    `tile Probe = ${tile}`,
    "",
    "app P",
    "  caps   = []",
    '  routes = {"/" -> Probe, "/404" -> Probe}',
    "  init   = []",
    "",
  ].join("\n");
}

async function render(tile: string): Promise<HTMLElement> {
  const app = await loadSource(sourceOf(tile));
  const target = document.createElement("div");
  document.body.appendChild(target);
  mount(app, target);
  const root = target.firstElementChild as HTMLElement | null;
  if (!root) throw new Error(`no element rendered for ${tile}`);
  return root;
}

type Row = {
  kind: string;
  /** A call whose named argument comes before the positional content. */
  tile: string;
  /** What the element must say. */
  says: string;
  /** What it must not say: the named argument's value, read as content. */
  notSays: string;
  /** The named argument, observed on the element. */
  prop: (el: HTMLElement) => void;
};

const rows: Row[] = [
  {
    kind: "text",
    tile: 'text(test-id="probe", n.show)',
    says: "7",
    notSays: "probe",
    prop: (el) => expect(el.getAttribute("data-kumiki-test")).toBe("probe"),
  },
  {
    kind: "heading",
    // The issue's own program. `level` is not observable in the DOM (the
    // renderer draws every heading as an `h1`), so the prop half is held by
    // `test-id`, written first as well.
    tile: 'heading(test-id="probe", level=2, title)',
    says: "Title",
    notSays: "probe",
    prop: (el) => expect(el.getAttribute("data-kumiki-test")).toBe("probe"),
  },
  {
    kind: "markdown",
    tile: 'markdown(test-id="probe", title)',
    says: "Title",
    notSays: "probe",
    prop: (el) => expect(el.getAttribute("data-kumiki-test")).toBe("probe"),
  },
  {
    kind: "code",
    tile: 'code(lang="ts", title)',
    says: "Title",
    notSays: "ts",
    prop: (el) => {
      const code = el.matches("[data-lang]") ? el : el.querySelector("[data-lang]");
      expect(code?.getAttribute("data-lang")).toBe("ts");
    },
  },
  {
    kind: "editable",
    tile: 'editable(test-id="probe", title)',
    says: "Title",
    notSays: "probe",
    prop: (el) => expect(el.getAttribute("data-kumiki-test")).toBe("probe"),
  },
];

describe("a builtin's content is its first positional argument (#393)", () => {
  for (const row of rows) {
    it(`${row.kind}: a named argument written first stays a prop`, async () => {
      const el = await render(row.tile);
      expect(el.textContent).toContain(row.says);
      expect(el.textContent).not.toBe(row.notSays);
      row.prop(el);
    });
  }

  it("a builtin with no positional argument still renders empty content", async () => {
    const el = await render('text(test-id="probe")');
    expect(el.textContent).toBe("");
    expect(el.getAttribute("data-kumiki-test")).toBe("probe");
  });
});
