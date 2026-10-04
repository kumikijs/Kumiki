// A value written as a tile argument compiles to that value and renders it.
//
// `tile-arg ::= (identifier '=')? expr` (language.md §1.7.1): a named argument
// and a user tile's positional argument — its `in=` input — are values, so an
// `if`, a `match`, a call and an expression that starts with a capitalised
// name are values there, whatever the argument is called and whichever tile it
// is written on. Each program below writes one such argument, and the
// assertion is about what the mounted app shows for it, before and after a
// click flips `busy`. The shapes the parser gives the same arguments are
// pinned in `packages/compiler/test/tile-arg-context.test.ts`.

import { check, lex, parse } from "@kumikijs/compiler";
import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { loadSource } from "./helpers/load.ts";

const program = (probe: string) => `type F = All | Done
type C = Red | Blue
slot busy : Bool = false
slot filter : F = All
slot s : Text = "5"
slot v : Int = 0
slot c : C = Red
fn label(t: Text) -> Text = t + "!"
reducer flip on=ui.click(Flip) do= busy := !busy
tile Flip = button(text="flip") {id: "flip"}
tile Row in=Int = text("n=" + $1.show)
tile Tab in=F = text(match $1 with | All -> "tab all" | Done -> "tab done")
tile Say in=Text = text($1)
tile App = column(Flip, ${probe})

app A
  caps   = []
  routes = {"/" -> App, "/404" -> App}
  init   = []
`;

/** The probe's root element, and a click on `Flip` that settles. */
async function mountProbe(
  probe: string,
): Promise<{ root: HTMLElement; flip: () => Promise<void> }> {
  const app = await loadSource(program(probe));
  const target = document.createElement("div");
  document.body.appendChild(target);
  mount(app, target);
  const root = target.firstElementChild as HTMLElement;
  return {
    root,
    flip: async () => {
      (root.querySelector("#flip") as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

/** The element a probe of builtin `kind` rendered — not the `Flip` button. */
function probeOf(root: HTMLElement, kind: string): HTMLElement {
  const el = [...root.querySelectorAll<HTMLElement>(`[data-kumiki-tile="${kind}"]`)].find(
    (e) => e.id !== "flip",
  );
  if (!el) throw new Error(`no ${kind} rendered`);
  return el;
}

/** What the probe — everything after `Flip` — shows as text. */
const shown = (root: HTMLElement) => (root.textContent ?? "").replace(/^flip/, "");

describe("each argument checks clean", () => {
  it.each([
    'button(text="Save", disabled=if busy then true else false)',
    'box(text("tab"), class=if busy then "tab on" else "tab")',
    "progress(value=3, max=if busy then 10 else 20)",
    'radio(group="f", value="all", selected=All == filter)',
    "slider(bind=v, max=Int.parse(s).get-or(10))",
    "Row(if busy then 100 else 1)",
    "Row(match c with | Red -> 100 | Blue -> 1)",
    "Tab(if busy then Done else All)",
    'Say(label("x"))',
  ])("%s", (probe) => {
    const errors = check(parse(lex(program(probe)))).filter((e) => e.severity !== "warning");
    expect(errors.map((e) => `${e.code} ${e.message}`)).toEqual([]);
  });
});

describe("a named argument of a builtin is the value it spells", () => {
  it("disabled=if … toggles with busy", async () => {
    const { root, flip } = await mountProbe(
      'button(text="Save", disabled=if busy then true else false)',
    );
    const save = probeOf(root, "button") as HTMLButtonElement;
    expect(save.textContent).toBe("Save");
    expect(save.disabled).toBe(false);
    await flip();
    expect((probeOf(root, "button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("class=if … toggles with busy", async () => {
    const { root, flip } = await mountProbe(
      'box(text("tab"), class=if busy then "tab on" else "tab")',
    );
    expect(probeOf(root, "box").classList.contains("tab")).toBe(true);
    expect(probeOf(root, "box").classList.contains("on")).toBe(false);
    await flip();
    expect(probeOf(root, "box").classList.contains("on")).toBe(true);
  });

  it("max=if … toggles with busy", async () => {
    const { root, flip } = await mountProbe("progress(value=3, max=if busy then 10 else 20)");
    expect((probeOf(root, "progress") as HTMLProgressElement).max).toBe(20);
    await flip();
    expect((probeOf(root, "progress") as HTMLProgressElement).max).toBe(10);
  });

  it("selected=All == filter selects the radio", async () => {
    const { root } = await mountProbe('radio(group="f", value="all", selected=All == filter)');
    expect(root.querySelector<HTMLInputElement>('input[type="radio"]')?.checked).toBe(true);
  });

  it("max=Int.parse(s).get-or(10) is the parsed Int", async () => {
    const { root } = await mountProbe("slider(bind=v, max=Int.parse(s).get-or(10))");
    expect(root.querySelector<HTMLInputElement>('input[type="range"]')?.max).toBe("5");
  });
});

describe("a user tile's positional argument is the input it spells", () => {
  it("Row(if …) passes the Int the branch picks", async () => {
    const { root, flip } = await mountProbe("Row(if busy then 100 else 1)");
    expect(shown(root)).toBe("n=1");
    await flip();
    expect(shown(root)).toBe("n=100");
  });

  it("Row(match …) passes the Int the arm picks", async () => {
    const { root } = await mountProbe("Row(match c with | Red -> 100 | Blue -> 1)");
    expect(shown(root)).toBe("n=100");
  });

  it("Tab(if … then Done else All) passes a variant", async () => {
    const { root, flip } = await mountProbe("Tab(if busy then Done else All)");
    expect(shown(root)).toBe("tab all");
    await flip();
    expect(shown(root)).toBe("tab done");
  });

  it("Say(label(…)) passes what the fn returns", async () => {
    const { root } = await mountProbe('Say(label("x"))');
    expect(shown(root)).toBe("x!");
  });
});
