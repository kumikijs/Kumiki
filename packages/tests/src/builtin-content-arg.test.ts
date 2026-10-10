import { describe, expect, it } from "vitest";
import { mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

async function render(tile: string): Promise<HTMLElement> {
  const app = await loadSource(
    withApp(
      `slot n : Int = 7
slot title : Text = "Title"
tile Probe = ${tile}`,
      "Probe",
    ),
  );
  const root = mountApp(app).root.firstElementChild as HTMLElement | null;
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
    tile: 'heading(test-id="probe", level=2, title)',
    says: "Title",
    notSays: "probe",
    prop: (el) => {
      expect(el.tagName).toBe("H2");
      expect(el.getAttribute("data-kumiki-test")).toBe("probe");
    },
  },
  {
    kind: "heading, content first",
    tile: 'heading(title, test-id="probe", level=2)',
    says: "Title",
    notSays: "probe",
    prop: (el) => {
      expect(el.tagName).toBe("H2");
      expect(el.getAttribute("data-kumiki-test")).toBe("probe");
    },
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
    kind: "label",
    tile: 'label(test-id="probe", title)',
    says: "Title",
    notSays: "probe",
    prop: (el) => expect(el.getAttribute("data-kumiki-test")).toBe("probe"),
  },
  {
    kind: "link",
    tile: 'link(to="/x", title)',
    says: "Title",
    notSays: "/x",
  },
];

describe("label and link still take their label as text=", () => {
  it.each([
    ['label(text="Named")', "Named"],
    ['link(to="/x", text="Named")', "Named"],
    ['link(to="/x") {text: "Prop"}', "Prop"],
  ])("%s", async (tile, says) => {
    expect((await render(tile)).textContent).toBe(says);
  });
});

describe("a builtin's content is its first positional argument", () => {
  it.each(rows)("$kind: the positional argument is the content, the named one is not", async ({
    tile,
    says,
    notSays,
    prop,
  }) => {
    const el = await render(tile);
    expect(el.textContent).toContain(says);
    expect(el.textContent).not.toContain(notSays);
    prop?.(el);
  });

  it("text with only a test-id: the test-id is a prop, not the content", async () => {
    const el = await render('text(test-id="probe")');
    expect(el.textContent).toBe("");
    expect(el.getAttribute("data-kumiki-test")).toBe("probe");
  });
});
