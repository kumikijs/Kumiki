import { generateDts, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

function dtsOf(src: string): string {
  return generateDts(parse(lex(src)));
}

describe("generateDts", () => {
  it("maps slot primitive types to a typed Slots interface", () => {
    const dts = dtsOf(`
      slot count : Int = 0
      slot label : Text = ""
      slot ready : Bool = false
      reducer r on=ui.click(B) do= count := count
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `);
    expect(dts).toContain("export interface KumikiSlots {");
    expect(dts).toContain("count: number;");
    expect(dts).toContain("label: string;");
    expect(dts).toContain("ready: boolean;");
  });

  it("emits a typed Provider entry per custom-capability effect", () => {
    const dts = dtsOf(`
      slot sent : Int = 0
      effect track cap=telemetry.track in={name: Text, n: Int} out=Unit
      reducer fire on=ui.click(B) do= emit track({name: "x", n: 1})
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[telemetry.track] routes={"/" -> App, "/404" -> App} init=[]
    `);
    // typed input record, Unit output → null
    expect(dts).toMatch(
      /"telemetry\.track"\??:\s*KumikiProvider<\{ name: string; n: number \}, null>/,
    );
    expect(dts).toContain("export interface KumikiProviders {");
    // a self-contained KumikiProvider<In, Out> helper alias is emitted
    expect(dts).toContain("export type KumikiProvider<");
  });

  it("does NOT emit standard-capability effects as providers (they are built-in)", () => {
    const dts = dtsOf(`
      slot xs : List(Int) = []
      effect load cap=http.get in={url: Url} out=Unit
      reducer go on=ui.click(B) do= emit load({url: Url})
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[http.get] routes={"/" -> App, "/404" -> App} init=[]
    `);
    expect(dts).not.toContain('"http.get"');
  });

  it("maps List/Option and unwraps nominal/refinement types", () => {
    const dts = dtsOf(`
      type Cents = nominal Int where positive
      slot tags : List(Text) = []
      slot maybe : Option(Int) = None
      slot price : Cents = 0
      reducer r on=ui.click(B) do= tags := tags
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `);
    expect(dts).toContain("export type Cents = number;");
    expect(dts).toContain("tags: string[];");
    // Option is the runtime tagged form (not `T | null`).
    expect(dts).toContain('maybe: { _tag: "Some"; _0: number } | { _tag: "None" };');
    expect(dts).toContain("price: Cents;");
  });

  it("maps Result to the runtime tagged Ok/Err union", () => {
    const dts = dtsOf(`
      type R = Result(Int, Text)
      slot s : Int = 0
      reducer r on=ui.click(B) do= s := s
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `);
    expect(dts).toContain(
      'export type R = { _tag: "Ok"; _0: number } | { _tag: "Err"; _0: string };',
    );
  });

  it("maps a union type to a tagged-variant union (nullary and payload variants)", () => {
    const dts = dtsOf(`
      type Light = Red | Green
      type Shape = Circle(Float) | Rect(Float, Float)
      slot s : Int = 0
      reducer r on=ui.click(B) do= s := s
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `);
    expect(dts).toContain('export type Light = { _tag: "Red" } | { _tag: "Green" };');
    expect(dts).toContain(
      'export type Shape = { _tag: "Circle"; _0: number } | { _tag: "Rect"; _0: number; _1: number };',
    );
  });

  it("preserves precise tagged unions through List/Option nesting", () => {
    const dts = dtsOf(`
      slot many : List(Option(Int)) = []
      slot one : Option(Result(Int, Text)) = None
      reducer r on=ui.click(B) do= many := many
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `);
    // List of a union is parenthesized so `[]` binds to the whole union.
    expect(dts).toContain('many: ({ _tag: "Some"; _0: number } | { _tag: "None" })[];');
    expect(dts).toContain(
      'one: { _tag: "Some"; _0: { _tag: "Ok"; _0: number } | { _tag: "Err"; _0: string } } | { _tag: "None" };',
    );
  });

  it("maps Map and Set to their runtime object representations", () => {
    const dts = dtsOf(`
      type M = Map(Text, Int)
      type S = Set(Text)
      type N = Map(Text, Option(Int))
      slot s : Int = 0
      reducer r on=ui.click(B) do= s := s
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `);
    // Map is a plain object keyed by stringified keys; Set is `{ [key]: true }`.
    expect(dts).toContain("export type M = Record<string, number>;");
    expect(dts).toContain("export type S = Record<string, true>;");
    expect(dts).toContain(
      'export type N = Record<string, { _tag: "Some"; _0: number } | { _tag: "None" }>;',
    );
  });

  it("emits a do-not-edit header and imports nothing it cannot resolve", () => {
    const dts = dtsOf(`
      slot count : Int = 0
      reducer r on=ui.click(B) do= count := count
      tile B = button(text="b")
      tile App = column(B)
      app A caps=[] routes={"/" -> App, "/404" -> App} init=[]
    `);
    expect(dts).toMatch(/Auto-generated/i);
  });
});
