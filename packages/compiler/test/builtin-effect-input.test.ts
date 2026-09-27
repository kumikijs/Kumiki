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
import { BUILTIN_EFFECT_CAPS, BUILTIN_EFFECTS } from "../src/capabilities.ts";

const program = (body: string) => `slot n : Int = 0
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

  it("reports a field navigate does not take", () => {
    expect(diagnostics(`emit navigate({path: "/", hash: "x"})`).map((d) => d.slice(0, 5))).toEqual([
      "E0215",
    ]);
  });
});

describe("the shapes the built-ins take are still accepted", () => {
  it.each([
    `navigate({path: "/", params: {}, query: {}})`,
    `navigate({path: "/", params: {}})`,
    // routing.md §3.7: `params` and `query` default to `{}` when unspecified.
    `navigate({path: "/x"})`,
    `navigate-replace({path: "/x", query: {"q": "1"}})`,
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

describe("the table the checker reads is the one stdlib.md §2.6 writes", () => {
  // §2.6 says it "is the list the compiler holds": each `effect` line there
  // names the capability and the `in=` of one entry of `BUILTIN_EFFECTS`.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const stdlib = readFileSync(path.resolve(here, "../../../docs/spec/stdlib.md"), "utf8");
  const section = stdlib.slice(
    stdlib.indexOf("## 2.6 Standard Effects"),
    stdlib.indexOf("## 2.7 "),
  );
  const blocks = [...section.matchAll(/```kumiki[^\n]*\n([\s\S]*?)```/g)].map((m) =>
    (m[1] ?? "").replace(/\s+/g, " "),
  );
  const written = new Map(
    blocks
      .flatMap((b) => [...b.matchAll(/effect ([a-z-]+) (?:cap=(\S+) )?in=(.+?) out=/g)])
      .map((m) => [m[1] ?? "", { cap: m[2] ?? null, in: m[3] ?? "" }]),
  );

  it("lists the same effects", () => {
    expect([...written.keys()].sort()).toEqual([...BUILTIN_EFFECTS.keys()].sort());
  });

  it.each([...BUILTIN_EFFECTS])("%s has the capability and in= the spec gives it", (name, e) => {
    expect({ cap: e.cap, in: typeToString(e.in) }).toEqual(written.get(name));
  });

  it("derives every capability from the same entries", () => {
    expect([...BUILTIN_EFFECT_CAPS]).toEqual([...BUILTIN_EFFECTS].map(([n, e]) => [n, e.cap]));
  });
});
