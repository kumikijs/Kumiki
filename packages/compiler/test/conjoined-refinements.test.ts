import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@kumikijs/compiler";
import type { AppShape, SlotMeta } from "@kumikijs/runtime";
import { beforeAll, describe, expect, it } from "vitest";
import type { TypeDef } from "../src/ast.ts";
import { refinementsOf } from "../src/codegen/emit-type.ts";
import { lex } from "../src/lexer.ts";
import { parse } from "../src/parser.ts";
import { defined } from "./helpers/defined.ts";

const TMP_ROOT = resolve(__dirname, "test-tmp");
mkdirSync(TMP_ROOT, { recursive: true });

const SRC = `
type Handle  = nominal Text where len-gt(3) where len-lt(9)
type Chained = nominal Short where len-gt(3)
type Short   = Text where len-lt(9)
type Bare    = nominal Short
type Tight   = nominal Short where len-gt(3) where nonempty
type Volume  = nominal Int where between(0, 11)
type Address = nominal Text where nonempty where email
type Opaque  = nominal Text where email where uuid
type Both    = Text where len-gt(3) where len-lt(9)
type Triple  = nominal Text where len-gt(3) where len-lt(9) where nonempty
type Thread  = {label: Text, replies: List(Thread)}
type NonEmpty(T) = T where nonempty
type Named(T)    = nominal NonEmpty(T) where len-gt(1)
type Hands(T)    = NonEmpty(T)

slot h   : Handle  = "kumiki"
slot c   : Chained = "kumiki"
slot b   : Bare    = "kumiki"
slot g   : Tight   = "kumiki"
slot v   : Volume  = 5
slot a   : Address = ""
slot o   : Opaque  = ""
slot d   : Both    = "kumiki"
slot p   : Triple  = "kumiki"
slot n   : Int     = 1
slot t   : Thread  = {label: "root", replies: []}
slot ng  : NonEmpty(Text)   = "kumiki"
slot nh  : NonEmpty(Short)  = "kumiki"
slot nn  : Named(Handle)    = "kumiki"
slot hh  : Hands(Text)      = "kumiki"
slot gg  : NonEmpty(NonEmpty(Short)) = "ku"
slot gn  : NonEmpty(Named(Short))    = "ku"

tile App = text("x")

app Refined
    caps   = []
    routes = {"/" -> App, "/404" -> App}
    init   = []
`;

let slots: Record<string, SlotMeta>;

beforeAll(async () => {
  const result = compile(SRC, { runtimeSpecifier: "@kumikijs/runtime", exportApp: true });
  if (result.kind !== "ok") throw new Error(JSON.stringify(result.errors));
  const dir = mkdtempSync(join(TMP_ROOT, "refine-"));
  const file = join(dir, "app.mjs");
  writeFileSync(file, result.js);
  const mod: { default: AppShape } = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  slots = mod.default.slots;
}, 30_000);

const meta = (name: string): SlotMeta => defined(slots[name], `slot "${name}"`);
const refineOf = (name: string): ((v: unknown) => boolean) =>
  defined(meta(name).refine, `slot "${name}"'s refinement`);

describe("a type's predicates conjoin", () => {
  it("tests every `where` a type carries, not just the outermost", () => {
    const refine = refineOf("h");
    expect(refine("kumiki")).toBe(true);
    // The inner predicate is the one that used to be dropped.
    expect(refine("ab")).toBe(false);
    expect(refine("kumikijs!")).toBe(false);
  });

  it("collects the predicates a named type hides behind an alias chain", () => {
    const refine = refineOf("c");
    expect(refine("kumiki")).toBe(true);
    expect(refine("ab")).toBe(false);
    expect(refine("kumikijs!")).toBe(false);
  });

  it("carries each predicate's name and arguments, base outward", () => {
    const m = meta("h");
    expect(m.refineAll).toEqual([
      { kind: "len-gt", args: [3], refine: expect.any(Function) },
      { kind: "len-lt", args: [9], refine: expect.any(Function) },
    ]);
    expect(m.refineKind).toBe("len-gt");
    expect(m.refineArgs).toEqual([3]);
  });

  it("orders a chain by what it is declared over, not by declaration order", () => {
    expect(meta("c").refineAll?.map((r) => r.kind)).toEqual(["len-lt", "len-gt"]);
    expect(meta("c").refineKind).toBe("len-lt");
  });

  it("conjoins three predicates reached through two names", () => {
    const m = meta("g");
    expect(m.refineAll?.map((r) => r.kind)).toEqual(["len-lt", "len-gt", "nonempty"]);
    const refine = refineOf("g");
    expect(refine("kumiki")).toBe(true);
    expect(refine("ab")).toBe(false); // len-gt(3)
    expect(refine("kumikijs!")).toBe(false); // len-lt(9)
    expect(refine("")).toBe(false); // nonempty (and len-gt)
  });

  it("collects the predicates of a layer that carries no `where` of its own", () => {
    const m = meta("b");
    expect(m.refineKind).toBe("len-lt");
    expect(m.refineAll).toBeUndefined(); // `Short` carries exactly one
    expect(refineOf("b")("kumikijs!")).toBe(false);
  });

  it("leaves a single-predicate slot exactly as it was", () => {
    const m = meta("v");
    expect(m.refineAll).toBeUndefined();
    expect(m.refineKind).toBe("between");
    expect(m.refineArgs).toEqual([0, 11]);
    expect(refineOf("v")(12)).toBe(false);
  });

  it("emits no refinement for a type that carries none", () => {
    expect(meta("n").refine).toBeUndefined();
    expect(meta("n").refineAll).toBeUndefined();
  });

  it("makes every predicate in the chain a test of its own", () => {
    const refine = refineOf("a");
    expect(refine("")).toBe(false); // nonempty (and email)
    expect(refine("not-an-address")).toBe(false); // email
    expect(refine("ada@example.com")).toBe(true);
    const parts = defined(meta("a").refineAll, "a's predicates");
    expect(parts.map((r) => r.kind)).toEqual(["nonempty", "email"]);
    expect(defined(parts[1], "the email entry").refine("")).toBe(false);
  });

  it("refuses every value when the predicates it conjoins share none", () => {
    const refine = refineOf("o");
    expect(refine("")).toBe(false);
    expect(refine("ada@example.com")).toBe(false);
    expect(refine("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(false);
    expect(meta("o").refineAll?.map((r) => r.kind)).toEqual(["email", "uuid"]);
  });

  it("collects three predicates written on one type expression", () => {
    expect(meta("p").refineAll?.map((r) => r.kind)).toEqual(["len-gt", "len-lt", "nonempty"]);
    const refine = refineOf("p");
    expect(refine("kumiki")).toBe(true);
    expect(refine("kumikijs!")).toBe(false);
  });

  it("reads a `where` chain written without `nominal`", () => {
    const refine = refineOf("d");
    expect(refine("kumiki")).toBe(true);
    expect(refine("ab")).toBe(false);
    expect(refine("kumikijs!")).toBe(false);
  });

  it("terminates on a type written in terms of itself", () => {
    expect(meta("t").refine).toBeUndefined();
  });
});

describe("a refinement written on a generic alias", () => {
  it("gates the slot the generic declares", () => {
    const refine = refineOf("ng");
    expect(refine("kumiki")).toBe(true);
    expect(refine("")).toBe(false);
    expect(meta("ng").refineKind).toBe("nonempty");
  });

  it("carries the argument's predicates too, base outward", () => {
    expect(meta("nh").refineAll?.map((r) => r.kind)).toEqual(["len-lt", "nonempty"]);
    const refine = refineOf("nh");
    expect(refine("")).toBe(false);
    expect(refine("kumikijs!")).toBe(false);
    expect(refine("kumiki")).toBe(true);
  });

  it("follows a generic applied inside another, under a nominal", () => {
    expect(meta("nn").refineAll?.map((r) => r.kind)).toEqual([
      "len-gt",
      "len-lt",
      "nonempty",
      "len-gt",
    ]);
    expect(meta("nn").refineAll?.map((r) => r.args)).toEqual([[3], [9], [], [1]]);
  });

  it("keeps the argument's predicates when a generic is applied inside itself", () => {
    expect(meta("gg").refineAll?.map((r) => r.kind)).toEqual(["len-lt", "nonempty", "nonempty"]);
    const refine = refineOf("gg");
    expect(refine("ku")).toBe(true);
    expect(refine("kukikikikiki")).toBe(false); // len-lt(9), from the innermost argument
    expect(refine("")).toBe(false);
  });

  it("keeps every predicate of a generic reached again through another one", () => {
    expect(meta("gn").refineAll?.map((r) => r.kind)).toEqual([
      "len-lt",
      "nonempty",
      "len-gt",
      "nonempty",
    ]);
    expect(meta("gn").refineAll?.map((r) => r.args)).toEqual([[9], [], [1], []]);
    expect(refineOf("gn")("kukikikikiki")).toBe(false);
  });

  it("follows a generic alias to another generic", () => {
    expect(meta("hh").refineKind).toBe("nonempty");
    expect(refineOf("hh")("")).toBe(false);
  });
});

describe("a generic alias written in terms of itself", () => {
  const walk = (src: string, root: string): string[] => {
    const types = new Map<string, TypeDef>();
    for (const d of parse(lex(src)).defs) if (d.kind === "TypeDef") types.set(d.name, d);
    const pos = { line: 1, col: 1 };
    return refinementsOf({ kind: "TypeRef", name: root, pos }, { types }).map((r) => r.pred);
  };

  it("collects, and terminates on, a generic that applies itself", () => {
    expect(walk("type Loop(T) = Loop(T) where nonempty\ntype L = Loop(Text)", "L")).toEqual([
      "nonempty",
    ]);
  });

  it("collects, and terminates on, an alias that is its own argument", () => {
    const src = "type NonEmpty(T) = T where nonempty\ntype A = NonEmpty(A)";
    expect(walk(src, "A")).toEqual(["nonempty"]);
  });
});
