import { afterEach, describe, expect, it } from "vitest";
import { click, mountApp } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const program = (defs: string) =>
  withApp(`type Color = Red | Green | Blue
slot c : Color = Blue
slot n : Int = 0
tile Go = button(text="go")
tile Paint = button(text="paint")
reducer paint on=ui.click(Paint) do= c := Red
${defs}`);

let disposers: Array<() => void> = [];
afterEach(() => {
  for (const d of disposers) d();
  disposers = [];
});

async function mounted(src: string): Promise<HTMLElement> {
  const { root, handle } = mountApp(await loadSource(src));
  disposers.push(() => {
    handle.dispose();
    root.remove();
  });
  return root;
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
