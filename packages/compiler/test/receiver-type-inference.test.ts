import {
  check,
  compile,
  FIELD_ACCESS_SHORTCUTS,
  KNOWN_METHODS,
  lex,
  parse,
} from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

// ADR-002 / issue #23: `recv.m` (the parenthesis-free shortcut) must dispatch
// field-vs-method by the receiver's INFERRED type, not by name alone — so a
// record field named like a method is read as a field (no shadow), a genuine
// stdlib receiver still gets the shortcut, and an unknown member on a known type
// is a diagnostic (E0108) instead of a silent `undefined`.

const compileOk = (src: string): string => {
  const r = compile(src, { runtimeSpecifier: "./runtime.js" });
  if (r.kind !== "ok") throw new Error(`compile failed: ${JSON.stringify(r.errors ?? r)}`);
  return r.js;
};
const errsOf = (src: string) => check(parse(lex(src)));
const app = (defs: string): string =>
  `${defs}\napp A\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

describe("receiver type inference (#23, ADR-002)", () => {
  it("a record field named like a method (head) is read as a field, not shadowed", () => {
    const js = compileOk(
      app(`type Node = { head: Int, tail: Int }
slot n : Node = { head: 1, tail: 2 }
tile App = column(heading(n.head.show))`),
    );
    // Must lower to a field read, NOT the List.head shortcut.
    expect(js).not.toContain("_s.listHead(");
    expect(js).toContain('["head"]');
  });

  it("a genuine List receiver still uses the head shortcut", () => {
    const js = compileOk(
      app(`slot xs : List(Int) = [1, 2, 3]
tile App = column(heading(xs.head.show))`),
    );
    expect(js).toContain("_s.listHead(");
  });

  it("an unknown member on a record type is E0108, not a silent undefined", () => {
    const errs = errsOf(
      app(`type Node = { head: Int, tail: Int }
slot n : Node = { head: 1, tail: 2 }
tile App = column(heading(n.bogus.show))`),
    );
    expect(errs.some((e) => e.code === "E0108")).toBe(true);
  });

  it("an unknown member on a List type is E0108", () => {
    const errs = errsOf(
      app(`slot xs : List(Int) = [1, 2, 3]
tile App = column(heading(xs.bogus.show))`),
    );
    expect(errs.some((e) => e.code === "E0108")).toBe(true);
  });

  it("a real record field that is NOT a method name still compiles clean (no E0108)", () => {
    const errs = errsOf(
      app(`type Post = { title: Text, body: Text }
slot p : Post = { title: "t", body: "b" }
tile App = column(heading(p.title))`),
    );
    expect(errs.filter((e) => e.code === "E0108")).toEqual([]);
  });

  it("a dynamic receiver (untyped reducer payload) keeps shortcut dispatch with no E0108", () => {
    const errs = errsOf(
      app(`slot s : Text = ""
reducer r on=ui.input(B) do= s := $event.value
tile B = input(value=s)
tile App = column(B)`),
    );
    expect(errs.filter((e) => e.code === "E0108")).toEqual([]);
  });

  it("unwraps Option(.get) then resolves the inner record field as a field", () => {
    const js = compileOk(
      app(`slot editor : Option({title: Text, body: Text}) = None
tile T = input(value=editor.get.title)
tile App = column(T)`),
    );
    expect(js).toContain('["title"]'); // .title read as a field on the unwrapped record
  });

  it("a tile `in` record resolves a method-named field as a field", () => {
    const js = compileOk(
      app(`type Node = { head: Text, size: Int }
tile Row in=Node = text($1.head)
tile App = column(Row({head: "h", size: 1}))`),
    );
    expect(js).not.toContain("_s.listHead(");
    expect(js).toContain('["head"]');
  });

  // ADR-002 symmetry: every no-paren FieldAccess shortcut must also be a known
  // method (so `recv.m` and `recv.m()` agree, and the diagnostic set is correct).
  it("every FieldAccess shortcut is also in KNOWN_METHODS (symmetric dispatch)", () => {
    for (const m of FIELD_ACCESS_SHORTCUTS) expect(KNOWN_METHODS.has(m), m).toBe(true);
  });
});
