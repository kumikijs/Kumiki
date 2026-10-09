// A built-in effect's argument is checked like a declared effect's: E0213 for
// the count, E0202 against its `in=` (stdlib.md §2.6).
//
// `checkEmitTarget` stopped after the capability check for every built-in,
// because a built-in has no `effect` declaration to read an `in=` off. So
// `emit navigate("/about")` checked ok, and at run time the router read `.path`
// off a string and never moved.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { typeToString } from "../src/assignable.ts";
import type { TypeExpr } from "../src/ast.ts";
import {
  BUILTIN_EFFECT_CAPS,
  BUILTIN_EFFECTS,
  type BuiltinEffect,
  REDUCER_REF,
} from "../src/capabilities.ts";
import { STDLIB_TYPES } from "../src/stdlib-types.ts";

const program = (body: string) => `slot n : Int = 0
slot cfg : {path: Text} = {path: "/x"}
slot wide : {path: Text, hash: Text} = {path: "/x", hash: "h"}
reducer yes on=ui.click(B) do= n := 1
reducer no  on=ui.click(B) do= n := 2
reducer go  on=ui.click(B) do= ${body}
tile B = button(text="go")
tile App = column(B)
app A
    caps   = [nav.push, nav.replace, nav.back, notification.show, log.write]
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

const diagnostics = (body: string) =>
  check(parse(lex(program(body)))).map((e) => `${e.code} ${e.message}`);

describe("a built-in effect's argument count", () => {
  it.each([
    ["navigate-back(1)", `Effect "navigate-back" expects 0 argument(s) but got 1`],
    ["navigate()", `Effect "navigate" expects 1 argument(s) but got 0`],
    [
      `log({level: "info", message: "m", data: {}}, 43)`,
      `Effect "log" expects 1 argument(s) but got 2`,
    ],
    ["toast()", `Effect "toast" expects 1 argument(s) but got 0`],
  ])("emit %s is E0213", (call, message) => {
    expect(diagnostics(`emit ${call}`)).toEqual([`E0213 ${message}`]);
  });
});

describe("a built-in effect's argument type", () => {
  it('emit navigate("/about") is E0202 against the record navigate takes', () => {
    expect(diagnostics(`emit navigate("/about")`)).toEqual([
      "E0202 Expected {path: Text, params: Map(Text, Text), query: Map(Text, Text)} but got Text",
    ]);
  });

  it.each([
    [
      `toast("Saved")`,
      "E0202 Expected {kind: Text, text: Text, duration: Option(Duration)} but got Text",
    ],
    [`scroll-to("top")`, "E0202 Expected {x: Int, y: Int} but got Text"],
    [`toast({kind: "info", text: 42, duration: None})`, "E0202 Expected Text but got Int"],
    [`navigate({path: 1})`, "E0202 Expected Text but got Int"],
    [`log(42)`, "E0202 Expected {level: Text, message: Text, data: Map(Text, Text)} but got Int"],
    [`confirm({title: 3, onYes: yes, onNo: no})`, "E0202 Expected Text but got Int"],
    [`confirm({title: "t", message: 3, onYes: yes, onNo: no})`, "E0202 Expected Text but got Int"],
  ])("emit %s", (call, expected) => {
    expect(diagnostics(`emit ${call}`)).toEqual([expected]);
  });

  it("names the whole in= when a value of another record type is passed", () => {
    // Leaving `params` / `query` out is allowed, and the message still names
    // the record `navigate` takes, not the part this call happened to write.
    expect(diagnostics(`emit navigate(wide)`)).toEqual([
      "E0202 Expected {path: Text, params: Map(Text, Text), query: Map(Text, Text)} but got {path: Text, hash: Text}",
    ]);
  });

  it.each([
    [`confirm({title: "t", onYes: 42, onNo: no})`, "E0202 Expected ReducerRef but got Int"],
    [`confirm({title: "t", onYes: yes, onNo: n > 0})`, "E0202 Expected ReducerRef but got Bool"],
    // A bare name is resolved as a reducer, and one that is not is E0103 alone.
    [
      `confirm({title: "t", onYes: yes, onNo: n})`,
      `E0103 confirm "onNo" refers to undefined reducer "n"`,
    ],
    [`confirm({title: "t", onYes: yes, onNo: "no"})`, "E0202 Expected ReducerRef but got Text"],
  ])("emit %s: onYes / onNo name a reducer", (call, expected) => {
    expect(diagnostics(`emit ${call}`)).toEqual([expected]);
  });

  it("reports a field navigate does not take", () => {
    expect(diagnostics(`emit navigate({path: "/", hash: "x"})`).map((d) => d.slice(0, 5))).toEqual([
      "E0215",
    ]);
  });
});

describe("a field a built-in does not default is required", () => {
  // stdlib.md §2.6: only an `Option(T)` field and the ones the entry defaults
  // (`navigate`'s `params` / `query`, `confirm`'s `message`) may be left out.
  it.each([
    [`navigate({params: {}, query: {}})`, `"path" of type Text`],
    [`navigate-replace({query: {}})`, `"path" of type Text`],
    [`confirm({message: "m", onYes: yes, onNo: no})`, `"title" of type Text`],
    [`confirm({title: "t", onYes: yes})`, `"onNo" of type ReducerRef`],
    [`toast({kind: "info"})`, `"text" of type Text`],
    [`log({level: "info", message: "m"})`, `"data" of type Map(Text, Text)`],
    [`scroll-to({x: 0})`, `"y" of type Int`],
  ])("emit %s is E0214", (call, field) => {
    expect(diagnostics(`emit ${call}`)).toEqual([`E0214 Record literal is missing field ${field}`]);
  });

  it("holds each branch of an if to the fields it leaves out itself", () => {
    expect(
      diagnostics(`emit navigate(if n > 0 then {path: "/a"} else {params: {}, query: {}})`),
    ).toEqual([`E0214 Record literal is missing field "path" of type Text`]);
  });
});

describe("the shapes the built-ins take are still accepted", () => {
  it.each([
    `navigate({path: "/", params: {}, query: {}})`,
    `navigate({path: "/", params: {}})`,
    // routing.md §3.7: `params` and `query` default to `{}` when unspecified.
    `navigate({path: "/x"})`,
    `navigate-replace({path: "/x", query: {"q": "1"}})`,
    `navigate-replace({path: "/x"})`,
    // A value whose type leaves the defaulted fields out, and a branch or a
    // `let` body that does: each leaf is held to the fields it writes itself.
    `navigate(cfg)`,
    `navigate(if n > 0 then {path: "/a"} else {path: "/b", query: {}})`,
    `navigate(let p = {path: "/a"} in p)`,
    `navigate-back()`,
    `scroll-to({x: 0, y: 0})`,
    // An `Option` field may be left out: it reads as `None`.
    `toast({kind: "info", text: "notified"})`,
    `toast({kind: "success", text: "Saved", duration: Some(Duration.s(3))})`,
    `log({level: "error", message: "m", data: {}})`,
    `confirm({title: "Discard?", onYes: yes, onNo: no})`,
    `confirm({title: "Discard?", message: "Unsaved edits.", onYes: yes, onNo: no})`,
  ])("emit %s", (call) => {
    expect(diagnostics(`emit ${call}`)).toEqual([]);
  });
});

describe("a declaration under a standard effect's name", () => {
  // The declaration is E0234 (reserved-effect-name.test.ts): the runtime
  // registers the standard effect under that name at mount. An argument is
  // still held to the declaration's `in=`, the one the program wrote it for.
  const shadowed = `effect navigate cap=nav.push in=Text out=Unit\n`;
  const reserved = `E0234 Effect "navigate" collides with the built-in effect navigate; emits of it never run this effect`;
  it("takes the declaration's in=", () => {
    expect(diagnostics(`emit navigate("/about")\n${shadowed}`)).toEqual([reserved]);
  });
  it("and reports against it", () => {
    expect(diagnostics(`emit navigate({path: "/about"})\n${shadowed}`)).toEqual([
      "E0202 Expected Text but got {path: Text}",
      reserved,
    ]);
  });
});

describe("the table the checker reads is the one the spec writes", () => {
  // stdlib.md §2.6 says it "is the list the compiler holds": each `effect` line
  // there names the capability and the `in=` of one entry of `BUILTIN_EFFECTS`.
  // Both tracks carry the same fenced blocks, so the slice is anchored on the
  // section numbers alone.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const spec = (track: string, file: string) =>
    readFileSync(path.resolve(here, `../../../docs/${track}spec/${file}`), "utf8");
  const effectLines = (text: string) =>
    new Map(
      [...text.matchAll(/```kumiki[^\n]*\n([\s\S]*?)```/g)]
        .map((m) => (m[1] ?? "").replace(/\s+/g, " "))
        .flatMap((b) => [...b.matchAll(/effect ([a-z-]+) (?:cap=(\S+) )?in=(.+?) out=/g)])
        .map((m) => [m[1] ?? "", { cap: m[2] ?? null, in: m[3] ?? "" }]),
    );
  const TRACKS = { en: "", ja: "ja/" } as const;

  describe.each(Object.entries(TRACKS))("%s", (_, track) => {
    const stdlib = spec(track, "stdlib.md");
    const written = effectLines(stdlib.slice(stdlib.indexOf("## 2.6 "), stdlib.indexOf("## 2.7 ")));

    it("lists the same effects", () => {
      expect([...written.keys()].sort()).toEqual([...BUILTIN_EFFECTS.keys()].sort());
    });

    it.each([...BUILTIN_EFFECTS])("%s has the capability and in= the spec gives it", (name, e) => {
      expect({ cap: e.cap, in: typeToString(e.inType) }).toEqual(written.get(name));
    });

    it("routing.md §3.7 writes navigate's in= the same way", () => {
      const routing = spec(track, "routing.md");
      const navigate = effectLines(
        routing.slice(routing.indexOf("## 3.7 "), routing.indexOf("## 3.8 ")),
      ).get("navigate");
      expect(navigate).toEqual({
        cap: "nav.push",
        in: typeToString((BUILTIN_EFFECTS.get("navigate") as BuiltinEffect).inType),
      });
    });
  });

  it("names no type the checker cannot resolve", () => {
    // `checkAgainst` passes anything held to a name that resolves to nothing,
    // so a misspelt or invented name here would check no argument at all.
    // `ReducerRef` is the one name with no definition: the checker matches the
    // table's own node, not the name.
    const known = new Set(STDLIB_TYPES.map((t) => t.name));
    const refs = (t: TypeExpr): TypeExpr[] =>
      t.kind === "TypeRef"
        ? [t]
        : t.kind === "TypeApp"
          ? t.args.flatMap(refs)
          : t.kind === "TypeRecord"
            ? t.fields.flatMap((f) => refs(f.type))
            : [];
    const unresolved = [...BUILTIN_EFFECTS].flatMap(([name, e]) =>
      refs(e.inType)
        .filter((r) => r !== REDUCER_REF && !(r.kind === "TypeRef" && known.has(r.name)))
        .map((r) => `${name}: ${typeToString(r)}`),
    );
    expect(unresolved).toEqual([]);
  });

  it("derives every capability from the same entries", () => {
    expect([...BUILTIN_EFFECT_CAPS]).toEqual([...BUILTIN_EFFECTS].map(([n, e]) => [n, e.cap]));
  });
});
