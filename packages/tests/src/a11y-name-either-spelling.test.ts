import { check, type KumikiError, lex, parse } from "@kumikijs/compiler";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

type Row = {
  label: string;
  tile: "button" | "link" | "image";
  args?: string;
  block?: string;
  /** Whether the row's check reports it. */
  reported: boolean;
  /** The checked attribute on the rendered element: its text, or `null` when it has none. */
  renders: string | null;
};

const CHECKED: Record<Row["tile"], { code: string; attr: string }> = {
  button: { code: "E0701", attr: "aria-label" },
  link: { code: "E0703", attr: "aria-label" },
  image: { code: "E0702", attr: "alt" },
};

const ROWS: Row[] = [
  {
    label: "button, aria-label argument",
    tile: "button",
    args: 'aria-label="Close"',
    reported: false,
    renders: "Close",
  },
  {
    label: "button, aria-label prop",
    tile: "button",
    block: 'aria-label: "Close"',
    reported: false,
    renders: "Close",
  },
  {
    label: "button, aria-label argument from a slot",
    tile: "button",
    args: "aria-label=name",
    reported: false,
    renders: "Close",
  },
  {
    label: "button, aria-label prop from a slot",
    tile: "button",
    block: "aria-label: name",
    reported: false,
    renders: "Close",
  },
  {
    label: "button, empty aria-label argument",
    tile: "button",
    args: 'aria-label=""',
    reported: false,
    renders: "",
  },
  {
    label: "button, empty aria-label prop",
    tile: "button",
    block: 'aria-label: ""',
    reported: false,
    renders: "",
  },
  {
    label: "button, aria-label argument that is a when",
    tile: "button",
    args: 'aria-label=when(true, text("A"))',
    reported: true,
    renders: null,
  },
  {
    label: "button, a when argument under an aria-label prop",
    tile: "button",
    args: 'aria-label=when(true, text("A"))',
    block: 'aria-label: "Close"',
    reported: false,
    renders: "Close",
  },
  { label: "button, no aria-label", tile: "button", reported: true, renders: null },
  {
    label: "link, aria-label argument",
    tile: "link",
    args: 'to="/", aria-label="Home"',
    reported: false,
    renders: "Home",
  },
  {
    label: "link, aria-label prop",
    tile: "link",
    args: 'to="/"',
    block: 'aria-label: "Home"',
    reported: false,
    renders: "Home",
  },
  {
    label: "link, aria-label argument from a slot",
    tile: "link",
    args: 'to="/", aria-label=name',
    reported: false,
    renders: "Close",
  },
  {
    label: "link, aria-label prop from a slot",
    tile: "link",
    args: 'to="/"',
    block: "aria-label: name",
    reported: false,
    renders: "Close",
  },
  { label: "link, no aria-label", tile: "link", args: 'to="/"', reported: true, renders: null },
  {
    label: "image, alt argument",
    tile: "image",
    args: 'src="a.png", alt="A"',
    reported: false,
    renders: "A",
  },
  {
    label: "image, alt prop",
    tile: "image",
    args: 'src="a.png"',
    block: 'alt: "A"',
    reported: false,
    renders: "A",
  },
  {
    label: "image, alt argument from a slot",
    tile: "image",
    args: 'src="a.png", alt=name',
    reported: false,
    renders: "Close",
  },
  {
    label: "image, alt prop from a slot",
    tile: "image",
    args: 'src="a.png"',
    block: "alt: name",
    reported: false,
    renders: "Close",
  },
  {
    label: "image, alt argument that is a when",
    tile: "image",
    args: 'src="a.png", alt=when(true, text("A"))',
    reported: true,
    renders: null,
  },
  {
    label: "image, alt argument that is a for",
    tile: "image",
    args: 'src="a.png", alt=for x in ["A"] text(x)',
    reported: true,
    renders: null,
  },
  { label: "image, no alt", tile: "image", args: 'src="a.png"', reported: true, renders: null },
  // A value that is not a Text counts as written, in either spelling, and the element does not
  // carry it as a name: #988 types these props.
  {
    label: "button, aria-label argument that is a variant",
    tile: "button",
    args: "aria-label=Dot",
    reported: false,
    renders: "[object Object]",
  },
  {
    label: "link, aria-label argument that is a variant",
    tile: "link",
    args: 'to="/", aria-label=Dot',
    reported: false,
    renders: "[object Object]",
  },
  {
    label: "image, alt argument that is a variant",
    tile: "image",
    args: 'src="a.png", alt=Dot',
    reported: false,
    renders: null,
  },
  {
    label: "button, an aria-label argument under a prop that is a variant",
    tile: "button",
    args: 'aria-label="Close"',
    block: "aria-label: Dot",
    reported: false,
    renders: "[object Object]",
  },
];

function call(row: Row, i: number): string {
  const args = [`test-id="r${i}"`, ...(row.args ? [row.args] : [])].join(", ");
  return `  ${row.tile}(${args})${row.block ? ` {${row.block}}` : ""}`;
}

// One row per line, so a diagnostic's line says which row it is about.
const HEADER = `slot name : Text = "Close"
type Glyph = Dot | Ring
tile Probe = column(`;
const FIRST_ROW_LINE = HEADER.split("\n").length + 1;
const SOURCE = withApp(`${HEADER}\n${ROWS.map(call).join(",\n")})`, "Probe");

let errors: KumikiError[] = [];
let root: HTMLElement;
let dispose = (): void => {};

beforeAll(async () => {
  errors = check(parse(lex(SOURCE)), { strictA11y: true });
  const mounted = mountApp(await loadSource(SOURCE));
  root = mounted.root;
  dispose = () => mounted.handle.dispose();
});

afterAll(() => {
  dispose();
  root.remove();
});

describe("a11y names, written as an argument or a prop", () => {
  it.each(
    ROWS.map((row, i) => [row.label, row, i] as const),
  )("%s: what the check reports and what the element carries", (_label, row, i) => {
    const { code, attr } = CHECKED[row.tile];
    const reported = errors.some((e) => e.code === code && e.pos.line === FIRST_ROW_LINE + i);
    const el = root.querySelector(`[data-kumiki-test="r${i}"]`);
    expect(el, "the row's element is mounted").not.toBeNull();
    expect({ reported, renders: el?.getAttribute(attr) ?? null }).toEqual({
      reported: row.reported,
      renders: row.renders,
    });
  });
});
