import { FIELD_ACCESS_SHORTCUTS, KNOWN_METHODS } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";
import { compileOrFail } from "./helpers/module.ts";
import { withApp } from "./helpers/programs.ts";

describe("receiver type inference", () => {
  it("a record field named like a method (head) is read as a field, not shadowed", () => {
    const js = compileOrFail(
      withApp(`type Node = { head: Int, tail: Int }
slot n : Node = { head: 1, tail: 2 }
tile App = column(heading(n.head.show))`),
    );
    // A field read, not the List.head shortcut.
    expect(js).not.toContain("_s.listHead(");
    expect(js).toContain('["head"]');
  });

  it("a genuine List receiver still uses the head shortcut", () => {
    const js = compileOrFail(
      withApp(`slot xs : List(Int) = [1, 2, 3]
tile App = column(heading(xs.head.show))`),
    );
    expect(js).toContain("_s.listHead(");
  });

  it("an unknown member on a record type is E0108, not a silent undefined", () => {
    const errs = checkSource(
      withApp(`type Node = { head: Int, tail: Int }
slot n : Node = { head: 1, tail: 2 }
tile App = column(heading(n.bogus.show))`),
    );
    expect(errs.some((e) => e.code === "E0108")).toBe(true);
  });

  it("an unknown member on a List type is E0108", () => {
    const errs = checkSource(
      withApp(`slot xs : List(Int) = [1, 2, 3]
tile App = column(heading(xs.bogus.show))`),
    );
    expect(errs.some((e) => e.code === "E0108")).toBe(true);
  });

  it("a real record field that is NOT a method name still compiles clean (no E0108)", () => {
    const errs = checkSource(
      withApp(`type Post = { title: Text, body: Text }
slot p : Post = { title: "t", body: "b" }
tile App = column(heading(p.title))`),
    );
    expect(errs.filter((e) => e.code === "E0108")).toEqual([]);
  });

  it("a dynamic receiver (untyped reducer payload) keeps shortcut dispatch with no E0108", () => {
    const errs = checkSource(
      withApp(`slot s : Text = ""
reducer r on=ui.input(B) do= s := $event.value
tile B = input(value=s)
tile App = column(B)`),
    );
    expect(errs.filter((e) => e.code === "E0108")).toEqual([]);
  });

  it("unwraps Option(.get) then resolves the inner record field as a field", () => {
    const js = compileOrFail(
      withApp(`slot editor : Option({title: Text, body: Text}) = None
tile T = input(value=editor.get.title)
tile App = column(T)`),
    );
    expect(js).toContain('["title"]'); // .title read as a field on the unwrapped record
  });

  it("a tile `in` record resolves a method-named field as a field", () => {
    const js = compileOrFail(
      withApp(`type Node = { head: Text, size: Int }
tile Row in=Node = text($1.head)
tile App = column(Row({head: "h", size: 1}))`),
    );
    expect(js).not.toContain("_s.listHead(");
    expect(js).toContain('["head"]');
  });

  it("every FieldAccess shortcut is also in KNOWN_METHODS (symmetric dispatch)", () => {
    for (const m of FIELD_ACCESS_SHORTCUTS) expect(KNOWN_METHODS.has(m), m).toBe(true);
  });
});
