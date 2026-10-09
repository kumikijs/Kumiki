import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string): string =>
  `${defs}\napp A\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

/** The call under test, wrapped in the smallest program that parses. */
const withCall = (decls: string, call: string): string =>
  app(`${decls}
reducer act on=ui.click(Btn)
    do= sink := ${call}
tile Btn = button(text="go")
tile App = column(Btn)`);

const errsOf = (src: string) => check(parse(lex(src)));
const codesOf = (src: string): string[] => errsOf(src).map((e) => e.code);

const MAP = `slot m : Map(Text, Int) = {}\nslot sink : Int = 0`;
const OPT = `slot o : Option(Int) = None\nslot sink : Int = 0`;
const RES = `slot r : Result(Int, Text) = Err("e")\nslot sink : Int = 0`;

describe("the receiver decides how many arguments .get-or takes", () => {
  it("rejects the Option reading on a Map, naming both readings", () => {
    const errs = errsOf(withCall(MAP, `m.get-or("k")`));
    const e = errs.find((x) => x.code === "E0213");
    expect(e).toBeDefined();
    expect(e?.kind).toBe("call-arity-mismatch");
    expect(e?.message).toContain(".get-or");
    expect(e?.message).toContain("Map");
    expect(e?.message).toContain("Option");
  });

  it.each([
    ["Option", OPT, `o.get-or("k", 0)`],
    ["Result", RES, `r.get-or("k", 0)`],
  ])("rejects the Map reading on %s", (name, decls, call) => {
    const errs = errsOf(withCall(decls, call));
    const e = errs.find((x) => x.code === "E0213");
    expect(e).toBeDefined();
    expect(e?.message).toContain(name);
    expect(e?.message).toContain("Map");
  });

  it("still rejects .get-or with no arguments", () => {
    expect(codesOf(withCall(OPT, `o.get-or()`))).toContain("E0213");
    expect(codesOf(withCall(MAP, `m.get-or()`))).toContain("E0213");
  });

  it.each([
    ["a Map", MAP, `m.get-or("k", 0, 1)`],
    ["a receiver the checker cannot decide", `slot sink : Int = 0`, `$event.get-or("k", 0, 1)`],
  ])("rejects a count past both readings on %s", (_label, decls, call) => {
    expect(codesOf(withCall(decls, call))).toContain("E0213");
  });

  it("names the receiver when it knows it, and both readings when it does not", () => {
    const known = errsOf(withCall(MAP, `m.get-or("k", 0, 1)`)).find((e) => e.code === "E0213");
    expect(known?.message).toContain('on "Map"');

    const dynamic = errsOf(withCall(`slot sink : Int = 0`, `$event.get-or("k", 0, 1)`)).find(
      (e) => e.code === "E0213",
    );
    expect(dynamic?.message).not.toContain('on "');
    expect(dynamic?.message).toContain("(default)");
    expect(dynamic?.message).toContain("(key, default)");
  });
});

describe("what stays legal", () => {
  it.each([
    ["the Map reading on a Map", MAP, `m.get-or("k", 0)`],
    ["the Option reading on an Option", OPT, `o.get-or(0)`],
    ["the Option reading on a Result", RES, `r.get-or(0)`],
  ])("accepts %s", (_label, decls, call) => {
    expect(errsOf(withCall(decls, call))).toEqual([]);
  });

  it("accepts the Option reading on a member that answers one", () => {
    const errs = errsOf(
      withCall(`slot xs : List(Int) = []\nslot sink : Int = 0`, `xs.head.get-or(0)`),
    );
    expect(errs).toEqual([]);
  });
});

describe("a receiver the checker cannot decide stays silent", () => {
  it("says nothing about a lambda parameter whose type is undecided", () => {
    const errs = errsOf(
      withCall(
        `slot xs : List(Int) = []\nslot sink : List(Int) = []`,
        `xs.fold([], $1.push($2)).map($1.get-or(0))`,
      ),
    );
    expect(errs).toEqual([]);
  });

  it("says nothing about an event payload, which carries no declared type", () => {
    expect(codesOf(withCall(`slot sink : Int = 0`, `$event.get-or(0)`))).not.toContain("E0213");
  });

  it("does not report the count on a union receiver", () => {
    const decls = `type F = All | Done\nslot f : F = All\nslot sink : Int = 0`;
    expect(codesOf(withCall(decls, `f.get-or(0)`))).not.toContain("E0213");
    expect(codesOf(withCall(decls, `f.get-or("k", 0)`))).not.toContain("E0213");
  });
});
