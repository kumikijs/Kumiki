// A `Set` is stored as `{ [key]: true }` and a `Map` as a plain object, so at
// runtime their keys are JavaScript object keys — strings. The members that
// hand keys back (`Set(T).to-list`, `Map(K, V).keys`, `Map(K, V).entries`, and
// `Map(K, V).filter`, whose predicate is given each key as `$1`; stdlib.md
// §2.2.1 / §2.2.2) are told by the checker how the declared key type is
// represented, and codegen passes that along. Without it a `Set(Int)` read
// back `["7", "8"]` under a `List(Int)` type.
//
// What is pinned here is the decision — the `keyKind` the checker records on
// the reader for each declared key type and for each place a receiver's type
// can come from — plus one lowering per helper, to show the decision reaches
// the emitted call. The runtime's side is in `packages/runtime/test/stdlib.test.ts`,
// and example 102 runs the two together.

import { check, compile, type Expr, lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";

const app = (defs: string): string =>
  `${defs}\ntile Btn = button(text="go")\ntile App = column(Btn)\napp A\n    caps   = []\n    routes = {"/" -> App, "/404" -> App}\n    init   = []`;

/** An initial value a slot of `type` accepts, so the case checks clean. */
const emptyOf = (type: string): string =>
  type.startsWith("Option") ? "None" : type.startsWith("Map") ? "{}" : "[]";

const READERS = new Set(["to-list", "keys", "entries", "filter"]);
type Reader = Extract<Expr, { kind: "FieldAccess" } | { kind: "MethodCall" }>;

/** Every reader node in the checked program, a receiver before a fragment argument. */
function readersOf(defs: string): Reader[] {
  const program = parse(lex(app(defs)));
  const errors = check(program).filter((e) => e.severity !== "warning");
  if (errors.length > 0) throw new Error(errors.map((e) => `${e.code} ${e.message}`).join("\n"));
  const found: Reader[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (!v || typeof v !== "object") return;
    const n = v as Record<string, unknown>;
    const name = n.kind === "FieldAccess" ? n.field : n.kind === "MethodCall" ? n.method : null;
    if (typeof name === "string" && READERS.has(name)) found.push(n as Reader);
    for (const child of Object.values(n)) visit(child);
  };
  visit(program);
  return found;
}

/**
 * The kind recorded on the last reader of a reducer that writes `rhs` into
 * `res` — the one inside the fragment when the receiver is a reader too, as in
 * `m.entries.map($2.to-list)`.
 */
function kindOf(decls: string, resType: string, rhs: string): string | undefined {
  const last = readersOf(`${decls}
slot res : ${resType} = ${emptyOf(resType)}
reducer act on=ui.click(Btn)
    do= res := ${rhs}`).at(-1);
  if (!last) throw new Error(`no reader in ${rhs}`);
  return last.keyKind;
}

describe("a reader of a numeric key records number", () => {
  it.each([
    ["Set(Int)", "st.to-list", "List(Int)"],
    ["Set(Int)", "st.to-list()", "List(Int)"],
    ["Set(Float)", "st.to-list", "List(Float)"],
    ["Set(Time)", "st.to-list", "List(Time)"],
  ])("%s / %s", (setType, rhs, resType) => {
    expect(kindOf(`slot st : ${setType} = {}`, resType, rhs)).toBe("number");
  });

  it.each([
    ["m.keys", "List(Int)"],
    ["m.keys()", "List(Int)"],
    ["m.entries", "List(Tuple(Int, Text))"],
  ])("Map(Int, Text) / %s", (rhs, resType) => {
    expect(kindOf(`slot m : Map(Int, Text) = {}`, resType, rhs)).toBe("number");
  });

  // The kind is the key type's *representation*, so a name over a number
  // reads a number back — followed through the nominal and the refinement.
  it("follows a nominal over Int", () => {
    const decls = `type TaskId = nominal Int\nslot st : Set(TaskId) = {}`;
    expect(kindOf(decls, "List(TaskId)", "st.to-list")).toBe("number");
  });

  it("follows a where over Int", () => {
    const decls = `type Small = Int where between(0, 9)\nslot st : Set(Small) = {}`;
    expect(kindOf(decls, "List(Small)", "st.to-list")).toBe("number");
  });
});

describe("a reader of a Bool key records bool", () => {
  it("Set(Bool) / st.to-list", () => {
    expect(kindOf(`slot st : Set(Bool) = {}`, "List(Bool)", "st.to-list")).toBe("bool");
  });

  it("Map(Bool, Int) / m.entries", () => {
    const decls = `slot m : Map(Bool, Int) = {}`;
    expect(kindOf(decls, "List(Tuple(Bool, Int))", "m.entries")).toBe("bool");
  });
});

describe("a Text key records nothing", () => {
  it("Map(Text, Int) / m.keys", () => {
    expect(kindOf(`slot m : Map(Text, Int) = {}`, "List(Text)", "m.keys")).toBeUndefined();
  });

  it("Set(Text) / st.to-list", () => {
    expect(kindOf(`slot st : Set(Text) = {}`, "List(Text)", "st.to-list")).toBeUndefined();
  });

  // The usual shape of an id. A nominal is followed to its base, so this is the
  // case that would tip to "number" if the base were misread.
  it("Set(TodoId) with TodoId = nominal Text", () => {
    const decls = `type TodoId = nominal Text\nslot st : Set(TodoId) = {}`;
    expect(kindOf(decls, "List(TodoId)", "st.to-list")).toBeUndefined();
  });

  // An Option's `to-list` shares the name and the helper, and has no key.
  it("Option(Int) / o.to-list", () => {
    expect(kindOf(`slot o : Option(Int) = None`, "List(Int)", "o.to-list")).toBeUndefined();
  });
});

describe("the receiver's type is followed wherever it comes from", () => {
  it("a let binding", () => {
    const decls = `slot st : Set(Int) = {}`;
    expect(kindOf(decls, "List(Int)", "let s = st.add(1) in s.to-list")).toBe("number");
  });

  it("a record field", () => {
    const decls = `type R = {ids: Set(Int)}\nslot r : R = {ids: {}}`;
    expect(kindOf(decls, "List(Int)", "r.ids.to-list")).toBe("number");
  });

  it("a fn parameter", () => {
    const readers = readersOf(`fn ids(s: Set(Int)) -> List(Int) = s.to-list`);
    expect(readers.map((r) => r.keyKind)).toEqual(["number"]);
  });

  // `$1` / `$2` are bound to what the receiver hands the fragment, so a key
  // reader on them is decided like any other. They used to be bound with no
  // type, and `rs.map($1.ids.to-list)` read strings back.
  it("the element $1 of a List", () => {
    const decls = `type R = {ids: Set(Int)}\nslot rs : List(R) = []`;
    expect(kindOf(decls, "List(List(Int))", "rs.map($1.ids.to-list)")).toBe("number");
  });

  it("the value $2 of a Map's .entries", () => {
    const decls = `slot m : Map(Text, Set(Int)) = {}`;
    expect(kindOf(decls, "List(List(Int))", "m.entries.map($2.to-list)")).toBe("number");
  });

  it("the value $1 of an Option", () => {
    const decls = `type R = {ids: Set(Int)}\nslot o : Option(R) = None`;
    expect(kindOf(decls, "Option(List(Int))", "o.map($1.ids.to-list)")).toBe("number");
  });

  // A property-test invariant reads the state `run-reducer` answers. Its
  // slots are the program's, so `slots.st` has the slot's declared type.
  it("the slots a property-test invariant reads through run-reducer", () => {
    const readers = readersOf(`slot st : Set(Int) = {}
reducer add on=ui.click(Btn)
    do= st := st.add(7)
test adds-seven =
    property-test
        for-all   = {n: Int}
        given     = {slots: {st: {}}, event: {type: ui.click, target: Btn}}
        invariant = run-reducer(add).slots.st.to-list.contains(7)`);
    expect(readers.map((r) => r.keyKind)).toEqual(["number"]);
  });
});

// Typing the state is what lets the key reader above be decided, and it
// decides the rest of the read too: a slot name the program does not declare
// is the E0108 it is anywhere else, where it used to read `undefined` at run
// time and fail the property as a counterexample.
describe("the state run-reducer answers", () => {
  const withInvariant = (invariant: string) =>
    check(
      parse(
        lex(
          app(`slot st : Set(Int) = {}
reducer add on=ui.click(Btn)
    do= st := st.add(7)
test t =
    property-test
        for-all   = {n: Int}
        given     = {slots: {st: {}}, event: {type: ui.click, target: Btn}}
        invariant = ${invariant}`),
        ),
      ),
    ).map((e) => `${e.code} ${e.message}`);

  it("reports a slot the program does not declare", () => {
    expect(withInvariant("run-reducer(add).slots.stt.size == 1")).toEqual([
      'E0108 Record type has no field or method ".stt"',
    ]);
  });

  // `route` is the runtime's slot: no program declares it, and it is in the
  // state all the same.
  it("carries the runtime's route slot", () => {
    expect(withInvariant('run-reducer(add).slots.route.path == ""')).toEqual([]);
  });
});

describe("Map.filter is a key reader too", () => {
  it("records the key's kind, since its predicate is handed each key as $1", () => {
    const decls = `slot m : Map(Int, Text) = {}`;
    expect(kindOf(decls, "Map(Int, Text)", "m.filter($1 == 3)")).toBe("number");
  });

  it("records nothing on a List, whose predicate is handed elements", () => {
    const decls = `slot xs : List(Int) = []`;
    expect(kindOf(decls, "List(Int)", "xs.filter($1 == 3)")).toBeUndefined();
  });
});

describe("the recorded kind reaches the emitted call", () => {
  /** The emitted module for one reducer that writes `rhs` into `res`. */
  function jsFor(decls: string, resType: string, rhs: string): string {
    const src = app(`${decls}
slot res : ${resType} = ${emptyOf(resType)}
reducer act on=ui.click(Btn)
    do= res := ${rhs}`);
    const r = compile(src, { runtimeSpecifier: "./runtime.js" });
    if (r.kind !== "ok") throw new Error(r.errors.map((e) => `${e.code} ${e.message}`).join("\n"));
    return r.js;
  }

  it.each([
    ["toList", "slot st : Set(Int) = {}", "List(Int)", "st.to-list"],
    ["mapKeys", "slot m : Map(Int, Text) = {}", "List(Int)", "m.keys"],
    ["mapEntries", "slot m : Map(Int, Text) = {}", "List(Tuple(Int, Text))", "m.entries"],
    ["filter", "slot m : Map(Int, Text) = {}", "Map(Int, Text)", "m.filter($1 == 3)"],
  ])("_s.%s", (helper, decls, resType, rhs) => {
    // The helper's last argument, however the receiver and the fragment lower.
    expect(jsFor(decls, resType, rhs)).toMatch(new RegExp(`_s\\.${helper}\\(.*, "number"\\)`));
  });
});
