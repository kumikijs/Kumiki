// Under `--strict-a11y`, E0701 / E0702 / E0703 ask whether a control carries a
// name: `aria-label` on a `button` or a `link`, `alt` on an `image`. A named
// argument is a prop wherever it is written (language.md §1.7.1), so
// `button(aria-label="Close")` and `button() {aria-label: "Close"}` put the same
// attribute on the element. Each check reads both spellings, and answers
// exactly what the mounted element carries: a check that read one spelling
// would reject a labelled control, and one that counted a value the element
// never gets would accept an unlabelled one.
//
// The corpus example (`220-a11y-aria-label-argument`) is held to the strict
// check by examples.test.ts and clicks each control by its name; this suite
// pins the rule per spelling against the DOM.

import { check, type KumikiError, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

type Row = {
  label: string;
  tile: "button" | "link" | "image";
  /** Arguments besides `test-id`, as written inside `( … )`. */
  args?: string;
  /** The props block's entries, as written inside `{ … }`. */
  block?: string;
  /** Whether the element carries the name, and so whether the check accepts it. */
  named: boolean;
};

const CHECKED: Record<Row["tile"], { code: string; attr: string }> = {
  button: { code: "E0701", attr: "aria-label" },
  link: { code: "E0703", attr: "aria-label" },
  image: { code: "E0702", attr: "alt" },
};

const ROWS: Row[] = [
  { label: "button, aria-label argument", tile: "button", args: 'aria-label="Close"', named: true },
  { label: "button, aria-label prop", tile: "button", block: 'aria-label: "Close"', named: true },
  {
    label: "button, aria-label argument from a slot",
    tile: "button",
    args: "aria-label=name",
    named: true,
  },
  {
    label: "button, aria-label prop from a slot",
    tile: "button",
    block: "aria-label: name",
    named: true,
  },
  // An empty value is written as an empty attribute. The check reads no value,
  // so it counts one in both spellings alike.
  {
    label: "button, empty aria-label argument",
    tile: "button",
    args: 'aria-label=""',
    named: true,
  },
  { label: "button, empty aria-label prop", tile: "button", block: 'aria-label: ""', named: true },
  // A tile is not a prop value: an argument that parses as one renders no
  // attribute, so it names nothing.
  {
    label: "button, aria-label argument that is a tile",
    tile: "button",
    args: "aria-label=Mark",
    named: false,
  },
  { label: "button, no aria-label", tile: "button", named: false },
  {
    label: "link, aria-label argument",
    tile: "link",
    args: 'to="/", aria-label="Home"',
    named: true,
  },
  {
    label: "link, aria-label prop",
    tile: "link",
    args: 'to="/"',
    block: 'aria-label: "Home"',
    named: true,
  },
  {
    label: "link, aria-label argument from a slot",
    tile: "link",
    args: 'to="/", aria-label=name',
    named: true,
  },
  {
    label: "link, aria-label prop from a slot",
    tile: "link",
    args: 'to="/"',
    block: "aria-label: name",
    named: true,
  },
  { label: "link, no aria-label", tile: "link", args: 'to="/"', named: false },
  { label: "image, alt argument", tile: "image", args: 'src="a.png", alt="A"', named: true },
  { label: "image, alt prop", tile: "image", args: 'src="a.png"', block: 'alt: "A"', named: true },
  {
    label: "image, alt argument from a slot",
    tile: "image",
    args: 'src="a.png", alt=name',
    named: true,
  },
  {
    label: "image, alt prop from a slot",
    tile: "image",
    args: 'src="a.png"',
    block: "alt: name",
    named: true,
  },
  // An `image` argument parses as a value, except a `when` / `for`, which is a
  // tile however it is written.
  {
    label: "image, alt argument that is a tile",
    tile: "image",
    args: 'src="a.png", alt=when(true, text("A"))',
    named: false,
  },
  { label: "image, no alt", tile: "image", args: 'src="a.png"', named: false },
];

function call(row: Row, i: number): string {
  const args = [`test-id="r${i}"`, ...(row.args ? [row.args] : [])].join(", ");
  return `  ${row.tile}(${args})${row.block ? ` {${row.block}}` : ""}`;
}

// One row per line, so a diagnostic's line says which row it is about.
const HEADER = `slot name : Text = "Close"
tile Mark = icon(name="x")
tile Probe = column(`;
const FIRST_ROW_LINE = HEADER.split("\n").length + 1;
const SOURCE = `${HEADER}
${ROWS.map(call).join(",\n")})
app P
    caps   = []
    routes = {"/" -> Probe, "/404" -> Probe}
    init   = []
`;

let errors: KumikiError[] = [];
let root: HTMLElement;
let dispose = (): void => {};

beforeAll(async () => {
  errors = check(parse(lex(SOURCE)), { strictA11y: true });
  root = document.createElement("div");
  document.body.appendChild(root);
  const handle = mount(await loadSource(SOURCE), root);
  dispose = () => handle.dispose();
});

afterAll(() => {
  dispose();
  root.remove();
});

describe("a11y names, written as an argument or a prop", () => {
  it.each(
    ROWS.map((row, i) => [row.label, row, i] as const),
  )("%s: the check accepts exactly when the element carries the name", (_label, row, i) => {
    const { code, attr } = CHECKED[row.tile];
    const reported = errors.some((e) => e.code === code && e.pos.line === FIRST_ROW_LINE + i);
    const el = root.querySelector(`[data-kumiki-test="r${i}"]`);
    expect(el, "the row's element is mounted").not.toBeNull();
    expect({ reported, carries: el?.hasAttribute(attr) }).toEqual({
      reported: !row.named,
      carries: row.named,
    });
  });
});
