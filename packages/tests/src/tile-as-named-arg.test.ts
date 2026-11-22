import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { find, mountSource } from "./helpers/dom.ts";
import { loadSource } from "./helpers/load.ts";
import { withApp } from "./helpers/source.ts";

const program = (home: string) =>
  withApp(
    `tile Header = text("header")
tile Home = ${home}
slot c : Bool = true
slot xs : List(Int) = [1]`,
    "Home",
  );

describe("a tile as a builtin's named argument is refused by the compile an app is loaded through", () => {
  it.each([
    ["a when as a container's", `box(header=when(c, Header), text("body"))`],
    ["a for as a container's", `box(header=for x in xs Header, text("body"))`],
    ["a when as a progress's", `column(progress(value=1, max=when(c, Header)))`],
  ])("%s", async (_, home) => {
    expect(check(parse(lex(program(home)))).map((e) => e.code)).toEqual(["E0201"]);
    await expect(loadSource(program(home))).rejects.toThrow("E0201");
  });
});

describe("the fixes the message suggests mount", () => {
  it.each([
    ["a when", `box(when(c, Header), text("body"))`],
    ["a for", `box(for x in xs Header, text("body"))`],
  ])("%s written as a container's positional child is shown", async (_, home) => {
    const { root } = await mountSource(program(home));
    expect(root.textContent).toBe("headerbody");
  });

  it("a value passed as the named argument is the prop", async () => {
    const { root } = await mountSource(
      program(`column(progress(value=1, max=if c then 4 else 2))`),
    );
    expect(find(root, "progress").getAttribute("max")).toBe("4");
  });
});
