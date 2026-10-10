import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it, onTestFinished } from "vitest";
import { find, mountApp, tick } from "./helpers/dom.ts";
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

async function mountProbe(
  probe: string,
): Promise<{ root: HTMLElement; flip: () => Promise<void> }> {
  const { root: host, handle } = mountApp(await loadSource(program(probe)));
  onTestFinished(() => {
    handle.dispose();
    host.remove();
  });
  const root = host.firstElementChild as HTMLElement;
  return {
    root,
    flip: async () => {
      find(root, "#flip").click();
      await tick(0);
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
    expect(find<HTMLInputElement>(root, 'input[type="radio"]').checked).toBe(true);
  });

  it("max=Int.parse(s).get-or(10) is the parsed Int", async () => {
    const { root } = await mountProbe("slider(bind=v, max=Int.parse(s).get-or(10))");
    expect(find<HTMLInputElement>(root, 'input[type="range"]').max).toBe("5");
  });
});

describe("a user tile's positional argument is the input it spells", () => {
  it.each([
    ["Row(if busy then 100 else 1)", "n=1", "n=100"],
    ["Tab(if busy then Done else All)", "tab all", "tab done"],
  ])("%s passes what the branch picks", async (probe, before, after) => {
    const { root, flip } = await mountProbe(probe);
    expect(shown(root)).toBe(before);
    await flip();
    expect(shown(root)).toBe(after);
  });

  it.each([
    ["Row(match c with | Red -> 100 | Blue -> 1)", "n=100"],
    ['Say(label("x"))', "x!"],
  ])("%s passes %s", async (probe, want) => {
    const { root } = await mountProbe(probe);
    expect(shown(root)).toBe(want);
  });
});
