import type { Expr } from "@kumikijs/compiler";
import { lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import { checkSource } from "./helpers/diagnostics.ts";
import { withApp } from "./helpers/programs.ts";

function parsed(literal: string): Expr {
  const def = parse(lex(`slot s : Int = ${literal}`)).defs[0];
  if (def?.kind !== "SlotDef") throw new Error(`expected a slot, found ${def?.kind}`);
  return def.init;
}

const diagnostics = (defs: string): string[] =>
  checkSource(withApp(`${defs}\ntile Go = button(text="go")\ntile App = column(Go)`)).map(
    (e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`,
  );

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

  it("of one entry is a Map too", () => {
    expect(parsed("{true: 1}")).toMatchObject({
      kind: "MapLit",
      entries: [{ key: { kind: "Bool", value: true }, value: { kind: "Num", value: 1 } }],
    });
    expect(parsed("{now: x}")).toMatchObject({
      kind: "MapLit",
      entries: [{ key: { kind: "Call", callee: "now" }, value: { kind: "Ref", name: "x" } }],
    });
  });

  it("is the same Map the parenthesised key writes", () => {
    const strip = (e: Expr): string => JSON.stringify(e, (k, v) => (k === "pos" ? undefined : v));
    expect(strip(parsed('{true: "on", false: "off"}'))).toBe(
      strip(parsed('{(true): "on", false: "off"}')),
    );
  });
});

describe("a reserved word that is not a value is a record field name", () => {
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

describe("a value keyword where a record field name goes", () => {
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

  // No Map entry is a key without a `:` after it, so these are a record's first field.
  it.each([
    ["{true}", "true"],
    ["{false}", "false"],
    ["{now}", "now"],
    ["{true, false}", "true"],
    ["{true = 1}", "true"],
    ["{now = x}", "now"],
  ])("is refused as the first key of %s", (literal, keyword) => {
    expect(() => parsed(literal)).toThrow(
      `Parse error at 1:17: \`${keyword}\` is a value, not a record field name`,
    );
  });
});

describe("`null` as a key", () => {
  it("makes the literal a Map whose key is `null`", () => {
    expect(parsed("{null: 1}")).toMatchObject({
      kind: "MapLit",
      entries: [{ key: { kind: "Null" }, value: { kind: "Num", value: 1 } }],
    });
  });

  it("is E0235 at the key, and the Map is checked as any other", () => {
    expect(diagnostics("slot m : Map(Int, Int) = {null: 1}")).toEqual([
      "E0235 1:27 `null` is not a value — Kumiki has no null. Where a value may be absent, declare Option(T) and write None for no value, Some(x) for one",
    ]);
  });

  it.each([
    ["{null}", 17],
    ["{null = 1}", 17],
    ["{a: 1, null: 2}", 23],
    ["{a, null}", 20],
  ])("is refused where a record field name goes in %s", (literal, col) => {
    expect(() => parsed(literal)).toThrow(
      `Parse error at 1:${col}: \`null\` is not a record field name, and not a value — Kumiki has no null`,
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

  it("and a value of the wrong type is E0201 at that value", () => {
    expect(diagnostics('slot labels : Map(Bool, Text) = {true: 1, false: "off"}')).toEqual([
      "E0201 1:40 Expected Text but got Int",
    ]);
  });

  it.each([
    ["true", "Bool"],
    ["now", "Time"],
  ])("and a `%s` key against an Int key type is E0201 at that key", (key, type) => {
    expect(diagnostics(`slot labels : Map(Int, Text) = {${key}: "a"}`)).toEqual([
      `E0201 1:33 Expected Int but got ${type}`,
    ]);
  });
});
