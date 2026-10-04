// A match arm's pattern may be a binding name (language.md §1.9 `pattern`),
// and that arm may come after another one. In a value or statement `match` an
// arm body is an expression, so whether the next `|` is a bool OR or the next
// arm is the parser's call; `->` is not a binary operator, so `| other ->` can
// only be an arm, while a `|` that no pattern and `->` follow stays an OR.
//
// Each case mounts the compiled program and reads the arm it chose for both a
// scrutinee the first arm takes and one only the binding takes.

import { lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { afterEach, describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const program = (defs: string) => `type Color = Red | Green | Blue
slot c : Color = Blue
slot n : Int = 0
slot a : Bool = false
slot b : Bool = true
tile Go = button(text="go")
tile Paint = button(text="paint")
reducer paint on=ui.click(Paint) do= c := Red
${defs}
app A
  caps   = []
  routes = {"/" -> App, "/404" -> App}
  init   = []
`;

let disposers: Array<() => void> = [];
afterEach(() => {
  for (const d of disposers) d();
  disposers = [];
});

async function mounted(src: string): Promise<HTMLElement> {
  const app = await loadSource(src);
  const root = document.createElement("div");
  document.body.appendChild(root);
  const handle = mount(app, root);
  disposers.push(() => {
    handle.dispose();
    root.remove();
  });
  return root;
}

function click(root: HTMLElement, text: string): void {
  const btn = Array.from(root.querySelectorAll("button")).find((el) => el.textContent === text);
  if (!btn) throw new Error(`button "${text}" not found`);
  btn.click();
}

const SHOW_N = `tile App = column(Paint, Go, text("n=" + n.show))`;

describe("a binding-name arm after another arm", () => {
  it.each([
    [
      "a fn body",
      `fn score(x: Color) -> Int = match x with | Red -> 1 | other -> 2
reducer r on=ui.click(Go) do= n := score(c)
${SHOW_N}`,
      "n=2",
      "n=1",
    ],
    [
      "a fn body, one arm a line",
      `fn score(x: Color) -> Int = match x with
    | Red -> 1
    | other -> 2
reducer r on=ui.click(Go) do= n := score(c)
${SHOW_N}`,
      "n=2",
      "n=1",
    ],
    [
      "an assigned value",
      `reducer r on=ui.click(Go) do= n := match c with | Red -> 1 | other -> 2
${SHOW_N}`,
      "n=2",
      "n=1",
    ],
    [
      "a reducer statement",
      `reducer r on=ui.click(Go) do= match c with | Red -> n := 1 | other -> n := 2
${SHOW_N}`,
      "n=2",
      "n=1",
    ],
    [
      "a value builtin's content, reading the binding",
      `tile App = column(Paint, Go, text(match c with | Red -> "red" | other -> "other=" + other.show))`,
      "other=Blue",
      "red",
    ],
  ])("in %s", async (_where, defs, byBinding, byFirst) => {
    const root = await mounted(program(defs));
    click(root, "go");
    expect(root.textContent).toContain(byBinding);
    click(root, "paint");
    click(root, "go");
    expect(root.textContent).toContain(byFirst);
    expect(root.textContent).not.toContain(byBinding);
  });
});

/** The definitions `defs` parse to, in the program above. */
const parsed = (defs: string) => parse(lex(program(`${defs}\ntile App = column(Go)`))).defs;

describe("a | that no pattern and -> follow stays bool OR", () => {
  // The or's right side, written each way that begins as a pattern could:
  // a name, a field read, and a call.
  const rhs: [string, Record<string, unknown>][] = [
    ["b", { kind: "Ref", name: "b" }],
    ["b.c", { kind: "FieldAccess", base: { kind: "Ref", name: "b" }, field: "c" }],
    ["f(x)", { kind: "Call", callee: "f", args: [{ kind: "Ref", name: "x" }] }],
  ];
  const or = (shape: Record<string, unknown>) => ({
    kind: "BinOp",
    op: "|",
    lhs: { kind: "Ref", name: "a" },
    rhs: shape,
  });

  it.each(rhs)("in a value match's arm body: a | %s", (written, shape) => {
    const defs = parsed(
      `fn g(x: Color) -> Bool = match x with | Red -> a | ${written} | other -> b`,
    );
    expect(defs.find((d) => d.kind === "FnDef")).toMatchObject({
      body: {
        kind: "MatchExpr",
        arms: [
          { pattern: { kind: "PVariant", name: "Red" }, body: or(shape) },
          { pattern: { kind: "PBind", name: "other" }, body: { kind: "Ref", name: "b" } },
        ],
      },
    });
  });

  it.each(rhs)("in a statement match's arm body: a | %s", (written, shape) => {
    const defs = parsed(
      `reducer r on=ui.click(Go) do= match c with | Red -> a := a | ${written} | other -> a := b`,
    );
    expect(defs.find((d) => d.kind === "ReducerDef" && d.name === "r")).toMatchObject({
      do: [
        {
          kind: "MatchStmt",
          arms: [
            { pattern: { kind: "PVariant", name: "Red" }, body: [{ rhs: or(shape) }] },
            {
              pattern: { kind: "PBind", name: "other" },
              body: [{ rhs: { kind: "Ref", name: "b" } }],
            },
          ],
        },
      ],
    });
  });
});
