import { mount } from "@kumikijs/runtime";
import { describe, expect, it } from "vitest";
import { withRoot } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

/** A program whose `go` reducer runs `body`, one statement per line. */
function programWith(body: string[], outType = "Text", outInit = '""'): string {
  return withApp(`type Shape = Circle(Int) | Square(Int)
slot noteKey : Text       = "a"
slot names   : List(Text) = ["b", "b", "c"]
slot shape   : Shape      = Circle(1)
slot got     : ${outType} = ${outInit}
reducer go on=ui.click(Go) do= ${body.join("\n                               ")}
tile Go = button(text="go", onClick=go)
tile App = column(Go, text("got=" + got.show))`);
}

/** A program whose `go` reducer writes `noteKey := "b"` and then `got := <read>`. */
function program(read: string, outType = "Text", outInit = '""'): string {
  return programWith(['noteKey := "b"', `got := ${read}`], outType, outInit);
}

/** Mount `source`, click `go` once, and return the slots. */
async function clickOnce(source: string): Promise<Record<string, unknown>> {
  const app = await loadSource(source);
  return withRoot(async (root) => {
    const { dispose } = mount(app, root);
    root.querySelector("button")?.click();
    const slots = { ...(app.live ?? {}) };
    dispose();
    return slots;
  });
}

/** Mount `source` and return the page text before and after one click on its button. */
async function textBeforeAndAfterClick(source: string): Promise<[string, string]> {
  const app = await loadSource(source);
  return withRoot(async (root) => {
    const { dispose } = mount(app, root);
    const before = root.textContent ?? "";
    root.querySelector("button")?.click();
    const after = root.textContent ?? "";
    dispose();
    return [before, after];
  });
}

describe("a slot read after the reducer's own write, in a nested form", () => {
  it.each([
    ["a match binding arm", "match 1 with | n -> noteKey"],
    ["a match variant arm", "match shape with | Circle(r) -> noteKey | Square(s) -> noteKey"],
    ["a match tuple arm", 'match ("x", 1) with | (s, _) -> noteKey'],
    ["a let … in body", 'let k = "x" in noteKey'],
  ])("reads the write in %s", async (_row, read) => {
    const slots = await clickOnce(program(read));
    expect(slots.noteKey).toBe("b");
    expect(slots.got).toBe("b");
  });

  it("reads the write in a method predicate", async () => {
    // A predicate that missed the write would count `$1 == "a"` over ["b", "b", "c"]: 0.
    const slots = await clickOnce(program("names.filter($1 == noteKey).length", "Int", "0"));
    expect(slots.got).toBe(2);
  });

  it("reads the write in a method's element lambda", async () => {
    const slots = await clickOnce(program('names.map($1 + noteKey).join(",")'));
    expect(slots.got).toBe("bb,bb,cb");
  });

  it("reads the write two levels down: a method predicate inside a match arm", async () => {
    const read = "match 1 with | n -> names.filter($1 == noteKey).length";
    const slots = await clickOnce(program(read, "Int", "0"));
    expect(slots.got).toBe(2);
  });

  it("reads an arm's own binding, not the slot it shadows", async () => {
    const slots = await clickOnce(program('match "q" with | noteKey -> noteKey'));
    expect(slots.noteKey).toBe("b");
    expect(slots.got).toBe("q");
  });
});

describe("a statement-level if / match after the write", () => {
  it.each([
    ["an if branch", "if true then got := noteKey else ()"],
    ["a match tuple arm", 'match ("x", 1) with | (s, _) -> got := noteKey'],
    [
      "a match variant arm",
      "match shape with | Circle(r) -> got := noteKey | Square(s) -> got := noteKey",
    ],
  ])("reads the write in %s", async (_row, stmt) => {
    const slots = await clickOnce(programWith(['noteKey := "b"', stmt]));
    expect(slots.noteKey).toBe("b");
    expect(slots.got).toBe("b");
  });
});

describe("a read after a write whose value is undefined in JS", () => {
  it.each([
    ["directly in the body", "got"],
    ["in a match arm", "match 1 with | n -> got"],
  ])("reads what the batch commits, %s", async (_row, read) => {
    const source = withApp(`slot got  : Text = "old"
slot seen : Text = "unset"
reducer go on=ui.click(Go) do= got := $el.missing
                               seen := ${read}
tile Go = button(text="go", onClick=go)
tile App = column(Go)`);
    const slots = await clickOnce(source);
    expect(slots.got).toBeUndefined();
    expect(slots.seen).toBe(slots.got);
  });
});

describe("a nested read that runs before the write", () => {
  it("reads the value the slot held when the reducer started", async () => {
    const slots = await clickOnce(
      programWith(["got := match 1 with | n -> noteKey", 'noteKey := "b"']),
    );
    expect(slots.noteKey).toBe("b");
    expect(slots.got).toBe("a");
  });

  it("counts with the starting value in a method predicate", async () => {
    // `$1 == "a"` over ["b", "b", "c"]: the write that follows is not seen yet.
    const slots = await clickOnce(
      programWith(["got := names.filter($1 == noteKey).length", 'noteKey := "b"'], "Int", "0"),
    );
    expect(slots.got).toBe(0);
  });
});

describe("a tile's nested forms still read the live slots", () => {
  it("renders a tile match arm and let body that read a slot", async () => {
    const source = withApp(`type Shape = Circle(Int) | Square(Int)
slot noteKey : Text  = "a"
slot shape   : Shape = Circle(1)
reducer flip on=ui.click(Flip) do= shape := Square(2)
                                   noteKey := "z"
tile Flip = button(text="flip", onClick=flip)
tile Body = match shape with
    | Circle(r) -> text("circle=" + noteKey)
    | Square(s) -> text(let k = "x" in "square=" + noteKey)
tile App = column(Flip, Body)`);
    const [before, after] = await textBeforeAndAfterClick(source);
    expect(before).toContain("circle=a");
    expect(after).toContain("square=z");
  });

  it.each([
    [
      "a tuple arm",
      'match (noteKey, 1) with | (k, _) -> text("tuple=" + k + noteKey)',
      "tuple=aa",
      "tuple=zz",
    ],
    [
      "a method predicate",
      'text("hits=" + names.filter($1 == noteKey).length.show)',
      "hits=0",
      "hits=1",
    ],
  ])("renders %s that reads a slot, before and after a write", async (_row, body, before, after) => {
    const source = withApp(`slot noteKey : Text       = "a"
slot names   : List(Text) = ["z", "y"]
reducer flip on=ui.click(Flip) do= noteKey := "z"
tile Flip = button(text="flip", onClick=flip)
tile Body = ${body}
tile App = column(Flip, Body)`);
    const [shownBefore, shownAfter] = await textBeforeAndAfterClick(source);
    expect(shownBefore).toContain(before);
    expect(shownAfter).toContain(after);
  });
});
