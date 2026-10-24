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
  {
    label: "button, empty aria-label argument",
    tile: "button",
    args: 'aria-label=""',
    named: true,
  },
  { label: "button, empty aria-label prop", tile: "button", block: 'aria-label: ""', named: true },
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
