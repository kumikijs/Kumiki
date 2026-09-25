// A builtin's content is its first POSITIONAL argument.
//
// `heading(level=2, title)` is an ordinary program: the level is a prop, the
// title is what the heading says. Lowering read `t.args[0]` whatever its name,
// so the level was rendered as the text and the title was dropped, with
// `check` saying nothing. A user-tile call already took its input from the
// first positional argument; this holds the builtins to the same rule.
//
// Each row writes a named argument FIRST and the content after it (one row
// also writes it after, to show the order does not matter), then
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
  /** The named argument, observed on the element, where it leaves a trace. */
  prop?: (el: HTMLElement) => void;
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
    kind: "heading, content first",
    // The other order: a named argument after the content is a prop too.
    tile: 'heading(title, test-id="probe", level=2)',
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
  {
    kind: "editable, text= beside a positional",
    // `editable` also takes its content from `text=`, but only as a fallback
    // for a call with no positional argument: written together, the
    // positional one is the content.
    tile: 'editable(text="A", "B")',
    says: "B",
    notSays: "A",
  },
];

describe("a builtin's content is its first positional argument", () => {
  for (const row of rows) {
    it(`${row.kind}: the positional argument is the content, the named one is not`, async () => {
      const el = await render(row.tile);
      expect(el.textContent).toContain(row.says);
      expect(el.textContent).not.toContain(row.notSays);
      row.prop?.(el);
    });
  }

  // Only the prop half here is a rule: a `test-id` never becomes content. The
  // empty text is today's behaviour for a call that gives no content, and says
  // nothing about `text(text="…")`, which `check` does not yet report; that
  // shape is deliberately left unpinned until it gets a diagnostic.
  it("text with only a test-id: the test-id is a prop, not the content", async () => {
    const el = await render('text(test-id="probe")');
    expect(el.textContent).toBe("");
    expect(el.getAttribute("data-kumiki-test")).toBe("probe");
  });
});
