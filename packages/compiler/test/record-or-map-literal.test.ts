// `{ … }` is a record literal or a Map literal, and the parser tells them
// apart by the first key (language.md §1.9): a field name followed by `:`,
// `=`, `,` or `}` makes the literal a record. A field name is an identifier
// or a reserved word, except the reserved words that are a whole value on
// their own — `true`, `false` and `now`. Those are keys, so
// `{true: "on", false: "off"}` is a `Map(Bool, Text)`, not a record with a
// field named `true` that no record type can declare. Rendering each form is
// pinned in `packages/tests/record-or-map-literal.test.ts`.

import type { Expr } from "@kumikijs/compiler";
import { check, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

/** The expression `literal` parses to, written as a slot's initial value. */
function parsed(literal: string): Expr {
  const def = parse(lex(`slot s : Int = ${literal}`)).defs[0];
  if (def?.kind !== "SlotDef") throw new Error(`expected a slot, found ${def?.kind}`);
  return def.init;
}

/** Every diagnostic as `code line:col message`, for `defs` inside a minimal app. */
function diagnostics(defs: string): string[] {
  const src = `${defs}
tile Go = button(text="go")
tile App = column(Go)
app A
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []`;
  return check(parse(lex(src))).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);
}

describe("a value keyword as the first key", () => {
  it.each([
    ["true", '{true: "on", false: "off"}', [true, false]],
    ["false", '{false: "off", true: "on"}', [false, true]],
  ])("`%s` makes the literal a Map with Bool keys", (_first, literal, keys) => {
    const e = parsed(literal);
    if (e.kind !== "MapLit") throw new Error(`expected a MapLit, found ${e.kind}`);
    expect(e.entries.map((en) => en.key)).toMatchObject(
      keys.map((value) => ({ kind: "Bool", value })),
    );
    expect(e.entries.map((en) => en.value)).toMatchObject([{ kind: "Str" }, { kind: "Str" }]);
  });

  it("`now` makes the literal a Map keyed by the current time", () => {
    expect(parsed('{now: "start"}')).toMatchObject({
      kind: "MapLit",
      entries: [{ key: { kind: "Call", callee: "now", args: [] }, value: { kind: "Str" } }],
    });
  });

  it("is the same Map the parenthesised key already wrote", () => {
    const strip = (e: Expr): string => JSON.stringify(e, (k, v) => (k === "pos" ? undefined : v));
    expect(strip(parsed('{true: "on", false: "off"}'))).toBe(
      strip(parsed('{(true): "on", false: "off"}')),
    );
  });
});

describe("a reserved word that is not a value stays a record field name", () => {
  it.each([
    ["type", "{type: ui.click, target: Go}", ["type", "target"]],
    ["for", '{for: "name"}', ["for"]],
    ["in", "{in = 1, out = 2}", ["in", "out"]],
  ])("`%s`", (_first, literal, names) => {
    const e = parsed(literal);
    if (e.kind !== "RecordLit") throw new Error(`expected a RecordLit, found ${e.kind}`);
    expect(e.fields.map((f) => f.name)).toEqual(names);
  });
});

describe("a value keyword after a record's first field", () => {
  it("is not a field name, by the same rule as the first key", () => {
    expect(() => parsed("{a: 1, true: 2}")).toThrow(
      "Parse error at 1:23: `true` is a value, not a record field name",
    );
  });

  it("is refused in the shorthand form too", () => {
    expect(() => parsed("{a, now}")).toThrow(
      "Parse error at 1:20: `now` is a value, not a record field name",
    );
  });
});

describe("the Map literal checks against its declared Map type", () => {
  it("as a slot's initial value", () => {
    expect(diagnostics('slot labels : Map(Bool, Text) = {true: "on", false: "off"}')).toEqual([]);
  });

  it("as a reducer write", () => {
    expect(
      diagnostics(`slot labels : Map(Bool, Text) = {}
reducer fill on=ui.click(Go) do= labels := {true: "on", false: "off"}`),
    ).toEqual([]);
  });

  it("with `now` as a Time key", () => {
    expect(
      diagnostics(`slot stamps : Map(Time, Text) = {}
reducer fill on=ui.click(Go) do= stamps := {now: "start"}`),
    ).toEqual([]);
  });

  // Read as a record, the whole literal was the mismatch; read as a Map, each
  // entry is checked against `V`, so the report lands on the value itself.
  it("and a value of the wrong type is E0201 at that value", () => {
    expect(diagnostics('slot labels : Map(Bool, Text) = {true: 1, false: "off"}')).toEqual([
      "E0201 1:40 Expected Text but got Int",
    ]);
  });
});
