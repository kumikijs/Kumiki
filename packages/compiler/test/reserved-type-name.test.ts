import { lex, parse } from "@kumikijs/compiler";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_TYPE_CONSTRUCTORS,
  isReservedTypeName,
  PRIM_TYPE_NAMES,
  RUNTIME_SUPPLIED_TYPE_NAMES,
  reservedTypeReason,
  STDLIB_TYPES,
} from "../src/stdlib-types.ts";
import { checkSource, codesOf } from "./helpers/diagnostics.ts";

const TAIL = `tile App = column(text("x"))
app A caps=[] routes={"/" -> App, "/404" -> App} init=[]`;

const diagnostics = (src: string) =>
  checkSource(src).map((e) => `${e.code} ${e.pos.line}:${e.pos.col} ${e.message}`);

const PRIMITIVE = "the primitive type";
const CONSTRUCTOR = "the built-in type constructor";
const RUNTIME = "the standard library's";

const reservedMessage = (name: string, meaning: string) =>
  `Type "${name}" collides with ${meaning} ${name}; uses of it never see this type`;

const RUNTIME_SUPPLIED = ["PanicInfo", "Route", "HttpError", "HttpStatus", "Duration", "FormValue"];

const RESERVED: [name: string, meaning: string][] = [
  ...PRIM_TYPE_NAMES.map((n): [string, string] => [n, PRIMITIVE]),
  ...[...BUILTIN_TYPE_CONSTRUCTORS.keys()].map((n): [string, string] => [n, CONSTRUCTOR]),
  ...[...RUNTIME_SUPPLIED_TYPE_NAMES].map((n): [string, string] => [n, RUNTIME]),
];

// The rows above are read from the tables, so these spell some out: a table
// that shrank would otherwise leave fewer rows that all pass.
const SPOT: [name: string, meaning: string][] = [
  ["Int", PRIMITIVE],
  ["File", PRIMITIVE],
  ["Option", CONSTRUCTOR],
  ["List", CONSTRUCTOR],
  ["Map", CONSTRUCTOR],
  ["PanicInfo", RUNTIME],
];

// Each use is one the standard library's definition would refuse, so a row
// fails if the name is reserved, and again if the use read the stdlib type.
const DECLARABLE: [string, string][] = [
  ["Email", `type Email = {address: Text}\nslot e : Email = {address: "ada@example.com"}`],
  ["Url", `type Url = Text\ntype Slug = nominal Text\nfn slug(u: Url) -> Slug = u`],
  ["Uuid", `type Uuid = Int\nslot id : Uuid = 5`],
  ["FormData", `type FormData = Text\nslot f : FormData = "x"`],
];

describe("the reserved names", () => {
  it("are the primitives, the built-in constructors and six standard library entries", () => {
    for (const row of SPOT) expect(RESERVED).toContainEqual(row);
    const stdlib = STDLIB_TYPES.map((t) => t.name);
    for (const name of RUNTIME_SUPPLIED_TYPE_NAMES) expect(stdlib).toContain(name);
    expect([...RUNTIME_SUPPLIED_TYPE_NAMES].sort()).toEqual([...RUNTIME_SUPPLIED].sort());
  });

  it("are answered by one predicate, which names the table each comes from", () => {
    const reason: Record<string, string> = {
      [PRIMITIVE]: "primitive",
      [CONSTRUCTOR]: "constructor",
      [RUNTIME]: "runtime-supplied",
    };
    for (const [name, meaning] of RESERVED) {
      expect(reservedTypeReason(name), name).toBe(reason[meaning]);
      expect(isReservedTypeName(name), name).toBe(true);
    }
  });

  it("and the declarable rows cover every other standard library entry", () => {
    const declarable = DECLARABLE.map(([name]) => name);
    expect(STDLIB_TYPES.map((t) => t.name).sort()).toEqual(
      [...RUNTIME_SUPPLIED, ...declarable].sort(),
    );
    for (const name of [...declarable, "Box", "Integer", "Options"]) {
      expect(reservedTypeReason(name), name).toBeUndefined();
      expect(isReservedTypeName(name), name).toBe(false);
    }
  });

  it.each(PRIM_TYPE_NAMES)("include %s, which the parser reads as a primitive", (name) => {
    const [def] = parse(lex(`type Box = ${name}`)).defs;
    expect(def?.kind === "TypeDef" && def.body.kind).toBe("TypePrim");
  });
});

describe("a program declaring a type under a reserved name", () => {
  it.each(RESERVED)("is E0231 at the declaration of %s", (name, meaning) => {
    expect(checkSource(`slot n : Int = 0\ntype ${name} = {v: Int}\n${TAIL}`)).toEqual([
      {
        code: "E0231",
        kind: "reserved-type-name",
        message: reservedMessage(name, meaning),
        pos: { line: 2, col: 1 },
      },
    ]);
  });

  it.each([
    "type Route = Text",
    "type Duration = Short | Long",
    "type HttpError(T) = {v: T}",
    "type Text = Int",
    "type Int = nominal Text",
    "type Bool = Yes | No",
    "type Time = Int where positive",
    "type Option = Int",
    "type List(T) = {v: T}",
    "type Map(K, V) = {k: K}",
    "type Result(T, E) = Good(T) | Bad(E)",
    "type Tuple(A, B) = {a: A, b: B}",
    "type Set(T) = List(T)",
  ])("reports the declaration whatever its body: %s", (decl) => {
    expect(codesOf(`${decl}\n${TAIL}`)).toEqual(["E0231"]);
  });

  it.each([
    "type HttpStatus = nominal Int where between(0, 599)",
    "type Option(T) = None | Some(T)",
    "type Result(T, E) = Ok(T) | Err(E)",
  ])("reports a declaration identical to the built-in one too: %s", (decl) => {
    expect(codesOf(`${decl}\n${TAIL}`)).toEqual(["E0231"]);
  });

  it.each([
    "Route",
    "Int",
    "Option",
  ])("reports each declaration of %s, beside the E0007 for the duplicate", (name) => {
    const found = codesOf(`type ${name} = Text\ntype ${name} = Bool\n${TAIL}`);
    expect(found.filter((c) => c === "E0231")).toHaveLength(2);
    expect(found).toContain("E0007");
  });
});

describe("a program declaring a type under a declarable name", () => {
  it.each(DECLARABLE)("is accepted for %s, and the uses mean the program's type", (_, decls) => {
    expect(diagnostics(`${decls}\n${TAIL}`)).toEqual([]);
  });
});

describe("a use of a reserved name keeps the standard library's type", () => {
  it("checks a slot against the standard library's Route, not the declared Text", () => {
    expect(diagnostics(`type Route = Text\nslot r : Route = "x"\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Route", RUNTIME)}`,
      "E0201 2:18 Expected Route but got Text",
    ]);
  });

  it("follows an alias to the standard library's definition, so a self-alias is no cycle", () => {
    expect(codesOf(`type Route = Route\n${TAIL}`)).toEqual(["E0231"]);
  });

  it("types an error-boundary fallback's $1 as the PanicInfo the runtime builds", () => {
    const src = `type PanicInfo = Text
slot secret : Option(Text) = None
tile Fb in=PanicInfo = column(text("recovered: " + $1.message))
tile Risky error-boundary=Fb = column(text(secret.get))
tile App = column(Risky)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    expect(diagnostics(src)).toEqual([`E0231 1:1 ${reservedMessage("PanicInfo", RUNTIME)}`]);
  });

  it("refuses a fallback typed by a program's own PanicInfo at the declaration", () => {
    const src = `type PanicInfo = Text
slot secret : Option(Text) = None
slot reveal : Bool = false
tile Fb in=PanicInfo = column(text("recovered: " + $1))
tile Risky error-boundary=Fb = when(reveal, text(secret.get))
tile Btn = button(text="go") {id: "go"}
reducer go on=ui.click(Btn) do= reveal := true
tile App = column(Risky, Btn)
app M caps=[] routes={"/" -> App, "/404" -> App} init=[]`;
    expect(diagnostics(src)).toEqual([`E0231 1:1 ${reservedMessage("PanicInfo", RUNTIME)}`]);
  });
});

describe("a use of a primitive name keeps the primitive", () => {
  it("refuses `type Int = Text` on its own", () => {
    expect(diagnostics(`type Int = Text\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Int", PRIMITIVE)}`,
    ]);
  });

  it("checks a slot typed Int as an Int, refusing the Text the declaration meant", () => {
    expect(diagnostics(`type Int = Text\nslot n : Int = 5\nslot t : Int = "x"\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Int", PRIMITIVE)}`,
      "E0201 3:16 Expected Int but got Text",
    ]);
  });

  it("checks a slot typed File as a File, inside a constructor and out", () => {
    const src = `type File = Text\nslot f : Option(File) = None\nslot g : File = "x"\n${TAIL}`;
    expect(diagnostics(src)).toEqual([
      `E0231 1:1 ${reservedMessage("File", PRIMITIVE)}`,
      "E0201 3:17 Expected File but got Text",
    ]);
  });

  it("follows a self-alias to the primitive, so it is no cycle", () => {
    expect(codesOf(`type Int = Int\n${TAIL}`)).toEqual(["E0231"]);
  });
});

describe("a use of a constructor name keeps the built-in constructor", () => {
  it("refuses `type Option = Int` on its own", () => {
    expect(diagnostics(`type Option = Int\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Option", CONSTRUCTOR)}`,
    ]);
  });

  it("checks `Option(Int)` against the built-in Option, with no arity report", () => {
    expect(diagnostics(`type Option = Int\nslot o : Option(Int) = None\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Option", CONSTRUCTOR)}`,
    ]);
  });

  it("measures a bare `Option` against the built-in's arity", () => {
    expect(diagnostics(`type Option = Int\nslot o : Option = 5\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Option", CONSTRUCTOR)}`,
      `E0210 2:10 Type "Option" expects 1 type argument(s) but got 0`,
    ]);
  });

  it("accepts a list for `List(Int)` and refuses the declared record shape", () => {
    expect(diagnostics(`type List(T) = {v: T}\nslot b : List(Int) = [1, 2]\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("List", CONSTRUCTOR)}`,
    ]);
    expect(diagnostics(`type List(T) = {v: T}\nslot a : List(Int) = {v: 1}\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("List", CONSTRUCTOR)}`,
      "E0201 2:22 Expected List(Int) but got {v: Int}",
    ]);
  });

  it("looks a member up on the built-in List", () => {
    const src = (body: string) => `type List(T) = {v: T}\nfn f(l: List(Int)) -> Int = ${body}`;
    expect(diagnostics(`${src("l.length")}\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("List", CONSTRUCTOR)}`,
    ]);
    expect(diagnostics(`${src("l.v")}\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("List", CONSTRUCTOR)}`,
      `E0108 2:29 Type "List" has no member ".v"`,
    ]);
  });

  it("checks `Map(Text, Int)` against the built-in Map", () => {
    const decl = "type Map(K, V) = {k: K}";
    expect(diagnostics(`${decl}\nslot m : Map(Text, Int) = {"a": 1}\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Map", CONSTRUCTOR)}`,
    ]);
    expect(diagnostics(`${decl}\nslot m : Map(Text, Int) = {k: "a"}\n${TAIL}`)).toEqual([
      `E0231 1:1 ${reservedMessage("Map", CONSTRUCTOR)}`,
      "E0201 2:27 Expected Map(Text, Int) but got {k: Text}",
    ]);
  });

  it.each([
    `type Set(T) = {v: T}\nslot s : Set(Int) = [1]`,
    `type Result(T, E) = {v: T}\nslot r : Result(Int, Text) = Err("x")`,
    `type Tuple = {a: Int}\nslot p : Tuple(Int, Int) = (1, 2)`,
  ])("checks against the built-in, with no arity report: %s", (src) => {
    expect(codesOf(`${src}\n${TAIL}`)).toEqual(["E0231"]);
  });

  it.each([
    "type List(T) = List(T)",
    "type Option = Option(Int)",
  ])("follows a self-application to the built-in, so it is no cycle: %s", (decl) => {
    expect(codesOf(`${decl}\n${TAIL}`)).toEqual(["E0231"]);
  });
});

describe("the standard library names everywhere else", () => {
  const positions = (n: string): [string, string][] => {
    const lower = `${n.charAt(0).toLowerCase()}${n.slice(1)}`;
    return [
      ["a slot annotation", `slot x : Option(${n}) = None`],
      ["a fn parameter and return", `fn f(a: Option(${n})) -> Option(${n}) = a`],
      ["a tile in=", `tile T in=${n} = text("t")`],
      ["a record field", `type Box = {v: ${n}}\nslot b : Option(Box) = None`],
      ["an alias of it", `type Mine = ${n}\nslot b : Option(Mine) = None`],
      [
        "a type parameter of that spelling",
        `type Box(${n}) = {v: ${n}}\nslot b : Box(Int) = {v: 1}`,
      ],
      ["a type whose name starts with it", `type ${n}View = {v: Int}\nslot b : ${n}View = {v: 1}`],
      ["a type whose name ends with it", `type App${n} = Int\nslot b : App${n} = 1`],
      ["a slot of that spelling", `slot ${lower} : Int = 0`],
      ["a fn of that spelling", `fn ${lower}(a: Int) -> Int = a`],
      ["a tile of that name", `tile ${n} = text("t")`],
      ["a variant tag of that name", `type Mine = ${n} | Other\nslot m : Mine = ${n}`],
    ];
  };
  // `slot route` is E0115: that name is the router's slot, not a type's.
  const cases = STDLIB_TYPES.flatMap((t) =>
    positions(t.name)
      .filter(([, decls]) => !decls.startsWith("slot route "))
      .map(([where, decls]) => ({ name: t.name, where, decls })),
  );
  it.each(cases)("leaves $name in $where alone", ({ decls }) => {
    expect(diagnostics(`${decls}\n${TAIL}`)).toEqual([]);
  });
});

describe("the primitive and constructor names everywhere else", () => {
  const use = (n: string): string =>
    BUILTIN_TYPE_CONSTRUCTORS.has(n)
      ? `${n}(${n === "Map" || n === "Result" ? "Text, Int" : "Int"})`
      : n;
  const positions = (n: string): [string, string][] => {
    const lower = `${n.charAt(0).toLowerCase()}${n.slice(1)}`;
    return [
      ["a slot annotation", `slot x : Option(${use(n)}) = None`],
      ["a fn parameter and return", `fn f(a: Option(${use(n)})) -> Option(${use(n)}) = a`],
      ["a record field", `type Box = {v: ${use(n)}}\nslot b : Option(Box) = None`],
      ["an alias of it", `type Mine = ${use(n)}\nslot b : Option(Mine) = None`],
      ["a type whose name starts with it", `type ${n}View = {v: Int}\nslot b : ${n}View = {v: 1}`],
      ["a type whose name ends with it", `type App${n} = Int\nslot b : App${n} = 1`],
      ["a lower-case type of that spelling", `type ${lower} = Int\nslot b : ${lower} = 1`],
      ["a slot of that spelling", `slot ${lower} : Int = 0`],
      ["a fn of that spelling", `fn ${lower}(a: Int) -> Int = a`],
      ["a tile of that name", `tile ${n} = text("t")`],
    ];
  };
  const cases = [...PRIM_TYPE_NAMES, ...BUILTIN_TYPE_CONSTRUCTORS.keys()].flatMap((name) =>
    positions(name).map(([where, decls]) => ({ name, where, decls })),
  );
  it.each(cases)("leaves $name in $where alone", ({ decls }) => {
    expect(diagnostics(`${decls}\n${TAIL}`)).toEqual([]);
  });
});
